import { describe, expect, it, vi } from 'vitest'
import { AccountService } from '../../src/main/account/accountService.js'
import type { CodexRuntimeSnapshot, RuntimeSubscription } from '../../src/shared/runtime.js'
import type {
  JsonRpcNotificationHandler,
  JsonRpcRequestOptions,
  JsonValue,
} from '../../src/main/runtime/jsonlRpc.js'

const READY_RUNTIME: CodexRuntimeSnapshot = {
  phase: 'ready',
  generation: 1,
  binaryPath: '/tmp/codex',
  version: 'codex-cli 0.147.0',
  userAgent: 'Codex Desktop/0.147.0',
  platformFamily: 'unix',
  platformOs: 'macos',
  startedAt: '2026-08-11T00:00:00.000Z',
  readyAt: '2026-08-11T00:00:01.000Z',
  lastExitCode: null,
  lastSignal: null,
  restartAttempt: 0,
  error: null,
  models: [],
}

class FakeRuntime {
  readonly requests: { method: string; params: JsonValue | undefined }[] = []
  readonly #notifications = new Map<string, Set<JsonRpcNotificationHandler>>()
  readonly #runtimeSubscriptions = new Set<RuntimeSubscription>()
  readonly #responders = new Map<string, (params: JsonValue | undefined) => JsonValue | Promise<JsonValue>>()

  setResponder(method: string, responder: (params: JsonValue | undefined) => JsonValue | Promise<JsonValue>): void {
    this.#responders.set(method, responder)
  }

  start(): Promise<CodexRuntimeSnapshot> {
    return Promise.resolve(READY_RUNTIME)
  }

  async request<T extends JsonValue = JsonValue>(
    method: string,
    params?: JsonValue,
    options?: JsonRpcRequestOptions,
  ): Promise<T> {
    void options
    this.requests.push({ method, params })
    const responder = this.#responders.get(method)
    if (!responder) throw new Error(`Unexpected request: ${method}`)
    return await responder(params) as T
  }

  onNotification(method: string, handler: JsonRpcNotificationHandler): () => void {
    const handlers = this.#notifications.get(method) ?? new Set<JsonRpcNotificationHandler>()
    handlers.add(handler)
    this.#notifications.set(method, handlers)
    return () => handlers.delete(handler)
  }

  subscribe(subscription: RuntimeSubscription): () => void {
    this.#runtimeSubscriptions.add(subscription)
    return () => this.#runtimeSubscriptions.delete(subscription)
  }

