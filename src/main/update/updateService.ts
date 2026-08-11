import { redactString } from '../logging/redact.js'
import type { UpdateProgress, UpdateSnapshot, UpdateSubscription } from '../../shared/update.js'

const MAX_RELEASE_NOTES_LENGTH = 16 * 1024
const AUTO_CHECK_DELAY_MS = 30_000
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000

export type UpdateDriverInfo = {
  version?: string
  releaseDate?: string
  releaseName?: string | null
  releaseNotes?: string | readonly { note?: string | null; version?: string | null }[] | null
}

export type UpdateDriver = {
  configure: (options: {
    autoDownload: boolean
    autoInstallOnAppQuit: boolean
    allowPrerelease: boolean
    allowDowngrade: boolean
    disableWebInstaller: boolean
  }) => void
  onError: (listener: (error: Error) => void) => () => void
  onChecking: (listener: () => void) => () => void
  onAvailable: (listener: (info: UpdateDriverInfo) => void) => () => void
  onNotAvailable: (listener: (info: UpdateDriverInfo) => void) => () => void
  onProgress: (listener: (progress: UpdateProgress) => void) => () => void
  onDownloaded: (listener: (info: UpdateDriverInfo) => void) => () => void
  onCancelled: (listener: (info: UpdateDriverInfo) => void) => () => void
  checkForUpdates: () => Promise<unknown>
  downloadUpdate: () => Promise<readonly string[]>
  quitAndInstall: () => void
}

export type UpdateServiceOptions = {
  currentVersion: string
  isPackaged: boolean
  platform: NodeJS.Platform
  configured: boolean
  driver?: UpdateDriver
  clock?: () => Date
}

export class UpdateService {
  readonly #clock: () => Date
  readonly #driver: UpdateDriver | null
  readonly #subscriptions = new Set<UpdateSubscription>()
  readonly #unsubscribers: (() => void)[] = []
  #snapshot: UpdateSnapshot
  #delayTimer: NodeJS.Timeout | null = null
  #intervalTimer: NodeJS.Timeout | null = null

  constructor(options: UpdateServiceOptions) {
    this.#clock = options.clock ?? (() => new Date())
    const supported = options.platform === 'darwin' || options.platform === 'win32'
    const disabledReason = disabledUpdateReason(options.isPackaged, supported, options.configured, options.driver)
    this.#driver = disabledReason ? null : options.driver ?? null
    this.#snapshot = {
      phase: disabledReason ? 'disabled' : 'idle',
      currentVersion: options.currentVersion,
      configured: options.configured,
      supported,
      automaticChecks: disabledReason === null,
      installOnQuit: true,
      availableVersion: null,
      releaseDate: null,
      releaseNotes: null,
      progress: null,
      checkedAt: null,
      error: null,
      disabledReason,
    }
    if (this.#driver) this.#connectDriver(this.#driver)
  }

  getSnapshot(): UpdateSnapshot {
    return structuredClone(this.#snapshot)
  }

  subscribe(subscription: UpdateSubscription): () => void {
    this.#subscriptions.add(subscription)
    return () => this.#subscriptions.delete(subscription)
  }

  startAutomaticChecks(): void {
    if (!this.#driver || this.#delayTimer || this.#intervalTimer) return
    this.#delayTimer = setTimeout(() => {
      this.#delayTimer = null
      void this.checkForUpdates()
      this.#intervalTimer = setInterval(() => void this.checkForUpdates(), AUTO_CHECK_INTERVAL_MS)
      this.#intervalTimer.unref()
    }, AUTO_CHECK_DELAY_MS)
    this.#delayTimer.unref()
  }

