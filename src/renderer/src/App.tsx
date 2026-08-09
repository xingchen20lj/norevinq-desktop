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
import { useEffect, useState } from 'react'
import type { AgentActivity, AgentActivityState } from '../../shared/agent'
import type { BootstrapState, ProjectSummary } from '../../shared/contracts'
import type { ConversationSnapshot, PendingApproval } from '../../shared/conversation'
import type { CodexRuntimeSnapshot } from '../../shared/runtime'
import type { ProviderStatus } from '../../shared/providers'
import type { GitRepositorySnapshot } from '../../shared/git'

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
    if (!selectedProject) { setGitStatus(null); return }
    void window.aster.getGitStatus({ projectId: selectedProject.id })
      .then(setGitStatus)
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
            <button className="icon-button" aria-label="终端"><TerminalSquare size={17} /></button>
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
                <span><GitBranch size={13} />Local</span>
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

function GitPanel({ project, snapshot, close, update, onError }: {
  project: ProjectSummary
  snapshot: GitRepositorySnapshot | null
  close: () => void
  update: (snapshot: GitRepositorySnapshot) => void
  onError: (message: string | null) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const staged = snapshot?.files.filter(({ indexStatus }) => indexStatus !== '.' && indexStatus !== '?') ?? []
  const unstaged = snapshot?.files.filter(({ worktreeStatus, kind }) => worktreeStatus !== '.' || kind === 'untracked') ?? []

  async function act(action: () => Promise<GitRepositorySnapshot>): Promise<void> {
    setBusy(true)
    onError(null)
    try { update(await action()) }
    catch (reason) { onError(toErrorMessage(reason)) }
    finally { setBusy(false) }
  }

  return <aside className="git-panel" aria-label="Git 工作区">
    <header><div><p className="eyebrow">SOURCE CONTROL</p><h2>{snapshot?.branch ?? (snapshot?.initialized ? 'Detached HEAD' : '尚未初始化')}</h2></div><button className="icon-button" onClick={close} aria-label="关闭 Git"><X size={16} /></button></header>
    {!snapshot?.initialized ? <div className="git-empty"><GitBranch size={24} /><p>{project.name} 还不是 Git 仓库。</p><button className="primary-button" disabled={busy} onClick={() => void act(() => window.aster.initializeGit({ projectId: project.id }))}>初始化仓库</button></div> : <>
      <div className="git-summary"><span>{snapshot.upstream ?? '无上游'}</span><span>↑ {snapshot.ahead} ↓ {snapshot.behind}</span><button onClick={() => void act(() => window.aster.getGitStatus({ projectId: project.id }))}>刷新</button></div>
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
      <article><GitBranch size={20} /><div><h2>隔离工作树</h2><p>并行开发，不干扰本地修改</p></div><span className="status-chip planned">即将接入</span></article>
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
