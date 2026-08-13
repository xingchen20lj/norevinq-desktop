import { mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentService } from '../../src/main/agent/agentService.js'
import type {
  JsonRpcNotificationHandler,
  JsonRpcRequestContext,
  JsonRpcRequestHandler,
  JsonValue,
} from '../../src/main/runtime/jsonlRpc.js'
import { StateDatabase } from '../../src/main/state/database.js'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('AgentService', () => {
  it('starts a real protocol thread, reduces streamed activity, and persists its project link', async () => {
    const { database, projectId } = createDatabase()
    const runtime = new FakeRuntime()
    const service = new AgentService(runtime, database)

    const starting = service.startConversation({ projectId, text: 'Say hello' })
    await runtime.waitForRequest('turn/start')
    runtime.emit('turn/started', { threadId: 'thread-1', turn: turn('turn-1', 'inProgress') })
    await starting
    runtime.emit('item/started', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: { id: 'message-1', type: 'agentMessage', text: '', phase: 'final_answer' },
    })
    runtime.emit('item/agentMessage/delta', {
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'message-1', delta: 'hello',
    })
    runtime.emit('item/completed', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: { id: 'message-1', type: 'agentMessage', text: 'hello', phase: 'final_answer' },
    })
    runtime.emit('turn/completed', { threadId: 'thread-1', turn: turn('turn-1', 'completed') })

    const snapshot = service.getSnapshot()
    expect(snapshot.selectedThreadId).toBe('thread-1')
    expect(snapshot.threadStates['thread-1']?.turnStatus).toBe('completed')
    expect(snapshot.threadStates['thread-1']?.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'agentMessage', text: 'hello', status: 'completed' }),
    ]))
    expect(database.listProjectThreadIds(projectId)).toEqual(['thread-1'])
    expect(runtime.turnStarts).toBe(1)
    expect(runtime.turnCompletions).toBe(1)

    service.dispose()
    database.close()
  })

  it('holds reverse approval requests until an explicit renderer decision', async () => {
    const { database } = createDatabase()
    const runtime = new FakeRuntime()
    const service = new AgentService(runtime, database)
    const approvalPromise = runtime.requestFromServer('item/commandExecution/requestApproval', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'command-1',
      startedAtMs: 123,
      command: 'pnpm test',
      cwd: '/project',
    }, { id: 42, method: 'item/commandExecution/requestApproval' })

    expect(service.getSnapshot().approvals).toEqual([
      expect.objectContaining({ requestId: '42', kind: 'command', command: 'pnpm test' }),
    ])
    service.resolveApproval({ requestId: '42', decision: 'acceptForSession' })
    await expect(approvalPromise).resolves.toEqual({ decision: 'acceptForSession' })
    expect(service.getSnapshot().approvals).toEqual([])

    service.dispose()
    database.close()
  })

  it('declines or cancels pending approvals without leaving a resolver behind', async () => {
    const { database } = createDatabase()
    const runtime = new FakeRuntime()
    const service = new AgentService(runtime, database)
    const declined = runtime.requestFromServer('item/fileChange/requestApproval', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'patch-1',
      grantRoot: '/project',
    }, { id: 43, method: 'item/fileChange/requestApproval' })

    service.resolveApproval({ requestId: '43', decision: 'decline' })
    await expect(declined).resolves.toEqual({ decision: 'decline' })
    expect(() => service.resolveApproval({ requestId: '43', decision: 'accept' })).toThrow(
      'no longer pending',
    )

    const cancelled = runtime.requestFromServer('item/commandExecution/requestApproval', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'command-2',
      command: 'touch should-not-run',
    }, { id: 44, method: 'item/commandExecution/requestApproval' })
    service.dispose()
    await expect(cancelled).resolves.toEqual({ decision: 'cancel' })
    database.close()
  })

  it('grants only the selected network and path permission subset with explicit scope', async () => {
    const { database } = createDatabase()
    const runtime = new FakeRuntime()
    const service = new AgentService(runtime, database)
    const response = runtime.requestFromServer('item/permissions/requestApproval', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'permission-1',
      environmentId: 'local',
      startedAtMs: 123,
      cwd: '/project',
      reason: 'Install and write generated output',
      permissions: {
        network: { enabled: true },
        fileSystem: {
          read: ['/shared/read'],
          write: ['/shared/write'],
          globScanMaxDepth: 4,
          entries: [
            { path: { type: 'glob_pattern', pattern: '/generated/**' }, access: 'write' },
            { path: { type: 'special', value: { kind: 'tmpdir' } }, access: 'read' },
          ],
        },
      },
    }, { id: 45, method: 'item/permissions/requestApproval' })

    const approval = service.getSnapshot().approvals[0]
    expect(approval).toMatchObject({
      requestId: '45',
      kind: 'permissions',
      environmentId: 'local',
      permissions: [
        { id: 'network', access: 'network', target: '网络访问' },
        { access: 'read', target: '/shared/read' },
        { access: 'write', target: '/shared/write' },
        { access: 'write', target: '/generated/**', targetKind: 'glob' },
        { access: 'read', target: 'tmpdir', targetKind: 'special' },
      ],
    })
    const globId = approval?.permissions.find(({ target }) => target === '/generated/**')?.id
    expect(() => service.resolveApproval({
      requestId: '45',
      decision: 'accept',
      grantedPermissionIds: ['filesystem-999'],
    })).toThrow('no longer part of this request')
    expect(service.getSnapshot().approvals).toHaveLength(1)
    service.resolveApproval({
      requestId: '45',
      decision: 'acceptForSession',
      grantedPermissionIds: ['network', globId ?? 'missing'],
    })
    await expect(response).resolves.toEqual({
      permissions: {
        network: { enabled: true },
        fileSystem: {
          read: null,
          write: null,
          entries: [{ path: { type: 'glob_pattern', pattern: '/generated/**' }, access: 'write' }],
          globScanMaxDepth: 4,
        },
      },
      scope: 'session',
    })
    expect(service.getSnapshot().approvals).toEqual([])
    service.dispose()
    database.close()
  })

  it('returns an empty turn-scoped grant when a permission request is declined', async () => {
    const { database } = createDatabase()
    const runtime = new FakeRuntime()
    const service = new AgentService(runtime, database)
    const response = runtime.requestFromServer('item/permissions/requestApproval', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'permission-2',
      environmentId: null,
      startedAtMs: 123,
      cwd: '/project',
      reason: 'Needs the network',
      permissions: { network: { enabled: true }, fileSystem: null },
    }, { id: 46, method: 'item/permissions/requestApproval' })
    service.resolveApproval({ requestId: '46', decision: 'decline' })
    await expect(response).resolves.toEqual({ permissions: {}, scope: 'turn' })
    service.dispose()
    database.close()
  })

  it('lists, resumes, steers, and interrupts project conversations', async () => {
    const { database, projectId } = createDatabase()
    const runtime = new FakeRuntime()
    const service = new AgentService(runtime, database)

    const loaded = await service.loadProject({ projectId })
    expect(loaded.threads.map(({ id }) => id)).toEqual(['thread-1'])
    const selected = await service.selectThread('thread-1')
    expect(selected.selectedThreadId).toBe('thread-1')
    expect(selected.threadStates['thread-1']).toMatchObject({
      threadId: 'thread-1',
      turnId: 'turn-old',
      turnStatus: 'completed',
    })
    await service.steerTurn({ threadId: 'thread-1', turnId: 'turn-1', text: 'Also run tests' })
    await service.interruptTurn({ threadId: 'thread-1', turnId: 'turn-1' })

    expect(runtime.requests.map(({ method }) => method)).toEqual([
      'thread/list', 'thread/resume', 'thread/goal/get', 'turn/steer', 'turn/interrupt',
    ])
    service.dispose()
    database.close()
  })

  it('opens only a conversation already associated with the deep-linked project', async () => {
    const { database, projectId } = createDatabase()
    const otherPath = mkdtempSync(join(tmpdir(), 'aster-deep-link-project-'))
    temporaryPaths.push(otherPath)
    const otherProjectId = database.upsertProject(otherPath).id
    database.associateThread(projectId, 'thread-2')
    const runtime = new FakeRuntime()
    const service = new AgentService(runtime, database)

    await expect(service.openLinkedThread(otherProjectId, 'thread-2'))
      .rejects.toThrow('not associated')
    const opened = await service.openLinkedThread(projectId, 'thread-2')
    expect(opened).toMatchObject({
      projectId,
      selectedThreadId: 'thread-2',
      listArchived: false,
      listSearchTerm: '',
    })
    expect(opened.threads.map(({ id }) => id)).toEqual(['thread-2'])
    expect(runtime.requests.map(({ method }) => method)).toEqual(['thread/resume', 'thread/goal/get'])

    service.dispose()
    database.close()
  })

  it('searches and paginates with opaque cursors, rejecting stale continuation tokens', async () => {
    const { database, projectId } = createDatabase()
    const runtime = new FakeRuntime()
    runtime.threadListResponses.push(
      { data: [protocolThread([], 'thread-1', 30)], nextCursor: 'cursor-2', backwardsCursor: null },
      { data: [protocolThread([], 'thread-2', 20)], nextCursor: null, backwardsCursor: 'back-2' },
    )
    const service = new AgentService(runtime, database)

    const first = await service.loadProject({ projectId, searchTerm: '  hello  ' })
    expect(first).toMatchObject({ listArchived: false, listSearchTerm: 'hello', nextCursor: 'cursor-2' })
    const second = await service.loadProject({ projectId, searchTerm: 'hello', cursor: 'cursor-2' })
    expect(second.threads.map(({ id }) => id)).toEqual(['thread-1', 'thread-2'])
    expect(second.nextCursor).toBeNull()
    await expect(service.loadProject({ projectId, searchTerm: 'hello', cursor: 'stale' }))
      .rejects.toThrow('cursor is stale')
    const firstParams = runtime.requests[0]?.params as Record<string, JsonValue> | undefined
    expect(typeof firstParams?.cwd).toBe('string')
    expect(firstParams).toMatchObject({ limit: 50, searchTerm: 'hello' })
    expect(runtime.requests[1]?.params).toMatchObject({ cursor: 'cursor-2', searchTerm: 'hello' })

    service.dispose()
    database.close()
  })

  it('persists pinned tasks, sorts them first, and hydrates pins missing from the first server page', async () => {
    const { database, projectId } = createDatabase()
    const runtime = new FakeRuntime()
    runtime.threadListResponses.push({
      data: [protocolThread([], 'thread-1', 30), protocolThread([], 'thread-2', 20)],
      nextCursor: null,
      backwardsCursor: null,
    })
    const service = new AgentService(runtime, database)
    await service.loadProject({ projectId })
    const pinned = service.setThreadPinned({ threadId: 'thread-2', pinned: true })
    expect(pinned.threads.map(({ id }) => id)).toEqual(['thread-2', 'thread-1'])
    expect(pinned.threads[0]?.pinned).toBe(true)
    service.dispose()

    const restoredRuntime = new FakeRuntime()
    restoredRuntime.threadListResponses.push({
      data: [protocolThread([], 'thread-1', 30)],
      nextCursor: null,
      backwardsCursor: null,
    })
    const restored = new AgentService(restoredRuntime, database)
    const snapshot = await restored.loadProject({ projectId })
    expect(snapshot.threads.map(({ id }) => id)).toEqual(['thread-2', 'thread-1'])
    expect(snapshot.threads[0]).toMatchObject({ id: 'thread-2', pinned: true })
    expect(restoredRuntime.requests).toContainEqual(expect.objectContaining({
      method: 'thread/read',
      params: { includeTurns: false, threadId: 'thread-2' },
    }))

    restored.dispose()
    database.close()
  })

  it('renames, compacts, forks, archives, restores, and permanently deletes protocol threads', async () => {
    const { database, projectId } = createDatabase()
    const runtime = new FakeRuntime()
    const service = new AgentService(runtime, database)

    await service.loadProject({ projectId })
    await service.renameThread({ threadId: 'thread-1', name: '  Release review  ' })
    expect(service.getSnapshot().threads[0]?.name).toBe('Release review')
    await service.compactThread('thread-1')
    const forked = await service.forkThread({ threadId: 'thread-1' })
    expect(forked).toMatchObject({ selectedThreadId: 'thread-fork', listArchived: false, listSearchTerm: '' })
    expect(forked.threads.map(({ id }) => id)).toEqual(['thread-fork'])
    await service.archiveThread('thread-fork')
    expect(service.getSnapshot()).toMatchObject({ selectedThreadId: null })
    expect(service.getSnapshot().threads.map(({ id }) => id)).toEqual(['thread-1'])

    runtime.threadListResponses.push({ data: [protocolThread([], 'thread-1')], nextCursor: null, backwardsCursor: null })
    await service.loadProject({ projectId, archived: true })
    runtime.threadListResponses.push({ data: [], nextCursor: null, backwardsCursor: null })
    await service.unarchiveThread('thread-1')
    expect(service.getSnapshot().threads).toEqual([])

    runtime.threadListResponses.push({ data: [protocolThread([], 'thread-1')], nextCursor: null, backwardsCursor: null })
    await service.loadProject({ projectId })
    runtime.threadListResponses.push({ data: [], nextCursor: null, backwardsCursor: null })
    await service.deleteThread('thread-1')
    expect(database.listProjectThreadIds(projectId)).toEqual(['thread-fork'])
    expect(runtime.requests.map(({ method }) => method)).toEqual(expect.arrayContaining([
      'thread/name/set',
      'thread/compact/start',
      'thread/fork',
      'thread/archive',
      'thread/unarchive',
      'thread/delete',
    ]))

    service.dispose()
    database.close()
  })

  it('fails closed on destructive lifecycle operations while a turn is active', async () => {
    const { database, projectId } = createDatabase()
    const runtime = new FakeRuntime()
    const service = new AgentService(runtime, database)
    await service.loadProject({ projectId })
    runtime.emit('turn/started', { threadId: 'thread-1', turn: turn('turn-active', 'inProgress') })

    await expect(service.archiveThread('thread-1')).rejects.toThrow('Stop the active turn')
    await expect(service.compactThread('thread-1')).rejects.toThrow('Stop the active turn')
    await expect(service.deleteThread('thread-1')).rejects.toThrow('Stop the active turn')
    expect(runtime.requests.filter(({ method }) => method.startsWith('thread/')).map(({ method }) => method))
      .toEqual(['thread/list'])

    service.dispose()
    database.close()
  })

  it('loads, updates, synchronizes, and clears app-server thread goals', async () => {
    const { database, projectId } = createDatabase()
    const runtime = new FakeRuntime()
    const service = new AgentService(runtime, database)
    await service.loadProject({ projectId })
    const selected = await service.selectThread('thread-1')
    expect(selected.goals['thread-1']).toBeNull()

    const set = await service.setThreadGoal({
      threadId: 'thread-1',
      objective: '  Complete the durable objective  ',
      status: 'active',
      tokenBudget: 50_000,
    })
    expect(set.goals['thread-1']).toMatchObject({
      objective: 'Complete the durable objective',
      status: 'active',
      tokenBudget: 50_000,
    })
    runtime.emit('thread/goal/updated', {
      threadId: 'thread-1',
      turnId: null,
      goal: goal('thread-1', 'Complete the durable objective', 'paused', 50_000, 1_200),
    })
    expect(service.getSnapshot().goals['thread-1']).toMatchObject({ status: 'paused', tokensUsed: 1_200 })
    const cleared = await service.clearThreadGoal('thread-1')
    expect(cleared.goals['thread-1']).toBeNull()

    service.dispose()
    database.close()
  })

  it('resolves a managed worktree UUID to the server cwd without accepting renderer paths', async () => {
    const { database, projectId, root } = createDatabase()
    const worktreePath = mkdtempSync(join(root, 'worktree-'))
    const worktreeId = randomUUID()
    database.insertManagedWorktree({
      id: worktreeId,
      projectId,
      path: worktreePath,
      baseRef: 'HEAD',
      baseOid: null,
      branch: null,
      createdAt: new Date().toISOString(),
      copiedIncludeFiles: 0,
    })
    const runtime = new FakeRuntime()
    const service = new AgentService(runtime, database)

    await service.startConversation({ projectId, worktreeId, text: 'Use the isolated worktree' })

    expect(runtime.requests.find(({ method }) => method === 'thread/start')?.params).toMatchObject({ cwd: worktreePath })
    service.dispose()
    database.close()
  })

  it('hands an idle conversation and its future turns across persisted worktree contexts', async () => {
    const { database, projectId, root } = createDatabase()
    const worktreePath = mkdtempSync(join(root, 'handoff-worktree-'))
    const worktreeId = randomUUID()
    database.insertManagedWorktree({
      id: worktreeId,
      projectId,
      path: worktreePath,
      baseRef: 'HEAD',
      baseOid: null,
      branch: 'codex/handoff-test',
      createdAt: new Date().toISOString(),
      copiedIncludeFiles: 0,
    })
    const runtime = new FakeRuntime()
    const moves: unknown[] = []
    const completed: string[] = []
    const service = new AgentService(runtime, database, {
      moveWorktreeChanges: (input) => {
        moves.push(input)
        return Promise.resolve({ moved: true, operationId: 'handoff-1' })
      },
      completeWorktreeHandoff: (operationId) => { completed.push(operationId); return Promise.resolve() },
    })
    await service.loadProject({ projectId })

    const handedOff = await service.handoffThread({
      threadId: 'thread-1',
      targetWorktreeId: worktreeId,
      moveChanges: true,
    })

    expect(moves).toEqual([{ projectId, threadId: 'thread-1', sourceWorktreeId: null, targetWorktreeId: worktreeId }])
    expect(completed).toEqual(['handoff-1'])
    expect(handedOff.threads[0]).toMatchObject({ worktreeId, projectPath: worktreePath })
    expect(database.getThreadProjectContext('thread-1')).toEqual({ projectId, worktreeId })

    await service.startTurn({ threadId: 'thread-1', text: 'Continue in the worktree' })
    const turnRequest = runtime.requests.filter(({ method }) => method === 'turn/start').at(-1)
    expect(turnRequest?.params).toMatchObject({ threadId: 'thread-1', cwd: worktreePath })

    service.dispose()
    database.close()
  })

  it('moves changes back when persisting a handoff context fails', async () => {
    const { database, projectId, root } = createDatabase()
    const worktreePath = mkdtempSync(join(root, 'rollback-worktree-'))
    const worktreeId = randomUUID()
    database.insertManagedWorktree({
      id: worktreeId,
      projectId,
      path: worktreePath,
      baseRef: 'HEAD',
      baseOid: null,
      branch: null,
      createdAt: new Date().toISOString(),
      copiedIncludeFiles: 0,
    })
    const runtime = new FakeRuntime()
    const moves: unknown[] = []
    const rollbacks: string[] = []
    const service = new AgentService(runtime, database, {
      moveWorktreeChanges: (input) => {
        moves.push(input)
        return Promise.resolve({ moved: true, operationId: 'handoff-rollback' })
      },
      rollbackWorktreeHandoff: (operationId) => { rollbacks.push(operationId); return Promise.resolve() },
    })
    await service.loadProject({ projectId })
    database.removeThreadAssociation('thread-1')

    await expect(service.handoffThread({
      threadId: 'thread-1',
      targetWorktreeId: worktreeId,
      moveChanges: true,
    })).rejects.toThrow('worktree changes were restored')
    expect(moves).toEqual([
      { projectId, threadId: 'thread-1', sourceWorktreeId: null, targetWorktreeId: worktreeId },
    ])
    expect(rollbacks).toEqual(['handoff-rollback'])

    service.dispose()
    database.close()
  })
})

