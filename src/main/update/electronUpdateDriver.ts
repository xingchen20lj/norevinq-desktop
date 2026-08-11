import electronUpdater, { type AppUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { UpdateDriver, UpdateDriverInfo } from './updateService.js'

export function createElectronUpdateDriver(): UpdateDriver {
  const { autoUpdater } = electronUpdater
  autoUpdater.logger = null
  return new ElectronUpdateDriver(autoUpdater)
}

class ElectronUpdateDriver implements UpdateDriver {
  readonly #updater: AppUpdater

  constructor(updater: AppUpdater) {
    this.#updater = updater
  }

  configure(options: Parameters<UpdateDriver['configure']>[0]): void {
    this.#updater.autoDownload = options.autoDownload
    this.#updater.autoInstallOnAppQuit = options.autoInstallOnAppQuit
    this.#updater.allowPrerelease = options.allowPrerelease
    this.#updater.allowDowngrade = options.allowDowngrade
    this.#updater.disableWebInstaller = options.disableWebInstaller
  }

  onError(listener: (error: Error) => void): () => void {
    this.#updater.on('error', listener)
    return () => this.#updater.off('error', listener)
  }

  onChecking(listener: () => void): () => void {
    this.#updater.on('checking-for-update', listener)
    return () => this.#updater.off('checking-for-update', listener)
  }

  onAvailable(listener: (info: UpdateDriverInfo) => void): () => void {
    const wrapped = (info: UpdateInfo): void => listener(info)
    this.#updater.on('update-available', wrapped)
    return () => this.#updater.off('update-available', wrapped)
  }

  onNotAvailable(listener: (info: UpdateDriverInfo) => void): () => void {
    const wrapped = (info: UpdateInfo): void => listener(info)
    this.#updater.on('update-not-available', wrapped)
    return () => this.#updater.off('update-not-available', wrapped)
  }

  onProgress(listener: (progress: ProgressInfo) => void): () => void {
    this.#updater.on('download-progress', listener)
    return () => this.#updater.off('download-progress', listener)
  }

  onDownloaded(listener: (info: UpdateDriverInfo) => void): () => void {
    const wrapped = (info: UpdateInfo): void => listener(info)
    this.#updater.on('update-downloaded', wrapped)
    return () => this.#updater.off('update-downloaded', wrapped)
  }

  onCancelled(listener: (info: UpdateDriverInfo) => void): () => void {
    const wrapped = (info: UpdateInfo): void => listener(info)
    this.#updater.on('update-cancelled', wrapped)
    return () => this.#updater.off('update-cancelled', wrapped)
  }

  checkForUpdates(): Promise<unknown> {
    return this.#updater.checkForUpdates()
  }

  downloadUpdate(): Promise<readonly string[]> {
    return this.#updater.downloadUpdate()
  }

  quitAndInstall(): void {
    this.#updater.quitAndInstall(false, true)
  }
}
