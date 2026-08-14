import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type {
  CreateTerminalInput,
  ResizeTerminalInput,
  TerminalContext,
  TerminalEvent,
  TerminalSession,
  TerminalState,
  TerminalSubscription,
  WriteTerminalInput,
} from '../../shared/terminal.js'
import type { StateDatabase } from '../state/database.js'
import type { JsonRpcRequestOptions, JsonValue } from '../runtime/jsonlRpc.js'

const MAX_SESSIONS = 12
const MAX_OUTPUT_CHARS = 4 * 1024 * 1024
const MAX_CONTEXT_CHARS = 32 * 1024
const MAX_INPUT_BYTES = 64 * 1024

type TerminalRuntime = {
  request: <T extends JsonValue = JsonValue>(method: string, params?: JsonValue, options?: JsonRpcRequestOptions) => Promise<T>
  onNotification: (method: string, handler: (method: string, params: JsonValue | undefined) => void) => () => void
  markProcessStarted: () => void
  markProcessCompleted: () => void
}

type InternalSession = TerminalSession & {
  processId: string
  decoder: StringDecoder
}

type CommandExecResult = { exitCode: number; stdout: string; stderr: string }

export class TerminalService {
  readonly #runtime: TerminalRuntime
  readonly #database: StateDatabase
  readonly #sessions = new Map<string, InternalSession>()
  readonly #subscriptions = new Set<TerminalSubscription>()
  readonly #disposeOutput: () => void

