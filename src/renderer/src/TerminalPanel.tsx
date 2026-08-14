import { Plus, Search, Square, TerminalSquare, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { TerminalSession } from '../../shared/terminal'
import '@xterm/xterm/css/xterm.css'

type Theme = 'dark' | 'light'

export function TerminalPanel({ projectId, sessions, selectedId, theme, select, close, create, onError, appendContext }: {
  projectId: string
  sessions: TerminalSession[]
  selectedId: string | null
  theme: Theme
  select: (sessionId: string | null) => void
  close: () => void
  create: () => Promise<void>
  onError: (message: string | null) => void
  appendContext: (sessionId: string) => Promise<void>
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const projectSessions = sessions.filter((session) => session.projectId === projectId)
  const selected = projectSessions.find(({ id }) => id === selectedId) ?? projectSessions[0] ?? null

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true)
    onError(null)
    try { await action() }
    catch (reason) { onError(toErrorMessage(reason)) }
    finally { setBusy(false) }
  }

  async function closeSession(sessionId: string): Promise<void> {
    await run(async () => {
      await window.norevinq.closeTerminal({ sessionId })
      const next = projectSessions.find(({ id }) => id !== sessionId)
      select(next?.id ?? null)
    })
  }

  return <section className="terminal-drawer" aria-label="集成终端">
    <header className="terminal-header">
      <div className="terminal-tabs" role="tablist" aria-label="终端会话">
        {projectSessions.map((session, index) => <button
          role="tab"
          aria-selected={selected?.id === session.id}
          className={selected?.id === session.id ? 'selected' : ''}
          onClick={() => select(session.id)}
          key={session.id}
          title={session.cwd}
        ><TerminalSquare size={12} /><span>{terminalTitle(session, index)}</span><i className={session.status} /></button>)}
      </div>
      <button className="icon-button" aria-label="新建终端" disabled={busy} onClick={() => void run(create)}><Plus size={14} /></button>
      <button className="icon-button" aria-label="关闭终端面板" onClick={close}><X size={15} /></button>
    </header>
    {selected ? <>
      <div className="terminal-toolbar">
        <span title={selected.cwd}>{selected.cwd}</span>
        <strong>{terminalStatusLabel(selected)}</strong>
        <button disabled={busy} onClick={() => void run(() => appendContext(selected.id))}>共享输出给智能体</button>
        <button disabled={busy} onClick={() => void run(async () => {
          if (selected.status === 'running' || selected.status === 'starting') {
            await window.norevinq.writeTerminal({ sessionId: selected.id, data: '\f' })
          }
          await window.norevinq.clearTerminal({ sessionId: selected.id })
        })}>清屏</button>
        {(selected.status === 'running' || selected.status === 'starting') && <button className="terminal-stop" disabled={busy} onClick={() => void run(() => window.norevinq.terminateTerminal({ sessionId: selected.id }))}><Square size={10} fill="currentColor" />终止</button>}
        <button disabled={busy} onClick={() => void closeSession(selected.id)}>关闭会话</button>
      </div>
      <TerminalCanvas session={selected} theme={theme} onError={onError} />
    </> : <div className="terminal-empty"><TerminalSquare size={22} /><p>当前项目没有终端会话。</p><button onClick={() => void run(create)}>新建终端</button></div>}
  </section>
}

