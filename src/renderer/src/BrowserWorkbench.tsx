import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { BrowserSnapshot } from '../../shared/browser'

export function BrowserWorkbench({ snapshot, close, onError }: {
  snapshot: BrowserSnapshot | null
  close: () => void
  onError: (message: string | null) => void
}): React.JSX.Element {
  const [address, setAddress] = useState(snapshot?.url ?? 'http://localhost:3000')
  const slot = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.aster.openBrowser({}).catch((reason: unknown) => onError(errorMessage(reason)))
    const element = slot.current
    if (!element) return
    const update = (): void => {
      const bounds = element.getBoundingClientRect()
      if (bounds.width >= 100 && bounds.height >= 80) {
        void window.aster.setBrowserBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })
          .catch((reason: unknown) => onError(errorMessage(reason)))
      }
    }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    window.addEventListener('resize', update)
    update()
    return () => { observer.disconnect(); window.removeEventListener('resize', update) }
  }, [onError])

  useEffect(() => {
    if (snapshot?.url) setAddress(snapshot.url)
  }, [snapshot?.url])

  async function run(action: () => Promise<unknown>): Promise<void> {
    onError(null)
    try { await action() } catch (reason) { onError(errorMessage(reason)) }
  }

  async function dismiss(): Promise<void> {
    await run(() => window.aster.closeBrowser())
    close()
  }

  return <section className="browser-workbench" aria-label="本地网页预览">
    <header className="browser-toolbar">
      <button disabled={!snapshot?.canGoBack} onClick={() => void run(() => window.aster.goBackBrowser())} aria-label="后退"><ArrowLeft size={14} /></button>
      <button disabled={!snapshot?.canGoForward} onClick={() => void run(() => window.aster.goForwardBrowser())} aria-label="前进"><ArrowRight size={14} /></button>
      <button onClick={() => void run(() => snapshot?.loading ? window.aster.stopBrowser() : window.aster.reloadBrowser())} aria-label={snapshot?.loading ? '停止加载' : '刷新网页'}>{snapshot?.loading ? <Square size={11} fill="currentColor" /> : <RefreshCw size={13} />}</button>
      <form onSubmit={(event) => { event.preventDefault(); void run(() => window.aster.navigateBrowser({ url: address })) }}><input aria-label="本地预览地址" value={address} onChange={(event) => setAddress(event.target.value)} spellCheck={false} /><button type="submit" disabled={!address.trim()}>打开</button></form>
      <button disabled={!snapshot?.url} onClick={() => { if (snapshot?.url && window.confirm('在系统浏览器中打开当前地址？')) void run(() => window.aster.openBrowserExternal({ url: snapshot.url ?? '', confirmed: true })) }} aria-label="在系统浏览器打开"><ExternalLink size={13} /></button>
      <button onClick={() => void dismiss()} aria-label="关闭网页预览"><X size={15} /></button>
    </header>
    <div className="browser-status"><span>{snapshot?.title ?? '本地网页预览'}</span>{snapshot?.loading && <LoaderCircle size={11} className="spin" />}{snapshot?.error && <strong>{snapshot.error}</strong>}<em>仅允许 loopback / .localhost</em></div>
    <div className="browser-native-slot" ref={slot}><span>原生隔离网页区域</span></div>
    <section className="browser-console" aria-label="网页控制台">
      <header><strong>控制台</strong><span>{snapshot?.logs.length ?? 0} 条</span><button disabled={!snapshot?.logs.length} onClick={() => void run(() => window.aster.clearBrowserLogs())}><Trash2 size={11} />清除</button></header>
      <div>{snapshot?.logs.length ? snapshot.logs.slice(-100).map((entry) => <p className={entry.level} key={entry.id}><time>{new Date(entry.createdAt).toLocaleTimeString()}</time><strong>{entry.level}</strong><code>{entry.message}</code>{entry.source && <span>{entry.source}{entry.line === null ? '' : `:${String(entry.line)}`}</span>}</p>) : <p className="empty">页面 console 输出和加载错误会显示在这里。</p>}</div>
    </section>
  </section>
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