  constructor(runtime: TerminalRuntime, database: StateDatabase) {
    this.#runtime = runtime
    this.#database = database
    this.#disposeOutput = runtime.onNotification('command/exec/outputDelta', (_method, params) => {
      this.#handleOutput(params)
    })
  }

  getState(): TerminalState {
    return { sessions: [...this.#sessions.values()].map(publicSession) }
  }

  subscribe(subscription: TerminalSubscription): () => void {
    this.#subscriptions.add(subscription)
    return () => this.#subscriptions.delete(subscription)
  }

  create(input: CreateTerminalInput): TerminalSession {
    if (this.#sessions.size >= MAX_SESSIONS) throw new Error(`At most ${String(MAX_SESSIONS)} terminal sessions can be open.`)
    const cwd = this.#resolveCwd(input.projectId, input.worktreeId)
    const cols = validateDimension(input.cols ?? 100, 2, 500, 'columns')
    const rows = validateDimension(input.rows ?? 30, 2, 300, 'rows')
    const shell = resolveShell(process.platform, process.env)
    const id = randomUUID()
    const processId = `norevinq-terminal-${id}`
    const now = new Date().toISOString()
    const session: InternalSession = {
      id,
      processId,
      projectId: input.projectId,
      worktreeId: input.worktreeId ?? null,
      threadId: input.threadId ?? null,
      cwd,
      shell: shell.command,
      status: 'starting',
      output: '',
      outputTruncated: false,
      cols,
      rows,
      exitCode: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      decoder: new StringDecoder('utf8'),
    }
    this.#sessions.set(id, session)
    this.#emit({ type: 'session', session: publicSession(session) })
    this.#runtime.markProcessStarted()
    void Promise.resolve().then(() => this.#runtime.request<CommandExecResult>('command/exec', {
      command: [shell.command, ...shell.args],
      processId,
      tty: true,
      streamStdin: true,
      streamStdoutStderr: true,
      disableOutputCap: true,
      disableTimeout: true,
      cwd,
      env: { TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      size: { cols, rows },
      sandboxPolicy: { type: 'dangerFullAccess' },
    }, { timeoutMs: null })).then((result) => {
      const current = this.#sessions.get(id)
      if (!current) return
      const trailing = current.decoder.end()
      if (trailing) this.#appendOutput(current, trailing)
      current.status = 'exited'
      current.exitCode = validExitCode(result.exitCode)
      current.updatedAt = new Date().toISOString()
      this.#emit({ type: 'session', session: publicSession(current) })
    }).catch((reason: unknown) => {
      const current = this.#sessions.get(id)
      if (!current) return
      current.status = 'failed'
      current.error = toErrorMessage(reason)
      current.updatedAt = new Date().toISOString()
      this.#appendOutput(current, `\r\n[Norevinq terminal disconnected: ${current.error}]\r\n`)
      this.#emit({ type: 'session', session: publicSession(current) })
    }).finally(() => this.#runtime.markProcessCompleted())
    return publicSession(session)
  }

  async write(input: WriteTerminalInput): Promise<void> {
    const session = this.#requireSession(input.sessionId)
    if (session.status !== 'starting' && session.status !== 'running') throw new Error('Terminal process is not accepting input.')
    const bytes = Buffer.from(input.data, 'utf8')
    if (bytes.length === 0 || bytes.length > MAX_INPUT_BYTES) throw new Error('Terminal input must be between 1 byte and 64 KiB.')
    await this.#runtime.request('command/exec/write', {
      processId: session.processId,
      deltaBase64: bytes.toString('base64'),
    })
  }

  async resize(input: ResizeTerminalInput): Promise<void> {
    const session = this.#requireSession(input.sessionId)
    const cols = validateDimension(input.cols, 2, 500, 'columns')
    const rows = validateDimension(input.rows, 2, 300, 'rows')
    if (session.cols === cols && session.rows === rows) return
    session.cols = cols
    session.rows = rows
    session.updatedAt = new Date().toISOString()
    if (session.status === 'starting' || session.status === 'running') {
      await this.#runtime.request('command/exec/resize', { processId: session.processId, size: { cols, rows } })
    }
    this.#emit({ type: 'session', session: publicSession(session) })
  }

  async terminate(sessionId: string): Promise<void> {
    const session = this.#requireSession(sessionId)
    if (session.status !== 'starting' && session.status !== 'running') return
    session.status = 'terminating'
    session.updatedAt = new Date().toISOString()
    this.#emit({ type: 'session', session: publicSession(session) })
    await this.#runtime.request('command/exec/terminate', { processId: session.processId })
  }

  async close(sessionId: string): Promise<TerminalState> {
    const session = this.#requireSession(sessionId)
    try {
      if (session.status === 'starting' || session.status === 'running') {
        await this.#runtime.request('command/exec/terminate', { processId: session.processId })
      }
    } finally {
      this.#sessions.delete(sessionId)
      this.#emit({ type: 'removed', sessionId })
    }
    return this.getState()
  }

  clear(sessionId: string): TerminalSession {
    const session = this.#requireSession(sessionId)
    session.output = ''
    session.outputTruncated = false
    session.updatedAt = new Date().toISOString()
    const result = publicSession(session)
    this.#emit({ type: 'session', session: result })
    return result
  }

  getContext(sessionId: string): TerminalContext {
    const session = this.#requireSession(sessionId)
    const plain = stripTerminalControls(session.output)
    const content = plain.length > MAX_CONTEXT_CHARS ? plain.slice(-MAX_CONTEXT_CHARS) : plain
    return {
      sessionId,
      cwd: session.cwd,
      content,
      truncated: session.outputTruncated || plain.length > MAX_CONTEXT_CHARS,
    }
  }

  dispose(): void {
    this.#disposeOutput()
    this.#subscriptions.clear()
    for (const session of this.#sessions.values()) {
      if (session.status === 'starting' || session.status === 'running') {
        void Promise.resolve()
          .then(() => this.#runtime.request('command/exec/terminate', { processId: session.processId }))
          .catch(() => undefined)
      }
    }
    this.#sessions.clear()
  }

  #resolveCwd(projectId: string, worktreeId: string | undefined): string {
    const project = this.#database.getProject(projectId)
    if (!project) throw new Error('Project not found.')
    if (!worktreeId) return project.path
    const worktree = this.#database.getManagedWorktree(worktreeId)
    if (worktree?.projectId !== projectId) throw new Error('Managed worktree does not belong to this project.')
    if (!existsSync(worktree.path) || !statSync(worktree.path).isDirectory()) throw new Error('Managed worktree is missing.')
    return worktree.path
  }

  #requireSession(sessionId: string): InternalSession {
    const session = this.#sessions.get(sessionId)
    if (!session) throw new Error('Terminal session not found.')
    return session
  }

  #handleOutput(params: JsonValue | undefined): void {
    if (!isRecord(params)) return
    const processId = typeof params.processId === 'string' ? params.processId : null
    const deltaBase64 = typeof params.deltaBase64 === 'string' ? params.deltaBase64 : null
    if (!processId || !deltaBase64 || !isCanonicalBase64(deltaBase64)) return
    const session = [...this.#sessions.values()].find((item) => item.processId === processId)
    if (!session) return
    const decoded = session.decoder.write(Buffer.from(deltaBase64, 'base64'))
    if (session.status === 'starting') session.status = 'running'
    if (params.capReached === true) session.outputTruncated = true
    if (decoded) this.#appendOutput(session, decoded)
    session.updatedAt = new Date().toISOString()
  }

  #appendOutput(session: InternalSession, data: string): void {
    session.output += data
    if (session.output.length > MAX_OUTPUT_CHARS) {
      session.output = session.output.slice(-MAX_OUTPUT_CHARS)
      session.outputTruncated = true
    }
    this.#emit({
      type: 'output',
      sessionId: session.id,
      data,
      outputTruncated: session.outputTruncated,
      status: session.status,
    })
  }

  #emit(event: TerminalEvent): void {
    for (const subscription of this.#subscriptions) subscription(event)
  }
}