function TerminalCanvas({ session, theme, onError }: {
  session: TerminalSession
  theme: Theme
  onError: (message: string | null) => void
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<import('@xterm/xterm').Terminal | null>(null)
  const searchRef = useRef<import('@xterm/addon-search').SearchAddon | null>(null)
  const renderedOutput = useRef('')
  const latestOutput = useRef(session.output)
  const latestTheme = useRef(theme)
  const [query, setQuery] = useState('')
  latestOutput.current = session.output
  latestTheme.current = theme

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let disposeTerminal = (): void => undefined

    void Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/addon-search'),
    ]).then(([{ Terminal }, { FitAddon }, { SearchAddon }]) => {
      if (disposed || !host.isConnected) return
      const terminal = new Terminal({
        allowProposedApi: false,
        cursorBlink: true,
        cursorStyle: 'bar',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 12,
        lineHeight: 1.25,
        scrollback: 10_000,
        theme: xtermTheme(latestTheme.current),
      })
      const fit = new FitAddon()
      const search = new SearchAddon()
      terminal.loadAddon(fit)
      terminal.loadAddon(search)
      terminal.open(host)
      terminalRef.current = terminal
      searchRef.current = search
      renderedOutput.current = latestOutput.current
      terminal.write(latestOutput.current)
      const dataDisposable = terminal.onData((data) => {
        void window.norevinq.writeTerminal({ sessionId: session.id, data }).catch((reason: unknown) => onError(toErrorMessage(reason)))
      })
      const resizeDisposable = terminal.onResize(({ cols, rows }) => {
        void window.norevinq.resizeTerminal({ sessionId: session.id, cols, rows }).catch((reason: unknown) => onError(toErrorMessage(reason)))
      })
      const resizeObserver = new ResizeObserver(() => {
        try { fit.fit() } catch { /* The drawer may be transitioning out of layout. */ }
      })
      resizeObserver.observe(host)
      requestAnimationFrame(() => { try { fit.fit(); terminal.focus() } catch { /* Unmounted before frame. */ } })
      disposeTerminal = () => {
        resizeObserver.disconnect()
        dataDisposable.dispose()
        resizeDisposable.dispose()
        search.dispose()
        fit.dispose()
        terminal.dispose()
        terminalRef.current = null
        searchRef.current = null
        renderedOutput.current = ''
      }
    }).catch((reason: unknown) => {
      if (!disposed) onError(`终端组件加载失败：${toErrorMessage(reason)}`)
    })

    return () => {
      disposed = true
      disposeTerminal()
    }
  }, [session.id])

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = xtermTheme(theme)
  }, [theme])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal || session.output === renderedOutput.current) return
    if (session.output.startsWith(renderedOutput.current)) {
      terminal.write(session.output.slice(renderedOutput.current.length))
    } else {
      terminal.reset()
      terminal.write(session.output)
    }
    renderedOutput.current = session.output
  }, [session.output])

  return <div className="terminal-canvas-shell">
    <div className="terminal-search"><Search size={12} /><input aria-label="搜索终端输出" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
      if (event.key === 'Enter' && query) searchRef.current?.findNext(query)
      if (event.key === 'Escape') { setQuery(''); terminalRef.current?.focus() }
    }} placeholder="搜索" /><button disabled={!query} onClick={() => searchRef.current?.findPrevious(query)}>↑</button><button disabled={!query} onClick={() => searchRef.current?.findNext(query)}>↓</button></div>
    <div className="terminal-canvas" ref={hostRef} />
  </div>
}

function terminalTitle(session: TerminalSession, index: number): string {
  const parts = session.cwd.split(/[\\/]/)
  return `${parts.at(-1) ?? 'Terminal'} ${String(index + 1)}`
}

function terminalStatusLabel(session: TerminalSession): string {
  if (session.status === 'exited') return `已退出 (${String(session.exitCode ?? '?')})`
  if (session.status === 'failed') return '连接失败'
  if (session.status === 'terminating') return '正在终止'
  if (session.status === 'starting') return '正在启动'
  return session.outputTruncated ? '运行中 · 输出已截断' : '运行中'
}

function xtermTheme(theme: Theme): { background: string; foreground: string; cursor: string; selectionBackground: string } {
  return theme === 'dark'
    ? { background: '#0d0f12', foreground: '#d9dee7', cursor: '#95a2ff', selectionBackground: '#38416a' }
    : { background: '#f6f7f9', foreground: '#252a33', cursor: '#4655d6', selectionBackground: '#c9cff6' }
}

function toErrorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  if (typeof reason === 'string' && reason) return reason
  return '发生未知错误。'
}
