import type {
  AccountRateLimits,
  AccountRateLimitWindow,
  AccountSnapshot,
  AccountSubscription,
  AccountSummary,
  PendingAccountLogin,
} from '../../shared/account.js'
import type { CodexRuntimeSnapshot, RuntimeSubscription } from '../../shared/runtime.js'
import type {
  JsonRpcNotificationHandler,
  JsonRpcRequestOptions,
  JsonValue,
} from '../runtime/jsonlRpc.js'
import { redactString } from '../logging/redact.js'

const MAX_AUTH_URL_LENGTH = 8_192
const MAX_ACCOUNT_ERROR_LENGTH = 2_048
const MAX_API_KEY_LENGTH = 512

type RuntimePort = {
  start: () => Promise<CodexRuntimeSnapshot>
  request<T extends JsonValue = JsonValue>(
    method: string,
    params?: JsonValue,
    options?: JsonRpcRequestOptions,
  ): Promise<T>
  onNotification(method: string, handler: JsonRpcNotificationHandler): () => void
  subscribe(subscription: RuntimeSubscription): () => void
}

type PendingLoginState = {
  loginId: string
  authUrl: string
  public: PendingAccountLogin
}

const INITIAL_ACCOUNT_SNAPSHOT: AccountSnapshot = Object.freeze({
  status: 'unavailable',
  requiresOpenaiAuth: null,
  account: null,
  pendingLogin: null,
  rateLimits: null,
  error: null,
  updatedAt: null,
})

export class AccountService {
  readonly #runtime: RuntimePort
  readonly #openExternal: (url: string) => Promise<void>
  readonly #clock: () => Date
  readonly #subscriptions = new Set<AccountSubscription>()
  readonly #disposers: (() => void)[]
  #snapshot: AccountSnapshot = structuredClone(INITIAL_ACCOUNT_SNAPSHOT)
  #pending: PendingLoginState | null = null
  #refreshing: Promise<AccountSnapshot> | null = null
  #readyGeneration = -1

  constructor(runtime: RuntimePort, options: {
    openExternal: (url: string) => Promise<void>
    clock?: () => Date
  }) {
    this.#runtime = runtime
    this.#openExternal = options.openExternal
    this.#clock = options.clock ?? (() => new Date())
    this.#disposers = [
      runtime.onNotification('account/login/completed', (_method, params) => this.#handleLoginCompleted(params)),
      runtime.onNotification('account/updated', () => { void this.refresh() }),
      runtime.onNotification('account/rateLimits/updated', () => { void this.refreshRateLimits() }),
      runtime.subscribe((snapshot) => this.#handleRuntime(snapshot)),
    ]
  }

  getSnapshot(): AccountSnapshot {
    return structuredClone(this.#snapshot)
  }

  subscribe(subscription: AccountSubscription): () => void {
    this.#subscriptions.add(subscription)
    return () => this.#subscriptions.delete(subscription)
  }

  refresh(refreshToken = false): Promise<AccountSnapshot> {
    if (this.#refreshing) return this.#refreshing
    const refreshing = this.#performRefresh(refreshToken).finally(() => {
      if (this.#refreshing === refreshing) this.#refreshing = null
    })
    this.#refreshing = refreshing
    return refreshing
  }

  async loginWithApiKey(apiKey: string): Promise<AccountSnapshot> {
    const normalized = apiKey.trim()
    if (normalized.length < 16 || normalized.length > MAX_API_KEY_LENGTH || /\s/u.test(normalized)) {
      throw new Error('OpenAI API Key format is invalid.')
    }
    await this.#runtime.start()
    this.#update({ status: 'loading', error: null })
    try {
      const result = asRecord(await this.#runtime.request('account/login/start', {
        type: 'apiKey',
        apiKey: normalized,
      }))
      if (result.type !== 'apiKey') throw new Error('app-server returned an unexpected API Key login response.')
      return await this.refresh()
    } catch (error) {
      const message = safeErrorMessage(error, normalized)
      this.#update({ status: 'error', error: message })
      throw new Error(message, { cause: error })
    }
  }

  startBrowserLogin(): Promise<AccountSnapshot> {
    return this.#startManagedLogin('chatgpt')
  }

  startDeviceCodeLogin(): Promise<AccountSnapshot> {
    return this.#startManagedLogin('chatgptDeviceCode')
  }