function publicSession(session: InternalSession): TerminalSession {
  return {
    id: session.id,
    projectId: session.projectId,
    worktreeId: session.worktreeId,
    threadId: session.threadId,
    cwd: session.cwd,
    shell: session.shell,
    status: session.status,
    output: session.output,
    outputTruncated: session.outputTruncated,
    cols: session.cols,
    rows: session.rows,
    exitCode: session.exitCode,
    error: session.error,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

function resolveShell(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv): { command: string; args: string[] } {
  const windowsShell = environment.ComSpec?.trim() ?? 'cmd.exe'
  if (platform === 'win32') return { command: windowsShell, args: [] }
  const configured = environment.SHELL?.trim()
  const command = configured && isAbsolute(configured) && !configured.includes('\0') ? configured : '/bin/zsh'
  return { command, args: ['-l'] }
}

function validateDimension(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Terminal ${label} are out of range.`)
  return value
}

function validExitCode(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCanonicalBase64(value: string): boolean {
  if (value.length === 0 || value.length > 1_400_000 || value.length % 4 !== 0) return false
  return /^[A-Za-z0-9+/]*={0,2}$/.test(value)
}

function stripTerminalControls(value: string): string {
  let result = ''
  for (let index = 0; index < value.length;) {
    const code = value.charCodeAt(index)
    if (code === 0x1b) {
      const next = value.charCodeAt(index + 1)
      if (next === 0x5b) {
        index += 2
        while (index < value.length) {
          const current = value.charCodeAt(index)
          index += 1
          if (current >= 0x40 && current <= 0x7e) break
        }
        continue
      }
      if (next === 0x5d) {
        index += 2
        while (index < value.length) {
          const current = value.charCodeAt(index)
          if (current === 0x07) { index += 1; break }
          if (current === 0x1b && value.charCodeAt(index + 1) === 0x5c) { index += 2; break }
          index += 1
        }
        continue
      }
      index += Math.min(2, value.length - index)
      continue
    }
    if (code === 0x0a || code === 0x09 || code >= 0x20) result += value.charAt(index)
    else if (code === 0x0d && value.charCodeAt(index + 1) !== 0x0a) result += '\n'
    index += 1
  }
  return result.replace(/\n{4,}/g, '\n\n\n')
}

function toErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Terminal process failed.'
}
