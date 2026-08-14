import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { CodexModelSummary, CodexRuntimeSnapshot, RuntimeSubscription } from '../../shared/runtime.js'
import type { JsonlLogger } from '../logging/logger.js'
import { discoverCodexBinary, type DiscoveredCodexBinary } from './codexDiscovery.js'
import {
  JsonlRpcClosedError,
  JsonlRpcPeer,
  type JsonRpcNotificationHandler,
  type JsonRpcRequestOptions,
  type JsonRpcRequestHandler,
  type JsonValue,
} from './jsonlRpc.js'
import { parseInitializeResult, parseModelListResult } from './protocolAdapter.js'
import { RuntimeStateStore } from './runtimeState.js'

type SpawnAppServer = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams

export type CodexRuntimeOptions = {
  explicitBinary?: string
  discover?: () => Promise<DiscoveredCodexBinary>
  spawnProcess?: SpawnAppServer
  logger?: Pick<JsonlLogger, 'debug' | 'error' | 'info' | 'warn'>
  maxAutomaticRestarts?: number
  restartBaseDelayMs?: number
  initializeTimeoutMs?: number
  configOverrides?: readonly string[]
  fixedChildEnvironment?: Readonly<Record<string, string>>
  childEnvironment?: Readonly<Record<string, string>>
  baseEnvironment?: NodeJS.ProcessEnv
  extraModels?: readonly CodexModelSummary[]
}

type NotificationRegistration = {
  method: string | null
  handler: JsonRpcNotificationHandler
}

const CLIENT_INFO = {
  name: 'aster_code',
  title: 'Aster Code',
  version: '0.1.0',
} as const

export class CodexRuntimeSupervisor {
  readonly #state = new RuntimeStateStore()
  readonly #discover: () => Promise<DiscoveredCodexBinary>
  readonly #spawnProcess: SpawnAppServer
  readonly #logger: CodexRuntimeOptions['logger']
  readonly #maxAutomaticRestarts: number
  readonly #restartBaseDelayMs: number
  readonly #initializeTimeoutMs: number
  readonly #baseEnvironment: NodeJS.ProcessEnv
  readonly #fixedChildEnvironment: Readonly<Record<string, string>>
  #configOverrides: readonly string[]
  #childEnvironment: Readonly<Record<string, string>>
  #extraModels: readonly CodexModelSummary[]
  readonly #notificationRegistrations = new Set<NotificationRegistration>()
  readonly #requestHandlers = new Map<string, JsonRpcRequestHandler>()

  #child: ChildProcessWithoutNullStreams | null = null
  #peer: JsonlRpcPeer | null = null
  #startPromise: Promise<CodexRuntimeSnapshot> | null = null
  #restartTimer: NodeJS.Timeout | null = null
  #stopRequested = false
  #activeTurnCount = 0
  #activeProcessCount = 0

