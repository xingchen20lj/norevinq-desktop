import { randomUUID } from 'node:crypto'
import type { AgentServerEvent } from '../../shared/agent.js'
import type {
  ConversationSnapshot,
  ConversationSubscription,
  ConversationThreadStatus,
  ConversationThreadSummary,
  InterruptTurnInput,
  PendingApproval,
  ResolveApprovalInput,
  StartConversationInput,
  StartTurnInput,
  SteerTurnInput,
} from '../../shared/conversation.js'
import type { JsonRpcNotificationHandler, JsonRpcRequestHandler, JsonValue } from '../runtime/jsonlRpc.js'
import type { StateDatabase } from '../state/database.js'
import { createAgentActivityState, reduceAgentActivity } from './activityReducer.js'

type RuntimePort = {
  start: () => Promise<unknown>
  request: <T extends JsonValue = JsonValue>(method: string, params?: JsonValue) => Promise<T>
  onNotification: (handler: JsonRpcNotificationHandler) => () => void
  registerRequestHandler: (method: string, handler: JsonRpcRequestHandler) => () => void
  markTurnStarted: () => void
  markTurnCompleted: () => void
}

type ApprovalResolver = {
  resolve: (result: JsonValue) => void
}

export class AgentService {
  readonly #runtime: RuntimePort
  readonly #database: StateDatabase
  readonly #subscriptions = new Set<ConversationSubscription>()
  readonly #approvalResolvers = new Map<string, ApprovalResolver>()
  readonly #activeTurns = new Set<string>()
  readonly #disposeRuntime: (() => void)[]
  #snapshot: ConversationSnapshot = {
    projectId: null,
    threads: [],
    selectedThreadId: null,
    threadStates: {},
    approvals: [],
    error: null,
  }

  constructor(runtime: RuntimePort, database: StateDatabase) {
    this.#runtime = runtime
    this.#database = database
    this.#disposeRuntime = [
      runtime.onNotification((method, params) => this.#handleNotification({ method, params })),
      runtime.registerRequestHandler(
        'item/commandExecution/requestApproval',
        (params, context) => this.#requestApproval('command', params, context.id),
      ),
      runtime.registerRequestHandler(
        'item/fileChange/requestApproval',
        (params, context) => this.#requestApproval('fileChange', params, context.id),
      ),
    ]
  }

  getSnapshot(): ConversationSnapshot {
    return this.#snapshot
  }

  subscribe(subscription: ConversationSubscription): () => void {
    this.#subscriptions.add(subscription)
    subscription(this.#snapshot)
    return () => this.#subscriptions.delete(subscription)
  }

  async loadProject(projectId: string): Promise<ConversationSnapshot> {
    const project = this.#requireProject(projectId)
    await this.#runtime.start()
    const result = asRecord(await this.#runtime.request('thread/list', {
      archived: false,
      cwd: project.path,
      limit: 100,
      sortDirection: 'desc',
      sortKey: 'updated_at',
    }))
    const threads = asArray(result.data).map((value) => toThreadSummary(asRecord(value)))
    for (const thread of threads) this.#database.associateThread(projectId, thread.id)
    this.#update({
      projectId,
      threads,
      selectedThreadId: threads.some(({ id }) => id === this.#snapshot.selectedThreadId)
        ? this.#snapshot.selectedThreadId
        : null,
      error: null,
    })
    return this.#snapshot
  }

  async selectThread(threadId: string): Promise<ConversationSnapshot> {
    await this.#runtime.start()
    const result = asRecord(await this.#runtime.request('thread/resume', { threadId }))
    const thread = asRecord(result.thread)
    this.#hydrateThread(thread)
    const projectId = this.#snapshot.projectId
    if (projectId) this.#database.associateThread(projectId, threadId)
    this.#update({ selectedThreadId: threadId, error: null })
    return this.#snapshot
  }

  async startConversation(input: StartConversationInput): Promise<ConversationSnapshot> {
    const project = this.#requireProject(input.projectId)
    const text = requirePrompt(input.text)
    await this.#runtime.start()
    const params: Record<string, JsonValue> = {
      approvalPolicy: input.approvalPolicy ?? 'on-request',
      cwd: project.path,
      sandbox: input.sandbox ?? 'workspace-write',
    }
    if (input.model) params.model = input.model
    if (input.modelProvider) params.modelProvider = input.modelProvider
    const result = asRecord(await this.#runtime.request('thread/start', params))
    const thread = asRecord(result.thread)
    const threadId = requireString(thread.id, 'thread.id')
    const summary = toThreadSummary(thread)
    this.#database.associateThread(input.projectId, threadId)
    this.#update({
      projectId: input.projectId,
      selectedThreadId: threadId,
      threads: upsertThread(this.#snapshot.threads, summary),
      error: null,
    })
    await this.#startTurn({
      threadId,
      text,
      ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
    })
    return this.#snapshot
  }

  async startTurn(input: StartTurnInput): Promise<ConversationSnapshot> {
    await this.#runtime.start()
    await this.#startTurn({ ...input, text: requirePrompt(input.text) })
    this.#update({ selectedThreadId: input.threadId, error: null })
    return this.#snapshot
  }

  async steerTurn(input: SteerTurnInput): Promise<ConversationSnapshot> {
    await this.#runtime.request('turn/steer', {
      expectedTurnId: input.turnId,
      input: [textInput(requirePrompt(input.text))],
      threadId: input.threadId,
    })
    return this.#snapshot
  }

  async interruptTurn(input: InterruptTurnInput): Promise<ConversationSnapshot> {
    await this.#runtime.request('turn/interrupt', input)
    return this.#snapshot
  }

  resolveApproval(input: ResolveApprovalInput): ConversationSnapshot {
    const resolver = this.#approvalResolvers.get(input.requestId)
    if (!resolver) throw new Error('The approval request is no longer pending.')
    resolver.resolve({ decision: input.decision })
    this.#approvalResolvers.delete(input.requestId)
    this.#update({ approvals: this.#snapshot.approvals.filter(({ requestId }) => requestId !== input.requestId) })
    return this.#snapshot
  }

  dispose(): void {
    for (const dispose of this.#disposeRuntime.splice(0)) dispose()
    for (const resolver of this.#approvalResolvers.values()) resolver.resolve({ decision: 'cancel' })
    this.#approvalResolvers.clear()
    for (const turnKey of this.#activeTurns) {
      this.#runtime.markTurnCompleted()
      this.#activeTurns.delete(turnKey)
    }
    this.#subscriptions.clear()
  }

  async #startTurn(input: StartTurnInput): Promise<void> {
    const params: Record<string, JsonValue> = {
      clientUserMessageId: randomUUID(),
      input: [textInput(input.text)],
      threadId: input.threadId,
    }
    if (input.reasoningEffort) params.effort = input.reasoningEffort
    this.#runtime.markTurnStarted()
    try {
      asRecord(await this.#runtime.request('turn/start', params))
    } catch (error) {
      this.#runtime.markTurnCompleted()
      throw error
    }
  }

  #handleNotification(event: AgentServerEvent): void {
    const params = asOptionalRecord(event.params)
    const threadId = params ? optionalString(params.threadId) : null
    if (threadId) {
      const current = this.#snapshot.threadStates[threadId] ?? createAgentActivityState()
      this.#update({
        threadStates: {
          ...this.#snapshot.threadStates,
          [threadId]: reduceAgentActivity(current, event),
        },
      })
    }

    if (event.method === 'thread/started' && params) {
      const thread = asOptionalRecord(params.thread)
      if (thread) this.#update({ threads: upsertThread(this.#snapshot.threads, toThreadSummary(thread)) })
    }

    if (event.method === 'turn/started' && params) {
      const turn = asOptionalRecord(params.turn)
      const turnId = turn ? optionalString(turn.id) : null
      if (threadId && turnId) this.#activeTurns.add(turnKey(threadId, turnId))
    }

    if (event.method === 'turn/completed' && params) {
      const turn = asOptionalRecord(params.turn)
      const turnId = turn ? optionalString(turn.id) : null
      if (threadId && turnId) {
        const key = turnKey(threadId, turnId)
        if (this.#activeTurns.delete(key)) this.#runtime.markTurnCompleted()
        void this.#refreshThreadMetadata(threadId)
      }
    }

    if (event.method === 'thread/name/updated' && params && threadId) {
      const threadName = optionalString(params.threadName)
      this.#update({
        threads: this.#snapshot.threads.map((thread) =>
          thread.id === threadId ? { ...thread, name: threadName } : thread),
      })
    }

    if (event.method === 'thread/status/changed' && params && threadId) {
      const status = toThreadStatus(params.status)
      this.#update({
        threads: this.#snapshot.threads.map((thread) =>
          thread.id === threadId ? { ...thread, status } : thread),
      })
    }
  }

  async #refreshThreadMetadata(threadId: string): Promise<void> {
    try {
      const result = asRecord(await this.#runtime.request('thread/read', { includeTurns: false, threadId }))
      this.#update({ threads: upsertThread(this.#snapshot.threads, toThreadSummary(asRecord(result.thread))) })
    } catch {
      // Completion is authoritative even when the optional metadata refresh fails.
    }
  }

  #requestApproval(
    kind: PendingApproval['kind'],
    rawParams: JsonValue | undefined,
    requestIdValue: number | string,
  ): Promise<JsonValue> {
    const params = asRecord(rawParams)
    const requestId = String(requestIdValue)
    const approval: PendingApproval = {
      requestId,
      kind,
      threadId: requireString(params.threadId, 'approval.threadId'),
      turnId: requireString(params.turnId, 'approval.turnId'),
      itemId: requireString(params.itemId, 'approval.itemId'),
      startedAtMs: typeof params.startedAtMs === 'number' ? params.startedAtMs : Date.now(),
      reason: optionalString(params.reason),
      command: optionalString(params.command),
      cwd: optionalString(params.cwd),
      grantRoot: optionalString(params.grantRoot),
    }
    return new Promise<JsonValue>((resolve) => {
      this.#approvalResolvers.set(requestId, { resolve })
      this.#update({ approvals: [...this.#snapshot.approvals, approval] })
    })
  }

  #hydrateThread(thread: Record<string, unknown>): void {
    const threadId = requireString(thread.id, 'thread.id')
    let state = createAgentActivityState()
    state = reduceAgentActivity(state, { method: 'thread/started', params: { thread } })
    for (const rawTurn of asArray(thread.turns)) {
      const turn = asRecord(rawTurn)
      const turnId = requireString(turn.id, 'turn.id')
      state = reduceAgentActivity(state, { method: 'turn/started', params: { threadId, turn } })
      for (const item of asArray(turn.items)) {
        state = reduceAgentActivity(state, { method: 'item/started', params: { threadId, turnId, item } })
        state = reduceAgentActivity(state, { method: 'item/completed', params: { threadId, turnId, item } })
      }
      state = reduceAgentActivity(state, { method: 'turn/completed', params: { threadId, turn } })
    }
    this.#update({
      threads: upsertThread(this.#snapshot.threads, toThreadSummary(thread)),
      threadStates: { ...this.#snapshot.threadStates, [threadId]: state },
    })
  }

  #requireProject(projectId: string) {
    const project = this.#database.getProject(projectId)
    if (!project) throw new Error('Project not found.')
    return project
  }

  #update(patch: Partial<ConversationSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const subscription of this.#subscriptions) subscription(this.#snapshot)
  }
}

