import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  UpdateService,
  type UpdateDriver,
  type UpdateDriverInfo,
} from '../../src/main/update/updateService.js'
import type { UpdateProgress } from '../../src/shared/update.js'

afterEach(() => vi.useRealTimers())

describe('UpdateService', () => {
  it('stays explicitly disabled for development, unsupported, and unconfigured packages', async () => {
    const driver = new FakeUpdateDriver()
    const development = new UpdateService({
      configured: true,
      currentVersion: '0.1.0',
      driver,
      isPackaged: false,
      platform: 'darwin',
    })
    expect(development.getSnapshot()).toMatchObject({
      phase: 'disabled',
      configured: true,
      supported: true,
      automaticChecks: false,
      disabledReason: '开发构建不会连接发布更新源。',
    })
    await development.checkForUpdates()
    expect(driver.checkCalls).toBe(0)

    expect(new UpdateService({
      configured: true,
      currentVersion: '0.1.0',
      driver,
      isPackaged: true,
      platform: 'freebsd',
    }).getSnapshot()).toMatchObject({ phase: 'disabled', supported: false })
    expect(new UpdateService({
      configured: false,
      currentVersion: '0.1.0',
      driver,
      isPackaged: true,
      platform: 'win32',
    }).getSnapshot()).toMatchObject({ phase: 'disabled', configured: false })
  })

  it('checks, downloads with bounded progress, and installs only a verified downloaded update', async () => {
    const driver = new FakeUpdateDriver()
    const now = new Date('2026-08-11T03:00:00.000Z')
    const service = new UpdateService({
      configured: true,
      currentVersion: '0.1.0',
      driver,
      isPackaged: true,
      platform: 'darwin',
      clock: () => now,
    })
    expect(driver.configuration).toEqual({
      autoDownload: false,
      autoInstallOnAppQuit: true,
      allowPrerelease: false,
      allowDowngrade: false,
      disableWebInstaller: true,
    })
    expect(() => service.installUpdate()).toThrow('verified downloaded update')

    driver.checkAction = () => {
      driver.emitAvailable({
        version: '0.2.0',
        releaseDate: '2026-08-11T02:00:00Z',
        releaseNotes: 'Security and stability fixes.',
      })
      return Promise.resolve()
    }
    expect(await service.checkForUpdates()).toMatchObject({
      phase: 'available',
      availableVersion: '0.2.0',
      checkedAt: now.toISOString(),
      releaseNotes: 'Security and stability fixes.',
    })

    driver.downloadAction = () => {
      driver.emitProgress({ percent: 130, transferred: 80, total: 100, bytesPerSecond: -1 })
      driver.emitDownloaded({ version: '0.2.0' })
      return Promise.resolve(['/private/update.zip'])
    }
    const downloaded = await service.downloadUpdate()
    expect(downloaded).toMatchObject({
      phase: 'downloaded',
      progress: { percent: 100, transferred: 80, total: 100, bytesPerSecond: 0 },
      installOnQuit: true,
    })
    service.installUpdate()
    expect(driver.installCalls).toBe(1)
    service.dispose()
  })

  it('deduplicates active checks, schedules bounded automatic checks, and redacts failures', async () => {
    vi.useFakeTimers()
    const driver = new FakeUpdateDriver()
    const service = new UpdateService({
      configured: true,
      currentVersion: '0.1.0',
      driver,
      isPackaged: true,
      platform: 'win32',
    })
    service.startAutomaticChecks()
    service.startAutomaticChecks()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(driver.checkCalls).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(driver.checkCalls).toBe(1)
    driver.emitNotAvailable({ version: '0.1.0' })
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000)
    expect(driver.checkCalls).toBe(2)

    driver.checkAction = () => Promise.reject(new Error('Authorization: Bearer secret-token'))
    driver.emitNotAvailable({ version: '0.1.0' })
    const failed = await service.checkForUpdates()
    expect(failed.phase).toBe('error')
    expect(failed.error).not.toContain('secret-token')
    expect(failed.error).toContain('[REDACTED]')
    service.dispose()
  })
})

class FakeUpdateDriver implements UpdateDriver {
  configuration: Parameters<UpdateDriver['configure']>[0] | null = null
  checkCalls = 0
  installCalls = 0
  checkAction: () => Promise<unknown> = () => Promise.resolve()
  downloadAction: () => Promise<readonly string[]> = () => Promise.resolve([])
  readonly #error = new Set<(error: Error) => void>()
  readonly #checking = new Set<() => void>()
  readonly #available = new Set<(info: UpdateDriverInfo) => void>()
  readonly #notAvailable = new Set<(info: UpdateDriverInfo) => void>()
  readonly #progress = new Set<(progress: UpdateProgress) => void>()
  readonly #downloaded = new Set<(info: UpdateDriverInfo) => void>()
  readonly #cancelled = new Set<(info: UpdateDriverInfo) => void>()

  configure(options: Parameters<UpdateDriver['configure']>[0]): void { this.configuration = options }
  onError(listener: (error: Error) => void): () => void { return add(this.#error, listener) }
  onChecking(listener: () => void): () => void { return add(this.#checking, listener) }
  onAvailable(listener: (info: UpdateDriverInfo) => void): () => void { return add(this.#available, listener) }
  onNotAvailable(listener: (info: UpdateDriverInfo) => void): () => void { return add(this.#notAvailable, listener) }
  onProgress(listener: (progress: UpdateProgress) => void): () => void { return add(this.#progress, listener) }
  onDownloaded(listener: (info: UpdateDriverInfo) => void): () => void { return add(this.#downloaded, listener) }
  onCancelled(listener: (info: UpdateDriverInfo) => void): () => void { return add(this.#cancelled, listener) }

  checkForUpdates(): Promise<unknown> {
    this.checkCalls += 1
    for (const listener of this.#checking) listener()
    return this.checkAction()
  }

  downloadUpdate(): Promise<readonly string[]> { return this.downloadAction() }
  quitAndInstall(): void { this.installCalls += 1 }
  emitAvailable(info: UpdateDriverInfo): void { for (const listener of this.#available) listener(info) }
  emitNotAvailable(info: UpdateDriverInfo): void { for (const listener of this.#notAvailable) listener(info) }
  emitProgress(progress: UpdateProgress): void { for (const listener of this.#progress) listener(progress) }
  emitDownloaded(info: UpdateDriverInfo): void { for (const listener of this.#downloaded) listener(info) }
}

function add<T>(set: Set<T>, listener: T): () => void {
  set.add(listener)
  return () => set.delete(listener)
}