  constructor(options: CodexRuntimeOptions = {}) {
    this.#discover = options.discover ?? (() => discoverCodexBinary(
      options.explicitBinary === undefined ? {} : { explicitBinary: options.explicitBinary },
    ))
    this.#spawnProcess = options.spawnProcess ?? ((command, args, spawnOptions) =>
      spawn(command, [...args], { ...spawnOptions, stdio: ['pipe', 'pipe', 'pipe'] }))
    this.#logger = options.logger
    this.#maxAutomaticRestarts = options.maxAutomaticRestarts ?? 3
    this.#restartBaseDelayMs = options.restartBaseDelayMs ?? 500
    this.#initializeTimeoutMs = options.initializeTimeoutMs ?? 15_000
    this.#baseEnvironment = options.baseEnvironment ?? process.env
    this.#fixedChildEnvironment = options.fixedChildEnvironment ?? {}
    this.#configOverrides = options.configOverrides ?? []
    this.#childEnvironment = options.childEnvironment ?? {}
    this.#extraModels = options.extraModels ?? []
  }

  getSnapshot(): CodexRuntimeSnapshot {
    return this.#state.getSnapshot()
  }

  subscribe(subscription: RuntimeSubscription): () => void {
    return this.#state.subscribe(subscription)
  }

  start(): Promise<CodexRuntimeSnapshot> {
    if (this.getSnapshot().phase === 'ready') return Promise.resolve(this.getSnapshot())
    if (this.#startPromise) return this.#startPromise
    this.#stopRequested = false
    this.#startPromise = this.#startOnce().finally(() => {
      this.#startPromise = null
    })
    return this.#startPromise
  }

  async restart(): Promise<CodexRuntimeSnapshot> {
    this.#state.update({ phase: 'restarting', error: null })
    await this.stop(false)
    return this.start()
  }

  async updateLaunchConfiguration(options: {
    configOverrides?: readonly string[]
    childEnvironment?: Readonly<Record<string, string>>
    extraModels?: readonly CodexModelSummary[]
  }): Promise<CodexRuntimeSnapshot> {
    if (this.#activeTurnCount > 0 || this.#activeProcessCount > 0) {
      throw new Error('Cannot change model providers while a turn or terminal process is active.')
    }
    this.#configOverrides = options.configOverrides ?? []
    this.#childEnvironment = options.childEnvironment ?? {}
    this.#extraModels = options.extraModels ?? []
    return this.restart()
  }

  stop(markStopped = true): Promise<void> {
    this.#stopRequested = true
    if (this.#restartTimer) {
      clearTimeout(this.#restartTimer)
      this.#restartTimer = null
    }
    const child = this.#child
    this.#peer?.close(new JsonlRpcClosedError('Aster agent runtime was stopped'))
    this.#peer = null
    this.#child = null
    if (child?.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    if (markStopped) this.#state.update({ phase: 'stopped', error: null })
    return Promise.resolve()
  }

  request<T extends JsonValue = JsonValue>(
    method: string,
    params?: JsonValue,
    options?: JsonRpcRequestOptions,
  ): Promise<T> {
    const peer = this.#requireReadyPeer()
    return peer.request<T>(method, params, options)
  }

  notify(method: string, params?: JsonValue): Promise<void> {
    return this.#requireReadyPeer().notify(method, params)
  }

  onNotification(handler: JsonRpcNotificationHandler): () => void
  onNotification(method: string, handler: JsonRpcNotificationHandler): () => void
  onNotification(
    methodOrHandler: JsonRpcNotificationHandler | string,
    possibleHandler?: JsonRpcNotificationHandler,
  ): () => void {
    const registration: NotificationRegistration = typeof methodOrHandler === 'function'
      ? { method: null, handler: methodOrHandler }
      : { method: methodOrHandler, handler: requireHandler(possibleHandler) }
    this.#notificationRegistrations.add(registration)
    const disposePeer = attachNotification(this.#peer, registration)
    return () => {
      this.#notificationRegistrations.delete(registration)
      disposePeer()
    }
  }

  registerRequestHandler(method: string, handler: JsonRpcRequestHandler): () => void {
    if (this.#requestHandlers.has(method)) throw new Error(`A runtime request handler already exists for "${method}"`)
    this.#requestHandlers.set(method, handler)
    const disposePeer = this.#peer?.registerRequestHandler(method, handler) ?? (() => undefined)
    return () => {
      if (this.#requestHandlers.get(method) === handler) this.#requestHandlers.delete(method)
      disposePeer()
    }
  }

  markTurnStarted(): void {
    this.#activeTurnCount += 1
  }

  markTurnCompleted(): void {
    this.#activeTurnCount = Math.max(0, this.#activeTurnCount - 1)
  }

  markProcessStarted(): void {
    this.#activeProcessCount += 1
  }

  markProcessCompleted(): void {
    this.#activeProcessCount = Math.max(0, this.#activeProcessCount - 1)
  }

  async #startOnce(): Promise<CodexRuntimeSnapshot> {
    const generation = this.getSnapshot().generation + 1
    this.#state.update({
      phase: 'discovering',
      generation,
      error: null,
      readyAt: null,
      models: [],
    })

    let binary: DiscoveredCodexBinary
    try {
      binary = await this.#discover()
    } catch (error: unknown) {
      const message = toErrorMessage(error)
      await this.#log('error', 'Codex binary discovery failed', { error: message })
      return this.#state.update({ phase: 'unavailable', error: message })
    }

    if (this.#stopRequested) return this.#state.update({ phase: 'stopped' })
    this.#state.update({
      phase: 'starting',
      binaryPath: binary.path,
      version: binary.version,
      startedAt: new Date().toISOString(),
      lastExitCode: null,
      lastSignal: null,
      error: null,
    })

    const configArgs = this.#configOverrides.flatMap((override) => ['-c', override])
    const child = this.#spawnProcess(binary.path, ['app-server', ...configArgs, '--listen', 'stdio://'], {
      env: {
        ...createCodexChildEnvironment(this.#baseEnvironment),
        ...this.#childEnvironment,
        ...this.#fixedChildEnvironment,
        LOG_FORMAT: 'json',
        RUST_LOG: this.#baseEnvironment.RUST_LOG ?? 'warn',
      },
      windowsHide: true,
    })
    this.#child = child
    child.once('exit', (code, signal) => this.#handleExit(generation, code, signal))
    child.once('error', (error) => void this.#log('error', 'Codex app-server process error', { error }))
    observeStderr(child.stderr, (line) => void this.#log('warn', 'Codex app-server stderr', { line }))

    const peer = new JsonlRpcPeer(child.stdout, child.stdin, {
      acceptMissingJsonrpc: true,
      omitJsonrpcHeader: true,
      defaultTimeoutMs: this.#initializeTimeoutMs,
      maxLineBytes: 16 * 1024 * 1024,
    })
    this.#peer = peer
    peer.onError((error) => void this.#log('warn', 'Codex app-server protocol error', { error }))
    this.#attachRegistrations(peer)
    this.#state.update({ phase: 'initializing' })

    try {
      const rawInitialize = await peer.request('initialize', {
        clientInfo: CLIENT_INFO,
        capabilities: {
          experimentalApi: false,
          requestAttestation: false,
        },
      }, { timeoutMs: this.#initializeTimeoutMs })
      const initialize = parseInitializeResult(rawInitialize)
      await peer.notify('initialized', {})
      const rawModels = await peer.request('model/list', {
        includeHidden: false,
        limit: 100,
      }, { timeoutMs: this.#initializeTimeoutMs })
      const models = mergeModels(parseModelListResult(rawModels), this.#extraModels)
      await this.#log('info', 'Codex app-server initialized', {
        binaryPath: binary.path,
        models: models.map(({ id }) => id),
        userAgent: initialize.userAgent,
        version: binary.version,
      })
      return this.#state.update({
        phase: 'ready',
        userAgent: initialize.userAgent,
        platformFamily: initialize.platformFamily,
        platformOs: initialize.platformOs,
        readyAt: new Date().toISOString(),
        restartAttempt: 0,
        error: null,
        models,
      })
    } catch (error: unknown) {
      const message = toErrorMessage(error)
      await this.#log('error', 'Codex app-server initialization failed', { error: message })
      peer.close(new JsonlRpcClosedError('Aster agent initialization failed'))
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      if (this.#child === child) this.#child = null
      if (this.#peer === peer) this.#peer = null
      return this.#state.update({ phase: 'failed', error: message })
    }
  }

  #attachRegistrations(peer: JsonlRpcPeer): void {
    for (const registration of this.#notificationRegistrations) attachNotification(peer, registration)
    for (const [method, handler] of this.#requestHandlers) peer.registerRequestHandler(method, handler)
  }

  #handleExit(generation: number, code: number | null, signal: NodeJS.Signals | null): void {
    if (generation !== this.getSnapshot().generation) return
    this.#peer?.close(new JsonlRpcClosedError('Aster agent runtime exited'))
    this.#peer = null
    this.#child = null
    const exitPatch = { lastExitCode: code, lastSignal: signal }
    if (this.#stopRequested) {
      this.#state.update({ ...exitPatch, phase: 'stopped' })
      return
    }

    if (this.#activeTurnCount > 0) {
      this.#state.update({
        ...exitPatch,
        phase: 'failed',
        error: 'Aster 智能体引擎在任务运行期间退出；为避免重复执行副作用，未自动重放任务。',
      })
      return
    }
    // Terminal processes are connection-scoped and already terminated by the
    // server. They are never replayed, but they must not prevent an idle
    // app-server from recovering for future work.
    this.#activeProcessCount = 0

    const nextAttempt = this.getSnapshot().restartAttempt + 1
    if (nextAttempt > this.#maxAutomaticRestarts) {
      this.#state.update({
        ...exitPatch,
        phase: 'failed',
        error: `Aster 智能体引擎退出，并已超过 ${String(this.#maxAutomaticRestarts)} 次自动重启上限。`,
      })
      return
    }

    const delay = this.#restartBaseDelayMs * 2 ** (nextAttempt - 1)
    this.#state.update({
      ...exitPatch,
      phase: 'restarting',
      restartAttempt: nextAttempt,
      error: `Aster 智能体引擎意外退出；将在 ${String(delay)} 毫秒后重试。`,
    })
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null
      void this.start()
    }, delay)
  }

  #requireReadyPeer(): JsonlRpcPeer {
    if (this.getSnapshot().phase !== 'ready' || !this.#peer) throw new Error('Aster agent runtime is not ready.')
    return this.#peer
  }

  async #log(
    level: 'debug' | 'error' | 'info' | 'warn',
    message: string,
    data?: unknown,
  ): Promise<void> {
    try {
      await this.#logger?.[level](message, data)
    } catch {
      // A diagnostic write must never bring down the agent runtime.
    }
  }
}

