import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalService } from '../../src/main/terminal/terminalService.js'
import type { JsonRpcNotificationHandler, JsonRpcRequestOptions, JsonValue } from '../../src/main/runtime/jsonlRpc.js'
import { StateDatabase } from '../../src/main/state/database.js'

const temporaryPaths: string[] = []
afterEach(() => { for (const path of temporaryPaths.splice(0)) rmSync(path, { force: true, recursive: true }) })

type RequestRecord = { method: string; params: JsonValue | undefined; options: JsonRpcRequestOptions | undefined }

class FakeRuntime {
  readonly requests: RequestRecord[] = []
  readonly handlers = new Map<string, JsonRpcNotificationHandler>()
  processStarts = 0
  processCompletions = 0
  resolveExecution: (value: JsonValue) => void = () => undefined
  rejectExecution: (reason: Error) => void = () => undefined

  request<T extends JsonValue = JsonValue>(method: string, params?: JsonValue, options?: JsonRpcRequestOptions): Promise<T> {
    this.requests.push({ method, params, options })
    if (method === 'command/exec') {
      return new Promise<JsonValue>((resolve, reject) => {
        this.resolveExecution = resolve
        this.rejectExecution = reject
      }) as Promise<T>
    }
    return Promise.resolve({}) as Promise<T>
  }

  onNotification(method: string, handler: JsonRpcNotificationHandler): () => void {
    this.handlers.set(method, handler)
    return () => this.handlers.delete(method)
  }

  markProcessStarted(): void { this.processStarts += 1 }
  markProcessCompleted(): void { this.processCompletions += 1 }

  emit(method: string, params: JsonValue): void {
    void this.handlers.get(method)?.(method, params)
  }
}

describe('TerminalService', () => {
  it('runs an app-server PTY with bounded typed input, resize, output, context, and exit state', async () => {
    const { database, project } = createProject()
    const runtime = new FakeRuntime()
    const service = new TerminalService(runtime, database)
    const events = vi.fn()
    service.subscribe(events)

    const session = service.create({ projectId: project.id, cols: 90, rows: 24, threadId: 'thread-1' })
    await vi.waitFor(() => expect(runtime.requests[0]?.method).toBe('command/exec'))
    expect(runtime.requests[0]).toMatchObject({
      method: 'command/exec',
      options: { timeoutMs: null },
      params: {
        processId: `aster-terminal-${session.id}`,
        tty: true,
        streamStdin: true,
        streamStdoutStderr: true,
        disableOutputCap: true,
        disableTimeout: true,
        cwd: project.path,
        size: { cols: 90, rows: 24 },
        sandboxPolicy: { type: 'dangerFullAccess' },
      },
    })
    expect(runtime.processStarts).toBe(1)

    const bytes = Buffer.from('\u001b[32m你好\u001b[0m\r\n', 'utf8')
    runtime.emit('command/exec/outputDelta', {
      processId: `aster-terminal-${session.id}`,
      stream: 'stdout',
      deltaBase64: bytes.subarray(0, 5).toString('base64'),
      capReached: false,
    })
    runtime.emit('command/exec/outputDelta', {
      processId: `aster-terminal-${session.id}`,
      stream: 'stdout',
      deltaBase64: bytes.subarray(5).toString('base64'),
      capReached: false,
    })
    expect(service.getState().sessions[0]).toMatchObject({ status: 'running', output: '\u001b[32m你好\u001b[0m\r\n' })

    await service.write({ sessionId: session.id, data: 'echo ok\r' })
    expect(runtime.requests.at(-1)).toMatchObject({
      method: 'command/exec/write',
      params: { deltaBase64: Buffer.from('echo ok\r').toString('base64') },
    })
    await service.resize({ sessionId: session.id, cols: 120, rows: 40 })
    expect(runtime.requests.at(-1)).toMatchObject({
      method: 'command/exec/resize',
      params: { size: { cols: 120, rows: 40 } },
    })
    expect(service.getContext(session.id)).toMatchObject({ content: '你好\n', cwd: project.path, truncated: false })

    runtime.resolveExecution({ exitCode: 0, stdout: '', stderr: '' })
    await vi.waitFor(() => expect(service.getState().sessions[0]?.status).toBe('exited'))
    expect(service.getState().sessions[0]?.exitCode).toBe(0)
    expect(runtime.processCompletions).toBe(1)
    expect(events).toHaveBeenCalled()
    service.dispose()
    database.close()
  })

  it('binds managed worktrees to their project and removes a failed session safely', async () => {
    const { root, database, project } = createProject()
    const otherPath = join(root, 'other')
    const worktreePath = join(root, 'worktree')
    mkdirSync(otherPath)
    mkdirSync(worktreePath)
    const otherProject = database.upsertProject(otherPath)
    database.insertManagedWorktree({
      id: 'f2929f18-4091-4e21-888c-ecf63f77efe8',
      projectId: project.id,
      path: worktreePath,
      baseRef: 'HEAD',
      baseOid: null,
      branch: null,
      createdAt: new Date().toISOString(),
      copiedIncludeFiles: 0,
    })
    const runtime = new FakeRuntime()
    const service = new TerminalService(runtime, database)

    expect(() => service.create({
      projectId: otherProject.id,
      worktreeId: 'f2929f18-4091-4e21-888c-ecf63f77efe8',
    })).toThrow(/does not belong/i)
    const session = service.create({
      projectId: project.id,
      worktreeId: 'f2929f18-4091-4e21-888c-ecf63f77efe8',
    })
    expect(session.cwd).toBe(worktreePath)
    await vi.waitFor(() => expect(runtime.requests.some(({ method }) => method === 'command/exec')).toBe(true))
    runtime.rejectExecution(new Error('connection lost'))
    await vi.waitFor(() => expect(service.getState().sessions[0]?.status).toBe('failed'))
    expect(service.getState().sessions[0]?.output).toContain('connection lost')
    await expect(service.close(session.id)).resolves.toEqual({ sessions: [] })
    service.dispose()
    database.close()
  })

  it('keeps only the latest four MiB of long-running output and rejects oversized input', async () => {
    const { database, project } = createProject()
    const runtime = new FakeRuntime()
    const service = new TerminalService(runtime, database)
    const session = service.create({ projectId: project.id })
    await vi.waitFor(() => expect(runtime.requests[0]?.method).toBe('command/exec'))
    const chunk = Buffer.alloc(1024 * 1024, 0x78).toString('base64')
    for (let index = 0; index < 5; index += 1) {
      runtime.emit('command/exec/outputDelta', {
        processId: `aster-terminal-${session.id}`,
        stream: 'stdout',
        deltaBase64: chunk,
        capReached: false,
      })
    }
    const snapshot = service.getState().sessions[0]
    expect(snapshot?.output).toHaveLength(4 * 1024 * 1024)
    expect(snapshot?.outputTruncated).toBe(true)
    await expect(service.write({ sessionId: session.id, data: 'x'.repeat(65_537) })).rejects.toThrow(/64 KiB/i)
    runtime.rejectExecution(new Error('finished test'))
    await vi.waitFor(() => expect(service.getState().sessions[0]?.status).toBe('failed'))
    service.dispose()
    database.close()
  })
})

function createProject(): { root: string; database: StateDatabase; project: ReturnType<StateDatabase['upsertProject']> } {
  const root = mkdtempSync(join(tmpdir(), 'aster-terminal-'))
  temporaryPaths.push(root)
  const projectPath = join(root, 'project')
  mkdirSync(projectPath)
  const database = new StateDatabase(join(root, 'state.sqlite3'))
  return { root, database, project: database.upsertProject(projectPath) }
}
