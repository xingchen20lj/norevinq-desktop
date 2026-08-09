import { randomUUID } from 'node:crypto'
import { BrowserWindow, WebContentsView } from 'electron'
import type {
  BrowserBounds,
  BrowserLogEntry,
  BrowserLogLevel,
  BrowserSnapshot,
  BrowserSubscription,
} from '../../shared/browser.js'
import { isAllowedBrowserRequest, normalizeLocalPreviewUrl } from './browserPolicy.js'

const MAX_LOGS = 500
const MAX_LOG_CHARS = 4_000

export class BrowserService {
  readonly #getWindow: () => BrowserWindow | null
  readonly #openExternal: (url: string) => Promise<void>
  readonly #subscriptions = new Set<BrowserSubscription>()
  readonly #partition = `aster-preview-${randomUUID()}`
  #view: WebContentsView | null = null
  #owner: BrowserWindow | null = null
  #sessionConfigured = false
  #snapshot: BrowserSnapshot = emptySnapshot()

  constructor(getWindow: () => BrowserWindow | null, openExternal: (url: string) => Promise<void>) {
    this.#getWindow = getWindow
    this.#openExternal = openExternal
  }

  getSnapshot(): BrowserSnapshot {
    return { ...this.#snapshot, logs: this.#snapshot.logs.map((entry) => ({ ...entry })) }
  }

  subscribe(subscription: BrowserSubscription): () => void {
    this.#subscriptions.add(subscription)
    return () => this.#subscriptions.delete(subscription)
  }

  async open(url?: string): Promise<BrowserSnapshot> {
    this.#ensureView()
    this.#update({ open: true, error: null })
    if (url) await this.navigate(url)
    return this.getSnapshot()
  }

  close(): BrowserSnapshot {
    const view = this.#view
    if (view) {
      this.#owner?.contentView.removeChildView(view)
      view.webContents.close()
      this.#view = null
      this.#owner = null
    }
    this.#snapshot = emptySnapshot()
    this.#emit()
    return this.getSnapshot()
  }

  async navigate(input: string): Promise<BrowserSnapshot> {
    const url = normalizeLocalPreviewUrl(input)
    const view = this.#ensureView()
    this.#update({ open: true, url, loading: true, error: null })
    try { await view.webContents.loadURL(url) }
    catch (error) {
      this.#update({ loading: false, error: error instanceof Error ? error.message.slice(0, MAX_LOG_CHARS) : String(error) })
    }
    return this.getSnapshot()
  }

  reload(): BrowserSnapshot {
    this.#view?.webContents.reload()
    return this.getSnapshot()
  }

  stop(): BrowserSnapshot {
    this.#view?.webContents.stop()
    this.#update({ loading: false })
    return this.getSnapshot()
  }

  goBack(): BrowserSnapshot {
    const history = this.#view?.webContents.navigationHistory
    if (history?.canGoBack()) history.goBack()
    return this.getSnapshot()
  }

  goForward(): BrowserSnapshot {
    const history = this.#view?.webContents.navigationHistory
    if (history?.canGoForward()) history.goForward()
    return this.getSnapshot()
  }

  setBounds(bounds: BrowserBounds): void {
    const values = [bounds.x, bounds.y, bounds.width, bounds.height]
    if (!values.every(Number.isFinite)) throw new Error('Browser bounds are invalid.')
    const normalized = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.min(10_000, Math.max(100, Math.round(bounds.width))),
      height: Math.min(10_000, Math.max(80, Math.round(bounds.height))),
    }
    this.#view?.setBounds(normalized)
  }

  clearLogs(): BrowserSnapshot {
    this.#update({ logs: [] })
    return this.getSnapshot()
  }

  async openInSystemBrowser(input: string): Promise<void> {
    let url: URL
    try { url = new URL(input) } catch { throw new Error('URL 无效。') }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || input.length > 2_048) {
      throw new Error('仅允许在系统浏览器打开无内嵌凭据的 HTTP(S) URL。')
    }
    await this.#openExternal(url.toString())
  }

  dispose(): void {
    this.close()
    this.#subscriptions.clear()
  }

  #ensureView(): WebContentsView {
    if (this.#view && !this.#view.webContents.isDestroyed()) return this.#view
    const owner = this.#getWindow()
    if (!owner || owner.isDestroyed()) throw new Error('Main window is unavailable.')
    const view = new WebContentsView({ webPreferences: {
      partition: this.#partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    } })
    view.setBackgroundColor('#ffffff')
    const contents = view.webContents
    if (!this.#sessionConfigured) {
      contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
      contents.session.setPermissionCheckHandler(() => false)
      contents.session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
        callback({ cancel: !isAllowedBrowserRequest(details.url) })
      })
      contents.session.on('will-download', (event) => event.preventDefault())
      this.#sessionConfigured = true
    }
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => { if (!isAllowedBrowserRequest(url)) event.preventDefault() })
    contents.on('did-start-loading', () => this.#update({ loading: true, error: null }))
    contents.on('did-stop-loading', () => this.#syncNavigation())
    contents.on('did-navigate', (_event, url) => this.#update({ url, error: null }))
    contents.on('did-navigate-in-page', (_event, url) => this.#update({ url }))
    contents.on('page-title-updated', (_event, title) => this.#update({ title: title.slice(0, 500) }))
    contents.on('did-fail-load', (_event, errorCode, description, _url, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) this.#update({ loading: false, error: `${description} (${String(errorCode)})`.slice(0, MAX_LOG_CHARS) })
    })
    contents.on('console-message', (_event, level, message, line, source) => this.#appendLog(
      normalizeLogLevel(level),
      message,
      source,
      line,
    ))
    contents.on('render-process-gone', (_event, details) => this.#update({
      loading: false,
      error: `预览渲染进程已退出：${details.reason}`,
    }))
    owner.contentView.addChildView(view)
    this.#owner = owner
    this.#view = view
    return view
  }

  #syncNavigation(): void {
    const contents = this.#view?.webContents
    if (!contents || contents.isDestroyed()) return
    const history = contents.navigationHistory
    this.#update({
      loading: contents.isLoading(),
      url: contents.getURL() || this.#snapshot.url,
      title: contents.getTitle() || this.#snapshot.title,
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
    })
  }

  #appendLog(level: BrowserLogLevel, message: string, source: string, line: number): void {
    const entry: BrowserLogEntry = {
      id: randomUUID(),
      level,
      message: message.slice(0, MAX_LOG_CHARS),
      source: safeSource(source),
      line: Number.isSafeInteger(line) && line >= 0 ? line : null,
      createdAt: new Date().toISOString(),
    }
    this.#update({ logs: [...this.#snapshot.logs, entry].slice(-MAX_LOGS) })
  }

  #update(patch: Partial<BrowserSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch }
    this.#emit()
  }

  #emit(): void {
    const snapshot = this.getSnapshot()
    for (const subscription of this.#subscriptions) subscription(snapshot)
  }
}

function emptySnapshot(): BrowserSnapshot {
  return { open: false, url: null, title: null, loading: false, canGoBack: false, canGoForward: false, error: null, logs: [] }
}

function normalizeLogLevel(level: number): BrowserLogLevel {
  if (level === 0) return 'debug'
  if (level === 2) return 'warning'
  if (level >= 3) return 'error'
  return 'info'
}

function safeSource(source: string): string | null {
  if (!source) return null
  try {
    const url = new URL(source)
    return `${url.origin}${url.pathname}`.slice(0, 1_000)
  } catch {
    return source.slice(0, 1_000)
  }
}
