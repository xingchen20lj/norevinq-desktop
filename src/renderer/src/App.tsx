import {
  Bot,
  Brain,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  FileCode2,
  FolderCode,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  KeyRound,
  LoaderCircle,
  MessageSquare,
  Moon,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  TerminalSquare,
  Upload,
  Wrench,
  X,
} from 'lucide-react'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'
import type { AgentActivity, AgentActivityState } from '../../shared/agent'
import type { BootstrapState, ProjectSummary } from '../../shared/contracts'
import type { ConversationSnapshot, PendingApproval } from '../../shared/conversation'
import type { CodexRuntimeSnapshot } from '../../shared/runtime'
import type { ProviderStatus } from '../../shared/providers'
import type { GitRepositorySnapshot } from '../../shared/git'
import type { ManagedWorktree } from '../../shared/worktree'
import type { DiffHunk, DiffLine, DiffSnapshot } from '../../shared/diff'
import type { TerminalEvent, TerminalSession, TerminalState } from '../../shared/terminal'

type Theme = 'dark' | 'light'

export function App(): React.JSX.Element {
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null)
  const [runtime, setRuntime] = useState<CodexRuntimeSnapshot | null>(null)
  const [conversations, setConversations] = useState<ConversationSnapshot | null>(null)
  const [providers, setProviders] = useState<ProviderStatus | null>(null)
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(null)
  const [composer, setComposer] = useState('')
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')
  const [newTask, setNewTask] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isOpening, setIsOpening] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [deepSeekKey, setDeepSeekKey] = useState('')
  const [gitStatus, setGitStatus] = useState<GitRepositorySnapshot | null>(null)
  const [gitOpen, setGitOpen] = useState(false)
  const [worktrees, setWorktrees] = useState<ManagedWorktree[]>([])
  const [selectedWorktree, setSelectedWorktree] = useState<ManagedWorktree | null>(null)
  const [worktreeOpen, setWorktreeOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalState, setTerminalState] = useState<TerminalState>({ sessions: [] })
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = window.localStorage.getItem('aster-theme')
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('aster-theme', theme)
  }, [theme])

  useEffect(() => {
    void window.aster.getBootstrapState().then((state) => {
      setBootstrap(state)
      setRuntime(state.runtime)
      setProviders(state.providers)
      setSelectedProject(state.projects[0] ?? null)
    }).catch((reason: unknown) => setError(toErrorMessage(reason)))
  }, [])

  useEffect(() => {
    const unsubscribeRuntime = window.aster.onRuntimeStatus(setRuntime)
    const unsubscribeConversations = window.aster.onConversationChanged(setConversations)
    void window.aster.getRuntimeStatus().then(setRuntime).catch((reason: unknown) => setError(toErrorMessage(reason)))
    return () => {
      unsubscribeRuntime()
      unsubscribeConversations()
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.aster.onTerminalEvent((event) => {
      setTerminalState((current) => reduceTerminalEvent(current, event))
    })
    void window.aster.getTerminalState().then((state) => {
      setTerminalState(state)
      setSelectedTerminalId((current) => current ?? state.sessions[0]?.id ?? null)
    }).catch((reason: unknown) => setError(toErrorMessage(reason)))
    return unsubscribe
  }, [])

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent): void {
      if (event.ctrlKey && event.key === '`') {
        event.preventDefault()
        void openTerminal()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  })

  useEffect(() => {
    if (!selectedProject || runtime?.phase !== 'ready') return
    setError(null)
    void window.aster.loadProjectConversations({ projectId: selectedProject.id })
      .then((snapshot) => {
        setConversations(snapshot)
        setNewTask(snapshot.selectedThreadId === null)
      })
      .catch((reason: unknown) => setError(toErrorMessage(reason)))
  }, [selectedProject, runtime?.phase])

  useEffect(() => {
    if (!selectedProject) { setGitStatus(null); setWorktrees([]); setSelectedWorktree(null); return }
    setSelectedWorktree(null)
    void Promise.all([
      window.aster.getGitStatus({ projectId: selectedProject.id }),
      window.aster.listWorktrees({ projectId: selectedProject.id }),
    ]).then(([git, items]) => { setGitStatus(git); setWorktrees(items) })
      .catch((reason: unknown) => setError(toErrorMessage(reason)))
  }, [selectedProject])

  useEffect(() => {
    const defaultModel = runtime?.models.find(({ isDefault }) => isDefault) ?? runtime?.models[0]
    if (defaultModel && !model) {
      setModel(defaultModel.id)
      setEffort(defaultModel.defaultReasoningEffort ?? defaultModel.supportedReasoningEfforts[0] ?? '')
    }
  }, [model, runtime?.models])

  const projects = bootstrap?.projects ?? []
  const selectedThread = conversations?.threads.find(({ id }) => id === conversations.selectedThreadId) ?? null
  const activityState = selectedThread ? conversations?.threadStates[selectedThread.id] ?? null : null
  const activeTurn = activityState?.turnStatus === 'inProgress'
  const selectedModel = runtime?.models.find(({ id }) => id === model) ?? null

  async function openProject(): Promise<void> {
    setIsOpening(true)
    setError(null)
    try {
      const project = await window.aster.selectProject()
      if (!project) return
      setSelectedProject(project)
      setNewTask(true)
      setBootstrap((current) => current && ({
        ...current,
        projects: [project, ...current.projects.filter(({ id }) => id !== project.id)],
      }))
    } catch (reason) {
      setError(toErrorMessage(reason))
    } finally {
      setIsOpening(false)
    }
  }

  async function selectThread(threadId: string): Promise<void> {
    setError(null)
    setNewTask(false)
    try {
      setConversations(await window.aster.selectConversation({ threadId }))
    } catch (reason) {
      setError(toErrorMessage(reason))
    }
  }

  async function submit(): Promise<void> {
    if (!selectedProject || !composer.trim() || isSubmitting || runtime?.phase !== 'ready') return
    const text = composer
    setComposer('')
    setError(null)
    setIsSubmitting(true)
    try {
      let snapshot: ConversationSnapshot
      if (newTask || !selectedThread) {
        snapshot = await window.aster.startConversation({
          projectId: selectedProject.id,
          ...(selectedWorktree ? { worktreeId: selectedWorktree.id } : {}),
          text,
          ...(model ? { model } : {}),
          ...(model.startsWith('deepseek-') ? { modelProvider: 'deepseek' } : {}),
          ...(effort ? { reasoningEffort: effort } : {}),
        })
        setNewTask(false)
      } else if (activeTurn && activityState.turnId) {
        snapshot = await window.aster.steerTurn({ threadId: selectedThread.id, turnId: activityState.turnId, text })
      } else {
        snapshot = await window.aster.startTurn({
          threadId: selectedThread.id,
          text,
          ...(effort ? { reasoningEffort: effort } : {}),
        })
      }
      setConversations(snapshot)
    } catch (reason) {
      setComposer(text)
      setError(toErrorMessage(reason))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function interrupt(): Promise<void> {
    if (!selectedThread || !activityState?.turnId) return
    try {
      await window.aster.interruptTurn({ threadId: selectedThread.id, turnId: activityState.turnId })
    } catch (reason) {
      setError(toErrorMessage(reason))
    }
  }

  async function openTerminal(forceNew = false): Promise<void> {
    if (!selectedProject) return
    if (runtime?.phase !== 'ready') {
      setError('Codex app-server 尚未就绪，无法启动终端。')
      return
    }
    const worktreeId = selectedWorktree?.id ?? null
    const threadId = !newTask ? selectedThread?.id ?? null : null
    const existing = !forceNew ? terminalState.sessions.find((session) =>
      session.projectId === selectedProject.id
      && session.worktreeId === worktreeId
      && session.threadId === threadId) : undefined
    try {
      const session = existing ?? await window.aster.createTerminal({
        projectId: selectedProject.id,
        ...(worktreeId ? { worktreeId } : {}),
        ...(threadId ? { threadId } : {}),
      })
      setSelectedTerminalId(session.id)
      setTerminalOpen(true)
    } catch (reason) {
      setError(toErrorMessage(reason))
    }
  }

  async function appendTerminalContext(sessionId: string): Promise<void> {
    const context = await window.aster.getTerminalContext({ sessionId })
    const text = [
      '请分析下面由我明确共享的当前终端输出，并据此继续任务。',
      `终端目录：${context.cwd}`,
      context.truncated ? '说明：输出已截取为最近部分。' : '说明：输出未截断。',
      '```text',
      context.content || '(终端暂无输出)',
      '```',
    ].join('\n')
    await appendReviewComment(text)
  }

  async function appendReviewComment(text: string): Promise<void> {
    if (!selectedThread || newTask) {
      setComposer((current) => current ? `${current}\n\n${text}` : text)
      setGitOpen(false)
      return
    }
    setError(null)
    setIsSubmitting(true)
    try {
      const snapshot = activeTurn && activityState.turnId
        ? await window.aster.steerTurn({ threadId: selectedThread.id, turnId: activityState.turnId, text })
        : await window.aster.startTurn({
          threadId: selectedThread.id,
          text,
          ...(effort ? { reasoningEffort: effort } : {}),
        })
      setConversations(snapshot)
    } catch (reason) {
      setError(toErrorMessage(reason))
      throw reason
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="window-drag-region" />
        <div className="brand-row">
          <div className="brand-mark"><Code2 size={17} strokeWidth={2.2} /></div>
          <span>Aster Code</span>
          <button className="icon-button sidebar-search" aria-label="搜索"><Search size={16} /></button>
        </div>

        <button className="new-task-button" disabled={!selectedProject} onClick={() => setNewTask(true)}>
          <Plus size={16} /> 新任务 <span className="shortcut">⌘N</span>
        </button>

        <nav className="sidebar-nav" aria-label="项目与任务导航">
          <div className="nav-heading">
            <span>项目</span>
            <button className="icon-button" onClick={() => void openProject()} aria-label="打开项目"><Plus size={14} /></button>
          </div>
          {projects.length === 0 ? (
            <button className="empty-project" onClick={() => void openProject()}>
              <FolderOpen size={15} /> 打开第一个项目
            </button>
          ) : projects.map((project) => (
            <div key={project.id}>
              <button
                className={`project-row ${selectedProject?.id === project.id ? 'selected' : ''}`}
                onClick={() => { setSelectedProject(project); setNewTask(true) }}
                title={project.path}
              >
                <FolderCode size={15} /><span>{project.name}</span><ChevronRight size={13} className="project-chevron" />
              </button>
              {selectedProject?.id === project.id && conversations?.projectId === project.id && (
                <div className="thread-list" aria-label={`${project.name} 任务`}>
                  {conversations.threads.map((thread) => (
                    <button
                      className={`thread-row ${!newTask && conversations.selectedThreadId === thread.id ? 'selected' : ''}`}
                      key={thread.id}
                      onClick={() => void selectThread(thread.id)}
                      title={thread.preview}
                    >
                      <MessageSquare size={12} /><span>{(thread.name ?? thread.preview) || '未命名任务'}</span>
                      {thread.status === 'active' && <span className="active-indicator" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button className="secondary-nav"><Clock3 size={16} />计划任务</button>
          <button className="secondary-nav"><ShieldCheck size={16} />安全</button>
          <button className="secondary-nav" onClick={() => setSettingsOpen(true)}><Settings size={16} />设置</button>
          <div className="sidebar-footer">
            <span>v{bootstrap?.appVersion ?? '0.1.0'}</span>
            <button className="icon-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="切换主题">
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-title">
            <span>{selectedThread?.name ?? selectedProject?.name ?? '欢迎'}</span>
            {selectedProject && <button className="context-pill" onClick={() => setGitOpen((value) => !value)} aria-label="Git 状态">
              <GitBranch size={13} />{gitStatus?.branch ?? (gitStatus?.initialized ? 'Detached' : 'Local')}
              {gitStatus && gitStatus.files.length > 0 && <b>{gitStatus.files.length}</b>}
            </button>}
            <span className={`runtime-pill ${runtime?.phase ?? 'starting'}`} title={runtime?.error ?? runtime?.binaryPath ?? undefined}>
              <span className="runtime-dot" /> Codex {runtimeLabel(runtime)}
            </span>
          </div>
          <div className="topbar-actions">
            <button className={`icon-button ${terminalOpen ? 'active' : ''}`} aria-label="终端" onClick={() => void openTerminal()}><TerminalSquare size={17} /></button>
            <button className="icon-button" aria-label="帮助"><CircleHelp size={17} /></button>
          </div>
        </header>

        <section className={`workspace ${selectedThread && !newTask ? 'conversation-workspace' : ''}`}>
          {selectedThread && !newTask ? (
            <ActivityTimeline state={activityState} />
          ) : (
            <Welcome selectedProject={selectedProject} runtime={runtime} isOpening={isOpening} openProject={openProject} />
          )}
          {error && <div className="error-banner workspace-error" role="alert">{error}</div>}
          {conversations?.approvals.map((approval) => (
            <ApprovalPanel approval={approval} key={approval.requestId} onError={setError} />
          ))}
          <div className="composer-shell">
            <textarea
              aria-label="任务输入"
              placeholder={selectedProject ? (activeTurn ? '追加指令到正在运行的任务…' : '描述你希望 Aster Code 完成的任务…') : '请先打开一个本地项目'}
              disabled={!selectedProject || runtime?.phase !== 'ready'}
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() }
              }}
              rows={2}
            />
            <div className="composer-footer">
              <div className="composer-options">
                <select aria-label="模型" value={model} onChange={(event) => {
                  const nextModel = runtime?.models.find(({ id }) => id === event.target.value)
                  setModel(event.target.value)
                  setEffort(nextModel?.defaultReasoningEffort ?? nextModel?.supportedReasoningEfforts[0] ?? '')
                }}>
                  {runtime?.models.map((item) => <option value={item.id} key={item.id} disabled={item.hidden}>{item.displayName}</option>)}
                </select>
                <select aria-label="推理强度" value={effort} onChange={(event) => setEffort(event.target.value)}>
                  {(selectedModel?.supportedReasoningEfforts ?? []).map((item) => <option value={item} key={item}>{item}</option>)}
                </select>
                <button type="button" onClick={() => setWorktreeOpen(true)}><GitBranch size={13} />{selectedWorktree ? 'Worktree' : 'Local'}</button>
              </div>
              {activeTurn ? (
                <button className="send-button stop-button" onClick={() => void interrupt()} aria-label="停止任务"><Square size={12} fill="currentColor" /></button>
              ) : (
                <button className="send-button" onClick={() => void submit()} disabled={!composer.trim() || isSubmitting || runtime?.phase !== 'ready'} aria-label="发送任务">
                  {isSubmitting ? <LoaderCircle size={16} className="spin" /> : <ChevronRight size={17} />}
                </button>
              )}
            </div>
          </div>
        </section>
        {gitOpen && selectedProject && <GitPanel
          project={selectedProject}
          snapshot={gitStatus}
          close={() => setGitOpen(false)}
          update={setGitStatus}
          onError={setError}
          onComment={appendReviewComment}
        />}
        {worktreeOpen && selectedProject && <WorktreePanel
          project={selectedProject}
          items={worktrees}
          selected={selectedWorktree}
          close={() => setWorktreeOpen(false)}
          update={setWorktrees}
          select={(item) => { setSelectedWorktree(item); setWorktreeOpen(false) }}
          onError={setError}
        />}
        {terminalOpen && selectedProject && <TerminalPanel
          projectId={selectedProject.id}
          sessions={terminalState.sessions}
          selectedId={selectedTerminalId}
          theme={theme}
          select={setSelectedTerminalId}
          close={() => setTerminalOpen(false)}
          create={() => openTerminal(true)}
          onError={setError}
          appendContext={appendTerminalContext}
        />}
      </main>
      {settingsOpen && <ProviderSettings
        providers={providers}
        apiKey={deepSeekKey}
        setApiKey={setDeepSeekKey}
        close={() => setSettingsOpen(false)}
        onError={setError}
        onUpdated={(result) => { setProviders(result.providers); setRuntime(result.runtime) }}
      />}
    </div>
  )
}

function TerminalPanel({ projectId, sessions, selectedId, theme, select, close, create, onError, appendContext }: {
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
      await window.aster.closeTerminal({ sessionId })
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
            await window.aster.writeTerminal({ sessionId: selected.id, data: '\f' })
          }
          await window.aster.clearTerminal({ sessionId: selected.id })
        })}>清屏</button>
        {(selected.status === 'running' || selected.status === 'starting') && <button className="terminal-stop" disabled={busy} onClick={() => void run(() => window.aster.terminateTerminal({ sessionId: selected.id }))}><Square size={10} fill="currentColor" />终止</button>}
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
  const terminalRef = useRef<Terminal | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const renderedOutput = useRef('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const terminal = new Terminal({
      allowProposedApi: false,
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 10_000,
      theme: xtermTheme(theme),
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    terminal.loadAddon(fit)
    terminal.loadAddon(search)
    terminal.open(host)
    terminalRef.current = terminal
    searchRef.current = search
    renderedOutput.current = session.output
    terminal.write(session.output)
    const dataDisposable = terminal.onData((data) => {
      void window.aster.writeTerminal({ sessionId: session.id, data }).catch((reason: unknown) => onError(toErrorMessage(reason)))
    })
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      void window.aster.resizeTerminal({ sessionId: session.id, cols, rows }).catch((reason: unknown) => onError(toErrorMessage(reason)))
    })
    const resizeObserver = new ResizeObserver(() => {
      try { fit.fit() } catch { /* The drawer may be transitioning out of layout. */ }
    })
    resizeObserver.observe(host)
    requestAnimationFrame(() => { try { fit.fit(); terminal.focus() } catch { /* Unmounted before frame. */ } })
    return () => {
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

function WorktreePanel({ project, items, selected, close, update, select, onError }: {
  project: ProjectSummary
  items: ManagedWorktree[]
  selected: ManagedWorktree | null
  close: () => void
  update: (items: ManagedWorktree[]) => void
  select: (item: ManagedWorktree | null) => void
  onError: (message: string | null) => void
}): React.JSX.Element {
  const [branch, setBranch] = useState('')
  const [busy, setBusy] = useState(false)

  async function act(action: () => Promise<ManagedWorktree[]>): Promise<void> {
    setBusy(true)
    onError(null)
    try { update(await action()) }
    catch (reason) { onError(toErrorMessage(reason)) }
    finally { setBusy(false) }
  }

  async function create(): Promise<void> {
    setBusy(true)
    onError(null)
    try {
      const created = await window.aster.createWorktree({
        projectId: project.id,
        ...(branch.trim() ? { branch: branch.trim() } : {}),
      })
      update([created, ...items])
      setBranch('')
    } catch (reason) {
      onError(toErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return <aside className="git-panel worktree-panel" aria-label="工作树">
    <header><div><p className="eyebrow">MANAGED WORKTREES</p><h2>隔离工作区</h2></div><button className="icon-button" onClick={close} aria-label="关闭工作树"><X size={16} /></button></header>
    <p className="worktree-note">默认从 HEAD 创建 detached worktree。填写分支名时才创建分支；`.worktreeinclude` 只复制显式匹配的已忽略普通文件。</p>
    <div className="worktree-create"><input aria-label="工作树分支" value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="可选：codex/feature-name" /><button disabled={busy} onClick={() => void create()}><Plus size={13} />创建</button></div>
    <button className={`worktree-row ${selected === null ? 'selected' : ''}`} onClick={() => select(null)}><GitBranch size={14} /><span><strong>Local</strong><small>{project.path}</small></span></button>
    {items.map((item) => <div className={`worktree-row ${selected?.id === item.id ? 'selected' : ''}`} key={item.id}>
      <button className="worktree-select" onClick={() => select(item)}><GitBranch size={14} /><span><strong>{item.branch ?? `Detached ${item.headOid?.slice(0, 7) ?? ''}`}</strong><small>{item.path}</small></span></button>
      <div className="worktree-actions">
        <button disabled={busy || item.missing} onClick={() => void act(() => item.locked ? window.aster.unlockWorktree({ worktreeId: item.id }) : window.aster.lockWorktree({ worktreeId: item.id }))}>{item.locked ? '解锁' : '锁定'}</button>
        <button disabled={busy || item.locked} onClick={() => void act(async () => {
          const next = await window.aster.removeWorktree({ worktreeId: item.id })
          if (selected?.id === item.id) select(null)
          return next
        })}>移除</button>
      </div>
    </div>)}
    {items.length === 0 && <div className="git-clean">暂无托管工作树</div>}
  </aside>
}

function GitPanel({ project, snapshot, close, update, onError, onComment }: {
  project: ProjectSummary
  snapshot: GitRepositorySnapshot | null
  close: () => void
  update: (snapshot: GitRepositorySnapshot) => void
  onError: (message: string | null) => void
  onComment: (text: string) => Promise<void>
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [diff, setDiff] = useState<DiffSnapshot | null>(null)
  const staged = snapshot?.files.filter(({ indexStatus }) => indexStatus !== '.' && indexStatus !== '?') ?? []
  const unstaged = snapshot?.files.filter(({ worktreeStatus, kind }) => worktreeStatus !== '.' || kind === 'untracked') ?? []

  async function act(action: () => Promise<GitRepositorySnapshot>): Promise<void> {
    setBusy(true)
    onError(null)
    try { update(await action()) }
    catch (reason) { onError(toErrorMessage(reason)) }
    finally { setBusy(false) }
  }

  async function review(mode: 'working' | 'staged'): Promise<void> {
    setBusy(true)
    onError(null)
    try { setDiff(await window.aster.getDiff({ projectId: project.id, mode })) }
    catch (reason) { onError(toErrorMessage(reason)) }
    finally { setBusy(false) }
  }

  return <aside className={`git-panel ${diff ? 'diff-panel' : ''}`} aria-label="Git 工作区">
    <header><div><p className="eyebrow">SOURCE CONTROL</p><h2>{snapshot?.branch ?? (snapshot?.initialized ? 'Detached HEAD' : '尚未初始化')}</h2></div><button className="icon-button" onClick={close} aria-label="关闭 Git"><X size={16} /></button></header>
    {diff ? <DiffReview
      snapshot={diff}
      close={() => setDiff(null)}
      replace={setDiff}
      refreshRepository={async () => update(await window.aster.getGitStatus({ projectId: project.id }))}
      onComment={onComment}
      onError={onError}
    /> : !snapshot?.initialized ? <div className="git-empty"><GitBranch size={24} /><p>{project.name} 还不是 Git 仓库。</p><button className="primary-button" disabled={busy} onClick={() => void act(() => window.aster.initializeGit({ projectId: project.id }))}>初始化仓库</button></div> : <>
      <div className="git-summary"><span>{snapshot.upstream ?? '无上游'}</span><span>↑ {snapshot.ahead} ↓ {snapshot.behind}</span><button onClick={() => void act(() => window.aster.getGitStatus({ projectId: project.id }))}>刷新</button></div>
      <div className="diff-actions"><button disabled={busy || unstaged.length === 0} onClick={() => void review('working')}>审阅未暂存</button><button disabled={busy || staged.length === 0} onClick={() => void review('staged')}>审阅已暂存</button></div>
      <GitFileGroup title="已暂存" files={staged} actionLabel="取消暂存" action={(path) => act(() => window.aster.unstageGitPaths({ projectId: project.id, paths: [path] }))} />
      <GitFileGroup title="更改" files={unstaged} actionLabel="暂存" action={(path) => act(() => window.aster.stageGitPaths({ projectId: project.id, paths: [path] }))} />
      {snapshot.files.length === 0 && <div className="git-clean"><Check size={16} />工作区干净</div>}
      <div className="commit-box"><textarea aria-label="提交说明" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="提交说明" rows={3} /><button disabled={busy || !message.trim() || staged.length === 0} onClick={() => void act(async () => {
        const next = await window.aster.commitGit({ projectId: project.id, message })
        setMessage('')
        return next
      })}><GitCommitHorizontal size={14} />提交</button></div>
      <button className="push-button" disabled={busy || !snapshot.branch || snapshot.remotes.length === 0} onClick={() => {
        const remote = snapshot.upstream?.split('/')[0] ?? snapshot.remotes[0]?.name
        const branch = snapshot.branch
        if (!remote || !branch) return
        void act(() => window.aster.pushGit({
          projectId: project.id,
          remote,
          branch,
          setUpstream: snapshot.upstream === null,
        }))
      }}><Upload size={14} />推送当前分支</button>
    </>}
  </aside>
}

type DiffView = 'unified' | 'split'
type ReviewLine = { side: 'old' | 'new'; line: number; code: string; kind: DiffLine['kind'] }

function DiffReview({ snapshot, close, replace, refreshRepository, onComment, onError }: {
  snapshot: DiffSnapshot
  close: () => void
  replace: (snapshot: DiffSnapshot) => void
  refreshRepository: () => Promise<void>
  onComment: (text: string) => Promise<void>
  onError: (message: string | null) => void
}): React.JSX.Element {
  const [view, setView] = useState<DiffView>('unified')
  const [busyHunk, setBusyHunk] = useState<string | null>(null)

  async function apply(hunkId: string, action: 'stage' | 'unstage' | 'revert'): Promise<void> {
    if (action === 'revert' && !window.confirm('仅恢复这个区块的工作区修改？此操作不会影响其他区块。')) return
    setBusyHunk(hunkId)
    onError(null)
    try {
      replace(await window.aster.applyDiffHunk({
        projectId: snapshot.projectId,
        snapshotId: snapshot.id,
        hunkId,
        action,
      }))
      await refreshRepository()
    } catch (reason) {
      onError(toErrorMessage(reason))
    } finally {
      setBusyHunk(null)
    }
  }

  return <section className="diff-review" aria-label="代码差异">
    <div className="diff-review-heading">
      <button disabled={busyHunk !== null} onClick={close}>← 返回状态</button>
      <div className="diff-view-toggle"><button className={view === 'unified' ? 'selected' : ''} onClick={() => setView('unified')}>统一</button><button className={view === 'split' ? 'selected' : ''} onClick={() => setView('split')}>分栏</button></div>
      <span>+{snapshot.totalAdditions} −{snapshot.totalDeletions}</span>
    </div>
    {snapshot.files.map((file) => <article className="diff-file" key={file.path}>
      <header><strong>{file.path}</strong><span>+{file.additions} −{file.deletions}</span></header>
      {file.binary ? <p>二进制或非普通文件已更改</p> : file.hunks.length > 0
        ? file.hunks.map((hunk) => <DiffHunkView
          key={hunk.id}
          filePath={file.path}
          hunk={hunk}
          view={view}
          mode={snapshot.mode}
          allowRevert={file.status !== '??'}
          busy={busyHunk === hunk.id}
          apply={apply}
          onComment={onComment}
          onError={onError}
        />)
        : <p>{file.patch ? '此差异无法安全拆分为区块。' : '无文本差异'}</p>}
      {file.truncated && <p className="danger-text">此文件差异已达到 2 MiB 展示上限，已禁用区块操作。</p>}
    </article>)}
    {snapshot.truncated && <p className="danger-text">差异达到全局展示上限；剩余内容未载入。</p>}
  </section>
}

function DiffHunkView({ filePath, hunk, view, mode, allowRevert, busy, apply, onComment, onError }: {
  filePath: string
  hunk: DiffHunk
  view: DiffView
  mode: DiffSnapshot['mode']
  allowRevert: boolean
  busy: boolean
  apply: (hunkId: string, action: 'stage' | 'unstage' | 'revert') => Promise<void>
  onComment: (text: string) => Promise<void>
  onError: (message: string | null) => void
}): React.JSX.Element {
  const [selected, setSelected] = useState<ReviewLine | null>(null)
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  async function sendComment(): Promise<void> {
    if (!selected || !comment.trim()) return
    setSending(true)
    setSent(false)
    onError(null)
    const location = selected.side === 'new' ? `新版本第 ${String(selected.line)} 行` : `旧版本第 ${String(selected.line)} 行`
    const text = [
      '请处理下面这条代码审阅意见，并在修改后说明验证结果。',
      `文件：${filePath}`,
      `位置：${location}`,
      `区块：${hunk.header}`,
      `代码：${selected.code.slice(0, 4_000)}`,
      `审阅意见：${comment.trim().slice(0, 4_000)}`,
    ].join('\n')
    try {
      await onComment(text)
      setComment('')
      setSent(true)
    } catch (reason) {
      onError(toErrorMessage(reason))
    } finally {
      setSending(false)
    }
  }

  return <section className="diff-hunk">
    <div className="diff-hunk-toolbar"><code>{hunk.header}</code><span>
      {mode === 'working' && <button disabled={busy} onClick={() => void apply(hunk.id, 'stage')}>{busy ? '处理中…' : '暂存区块'}</button>}
      {mode === 'staged' && <button disabled={busy} onClick={() => void apply(hunk.id, 'unstage')}>{busy ? '处理中…' : '取消暂存'}</button>}
      {mode === 'working' && allowRevert && <button className="revert" disabled={busy} onClick={() => void apply(hunk.id, 'revert')}>恢复区块</button>}
    </span></div>
    {view === 'unified'
      ? <div className="diff-unified">{hunk.lines.map((line, index) => <DiffLineButton
        key={`${hunk.id}:${String(index)}`}
        line={line}
        selected={selected}
        select={setSelected}
      />)}</div>
      : <div className="diff-split">{splitDiffLines(hunk.lines).map((row, index) => <div className="diff-split-row" key={`${hunk.id}:split:${String(index)}`}>
        <SplitCell line={row.old} side="old" selected={selected} select={setSelected} />
        <SplitCell line={row.new} side="new" selected={selected} select={setSelected} />
      </div>)}</div>}
    {selected && <div className="diff-comment"><span>{selected.side === 'new' ? '+' : '−'}{selected.line} · {selected.code.slice(0, 100)}</span><textarea aria-label={`评论 ${filePath} 第 ${String(selected.line)} 行`} maxLength={4_000} value={comment} onChange={(event) => { setComment(event.target.value); setSent(false) }} placeholder="写下审阅意见，将真实追加到当前智能体任务…" rows={2} /><div><button onClick={() => setSelected(null)}>取消</button><button className="comment-send" disabled={sending || !comment.trim()} onClick={() => void sendComment()}>{sending ? '正在追加…' : '追加给智能体'}</button></div>{sent && <small>已追加到当前任务。</small>}</div>}
  </section>
}

function DiffLineButton({ line, selected, select }: {
  line: DiffLine
  selected: ReviewLine | null
  select: (line: ReviewLine) => void
}): React.JSX.Element {
  const review = toReviewLine(line)
  const isSelected = review !== null && selected?.side === review.side && selected.line === review.line
  return <button className={`diff-line ${line.kind} ${isSelected ? 'selected' : ''}`} disabled={!review} onClick={() => { if (review) select(review) }}>
    <span>{line.oldLine ?? ''}</span><span>{line.newLine ?? ''}</span><code>{linePrefix(line.kind)}{line.content}</code>
  </button>
}

function SplitCell({ line, side, selected, select }: {
  line: DiffLine | null
  side: 'old' | 'new'
  selected: ReviewLine | null
  select: (line: ReviewLine) => void
}): React.JSX.Element {
  if (!line) return <span className="diff-split-cell empty" />
  const number = side === 'old' ? line.oldLine : line.newLine
  const review = number === null ? null : { side, line: number, code: line.content, kind: line.kind } satisfies ReviewLine
  const isSelected = review !== null && selected?.side === review.side && selected.line === review.line
  return <button className={`diff-split-cell ${line.kind} ${isSelected ? 'selected' : ''}`} disabled={!review} onClick={() => { if (review) select(review) }}><span>{number ?? ''}</span><code>{line.content}</code></button>
}

function toReviewLine(line: DiffLine): ReviewLine | null {
  if (line.newLine !== null) return { side: 'new', line: line.newLine, code: line.content, kind: line.kind }
  if (line.oldLine !== null) return { side: 'old', line: line.oldLine, code: line.content, kind: line.kind }
  return null
}

function linePrefix(kind: DiffLine['kind']): string {
  if (kind === 'addition') return '+'
  if (kind === 'deletion') return '−'
  return ' '
}

function splitDiffLines(lines: DiffLine[]): { old: DiffLine | null; new: DiffLine | null }[] {
  const result: { old: DiffLine | null; new: DiffLine | null }[] = []
  for (let index = 0; index < lines.length;) {
    const current = lines[index]
    if (!current) break
    if (current.kind === 'context' || current.kind === 'metadata') {
      result.push({ old: current, new: current })
      index += 1
      continue
    }
    const removed: DiffLine[] = []
    const added: DiffLine[] = []
    for (let line = lines[index]; line?.kind === 'deletion'; line = lines[index]) {
      removed.push(line)
      index += 1
    }
    for (let line = lines[index]; line?.kind === 'addition'; line = lines[index]) {
      added.push(line)
      index += 1
    }
    const length = Math.max(removed.length, added.length)
    for (let offset = 0; offset < length; offset += 1) result.push({ old: removed[offset] ?? null, new: added[offset] ?? null })
  }
  return result
}

function GitFileGroup({ title, files, actionLabel, action }: {
  title: string
  files: GitRepositorySnapshot['files']
  actionLabel: string
  action: (path: string) => Promise<void>
}): React.JSX.Element {
  if (files.length === 0) return <></>
  return <section className="git-file-group"><h3>{title}<span>{files.length}</span></h3>{files.map((file) => <div className="git-file" key={`${title}:${file.path}`}><span className="git-code">{file.indexStatus}{file.worktreeStatus}</span><span title={file.path}>{file.path}</span><button onClick={() => void action(file.path)} aria-label={`${actionLabel} ${file.path}`}>{actionLabel}</button></div>)}</section>
}

function ProviderSettings({ providers, apiKey, setApiKey, close, onError, onUpdated }: {
  providers: ProviderStatus | null
  apiKey: string
  setApiKey: (value: string) => void
  close: () => void
  onError: (message: string | null) => void
  onUpdated: (result: { providers: ProviderStatus; runtime: CodexRuntimeSnapshot }) => void
}): React.JSX.Element {
  const [saving, setSaving] = useState(false)
  const status = providers?.deepseek

  async function save(): Promise<void> {
    setSaving(true)
    onError(null)
    try {
      const result = await window.aster.saveDeepSeekCredential({ apiKey })
      setApiKey('')
      onUpdated(result)
    } catch (reason) {
      onError(toErrorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  async function remove(): Promise<void> {
    setSaving(true)
    onError(null)
    try {
      onUpdated(await window.aster.deleteDeepSeekCredential())
    } catch (reason) {
      onError(toErrorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <section className="settings-dialog" role="dialog" aria-modal="true" aria-label="模型提供商设置">
      <header><div><p className="eyebrow">MODEL PROVIDERS</p><h2>DeepSeek Responses</h2></div><button className="icon-button" onClick={close} aria-label="关闭设置"><X size={16} /></button></header>
      <div className="provider-state">
        <div className="provider-icon"><KeyRound size={17} /></div>
        <div><strong>{status?.configured ? '已配置' : '未配置'}</strong><p>{status?.credentialSource === 'environment' ? '由进程环境安全提供' : status?.credentialSource === 'os-vault' ? '保存在操作系统加密保险库' : '添加 API Key 以启用'}</p></div>
        <span className={status?.configured ? 'connected' : ''}>{status?.responsesModel ?? 'deepseek-v4-flash'}</span>
      </div>
      <label className="credential-field"><span>API Key</span><input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="仅加密保存，不写入日志或数据库" /></label>
      <p className="settings-note">支持文本、推理、函数工具、custom apply_patch 与服务端 Web Search。不支持图片、文件输入、MCP、Computer Use、后台任务或 stateful Responses。</p>
      <div className="provider-warning"><strong>DeepSeek V4 Pro 暂不可用</strong><span>截至 2026-08-10，Responses API 返回 HTTP 400；Aster 不会静默降级到 Chat Completions。</span></div>
      <footer>
        {status?.credentialSource === 'os-vault' && <button onClick={() => void remove()} disabled={saving}>删除已保存密钥</button>}
        <button className="primary-button" onClick={() => void save()} disabled={saving || apiKey.trim().length < 16}>{saving ? '正在重启运行时…' : '安全保存并启用'}</button>
      </footer>
    </section>
  </div>
}

function Welcome({ selectedProject, runtime, isOpening, openProject }: {
  selectedProject: ProjectSummary | null
  runtime: CodexRuntimeSnapshot | null
  isOpening: boolean
  openProject: () => Promise<void>
}): React.JSX.Element {
  return <div className="hero">
    <div className="hero-orbit" aria-hidden="true"><div className="hero-core"><Sparkles size={27} /></div></div>
    <p className="eyebrow">LOCAL-FIRST CODING AGENT</p>
    <h1>{selectedProject ? `开始处理 ${selectedProject.name}` : '把复杂开发工作交给智能体'}</h1>
    <p className="hero-subtitle">{selectedProject?.path ?? '由 Codex app-server 驱动的本地智能编程工作台'}</p>
    {!selectedProject && <button className="primary-button" onClick={() => void openProject()} disabled={isOpening}>
      <FolderOpen size={17} /> {isOpening ? '正在打开…' : '打开本地项目'}
    </button>}
    <div className="capability-grid">
      <article><Bot size={20} /><div><h2>Codex 任务</h2><p>{runtime?.version ? `${runtime.version} · ${String(runtime.models.length)} 个模型` : '流式活动、审批与可中断任务'}</p></div><span className={`status-chip ${runtime?.phase === 'ready' ? 'connected' : 'planned'}`}>{runtime?.phase === 'ready' ? '已连接' : runtimeLabel(runtime)}</span></article>
      <article><GitBranch size={20} /><div><h2>隔离工作树</h2><p>并行开发，不干扰本地修改</p></div><span className="status-chip connected">已接入</span></article>
      <article><ShieldCheck size={20} /><div><h2>安全工作台</h2><p>扫描、证据、修复与 SARIF</p></div><span className="status-chip planned">即将接入</span></article>
    </div>
  </div>
}

function ActivityTimeline({ state }: { state: AgentActivityState | null }): React.JSX.Element {
  if (!state || state.activities.length === 0) return <div className="empty-timeline"><MessageSquare size={23} /><p>任务已创建，等待第一条活动。</p></div>
  return <div className="activity-timeline" aria-label="智能体活动">
    {state.activities.map((activity) => <ActivityCard activity={activity} key={`${activity.type}:${activity.id}`} />)}
    {state.turnStatus === 'inProgress' && <div className="running-row"><LoaderCircle size={14} className="spin" /> Codex 正在工作</div>}
  </div>
}

function ActivityCard({ activity }: { activity: AgentActivity }): React.JSX.Element {
  if (activity.type === 'thread' || activity.type === 'turn') return <></>
  const icon = activity.type === 'userMessage' || activity.type === 'agentMessage' ? <MessageSquare size={15} />
    : activity.type === 'reasoning' ? <Brain size={15} />
      : activity.type === 'fileChange' ? <FileCode2 size={15} /> : <Wrench size={15} />
  return <article className={`activity-card ${activity.type}`}>
    <div className="activity-icon">{icon}</div>
    <div className="activity-body">
      <div className="activity-heading"><strong>{activityLabel(activity)}</strong><span>{activity.status}</span></div>
      <ActivityContent activity={activity} />
    </div>
  </article>
}

function ActivityContent({ activity }: { activity: AgentActivity }): React.JSX.Element {
  if (activity.type === 'userMessage') return <p>{activity.content.filter(({ type }) => type === 'text').map((item) => item.type === 'text' ? item.text : '').join('\n')}</p>
  if (activity.type === 'agentMessage') return <p>{activity.text}</p>
  if (activity.type === 'reasoning') return <p>{[...activity.summary, ...activity.content].join('\n')}</p>
  if (activity.type === 'command') return <><code>{activity.command}</code>{activity.output && <pre>{activity.output}</pre>}</>
  if (activity.type === 'fileChange') return <>{activity.changes.map((change) => <code key={`${change.path}:${change.kind}`}>{change.kind} {change.path}</code>)}</>
  if (activity.type === 'plan') return <>{activity.steps.map((step) => <p key={step.step}>• {step.step} — {step.status}</p>)}</>
  if (activity.type === 'error') return <p className="danger-text">{activity.message}</p>
  if (activity.type === 'mcpTool') return <p>{activity.server} / {activity.tool}{activity.progress ? ` · ${activity.progress}` : ''}</p>
  if (activity.type === 'webSearch') return <p>{activity.query}</p>
  if (activity.type === 'dynamicTool') return <p>{activity.namespace ? `${activity.namespace} / ` : ''}{activity.tool}</p>
  return <p>{activity.type}</p>
}

function ApprovalPanel({ approval, onError }: { approval: PendingApproval; onError: (message: string) => void }): React.JSX.Element {
  async function decide(decision: 'accept' | 'acceptForSession' | 'decline'): Promise<void> {
    try { await window.aster.resolveApproval({ requestId: approval.requestId, decision }) }
    catch (reason) { onError(toErrorMessage(reason)) }
  }
  return <section className="approval-panel" aria-label="待审批操作">
    <div><strong>{approval.kind === 'command' ? '允许执行命令？' : '允许修改文件？'}</strong><p>{approval.command ?? approval.reason ?? approval.grantRoot ?? 'Codex 请求继续执行受保护操作。'}</p></div>
    <button onClick={() => void decide('decline')}><X size={14} />拒绝</button>
    <button onClick={() => void decide('acceptForSession')}>本次会话允许</button>
    <button className="approve" onClick={() => void decide('accept')}><Check size={14} />允许</button>
  </section>
}

function activityLabel(activity: AgentActivity): string {
  switch (activity.type) {
    case 'userMessage': return '你的指令'
    case 'agentMessage': return 'Codex'
    case 'reasoning': return '推理'
    case 'command': return '命令'
    case 'fileChange': return '文件变更'
    case 'plan': return '计划'
    case 'error': return '错误'
    case 'mcpTool': return 'MCP 工具'
    case 'dynamicTool': return '工具'
    case 'webSearch': return '网络搜索'
    case 'collab': return '协作'
    case 'subagent': return '子智能体'
    default: return '活动'
  }
}

const MAX_TERMINAL_RENDER_CHARS = 4 * 1024 * 1024

function reduceTerminalEvent(state: TerminalState, event: TerminalEvent): TerminalState {
  if (event.type === 'removed') return { sessions: state.sessions.filter(({ id }) => id !== event.sessionId) }
  if (event.type === 'session') {
    const exists = state.sessions.some(({ id }) => id === event.session.id)
    return {
      sessions: exists
        ? state.sessions.map((session) => session.id === event.session.id ? event.session : session)
        : [...state.sessions, event.session],
    }
  }
  return {
    sessions: state.sessions.map((session) => {
      if (session.id !== event.sessionId) return session
      const combined = session.output + event.data
      return {
        ...session,
        status: event.status,
        output: combined.length > MAX_TERMINAL_RENDER_CHARS ? combined.slice(-MAX_TERMINAL_RENDER_CHARS) : combined,
        outputTruncated: event.outputTruncated || combined.length > MAX_TERMINAL_RENDER_CHARS,
        updatedAt: new Date().toISOString(),
      }
    }),
  }
}

function toErrorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  if (typeof reason === 'string' && reason) return reason
  return '发生未知错误。'
}

function runtimeLabel(runtime: CodexRuntimeSnapshot | null): string {
  switch (runtime?.phase) {
    case 'ready': return '已就绪'
    case 'discovering': return '查找中'
    case 'starting': return '启动中'
    case 'initializing': return '握手中'
    case 'restarting': return '重启中'
    case 'unavailable': return '不可用'
    case 'failed': return '异常'
    case 'stopped': return '已停止'
    default: return '连接中'
  }
}