const CODEX_ENVIRONMENT_ALLOWLIST = new Set([
  'ALL_PROXY',
  'APPDATA',
  'CODEX_HOME',
  'COLORTERM',
  'ComSpec',
  'HOME',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'LANG',
  'LANGUAGE',
  'LOCALAPPDATA',
  'LOGNAME',
  'NODE_EXTRA_CA_CERTS',
  'NO_PROXY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'PATH',
  'PATHEXT',
  'PROGRAMDATA',
  'RUST_BACKTRACE',
  'RUST_LOG',
  'SHELL',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'SystemRoot',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'TZ',
  'USER',
  'USERNAME',
  'USERPROFILE',
  'all_proxy',
  'https_proxy',
  'http_proxy',
  'no_proxy',
])

export function createCodexChildEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment).filter(([name, value]) =>
    value !== undefined && (CODEX_ENVIRONMENT_ALLOWLIST.has(name) || name.startsWith('LC_')),
  ))
}

function attachNotification(peer: JsonlRpcPeer | null, registration: NotificationRegistration): () => void {
  if (!peer) return () => undefined
  return registration.method === null
    ? peer.onNotification(registration.handler)
    : peer.onNotification(registration.method, registration.handler)
}

function requireHandler(handler: JsonRpcNotificationHandler | undefined): JsonRpcNotificationHandler {
  if (!handler) throw new Error('Notification handler is required.')
  return handler
}

function observeStderr(stderr: Readable, onLine: (line: string) => void): void {
  let buffer = ''
  stderr.setEncoding('utf8')
  stderr.on('data', (chunk: string) => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) onLine(line)
      newline = buffer.indexOf('\n')
    }
  })
  stderr.once('end', () => {
    const line = buffer.trim()
    if (line) onLine(line)
  })
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function mergeModels(primary: CodexModelSummary[], extra: readonly CodexModelSummary[]): CodexModelSummary[] {
  const seen = new Set(primary.map(({ id }) => id))
  return [...primary, ...extra.filter(({ id }) => !seen.has(id))]
}