function textInput(text: string): JsonValue {
  return { type: 'text', text, text_elements: [] }
}

function requirePrompt(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Task instructions cannot be empty.')
  if (trimmed.length > 100_000) throw new Error('Task instructions exceed the 100,000 character limit.')
  return trimmed
}

function toThreadSummary(thread: Record<string, unknown>): ConversationThreadSummary {
  return {
    id: requireString(thread.id, 'thread.id'),
    sessionId: optionalString(thread.sessionId) ?? requireString(thread.id, 'thread.id'),
    projectPath: optionalString(thread.cwd) ?? '',
    preview: optionalString(thread.preview) ?? '',
    name: optionalString(thread.name),
    modelProvider: optionalString(thread.modelProvider) ?? 'unknown',
    status: toThreadStatus(thread.status),
    createdAt: optionalNumber(thread.createdAt) ?? 0,
    updatedAt: optionalNumber(thread.updatedAt) ?? 0,
    forkedFromId: optionalString(thread.forkedFromId),
    parentThreadId: optionalString(thread.parentThreadId),
    cliVersion: optionalString(thread.cliVersion) ?? '',
  }
}

function toThreadStatus(value: unknown): ConversationThreadStatus {
  const type = optionalString(asOptionalRecord(value)?.type)
  if (type === 'notLoaded' || type === 'idle' || type === 'active' || type === 'systemError') return type
  return 'unknown'
}

function upsertThread(
  threads: ConversationThreadSummary[],
  thread: ConversationThreadSummary,
): ConversationThreadSummary[] {
  return [thread, ...threads.filter(({ id }) => id !== thread.id)]
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

function turnKey(threadId: string, turnId: string): string {
  return `${threadId}:${turnId}`
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Codex returned an invalid object.')
  return value as Record<string, unknown>
}

function asOptionalRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Codex returned an invalid ${label}.`)
  return value
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
