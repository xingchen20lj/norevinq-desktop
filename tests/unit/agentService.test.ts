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

  it('lists, resumes, steers, and interrupts project conversations', async () => {
    const { database, projectId } = createDatabase()
    const runtime = new FakeRuntime()
    const service = new AgentService(runtime, database)

    const loaded = await service.loadProject(projectId)
    expect(loaded.threads.map(({ id }) => id)).toEqual(['thread-1'])
    const selected = await service.selectThread('thread-1')
    expect(selected.selectedThreadId).toBe('thread-1')
    await service.steerTurn({ threadId: 'thread-1', turnId: 'turn-1', text: 'Also run tests' })
    await service.interruptTurn({ threadId: 'thread-1', turnId: 'turn-1' })

    expect(runtime.requests.map(({ method }) => method)).toEqual([
      'thread/list', 'thread/resume', 'turn/steer', 'turn/interrupt',
    ])
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
})

class FakeRuntime {
  readonly requests: { method: string; params: JsonValue | undefined }[] = []
  readonly #notifications = new Set<JsonRpcNotificationHandler>()
  readonly #handlers = new Map<string, JsonRpcRequestHandler>()
  turnStarts = 0
  turnCompletions = 0

  start(): Promise<unknown> { return Promise.resolve({}) }

  request<T extends JsonValue = JsonValue>(method: string, params?: JsonValue): Promise<T> {
    this.requests.push({ method, params })
    const thread = protocolThread(method === 'thread/resume' ? [turn('turn-old', 'completed')] : [])
    const responses: Record<string, JsonValue> = {
      'thread/list': { data: [thread], nextCursor: null, backwardsCursor: null },
      'thread/resume': { thread, model: 'gpt-5.4', modelProvider: 'openai' },
      'thread/start': { thread, model: 'gpt-5.4', modelProvider: 'openai' },
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

function protocolThread(turns: JsonValue[]): JsonValue {
  return {
    id: 'thread-1',
    sessionId: 'session-1',
    forkedFromId: null,
    parentThreadId: null,
    preview: 'Say hello',
    modelProvider: 'openai',
    createdAt: 10,
    updatedAt: 20,
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