  async openPendingLogin(): Promise<AccountSnapshot> {
    if (!this.#pending) throw new Error('There is no pending ChatGPT login.')
    await this.#openExternal(this.#pending.authUrl)
    return this.getSnapshot()
  }

  async cancelPendingLogin(): Promise<AccountSnapshot> {
    const pending = this.#pending
    if (!pending) return this.getSnapshot()
    try {
      await this.#runtime.request('account/login/cancel', { loginId: pending.loginId })
    } finally {
      this.#pending = null
      this.#update({ pendingLogin: null, error: null, status: this.#snapshot.account ? 'authenticated' : 'signedOut' })
    }
    return this.getSnapshot()
  }

  async logout(): Promise<AccountSnapshot> {
    if (this.#pending) await this.cancelPendingLogin()
    await this.#runtime.start()
    await this.#runtime.request('account/logout')
    return this.refresh()
  }

  dispose(): void {
    for (const dispose of this.#disposers.splice(0)) dispose()
    this.#subscriptions.clear()
    this.#pending = null
  }

  async #performRefresh(refreshToken: boolean): Promise<AccountSnapshot> {
    this.#update({ status: this.#pending ? 'loginPending' : 'loading', error: null })
    try {
      await this.#runtime.start()
      const response = asRecord(await this.#runtime.request('account/read', { refreshToken }))
      const account = parseAccount(response.account)
      const requiresOpenaiAuth = response.requiresOpenaiAuth === true
      let rateLimits: AccountRateLimits | null = null
      if (account?.type === 'chatgpt') {
        try {
          rateLimits = parseRateLimits(await this.#runtime.request('account/rateLimits/read'))
        } catch {
          rateLimits = this.#snapshot.rateLimits
        }
      }
      return this.#update({
        status: this.#pending ? 'loginPending' : account ? 'authenticated' : 'signedOut',
        requiresOpenaiAuth,
        account,
        pendingLogin: this.#pending?.public ?? null,
        rateLimits,
        error: null,
        updatedAt: this.#clock().toISOString(),
      })
    } catch (error) {
      const message = safeErrorMessage(error)
      return this.#update({ status: 'error', error: message })
    }
  }

  async #startManagedLogin(type: 'chatgpt' | 'chatgptDeviceCode'): Promise<AccountSnapshot> {
    if (this.#pending) throw new Error('A ChatGPT login is already pending.')
    await this.#runtime.start()
    this.#update({ status: 'loading', error: null })
    try {
      const result = asRecord(await this.#runtime.request('account/login/start', { type }))
      let parsed: PendingLoginState
      try {
        parsed = parseManagedLogin(result, type)
      } catch (error) {
        if (typeof result.loginId === 'string' && result.loginId.length > 0 && result.loginId.length <= 200) {
          await this.#runtime.request('account/login/cancel', { loginId: result.loginId }).catch(() => undefined)
        }
        throw error
      }
      this.#pending = parsed
      this.#update({ status: 'loginPending', pendingLogin: parsed.public, error: null })
      try {
        await this.#openExternal(parsed.authUrl)
      } catch (error) {
        await this.#runtime.request('account/login/cancel', { loginId: parsed.loginId }).catch(() => undefined)
        this.#pending = null
        const message = safeErrorMessage(error)
        this.#update({ status: 'error', pendingLogin: null, error: message })
        throw new Error(message, { cause: error })
      }
      return this.getSnapshot()
    } catch (error) {
      if (this.#snapshot.status !== 'error') this.#update({ status: 'error', error: safeErrorMessage(error) })
      throw error
    }
  }

  #handleRuntime(snapshot: CodexRuntimeSnapshot): void {
    if (snapshot.phase === 'ready') {
      if (snapshot.generation === this.#readyGeneration) return
      this.#readyGeneration = snapshot.generation
      if (this.#pending) {
        this.#pending = null
        this.#update({ pendingLogin: null, error: 'ChatGPT login was interrupted because app-server restarted.' })
      }
      void this.refresh()
      return
    }
    if (snapshot.phase === 'stopped' || snapshot.phase === 'unavailable' || snapshot.phase === 'failed') {
      this.#update({ status: 'unavailable', error: snapshot.error, pendingLogin: null })
      this.#pending = null
    }
  }

  #handleLoginCompleted(params: JsonValue | undefined): void {
    const record = asRecord(params)
    const loginId = typeof record.loginId === 'string' ? record.loginId : null
    if (this.#pending && loginId !== this.#pending.loginId) return
    this.#pending = null
    if (record.success === true) {
      this.#update({ status: 'loading', pendingLogin: null, error: null })
      void this.refresh(true)
      return
    }
    this.#update({
      status: this.#snapshot.account ? 'authenticated' : 'error',
      pendingLogin: null,
      error: typeof record.error === 'string' ? redactString(record.error).slice(0, MAX_ACCOUNT_ERROR_LENGTH) : 'ChatGPT login did not complete.',
    })
  }

  async refreshRateLimits(): Promise<AccountSnapshot> {
    if (this.#snapshot.account?.type !== 'chatgpt') return this.getSnapshot()
    try {
      const rateLimits = parseRateLimits(await this.#runtime.request('account/rateLimits/read'))
      return this.#update({ rateLimits, updatedAt: this.#clock().toISOString() })
    } catch {
      return this.getSnapshot()
    }
  }

  #update(patch: Partial<AccountSnapshot>): AccountSnapshot {
    this.#snapshot = { ...this.#snapshot, ...patch }
    const snapshot = this.getSnapshot()
    for (const subscription of this.#subscriptions) subscription(snapshot)
    return snapshot
  }
}

function parseManagedLogin(value: Record<string, JsonValue>, expected: 'chatgpt' | 'chatgptDeviceCode'): PendingLoginState {
  if (value.type !== expected) throw new Error('app-server returned an unexpected ChatGPT login response.')
  const loginId = requireBoundedString(value.loginId, 'loginId', 200)
  const rawUrl = expected === 'chatgpt' ? value.authUrl : value.verificationUrl
  const authUrl = validateOpenAiAuthUrl(requireBoundedString(rawUrl, 'authentication URL', MAX_AUTH_URL_LENGTH))
  const userCode = expected === 'chatgptDeviceCode'
    ? requireBoundedString(value.userCode, 'device code', 128)
    : null
  return {
    loginId,
    authUrl,
    public: {
      type: expected === 'chatgpt' ? 'browser' : 'deviceCode',
      verificationUrl: authUrl,
      userCode,
    },
  }
}

function validateOpenAiAuthUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('app-server returned an invalid authentication URL.')
  }
  const hostname = url.hostname.toLowerCase()
  const allowedHost = hostname === 'openai.com' || hostname.endsWith('.openai.com')
    || hostname === 'chatgpt.com' || hostname.endsWith('.chatgpt.com')
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !allowedHost) {
    throw new Error('app-server returned an untrusted authentication URL.')
  }
  return url.toString()
}

function parseAccount(value: JsonValue | undefined): AccountSummary | null {
  if (value === null || value === undefined) return null
  const account = asRecord(value)
  if (account.type === 'apiKey') return { type: 'apiKey' }
  if (account.type === 'chatgpt') {
    return {
      type: 'chatgpt',
      email: typeof account.email === 'string' ? account.email.slice(0, 320) : null,
      planType: typeof account.planType === 'string' ? account.planType.slice(0, 64) : 'unknown',
    }
  }
  if (account.type === 'amazonBedrock') {
    const codexManaged = account.credentialSource === 'codexManaged' || account.usesCodexManagedCredentials === true
    return { type: 'amazonBedrock', credentialSource: codexManaged ? 'codexManaged' : 'awsManaged' }
  }
  return {
    type: 'unknown',
    label: typeof account.type === 'string' ? account.type.slice(0, 128) : 'unknown',
  }
}

function parseRateLimits(value: JsonValue): AccountRateLimits | null {
  const response = asRecord(value)
  const limits = asOptionalRecord(response.rateLimits)
  if (!limits) return null
  const resetCredits = asOptionalRecord(response.rateLimitResetCredits)
  return {
    limitId: boundedNullableString(limits.limitId, 128),
    limitName: boundedNullableString(limits.limitName, 128),
    primary: parseRateLimitWindow(limits.primary),
    secondary: parseRateLimitWindow(limits.secondary),
    reachedType: boundedNullableString(limits.rateLimitReachedType, 128),
    availableResetCredits: finiteInteger(resetCredits?.availableCount),
  }
}

function parseRateLimitWindow(value: JsonValue | undefined): AccountRateLimitWindow | null {
  const window = asOptionalRecord(value)
  if (!window || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) return null
  return {
    usedPercent: Math.min(100, Math.max(0, window.usedPercent)),
    windowDurationMins: finiteNumber(window.windowDurationMins),
    resetsAt: finiteNumber(window.resetsAt),
  }
}

function finiteNumber(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function finiteInteger(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function boundedNullableString(value: JsonValue | undefined, max: number): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null
}

function requireBoundedString(value: JsonValue | undefined, label: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new Error(`app-server returned an invalid ${label}.`)
  }
  return value
}

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> {
  if (!isJsonObject(value)) return {}
  return { ...value }
}

function isJsonObject(value: JsonValue | undefined): value is Readonly<Record<string, JsonValue>> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asOptionalRecord(value: JsonValue | undefined): Record<string, JsonValue> | null {
  const record = asRecord(value)
  return Object.keys(record).length > 0 ? record : null
}

function safeErrorMessage(error: unknown, secret?: string): string {
  const raw = error instanceof Error ? error.message : String(error)
  const withoutExactSecret = secret ? raw.replaceAll(secret, '[REDACTED]') : raw
  return redactString(withoutExactSecret).slice(0, MAX_ACCOUNT_ERROR_LENGTH)
}