  emitNotification(method: string, params?: JsonValue): void {
    for (const handler of this.#notifications.get(method) ?? []) void handler(method, params)
  }

  emitRuntime(snapshot: CodexRuntimeSnapshot): void {
    for (const subscription of this.#runtimeSubscriptions) subscription(snapshot)
  }
}

describe('AccountService', () => {
  it('reads a bounded ChatGPT account and rate-limit summary without exposing tokens', async () => {
    const runtime = new FakeRuntime()
    runtime.setResponder('account/read', () => ({
      account: { type: 'chatgpt', email: 'person@example.com', planType: 'plus', accessToken: 'secret-token' },
      requiresOpenaiAuth: true,
    }))
    runtime.setResponder('account/rateLimits/read', () => ({
      rateLimits: {
        limitId: 'codex',
        limitName: 'Codex',
        primary: { usedPercent: 125, windowDurationMins: 300, resetsAt: 1_786_400_000 },
        secondary: null,
        rateLimitReachedType: 'primary',
      },
      rateLimitsByLimitId: null,
      rateLimitResetCredits: { availableCount: 2, credits: [] },
    }))
    const service = new AccountService(runtime, { openExternal: vi.fn() })

    const snapshot = await service.refresh()

    expect(snapshot).toMatchObject({
      status: 'authenticated',
      requiresOpenaiAuth: true,
      account: { type: 'chatgpt', email: 'person@example.com', planType: 'plus' },
      rateLimits: { primary: { usedPercent: 100 }, availableResetCredits: 2 },
    })
    expect(JSON.stringify(snapshot)).not.toContain('secret-token')
  })

  it('passes an API key only to app-server and never returns it in state', async () => {
    const runtime = new FakeRuntime()
    const apiKey = 'sk-project-super-secret-value'
    runtime.setResponder('account/login/start', (params) => {
      expect(params).toEqual({ type: 'apiKey', apiKey })
      return { type: 'apiKey' }
    })
    runtime.setResponder('account/read', () => ({ account: { type: 'apiKey' }, requiresOpenaiAuth: true }))
    const service = new AccountService(runtime, { openExternal: vi.fn() })

    const snapshot = await service.loginWithApiKey(apiKey)

    expect(snapshot.account).toEqual({ type: 'apiKey' })
    expect(JSON.stringify(snapshot)).not.toContain(apiKey)
  })

  it('redacts an API key even when a remote error echoes the submitted value', async () => {
    const runtime = new FakeRuntime()
    const apiKey = 'sk-project-echoed-secret-value'
    runtime.setResponder('account/login/start', () => {
      throw new Error(`Rejected credential ${apiKey}`)
    })
    const service = new AccountService(runtime, { openExternal: vi.fn() })

    await expect(service.loginWithApiKey(apiKey)).rejects.not.toThrow(apiKey)
    expect(service.getSnapshot().error).not.toContain(apiKey)
    expect(service.getSnapshot().error).toContain('[REDACTED]')
  })

  it('opens a trusted browser login and cancels only its internally held login id', async () => {
    const runtime = new FakeRuntime()
    const openExternal = vi.fn<(_: string) => Promise<void>>().mockResolvedValue()
    runtime.setResponder('account/login/start', () => ({
      type: 'chatgpt',
      loginId: 'login-123',
      authUrl: 'https://chatgpt.com/auth/login?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fcallback',
    }))
    runtime.setResponder('account/login/cancel', (params) => {
      expect(params).toEqual({ loginId: 'login-123' })
      return { status: 'canceled' }
    })
    const service = new AccountService(runtime, { openExternal })

    const pending = await service.startBrowserLogin()
    expect(pending.pendingLogin).toMatchObject({ type: 'browser' })
    expect(openExternal).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/chatgpt\.com\//u))

    const canceled = await service.cancelPendingLogin()
    expect(canceled.pendingLogin).toBeNull()
    expect(canceled.status).toBe('signedOut')
  })

  it('shows the device code and refreshes account state after the matching completion notification', async () => {
    const runtime = new FakeRuntime()
    runtime.setResponder('account/login/start', () => ({
      type: 'chatgptDeviceCode',
      loginId: 'device-login',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-1234',
    }))
    runtime.setResponder('account/read', () => ({
      account: { type: 'chatgpt', email: null, planType: 'pro' },
      requiresOpenaiAuth: true,
    }))
    runtime.setResponder('account/rateLimits/read', () => ({ rateLimits: {}, rateLimitsByLimitId: null, rateLimitResetCredits: null }))
    const service = new AccountService(runtime, { openExternal: vi.fn().mockResolvedValue(undefined) })

    expect((await service.startDeviceCodeLogin()).pendingLogin).toEqual({
      type: 'deviceCode',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-1234',
    })
    runtime.emitNotification('account/login/completed', {
      loginId: 'different-login', success: true, error: null, onboardingEntrypoint: null,
    })
    expect(service.getSnapshot().status).toBe('loginPending')

    runtime.emitNotification('account/login/completed', {
      loginId: 'device-login', success: true, error: null, onboardingEntrypoint: null,
    })
    await vi.waitFor(() => expect(service.getSnapshot().account).toEqual({
      type: 'chatgpt', email: null, planType: 'pro',
    }))
  })

  it('rejects untrusted authentication URLs without opening them', async () => {
    const runtime = new FakeRuntime()
    const openExternal = vi.fn()
    runtime.setResponder('account/login/start', () => ({
      type: 'chatgpt',
      loginId: 'login-evil',
      authUrl: 'https://evil.example/steal',
    }))
    runtime.setResponder('account/login/cancel', (params) => {
      expect(params).toEqual({ loginId: 'login-evil' })
      return { status: 'canceled' }
    })
    const service = new AccountService(runtime, { openExternal })

    await expect(service.startBrowserLogin()).rejects.toThrow('untrusted authentication URL')
    expect(openExternal).not.toHaveBeenCalled()
    expect(service.getSnapshot()).toMatchObject({ status: 'error', pendingLogin: null })
  })

  it('cancels the remote login when the system browser cannot be opened', async () => {
    const runtime = new FakeRuntime()
    runtime.setResponder('account/login/start', () => ({
      type: 'chatgpt', loginId: 'login-open-failed', authUrl: 'https://auth.openai.com/oauth/authorize',
    }))
    runtime.setResponder('account/login/cancel', (params) => {
      expect(params).toEqual({ loginId: 'login-open-failed' })
      return { status: 'canceled' }
    })
    const service = new AccountService(runtime, {
      openExternal: vi.fn().mockRejectedValue(new Error('No browser is registered')),
    })

    await expect(service.startBrowserLogin()).rejects.toThrow('No browser is registered')
    expect(service.getSnapshot()).toMatchObject({ status: 'error', pendingLogin: null })
    expect(runtime.requests.filter(({ method }) => method === 'account/login/cancel')).toHaveLength(1)
  })

  it('clears a pending login when app-server stops instead of reusing it after restart', async () => {
    const runtime = new FakeRuntime()
    runtime.setResponder('account/login/start', () => ({
      type: 'chatgpt', loginId: 'login-before-crash', authUrl: 'https://chatgpt.com/auth/login',
    }))
    const service = new AccountService(runtime, { openExternal: vi.fn().mockResolvedValue(undefined) })
    await service.startBrowserLogin()

    runtime.emitRuntime({ ...READY_RUNTIME, phase: 'failed', error: 'exit 23' })

    expect(service.getSnapshot()).toMatchObject({ status: 'unavailable', pendingLogin: null, error: 'exit 23' })
    await expect(service.openPendingLogin()).rejects.toThrow('no pending ChatGPT login')
  })
})
