import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import type { AgentServerEvent } from '../../shared/agent.js'
import type {
  ConversationSnapshot,
  ConversationSubscription,
  ConversationThreadStatus,
  ConversationThreadSummary,
  ForkConversationInput,
  HandoffConversationInput,
  InterruptTurnInput,
  LoadProjectConversationsInput,
  PendingApproval,
  RequestedPermission,
  RenameConversationInput,
  ResolveApprovalInput,
  SetConversationPinnedInput,
  SetThreadGoalInput,
  StartConversationInput,
  StartTurnInput,
  SteerTurnInput,
  ThreadGoal,
  ThreadGoalStatus,
} from '../../shared/conversation.js'
import type { JsonRpcNotificationHandler, JsonRpcRequestHandler, JsonValue } from '../runtime/jsonlRpc.js'
import type { StateDatabase } from '../state/database.js'
import type { MoveWorktreeChangesInput, MoveWorktreeChangesResult } from '../../shared/worktree.js'
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
  resultFor: (input: ResolveApprovalInput) => JsonValue
  cancelResult: JsonValue
}

type PermissionOption = RequestedPermission & {
  section: 'network' | 'legacyRead' | 'legacyWrite' | 'entry'
  raw: JsonValue
}

type ParsedPermissionRequest = {
  options: PermissionOption[]
  globScanMaxDepth: number | null
}

type AgentServiceOptions = {
  moveWorktreeChanges?: (input: MoveWorktreeChangesInput) => Promise<MoveWorktreeChangesResult>
}

const MAX_PERMISSION_OPTIONS = 64
const MAX_PERMISSION_TEXT = 4_096