class FakeRuntime {
  readonly requests: { method: string; params: JsonValue | undefined }[] = []
  readonly threadListResponses: JsonValue[] = []
  readonly #notifications = new Set<JsonRpcNotificationHandler>()
  readonly #handlers = new Map<string, JsonRpcRequestHandler>()
  turnStarts = 0
  turnCompletions = 0
  goal: JsonValue | null = null

  start(): Promise<unknown> { return Promise.resolve({}) }

  request<T extends JsonValue = JsonValue>(method: string, params?: JsonValue): Promise<T> {
    this.requests.push({ method, params })
    const parameters = params && typeof params === 'object' && !Array.isArray(params)
      ? params as Record<string, JsonValue>
      : {}
    const requestedThreadId = typeof parameters.threadId === 'string' ? parameters.threadId : 'thread-1'
    const thread = protocolThread(
      method === 'thread/resume' ? [turn('turn-old', 'completed')] : [],
      requestedThreadId,
    )
    if (method === 'thread/list') {
      const response = this.threadListResponses.shift()
        ?? { data: [thread], nextCursor: null, backwardsCursor: null }
      return Promise.resolve(response as T)
    }
    if (method === 'thread/goal/get') return Promise.resolve({ goal: this.goal } as unknown as T)
    if (method === 'thread/goal/set') {
      this.goal = goal(
        requestedThreadId,
        typeof parameters.objective === 'string' ? parameters.objective : 'Goal',
        typeof parameters.status === 'string' ? parameters.status : 'active',
        typeof parameters.tokenBudget === 'number' ? parameters.tokenBudget : null,
      )
      return Promise.resolve({ goal: this.goal } as unknown as T)
    }
    if (method === 'thread/goal/clear') {
      this.goal = null
      return Promise.resolve({} as T)
    }
    const responses: Record<string, JsonValue> = {
      'thread/resume': { thread, model: 'gpt-5.4', modelProvider: 'openai' },
      'thread/read': { thread },
      'thread/start': { thread, model: 'gpt-5.4', modelProvider: 'openai' },
      'thread/name/set': {},
      'thread/archive': {},
      'thread/unarchive': { thread },
      'thread/delete': {},
      'thread/fork': { thread: protocolThread([], 'thread-fork'), model: 'gpt-5.4', modelProvider: 'openai' },
      'thread/compact/start': {},
      'turn/start': { turn: turn('turn-1', 'inProgress') },
      'turn/steer': { turnId: 'turn-1' },
      'turn/interrupt': {},
    }
    return Promise.resolve(responses[method] as T)
  }