  async checkForUpdates(): Promise<UpdateSnapshot> {
    if (!this.#driver) return this.getSnapshot()
    if (this.#snapshot.phase === 'checking' || this.#snapshot.phase === 'downloading' || this.#snapshot.phase === 'downloaded') {
      return this.getSnapshot()
    }
    this.#update({ phase: 'checking', error: null, progress: null })
    try {
      await this.#driver.checkForUpdates()
    } catch (error) {
      this.#recordError(error)
    }
    return this.getSnapshot()
  }

  async downloadUpdate(): Promise<UpdateSnapshot> {
    if (!this.#driver) return this.getSnapshot()
    if (this.#snapshot.phase !== 'available' && this.#snapshot.phase !== 'error') {
      throw new Error('An available update is required before downloading.')
    }
    if (!this.#snapshot.availableVersion) throw new Error('The update version is missing.')
    this.#update({ phase: 'downloading', error: null, progress: null })
    try {
      await this.#driver.downloadUpdate()
    } catch (error) {
      this.#recordError(error)
    }
    return this.getSnapshot()
  }

  installUpdate(): void {
    if (!this.#driver || this.#snapshot.phase !== 'downloaded') {
      throw new Error('A verified downloaded update is required before installation.')
    }
    this.#driver.quitAndInstall()
  }

  dispose(): void {
    if (this.#delayTimer) clearTimeout(this.#delayTimer)
    if (this.#intervalTimer) clearInterval(this.#intervalTimer)
    this.#delayTimer = null
    this.#intervalTimer = null
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe()
    this.#subscriptions.clear()
  }

  #connectDriver(driver: UpdateDriver): void {
    driver.configure({
      autoDownload: false,
      autoInstallOnAppQuit: true,
      allowPrerelease: false,
      allowDowngrade: false,
      disableWebInstaller: true,
    })
    this.#unsubscribers.push(
      driver.onError((error) => this.#recordError(error)),
      driver.onChecking(() => this.#update({ phase: 'checking', error: null, progress: null })),
      driver.onAvailable((info) => this.#update({
        phase: 'available',
        availableVersion: safeVersion(info.version),
        releaseDate: safeDate(info.releaseDate),
        releaseNotes: safeReleaseNotes(info.releaseNotes),
        checkedAt: this.#clock().toISOString(),
        error: null,
      })),
      driver.onNotAvailable(() => this.#update({
        phase: 'upToDate',
        availableVersion: null,
        releaseDate: null,
        releaseNotes: null,
        progress: null,
        checkedAt: this.#clock().toISOString(),
        error: null,
      })),
      driver.onProgress((progress) => this.#update({
        phase: 'downloading',
        progress: normalizeProgress(progress),
      })),
      driver.onDownloaded((info) => this.#update({
        phase: 'downloaded',
        availableVersion: safeVersion(info.version) ?? this.#snapshot.availableVersion,
        releaseDate: safeDate(info.releaseDate) ?? this.#snapshot.releaseDate,
        releaseNotes: safeReleaseNotes(info.releaseNotes) ?? this.#snapshot.releaseNotes,
        progress: this.#snapshot.progress ? { ...this.#snapshot.progress, percent: 100 } : null,
        error: null,
      })),
      driver.onCancelled(() => this.#update({
        phase: 'available',
        progress: null,
        error: '更新下载已取消。',
      })),
    )
  }

  #recordError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.#update({ phase: 'error', error: redactString(message).slice(0, 2_048), progress: null })
  }

  #update(patch: Partial<UpdateSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch }
    const snapshot = this.getSnapshot()
    for (const subscription of this.#subscriptions) subscription(snapshot)
  }
}

function disabledUpdateReason(
  isPackaged: boolean,
  supported: boolean,
  configured: boolean,
  driver: UpdateDriver | undefined,
): string | null {
  if (!supported) return '当前平台不在 Aster Code 的桌面更新支持范围内。'
  if (!isPackaged) return '开发构建不会连接发布更新源。'
  if (!configured) return '此发布包没有 app-update.yml；发布者尚未配置更新渠道。'
  if (!driver) return '更新运行时不可用。'
  return null
}

function safeVersion(value: string | undefined): string | null {
  if (!value || value.length > 100 || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/u.test(value)) return null
  return value
}

function safeDate(value: string | undefined): string | null {
  if (!value || value.length > 100 || Number.isNaN(Date.parse(value))) return null
  return new Date(value).toISOString()
}

function safeReleaseNotes(value: UpdateDriverInfo['releaseNotes']): string | null {
  if (!value) return null
  const text = typeof value === 'string'
    ? value
    : value.map(({ note, version }) => `${version ?? 'Release'}: ${note ?? ''}`).join('\n\n')
  return redactString(text).slice(0, MAX_RELEASE_NOTES_LENGTH)
}

function normalizeProgress(progress: UpdateProgress): UpdateProgress {
  const finite = (value: number): number => Number.isFinite(value) && value >= 0 ? value : 0
  return {
    percent: Math.min(100, finite(progress.percent)),
    transferred: finite(progress.transferred),
    total: finite(progress.total),
    bytesPerSecond: finite(progress.bytesPerSecond),
  }
}