export class AgentService {
  readonly #runtime: RuntimePort
  readonly #database: StateDatabase
  readonly #subscriptions = new Set<ConversationSubscription>()
  readonly #approvalResolvers = new Map<string, ApprovalResolver>()
  readonly #activeTurns = new Set<string>()
  readonly #handoffThreads = new Set<string>()
  readonly #moveWorktreeChanges: AgentServiceOptions['moveWorktreeChanges']
  readonly #disposeRuntime: (() => void)[]
  #snapshot: ConversationSnapshot = {
    projectId: null,
    threads: [],
    selectedThreadId: null,
    listArchived: false,
    listSearchTerm: '',
    nextCursor: null,
    threadStates: {},
    goals: {},
    approvals: [],
    error: null,
  }

  constructor(runtime: RuntimePort, database: StateDatabase, options: AgentServiceOptions = {}) {
    this.#runtime = runtime
    this.#database = database
    this.#moveWorktreeChanges = options.moveWorktreeChanges
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
      runtime.registerRequestHandler(
        'item/permissions/requestApproval',
        (params, context) => this.#requestPermissionsApproval(params, context.id),
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

  async loadProject(input: LoadProjectConversationsInput): Promise<ConversationSnapshot> {
    const project = this.#requireProject(input.projectId)
    const archived = input.archived ?? false
    const searchTerm = normalizeSearchTerm(input.searchTerm)
    const cursor = input.cursor ?? null
    if (cursor && (
      this.#snapshot.projectId !== input.projectId
      || this.#snapshot.listArchived !== archived
      || this.#snapshot.listSearchTerm !== searchTerm
      || this.#snapshot.nextCursor !== cursor
    )) throw new Error('The conversation page cursor is stale.')
    await this.#runtime.start()
    const params: Record<string, JsonValue> = {
      archived,
      cwd: project.path,
      limit: 50,
      sortDirection: 'desc',
      sortKey: 'updated_at',
    }
    if (searchTerm) params.searchTerm = searchTerm
    if (cursor) params.cursor = cursor
    const result = asRecord(await this.#runtime.request('thread/list', params))
    const pinnedIds = new Set(this.#database.listPinnedProjectThreadIds(input.projectId, archived))
    const page = asArray(result.data).map((value) => {
      const thread = asRecord(value)
      const threadId = requireString(thread.id, 'thread.id')
      return this.#toThreadSummary(thread, pinnedIds.has(threadId))
    })
    for (const thread of page) this.#database.associateThread(input.projectId, thread.id, archived)
    const pinned = cursor ? [] : await this.#readMissingPinnedThreads(pinnedIds, page, searchTerm)
    const threads = cursor
      ? mergeThreadPage(this.#snapshot.threads, page)
      : mergeThreadPage(pinned, page)
    this.#update({
      projectId: input.projectId,
      threads,
      listArchived: archived,
      listSearchTerm: searchTerm,
      nextCursor: optionalString(result.nextCursor),
      selectedThreadId: threads.some(({ id }) => id === this.#snapshot.selectedThreadId)
        ? this.#snapshot.selectedThreadId
        : null,
      error: null,
    })
    return this.#snapshot
  }

  async selectThread(threadId: string): Promise<ConversationSnapshot> {
    this.#requireVisibleThread(threadId)
    await this.#runtime.start()
    const result = asRecord(await this.#runtime.request('thread/resume', { threadId }))
    const thread = asRecord(result.thread)
    this.#hydrateThread(thread)
    const projectId = this.#snapshot.projectId
    if (projectId) this.#database.associateThread(projectId, threadId)
    this.#update({ selectedThreadId: threadId, error: null })
    await this.#loadThreadGoal(threadId)
    return this.#snapshot
  }

  async openLinkedThread(projectId: string, threadId: string): Promise<ConversationSnapshot> {
    this.#requireProject(projectId)
    if (!this.#database.hasProjectThread(projectId, threadId)) {
      throw new Error('Conversation is not associated with the requested project.')
    }
    await this.#runtime.start()
    const result = asRecord(await this.#runtime.request('thread/resume', { threadId }))
    const thread = asRecord(result.thread)
    if (requireString(thread.id, 'thread.id') !== threadId) {
      throw new Error('Codex returned another conversation for the deep link.')
    }
    this.#hydrateThread(thread)
    this.#update({
      projectId,
      threads: [this.#toThreadSummary(thread)],
      selectedThreadId: threadId,
      listArchived: false,
      listSearchTerm: '',
      nextCursor: null,
      error: null,
    })
    await this.#loadThreadGoal(threadId)
    return this.#snapshot
  }

  async renameThread(input: RenameConversationInput): Promise<ConversationSnapshot> {
    this.#requireVisibleThread(input.threadId)
    const name = requireThreadName(input.name)
    await this.#runtime.request('thread/name/set', { threadId: input.threadId, name })
    this.#update({
      threads: this.#snapshot.threads.map((thread) =>
        thread.id === input.threadId ? { ...thread, name } : thread),
      error: null,
    })
    return this.#snapshot
  }

  async archiveThread(threadId: string): Promise<ConversationSnapshot> {
    this.#requireIdleVisibleThread(threadId)
    await this.#runtime.request('thread/archive', { threadId })
    this.#database.setThreadArchived(threadId, true)
    this.#removeThreadFromCurrentList(threadId)
    return this.#reloadCurrentList()
  }

  async unarchiveThread(threadId: string): Promise<ConversationSnapshot> {
    this.#requireVisibleThread(threadId)
    await this.#runtime.request('thread/unarchive', { threadId })
    this.#database.setThreadArchived(threadId, false)
    this.#removeThreadFromCurrentList(threadId)
    return this.#reloadCurrentList()
  }

  async deleteThread(threadId: string): Promise<ConversationSnapshot> {
    this.#requireIdleVisibleThread(threadId)
    await this.#runtime.request('thread/delete', { threadId })
    this.#database.removeThreadAssociation(threadId)
    this.#removeThreadFromCurrentList(threadId, true)
    return this.#reloadCurrentList()
  }

  async forkThread(input: ForkConversationInput): Promise<ConversationSnapshot> {
    this.#requireVisibleThread(input.threadId)
    await this.#runtime.start()
    const result = asRecord(await this.#runtime.request('thread/fork', {
      threadId: input.threadId,
      ...(input.lastTurnId ? { lastTurnId: input.lastTurnId } : {}),
    }))
    const thread = asRecord(result.thread)
    const threadId = requireString(thread.id, 'thread.id')
    const projectId = this.#snapshot.projectId
    if (!projectId) throw new Error('No project is loaded.')
    const worktreeId = this.#database.getThreadWorktreeId(input.threadId)
    this.#database.associateThread(projectId, threadId, undefined, worktreeId)
    this.#hydrateThread(thread)
    this.#update({
      threads: [this.#toThreadSummary(thread, false)],
      selectedThreadId: threadId,
      listArchived: false,
      listSearchTerm: '',
      nextCursor: null,
      error: null,
    })
    await this.#loadThreadGoal(threadId)
    return this.#snapshot
  }

  async compactThread(threadId: string): Promise<ConversationSnapshot> {
    this.#requireIdleVisibleThread(threadId)
    await this.#runtime.request('thread/compact/start', { threadId })
    this.#update({ error: null })
    return this.#snapshot
  }

  setThreadPinned(input: SetConversationPinnedInput): ConversationSnapshot {
    this.#requireVisibleThread(input.threadId)
    const projectId = this.#snapshot.projectId
    if (!projectId) throw new Error('No project is loaded.')
    this.#database.setThreadPinned(projectId, input.threadId, input.pinned)
    this.#update({
      threads: sortThreads(this.#snapshot.threads.map((thread) =>
        thread.id === input.threadId ? { ...thread, pinned: input.pinned } : thread)),
      error: null,
    })
    return this.#snapshot
  }

  async setThreadGoal(input: SetThreadGoalInput): Promise<ConversationSnapshot> {
    this.#requireVisibleThread(input.threadId)
    const objective = requireGoalObjective(input.objective)
    const tokenBudget = requireTokenBudget(input.tokenBudget)
    const result = asRecord(await this.#runtime.request('thread/goal/set', {
      threadId: input.threadId,
      objective,
      status: input.status,
      tokenBudget,
    }))
    const goal = toThreadGoal(asRecord(result.goal))
    if (goal.threadId !== input.threadId) throw new Error('Codex returned a goal for another conversation.')
    this.#update({ goals: { ...this.#snapshot.goals, [input.threadId]: goal }, error: null })
    return this.#snapshot
  }

  async clearThreadGoal(threadId: string): Promise<ConversationSnapshot> {
    this.#requireVisibleThread(threadId)
    await this.#runtime.request('thread/goal/clear', { threadId })
    this.#update({ goals: { ...this.#snapshot.goals, [threadId]: null }, error: null })
    return this.#snapshot
  }

  async handoffThread(input: HandoffConversationInput): Promise<ConversationSnapshot> {
    const thread = this.#requireIdleVisibleThread(input.threadId)
    const projectId = this.#snapshot.projectId
    if (!projectId) throw new Error('No project is loaded.')
    const sourceWorktreeId = this.#database.getThreadWorktreeId(input.threadId)
    if (sourceWorktreeId === input.targetWorktreeId) return this.#snapshot
    const project = this.#requireProject(projectId)
    const targetPath = input.targetWorktreeId
      ? this.#requireWorktreePath(projectId, input.targetWorktreeId)
      : project.path
    if (this.#handoffThreads.has(input.threadId)) throw new Error('This conversation is already being handed off.')
    this.#handoffThreads.add(input.threadId)
    try {
      let movedChanges = false
      if (input.moveChanges) {
        if (!this.#moveWorktreeChanges) throw new Error('Worktree handoff is unavailable.')
        const result = await this.#moveWorktreeChanges({
          projectId,
          sourceWorktreeId,
          targetWorktreeId: input.targetWorktreeId,
        })
        movedChanges = result.moved
      }
      try {
        this.#database.setThreadWorktree(projectId, input.threadId, input.targetWorktreeId)
      } catch (persistenceError) {
        if (!movedChanges || !this.#moveWorktreeChanges) throw persistenceError
        try {
          await this.#moveWorktreeChanges({
            projectId,
            sourceWorktreeId: input.targetWorktreeId,
            targetWorktreeId: sourceWorktreeId,
          })
        } catch (rollbackError) {
          throw new AggregateError(
            [persistenceError, rollbackError],
            'The worktree changes moved, but the conversation context could not be saved or rolled back.',
            { cause: rollbackError },
          )
        }
        throw new Error('The conversation context could not be saved; worktree changes were restored.', {
          cause: persistenceError,
        })
      }
      this.#update({
        threads: this.#snapshot.threads.map((item) => item.id === thread.id
          ? { ...item, projectPath: targetPath, worktreeId: input.targetWorktreeId }
          : item),
        error: null,
      })
      return this.#snapshot
    } finally {
      this.#handoffThreads.delete(input.threadId)
    }
  }

  async startConversation(input: StartConversationInput): Promise<ConversationSnapshot> {
    const project = this.#requireProject(input.projectId)
    const workingPath = input.worktreeId
      ? this.#requireWorktreePath(input.projectId, input.worktreeId)
      : project.path
    const text = requirePrompt(input.text)
    await this.#runtime.start()
    const params: Record<string, JsonValue> = {
      approvalPolicy: input.approvalPolicy ?? 'on-request',
      cwd: workingPath,
      sandbox: input.sandbox ?? 'workspace-write',
    }
    if (input.model) params.model = input.model
    if (input.modelProvider) params.modelProvider = input.modelProvider
    const result = asRecord(await this.#runtime.request('thread/start', params))
    const thread = asRecord(result.thread)
    const threadId = requireString(thread.id, 'thread.id')
    const worktreeId = input.worktreeId ?? null
    this.#database.associateThread(input.projectId, threadId, undefined, worktreeId)
    const summary = this.#toThreadSummary(thread, false)
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

  async startScheduledConversation(
    input: StartConversationInput,
    existingThreadId?: string,
  ): Promise<{ threadId: string; turnId: string | null }> {
    const text = requirePrompt(input.text)
    await this.#runtime.start()
    if (existingThreadId) {
      const resumed = asRecord(await this.#runtime.request('thread/resume', { threadId: existingThreadId }))
      this.#hydrateThread(asRecord(resumed.thread))
      const turnId = await this.#startTurn({
        threadId: existingThreadId,
        text,
        ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
      })
      return { threadId: existingThreadId, turnId }
    }

    const project = this.#requireProject(input.projectId)
    const workingPath = input.worktreeId
      ? this.#requireWorktreePath(input.projectId, input.worktreeId)
      : project.path
    const params: Record<string, JsonValue> = {
      approvalPolicy: input.approvalPolicy ?? 'never',
      cwd: workingPath,
      sandbox: input.sandbox ?? 'read-only',
    }
    if (input.model) params.model = input.model
    if (input.modelProvider) params.modelProvider = input.modelProvider
    const result = asRecord(await this.#runtime.request('thread/start', params))
    const thread = asRecord(result.thread)
    const threadId = requireString(thread.id, 'thread.id')
    const worktreeId = input.worktreeId ?? null
    this.#database.associateThread(input.projectId, threadId, undefined, worktreeId)
    this.#update({ threads: upsertThread(this.#snapshot.threads, this.#toThreadSummary(thread, false)) })
    const turnId = await this.#startTurn({
      threadId,
      text,
      ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
    })
    return { threadId, turnId }
  }

  async startTurn(input: StartTurnInput): Promise<ConversationSnapshot> {
    this.#requireVisibleThread(input.threadId)
    if (this.#handoffThreads.has(input.threadId)) throw new Error('Wait for the conversation handoff to finish.')
    await this.#runtime.start()
    await this.#startTurn({ ...input, text: requirePrompt(input.text) })
    this.#update({ selectedThreadId: input.threadId, error: null })
    return this.#snapshot
  }

  async steerTurn(input: SteerTurnInput): Promise<ConversationSnapshot> {
    this.#requireVisibleThread(input.threadId)
    await this.#runtime.request('turn/steer', {
      expectedTurnId: input.turnId,
      input: [textInput(requirePrompt(input.text))],
      threadId: input.threadId,
    })
    return this.#snapshot
  }

  async interruptTurn(input: InterruptTurnInput): Promise<ConversationSnapshot> {
    this.#requireVisibleThread(input.threadId)
    await this.#runtime.request('turn/interrupt', input)
    return this.#snapshot
  }

  resolveApproval(input: ResolveApprovalInput): ConversationSnapshot {
    const resolver = this.#approvalResolvers.get(input.requestId)
    if (!resolver) throw new Error('The approval request is no longer pending.')
    resolver.resolve(resolver.resultFor(input))
    this.#approvalResolvers.delete(input.requestId)
    this.#update({ approvals: this.#snapshot.approvals.filter(({ requestId }) => requestId !== input.requestId) })
    return this.#snapshot
  }

  dispose(): void {
    for (const dispose of this.#disposeRuntime.splice(0)) dispose()
    for (const resolver of this.#approvalResolvers.values()) resolver.resolve(resolver.cancelResult)
    this.#approvalResolvers.clear()
    for (const turnKey of this.#activeTurns) {
      this.#runtime.markTurnCompleted()
      this.#activeTurns.delete(turnKey)
    }
    this.#subscriptions.clear()
  }

  async #startTurn(input: StartTurnInput): Promise<string | null> {
    const params: Record<string, JsonValue> = {
      clientUserMessageId: randomUUID(),
      input: [textInput(input.text)],
      threadId: input.threadId,
    }
    const context = this.#database.getThreadProjectContext(input.threadId)
    if (context) {
      const project = this.#requireProject(context.projectId)
      params.cwd = context.worktreeId
        ? this.#requireWorktreePath(context.projectId, context.worktreeId)
        : project.path
    }
    if (input.reasoningEffort) params.effort = input.reasoningEffort
    this.#runtime.markTurnStarted()
    try {
      const result = asRecord(await this.#runtime.request('turn/start', params))
      return optionalString(asOptionalRecord(result.turn)?.id)
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
      if (thread) this.#update({ threads: upsertThread(this.#snapshot.threads, this.#toThreadSummary(thread)) })
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

    if (event.method === 'thread/goal/updated' && params && threadId) {
      const goal = asOptionalRecord(params.goal)
      if (goal) {
        const parsed = toThreadGoal(goal)
        if (parsed.threadId === threadId) {
          this.#update({ goals: { ...this.#snapshot.goals, [threadId]: parsed } })
        }
      }
    }

    if (event.method === 'thread/goal/cleared' && threadId) {
      this.#update({ goals: { ...this.#snapshot.goals, [threadId]: null } })
    }

    if (threadId && event.method === 'thread/archived') this.#database.setThreadArchived(threadId, true)
    if (threadId && event.method === 'thread/unarchived') this.#database.setThreadArchived(threadId, false)
    if (threadId && event.method === 'thread/deleted') this.#database.removeThreadAssociation(threadId)

    if ((event.method === 'thread/archived' && !this.#snapshot.listArchived)
      || (event.method === 'thread/unarchived' && this.#snapshot.listArchived)
      || event.method === 'thread/deleted') {
      if (threadId) this.#removeThreadFromCurrentList(threadId, event.method === 'thread/deleted')
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
      this.#update({ threads: upsertThread(this.#snapshot.threads, this.#toThreadSummary(asRecord(result.thread))) })
    } catch {
      // Completion is authoritative even when the optional metadata refresh fails.
    }
  }

  async #reloadCurrentList(): Promise<ConversationSnapshot> {
    const projectId = this.#snapshot.projectId
    if (!projectId) return this.#snapshot
    return this.loadProject({
      projectId,
      archived: this.#snapshot.listArchived,
      ...(this.#snapshot.listSearchTerm ? { searchTerm: this.#snapshot.listSearchTerm } : {}),
    })
  }

  async #loadThreadGoal(threadId: string): Promise<void> {
    const result = asRecord(await this.#runtime.request('thread/goal/get', { threadId }))
    const rawGoal = result.goal
    if (rawGoal === null || rawGoal === undefined) {
      this.#update({ goals: { ...this.#snapshot.goals, [threadId]: null } })
      return
    }
    const goal = toThreadGoal(asRecord(rawGoal))
    if (goal.threadId !== threadId) throw new Error('Codex returned a goal for another conversation.')
    this.#update({ goals: { ...this.#snapshot.goals, [threadId]: goal } })
  }

  async #readMissingPinnedThreads(
    pinnedIds: ReadonlySet<string>,
    page: readonly ConversationThreadSummary[],
    searchTerm: string,
  ): Promise<ConversationThreadSummary[]> {
    const visibleIds = new Set(page.map(({ id }) => id))
    const threads = await Promise.all([...pinnedIds]
      .filter((threadId) => !visibleIds.has(threadId))
      .map(async (requestedThreadId): Promise<ConversationThreadSummary | null> => {
        try {
          const result = asRecord(await this.#runtime.request('thread/read', {
            includeTurns: false,
            threadId: requestedThreadId,
          }))
          const thread = asRecord(result.thread)
          return this.#toThreadSummary(thread, true)
        } catch {
          return null
        }
      }))
    return threads.filter((thread): thread is ConversationThreadSummary =>
      thread !== null && matchesThreadSearch(thread, searchTerm))
  }

  #toThreadSummary(thread: Record<string, unknown>, pinned?: boolean): ConversationThreadSummary {
    const threadId = requireString(thread.id, 'thread.id')
    const worktreeId = this.#database.getThreadWorktreeId(threadId)
    const summary = toThreadSummary(
      thread,
      pinned ?? this.#database.isThreadPinned(threadId),
      worktreeId,
    )
    if (!worktreeId) return summary
    const worktree = this.#database.getManagedWorktree(worktreeId)
    return worktree ? { ...summary, projectPath: worktree.path } : summary
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
      environmentId: optionalString(params.environmentId),
      permissions: [],
    }
    return new Promise<JsonValue>((resolve) => {
      this.#approvalResolvers.set(requestId, {
        resolve,
        resultFor: ({ decision }) => ({ decision }),
        cancelResult: { decision: 'cancel' },
      })
      this.#update({ approvals: [...this.#snapshot.approvals, approval] })
    })
  }

  #requestPermissionsApproval(
    rawParams: JsonValue | undefined,
    requestIdValue: number | string,
  ): Promise<JsonValue> {
    const params = asRecord(rawParams)
    const requestId = String(requestIdValue)
    const parsed = parsePermissionRequest(params.permissions)
    if (parsed.options.length === 0) return Promise.resolve({ permissions: {}, scope: 'turn' })
    const approval: PendingApproval = {
      requestId,
      kind: 'permissions',
      threadId: requireString(params.threadId, 'approval.threadId'),
      turnId: requireString(params.turnId, 'approval.turnId'),
      itemId: requireString(params.itemId, 'approval.itemId'),
      startedAtMs: typeof params.startedAtMs === 'number' ? params.startedAtMs : Date.now(),
      reason: boundedOptionalString(params.reason),
      command: null,
      cwd: boundedOptionalString(params.cwd),
      grantRoot: null,
      environmentId: boundedOptionalString(params.environmentId),
      permissions: parsed.options.map(({ id, kind, access, target, targetKind }) => ({
        id,
        kind,
        access,
        target,
        targetKind,
      })),
    }
    return new Promise<JsonValue>((resolve) => {
      this.#approvalResolvers.set(requestId, {
        resolve,
        resultFor: (input) => permissionApprovalResult(input, parsed),
        cancelResult: { permissions: {}, scope: 'turn' },
      })
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
      threads: upsertThread(this.#snapshot.threads, this.#toThreadSummary(thread)),
      threadStates: { ...this.#snapshot.threadStates, [threadId]: state },
    })
  }

  #requireProject(projectId: string) {
    const project = this.#database.getProject(projectId)
    if (!project) throw new Error('Project not found.')
    return project
  }

  #requireWorktreePath(projectId: string, worktreeId: string): string {
    const worktree = this.#database.getManagedWorktree(worktreeId)
    if (worktree?.projectId !== projectId) throw new Error('Managed worktree not found for this project.')
    if (!statSync(worktree.path).isDirectory()) throw new Error('Managed worktree directory is unavailable.')
    return worktree.path
  }

  #requireVisibleThread(threadId: string): ConversationThreadSummary {
    const thread = this.#snapshot.threads.find(({ id }) => id === threadId)
    if (!thread) throw new Error('Conversation is not available in the current project view.')
    return thread
  }

  #requireIdleVisibleThread(threadId: string): ConversationThreadSummary {
    const thread = this.#requireVisibleThread(threadId)
    if (this.#snapshot.threadStates[threadId]?.turnStatus === 'inProgress') {
      throw new Error('Stop the active turn before changing this conversation.')
    }
    if (this.#snapshot.approvals.some((approval) => approval.threadId === threadId)) {
      throw new Error('Resolve pending approvals before changing this conversation.')
    }
    return thread
  }

  #removeThreadFromCurrentList(threadId: string, removeState = false): void {
    const threadStates = removeState
      ? Object.fromEntries(Object.entries(this.#snapshot.threadStates).filter(([id]) => id !== threadId))
      : this.#snapshot.threadStates
    const goals = removeState
      ? Object.fromEntries(Object.entries(this.#snapshot.goals).filter(([id]) => id !== threadId))
      : this.#snapshot.goals
    this.#update({
      threads: this.#snapshot.threads.filter(({ id }) => id !== threadId),
      selectedThreadId: this.#snapshot.selectedThreadId === threadId ? null : this.#snapshot.selectedThreadId,
      threadStates,
      goals,
      error: null,
    })
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

function requireThreadName(value: string): string {
  const name = value.trim()
  if (!name) throw new Error('Conversation name cannot be empty.')
  if (name.length > 120) throw new Error('Conversation name exceeds the 120 character limit.')
  return name
}

function requireGoalObjective(value: string): string {
  const objective = value.trim()
  if (!objective) throw new Error('Goal objective cannot be empty.')
  if (objective.length > 10_000) throw new Error('Goal objective exceeds the 10,000 character limit.')
  return objective
}

function requireTokenBudget(value: number | null): number | null {
  if (value === null) return null
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000_000) {
    throw new Error('Goal token budget must be a positive safe integer no greater than 1,000,000,000.')
  }
  return value
}

function normalizeSearchTerm(value: string | undefined): string {
  const term = value?.trim() ?? ''
  if (term.length > 200) throw new Error('Conversation search exceeds the 200 character limit.')
  return term
}

function toThreadSummary(
  thread: Record<string, unknown>,
  pinned = false,
  worktreeId: string | null = null,
): ConversationThreadSummary {
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
    pinned,
    worktreeId,
  }
}