  onNotification(handler: JsonRpcNotificationHandler): () => void {
    this.#notifications.add(handler)
    return () => this.#notifications.delete(handler)
  }

  registerRequestHandler(method: string, handler: JsonRpcRequestHandler): () => void {
    this.#handlers.set(method, handler)
    return () => this.#handlers.delete(method)
  }

  markTurnStarted(): void { this.turnStarts += 1 }
  markTurnCompleted(): void { this.turnCompletions += 1 }

  emit(method: string, params: JsonValue): void {
    for (const handler of this.#notifications) void handler(method, params)
  }

  requestFromServer(method: string, params: JsonValue, context: JsonRpcRequestContext): Promise<JsonValue | undefined> {
    const handler = this.#handlers.get(method)
    if (!handler) throw new Error(`Missing handler for ${method}`)
    return Promise.resolve(handler(params, context))
  }

  async waitForRequest(method: string): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (this.requests.some((request) => request.method === method)) return
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    throw new Error(`Timed out waiting for ${method}`)
  }
}

function createDatabase(): { database: StateDatabase; projectId: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'aster-agent-test-'))
  temporaryPaths.push(root)
  const projectPath = mkdtempSync(join(root, 'project-'))
  const database = new StateDatabase(join(root, 'state.sqlite3'))
  return { database, projectId: database.upsertProject(projectPath).id, root }
}

function protocolThread(turns: JsonValue[], id = 'thread-1', updatedAt = 20): JsonValue {
  return {
    id,
    sessionId: `session-${id}`,
    forkedFromId: null,
    parentThreadId: null,
    preview: 'Say hello',
    modelProvider: 'openai',
    createdAt: 10,
    updatedAt,
    status: { type: 'idle' },
    cwd: '/project',
    cliVersion: '0.147.0',
    name: null,
    turns,
  }
}

function turn(id: string, status: string): JsonValue {
  return {
    id,
    items: [],
    itemsView: { type: 'full' },
    status,
    error: null,
    startedAt: 10,
    completedAt: status === 'completed' ? 11 : null,
    durationMs: status === 'completed' ? 1_000 : null,
  }
}

function goal(
  threadId: string,
  objective: string,
  status: string,
  tokenBudget: number | null,
  tokensUsed = 0,
): JsonValue {
  return {
    threadId,
    objective,
    status,
    tokenBudget,
    tokensUsed,
    timeUsedSeconds: 12,
    createdAt: 10,
    updatedAt: 11,
  }
}