function toThreadStatus(value: unknown): ConversationThreadStatus {
  const type = optionalString(asOptionalRecord(value)?.type)
  if (type === 'notLoaded' || type === 'idle' || type === 'active' || type === 'systemError') return type
  return 'unknown'
}

function toThreadGoal(value: Record<string, unknown>): ThreadGoal {
  const status = requireString(value.status, 'goal.status')
  if (!isThreadGoalStatus(status)) throw new Error('Codex returned an invalid goal.status.')
  const tokenBudget = value.tokenBudget === null ? null : requireFiniteNumber(value.tokenBudget, 'goal.tokenBudget')
  return {
    threadId: requireString(value.threadId, 'goal.threadId'),
    objective: requireString(value.objective, 'goal.objective'),
    status,
    tokenBudget,
    tokensUsed: requireFiniteNumber(value.tokensUsed, 'goal.tokensUsed'),
    timeUsedSeconds: requireFiniteNumber(value.timeUsedSeconds, 'goal.timeUsedSeconds'),
    createdAt: requireFiniteNumber(value.createdAt, 'goal.createdAt'),
    updatedAt: requireFiniteNumber(value.updatedAt, 'goal.updatedAt'),
  }
}

function isThreadGoalStatus(value: string): value is ThreadGoalStatus {
  return value === 'active' || value === 'paused' || value === 'blocked'
    || value === 'usageLimited' || value === 'budgetLimited' || value === 'complete'
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Codex returned an invalid ${label}.`)
  }
  return value
}

function upsertThread(
  threads: ConversationThreadSummary[],
  thread: ConversationThreadSummary,
): ConversationThreadSummary[] {
  return sortThreads([thread, ...threads.filter(({ id }) => id !== thread.id)])
}

function mergeThreadPage(
  current: ConversationThreadSummary[],
  page: ConversationThreadSummary[],
): ConversationThreadSummary[] {
  const byId = new Map(current.map((thread) => [thread.id, thread]))
  for (const thread of page) byId.set(thread.id, thread)
  return sortThreads([...byId.values()])
}

function sortThreads(threads: ConversationThreadSummary[]): ConversationThreadSummary[] {
  return [...threads].sort((left, right) => Number(right.pinned) - Number(left.pinned)
    || right.updatedAt - left.updatedAt)
}

function matchesThreadSearch(thread: ConversationThreadSummary, searchTerm: string): boolean {
  if (!searchTerm) return true
  const haystack = `${thread.name ?? ''} ${thread.preview}`.toLocaleLowerCase()
  return haystack.includes(searchTerm.toLocaleLowerCase())
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

function boundedOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? value.slice(0, MAX_PERMISSION_TEXT) : null
}

function parsePermissionRequest(value: unknown): ParsedPermissionRequest {
  const profile = asRecord(value)
  const options: PermissionOption[] = []
  const network = asOptionalRecord(profile.network)
  if (network?.enabled === true) {
    options.push({
      id: 'network',
      kind: 'network',
      access: 'network',
      target: '网络访问',
      targetKind: 'network',
      section: 'network',
      raw: { enabled: true },
    })
  }

  const fileSystem = asOptionalRecord(profile.fileSystem)
  if (!fileSystem) return { options, globScanMaxDepth: null }
  for (const target of boundedStringArray(fileSystem.read)) {
    options.push(permissionPathOption(options.length, 'read', target, 'legacyRead', target))
  }
  for (const target of boundedStringArray(fileSystem.write)) {
    options.push(permissionPathOption(options.length, 'write', target, 'legacyWrite', target))
  }
  for (const value of asArray(fileSystem.entries)) {
    if (options.length >= MAX_PERMISSION_OPTIONS) break
    const entry = asRecord(value)
    const access = entry.access
    if (access !== 'read' && access !== 'write' && access !== 'deny') continue
    const parsedPath = parsePermissionPath(entry.path)
    if (!parsedPath) continue
    options.push({
      id: `filesystem-${String(options.length)}`,
      kind: 'fileSystem',
      access,
      target: parsedPath.target,
      targetKind: parsedPath.targetKind,
      section: 'entry',
      raw: { access, path: parsedPath.raw },
    })
  }
  const depth = fileSystem.globScanMaxDepth
  return {
    options: options.slice(0, MAX_PERMISSION_OPTIONS),
    globScanMaxDepth: Number.isSafeInteger(depth) && typeof depth === 'number' && depth >= 0 ? depth : null,
  }
}

function boundedStringArray(value: unknown): string[] {
  return asArray(value)
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .slice(0, MAX_PERMISSION_OPTIONS)
    .map((item) => item.slice(0, MAX_PERMISSION_TEXT))
}

function permissionPathOption(
  index: number,
  access: 'read' | 'write',
  target: string,
  section: 'legacyRead' | 'legacyWrite',
  raw: string,
): PermissionOption {
  return {
    id: `filesystem-${String(index)}`,
    kind: 'fileSystem',
    access,
    target,
    targetKind: 'path',
    section,
    raw,
  }
}

function parsePermissionPath(value: unknown): {
  target: string
  targetKind: RequestedPermission['targetKind']
  raw: JsonValue
} | null {
  const path = asOptionalRecord(value)
  if (!path) return null
  if (path.type === 'path' && typeof path.path === 'string' && path.path) {
    const target = path.path.slice(0, MAX_PERMISSION_TEXT)
    return { target, targetKind: 'path', raw: { type: 'path', path: target } }
  }
  if (path.type === 'glob_pattern' && typeof path.pattern === 'string' && path.pattern) {
    const target = path.pattern.slice(0, MAX_PERMISSION_TEXT)
    return { target, targetKind: 'glob', raw: { type: 'glob_pattern', pattern: target } }
  }
  if (path.type !== 'special') return null
  const special = asOptionalRecord(path.value)
  if (!special || typeof special.kind !== 'string') return null
  const kind = special.kind.slice(0, 64)
  const subpath = typeof special.subpath === 'string' ? special.subpath.slice(0, MAX_PERMISSION_TEXT) : null
  if (kind === 'root' || kind === 'minimal' || kind === 'tmpdir' || kind === 'slash_tmp') {
    return { target: kind, targetKind: 'special', raw: { type: 'special', value: { kind } } }
  }
  if (kind === 'project_roots') {
    return {
      target: subpath ? `project_roots/${subpath}` : 'project_roots',
      targetKind: 'special',
      raw: { type: 'special', value: { kind, subpath } },
    }
  }
  if (kind === 'unknown' && typeof special.path === 'string') {
    const unknownPath = special.path.slice(0, MAX_PERMISSION_TEXT)
    return {
      target: subpath ? `${unknownPath}/${subpath}` : unknownPath,
      targetKind: 'special',
      raw: { type: 'special', value: { kind, path: unknownPath, subpath } },
    }
  }
  return null
}

function permissionApprovalResult(
  input: ResolveApprovalInput,
  request: ParsedPermissionRequest,
): JsonValue {
  if (input.decision === 'decline' || input.decision === 'cancel') {
    return { permissions: {}, scope: 'turn' }
  }
  const available = new Map(request.options.map((option) => [option.id, option]))
  const requestedIds = input.grantedPermissionIds ?? request.options.map(({ id }) => id)
  const selectedIds = [...new Set(requestedIds)]
  if (selectedIds.length > MAX_PERMISSION_OPTIONS) throw new Error('Too many permission grants were selected.')
  for (const id of selectedIds) {
    if (!available.has(id)) throw new Error('A selected permission is no longer part of this request.')
  }
  const selected = selectedIds.map((id) => available.get(id)).filter((value): value is PermissionOption => Boolean(value))
  const permissions: Record<string, JsonValue> = {}
  if (selected.some(({ section }) => section === 'network')) permissions.network = { enabled: true }
  const fileSystemOptions = selected.filter(({ kind }) => kind === 'fileSystem')
  if (fileSystemOptions.length > 0) {
    const read = fileSystemOptions.filter(({ section }) => section === 'legacyRead').map(({ raw }) => raw)
    const write = fileSystemOptions.filter(({ section }) => section === 'legacyWrite').map(({ raw }) => raw)
    const entries = fileSystemOptions.filter(({ section }) => section === 'entry').map(({ raw }) => raw)
    const fileSystem: Record<string, JsonValue> = {
      read: read.length > 0 ? read : null,
      write: write.length > 0 ? write : null,
    }
    if (entries.length > 0) fileSystem.entries = entries
    if (entries.length > 0 && request.globScanMaxDepth !== null) {
      fileSystem.globScanMaxDepth = request.globScanMaxDepth
    }
    permissions.fileSystem = fileSystem
  }
  return {
    permissions,
    scope: input.decision === 'acceptForSession' ? 'session' : 'turn',
  }
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
