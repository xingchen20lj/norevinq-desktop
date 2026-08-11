import {
  Archive,
  ArchiveRestore,
  Bot,
  Brain,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  FileCode2,
  Files,
  FolderCode,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  GitPullRequest,
  Globe2,
  LoaderCircle,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  Target,
  TerminalSquare,
  Trash2,
  Upload,
  Wrench,
  X,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import type { AgentActivity, AgentActivityState } from '../../shared/agent'
import type { BootstrapState, DeepLinkTarget, ProjectSummary } from '../../shared/contracts'
import type {
  ConversationSnapshot,
  ApprovalDecision,
  PendingApproval,
  ThreadGoal,
  ThreadGoalStatus,
} from '../../shared/conversation'
import type { CodexRuntimeSnapshot } from '../../shared/runtime'
import type { ProviderStatus } from '../../shared/providers'
import type { GitHubRepositoryStatus, GitRepositorySnapshot } from '../../shared/git'
import type { ManagedWorktree } from '../../shared/worktree'
import type { DiffHunk, DiffLine, DiffSnapshot } from '../../shared/diff'
import type { TerminalEvent, TerminalState } from '../../shared/terminal'
import type { IntegrationJson, IntegrationSnapshot, PendingIntegrationRequest } from '../../shared/integrations'
import type { SecuritySnapshot } from '../../shared/security'
import type { SchedulerSnapshot } from '../../shared/scheduler'
import type { BrowserSnapshot } from '../../shared/browser'
import type { UpdateSnapshot } from '../../shared/update'
import type { DiagnosticsSnapshot } from '../../shared/diagnostics'
import type { AccountSnapshot } from '../../shared/account'
import type { CommandAction } from './CommandPalette'

const BrowserWorkbench = lazy(() => import('./BrowserWorkbench').then(({ BrowserWorkbench: component }) => ({ default: component })))
const CommandPalette = lazy(() => import('./CommandPalette').then(({ CommandPalette: component }) => ({ default: component })))
const FileWorkbench = lazy(() => import('./FileWorkbench').then(({ FileWorkbench: component }) => ({ default: component })))
const SchedulerWorkbench = lazy(() => import('./SchedulerWorkbench').then(({ SchedulerWorkbench: component }) => ({ default: component })))
const SecurityWorkbench = lazy(() => import('./SecurityWorkbench').then(({ SecurityWorkbench: component }) => ({ default: component })))
const SettingsWorkbench = lazy(() => import('./SettingsWorkbench').then(({ SettingsWorkbench: component }) => ({ default: component })))
const TerminalPanel = lazy(() => import('./TerminalPanel').then(({ TerminalPanel: component }) => ({ default: component })))

type Theme = 'dark' | 'light'
type ThemePreference = Theme | 'system'

export function App(): React.JSX.Element {
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null)
  const [runtime, setRuntime] = useState<CodexRuntimeSnapshot | null>(null)
  const [conversations, setConversations] = useState<ConversationSnapshot | null>(null)
  const [providers, setProviders] = useState<ProviderStatus | null>(null)
  const [account, setAccount] = useState<AccountSnapshot | null>(null)
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(null)
  const [composer, setComposer] = useState('')
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')
  const [newTask, setNewTask] = useState(true)
  const [threadSearch, setThreadSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [threadActionBusy, setThreadActionBusy] = useState(false)
  const [projectPinBusy, setProjectPinBusy] = useState<string | null>(null)
  const [pendingDeepLink, setPendingDeepLink] = useState<DeepLinkTarget | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [goalOpen, setGoalOpen] = useState(false)
  const [goalObjective, setGoalObjective] = useState('')
  const [goalStatus, setGoalStatus] = useState<ThreadGoalStatus>('active')
  const [goalTokenBudget, setGoalTokenBudget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isOpening, setIsOpening] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [securityOpen, setSecurityOpen] = useState(false)
  const [security, setSecurity] = useState<SecuritySnapshot | null>(null)
  const [schedulerOpen, setSchedulerOpen] = useState(false)
  const [scheduler, setScheduler] = useState<SchedulerSnapshot | null>(null)
  const [deepSeekKey, setDeepSeekKey] = useState('')
  const [gitStatus, setGitStatus] = useState<GitRepositorySnapshot | null>(null)
  const [gitOpen, setGitOpen] = useState(false)
  const [worktrees, setWorktrees] = useState<ManagedWorktree[]>([])
  const [selectedWorktree, setSelectedWorktree] = useState<ManagedWorktree | null>(null)
  const [worktreeOpen, setWorktreeOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalState, setTerminalState] = useState<TerminalState>({ sessions: [] })
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null)
  const [filesOpen, setFilesOpen] = useState(false)
  const [initialFilePath, setInitialFilePath] = useState<string | null>(null)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [browser, setBrowser] = useState<BrowserSnapshot | null>(null)
  const [updates, setUpdates] = useState<UpdateSnapshot | null>(null)
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null)
  const [commandOpen, setCommandOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem('aster-sidebar-collapsed') === 'true')
  const [integrations, setIntegrations] = useState<IntegrationSnapshot | null>(null)
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    const saved = window.localStorage.getItem('aster-theme')
    return saved === 'dark' || saved === 'light' || saved === 'system' ? saved : 'system'
  })
  const [systemTheme, setSystemTheme] = useState<Theme>(() => window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  const theme: Theme = themePreference === 'system' ? systemTheme : themePreference
  const projects = bootstrap?.projects ?? []
  const selectedThread = conversations?.threads.find(({ id }) => id === conversations.selectedThreadId) ?? null
  const selectedGoal = selectedThread ? conversations?.goals[selectedThread.id] ?? null : null
  const activityState = selectedThread ? conversations?.threadStates[selectedThread.id] ?? null : null
  const activeTurn = activityState?.turnStatus === 'inProgress'
  const selectedModel = runtime?.models.find(({ id }) => id === model) ?? null

  function openFiles(path: string | null = null): void {
    if (browserOpen) void window.aster.closeBrowser().catch((reason: unknown) => setError(toErrorMessage(reason)))
    setBrowserOpen(false)
    const root = selectedWorktree?.path ?? selectedProject?.path ?? null
    setInitialFilePath(path && root ? projectRelativeArtifactPath(path, root) : path)
    setFilesOpen(true)
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('aster-theme', themePreference)
  }, [theme, themePreference])

  useEffect(() => { window.localStorage.setItem('aster-sidebar-collapsed', String(sidebarCollapsed)) }, [sidebarCollapsed])

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: light)')
    const update = (): void => setSystemTheme(query.matches ? 'light' : 'dark')
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    void window.aster.getBootstrapState().then((state) => {
      setBootstrap(state)
      setRuntime(state.runtime)
      setProviders(state.providers)
      setAccount(state.account)
      setUpdates(state.updates)
      setDiagnostics(state.diagnostics)
      setSelectedProject(state.projects[0] ?? null)
    }).catch((reason: unknown) => setError(toErrorMessage(reason)))
  }, [])

  useEffect(() => {
    const unsubscribe = window.aster.onAccountChanged(setAccount)
    void window.aster.getAccountState().then(setAccount).catch((reason: unknown) => setError(toErrorMessage(reason)))
    return unsubscribe
  }, [])

  useEffect(() => {
    const unsubscribe = window.aster.onUpdateChanged(setUpdates)
    void window.aster.getUpdateState().then(setUpdates).catch((reason: unknown) => setError(toErrorMessage(reason)))
    return unsubscribe
  }, [])

  useEffect(() => window.aster.onDeepLink(setPendingDeepLink), [])

  useEffect(() => {
    if (!pendingDeepLink || !bootstrap || runtime?.phase !== 'ready') return
    const target = pendingDeepLink
    const project = bootstrap.projects.find(({ id }) => id === target.projectId)
    if (!project) {
      setError('深链接引用的项目已不存在。')
      setPendingDeepLink(null)
      return
    }
    setSelectedProject(project)
    setThreadSearch('')
    setShowArchived(false)
    void (target.kind === 'thread'
      ? window.aster.openDeepLink(target)
      : window.aster.loadProjectConversations({ projectId: project.id }))
      .then((snapshot) => {
        if (snapshot) setConversations(snapshot)
        setNewTask(target.kind !== 'thread')
      })
      .catch((reason: unknown) => setError(toErrorMessage(reason)))
      .finally(() => setPendingDeepLink(null))
  }, [bootstrap, pendingDeepLink, runtime?.phase])

  useEffect(() => {
    const unsubscribe = window.aster.onBrowserChanged(setBrowser)
    void window.aster.getBrowserState().then(setBrowser)
      .catch((reason: unknown) => setError(toErrorMessage(reason)))
    return unsubscribe
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      const modifier = event.metaKey || event.ctrlKey
      if (modifier && (event.key.toLocaleLowerCase() === 'k' || (event.shiftKey && event.key.toLocaleLowerCase() === 'p'))) {
        event.preventDefault()
        setCommandOpen(true)
      } else if (modifier && event.key.toLocaleLowerCase() === 'n') {
        event.preventDefault()
        if (selectedProject) setNewTask(true)
      } else if (modifier && event.key === '`') {
        event.preventDefault()
        void openTerminal()
      } else if (event.key === 'Escape' && !commandOpen) {
        if (renameOpen) setRenameOpen(false)
        else if (goalOpen) setGoalOpen(false)
        else if (browserOpen) { void window.aster.closeBrowser(); setBrowserOpen(false) }
        else if (filesOpen) setFilesOpen(false)
        else if (terminalOpen) setTerminalOpen(false)
        else if (gitOpen) setGitOpen(false)
        else if (worktreeOpen) setWorktreeOpen(false)
        else if (settingsOpen) setSettingsOpen(false)
        else if (securityOpen) setSecurityOpen(false)
        else if (schedulerOpen) setSchedulerOpen(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [browserOpen, commandOpen, filesOpen, gitOpen, goalOpen, renameOpen, schedulerOpen, securityOpen, selectedProject, settingsOpen, terminalOpen, worktreeOpen])

  useEffect(() => {
    const unsubscribe = window.aster.onSecurityChanged(setSecurity)
    void window.aster.getSecurityState().then(setSecurity)
      .catch((reason: unknown) => setError(toErrorMessage(reason)))
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!securityOpen) return
    void window.aster.refreshSecurityRuntime().then(setSecurity)
      .catch((reason: unknown) => setError(toErrorMessage(reason)))
  }, [securityOpen])

  useEffect(() => {
    const unsubscribe = window.aster.onSchedulerChanged(setScheduler)
    void window.aster.getSchedulerState().then(setScheduler)
      .catch((reason: unknown) => setError(toErrorMessage(reason)))
    return unsubscribe
  }, [])

  useEffect(() => {
    const unsubscribe = window.aster.onIntegrationChanged(setIntegrations)
    void window.aster.getIntegrationState().then(setIntegrations)
      .catch((reason: unknown) => setError(toErrorMessage(reason)))
    return unsubscribe
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
    if (!selectedProject || runtime?.phase !== 'ready' || pendingDeepLink?.projectId === selectedProject.id) return
    setError(null)
    setThreadSearch('')
    setShowArchived(false)
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
    if (!settingsOpen || !selectedProject || runtime?.phase !== 'ready') return
    void window.aster.loadIntegrations({
      projectId: selectedProject.id,
      ...(selectedThread ? { threadId: selectedThread.id } : {}),
    }).catch((reason: unknown) => setError(toErrorMessage(reason)))
  }, [runtime?.phase, selectedProject, selectedThread, settingsOpen])

  useEffect(() => {
    const defaultModel = runtime?.models.find(({ isDefault }) => isDefault) ?? runtime?.models[0]
    if (defaultModel && !model) {
      setModel(defaultModel.id)
      setEffort(defaultModel.defaultReasoningEffort ?? defaultModel.supportedReasoningEfforts[0] ?? '')
    }
  }, [model, runtime?.models])

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
        projects: sortProjects([project, ...current.projects.filter(({ id }) => id !== project.id)]),
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

  async function loadConversationPage(options: { archived?: boolean; searchTerm?: string; cursor?: string } = {}): Promise<void> {
    if (!selectedProject) return
    const archived = options.archived ?? showArchived
    const searchTerm = options.searchTerm ?? threadSearch
    setError(null)
    try {
      const snapshot = await window.aster.loadProjectConversations({
        projectId: selectedProject.id,
        archived,
        ...(searchTerm.trim() ? { searchTerm: searchTerm.trim() } : {}),
        ...(options.cursor ? { cursor: options.cursor } : {}),
      })
      setConversations(snapshot)
      setShowArchived(snapshot.listArchived)
      setThreadSearch(snapshot.listSearchTerm)
      if (!snapshot.selectedThreadId) setNewTask(true)
    } catch (reason) {
      setError(toErrorMessage(reason))
    }
  }

  async function runThreadAction(action: () => Promise<ConversationSnapshot>): Promise<void> {
    setThreadActionBusy(true)
    setError(null)
    try {
      const snapshot = await action()
      setConversations(snapshot)
      setShowArchived(snapshot.listArchived)
      setThreadSearch(snapshot.listSearchTerm)
      setNewTask(snapshot.selectedThreadId === null)
    } catch (reason) {
      setError(toErrorMessage(reason))
    } finally {
      setThreadActionBusy(false)
    }
  }

  async function toggleProjectPinned(project: ProjectSummary): Promise<void> {
    setProjectPinBusy(project.id)
    setError(null)
    try {
      const nextProjects = await window.aster.setProjectPinned({ projectId: project.id, pinned: !project.pinned })
      setBootstrap((current) => current ? { ...current, projects: nextProjects } : current)
      setSelectedProject((current) => current?.id === project.id
        ? nextProjects.find(({ id }) => id === project.id) ?? current
        : current)
    } catch (reason) {
      setError(toErrorMessage(reason))
    } finally {
      setProjectPinBusy(null)
    }
  }

  async function toggleThreadPinned(threadId: string, pinned: boolean): Promise<void> {
    await runThreadAction(() => window.aster.setConversationPinned({ threadId, pinned: !pinned }))
  }

  function openGoalDialog(): void {
    if (!selectedThread) return
    setGoalObjective(selectedGoal?.objective ?? '')
    setGoalStatus(selectedGoal?.status ?? 'active')
    setGoalTokenBudget(selectedGoal?.tokenBudget === null || selectedGoal === null
      ? ''
      : String(selectedGoal.tokenBudget))
    setGoalOpen(true)
  }

  async function saveGoal(): Promise<void> {
    if (!selectedThread || !goalObjective.trim()) return
    const parsedBudget = goalTokenBudget.trim() ? Number(goalTokenBudget) : null
    if (parsedBudget !== null && (!Number.isSafeInteger(parsedBudget) || parsedBudget <= 0)) {
      setError('目标 token 预算必须是正整数。')
      return
    }
    await runThreadAction(() => window.aster.setThreadGoal({
      threadId: selectedThread.id,
      objective: goalObjective,
      status: goalStatus,
      tokenBudget: parsedBudget,
    }))
    setGoalOpen(false)
  }

  async function clearGoal(): Promise<void> {
    if (!selectedThread || !selectedGoal || !window.confirm('清除此任务的长期目标？')) return
    await runThreadAction(() => window.aster.clearThreadGoal({ threadId: selectedThread.id }))
    setGoalOpen(false)
  }

  function renameSelectedThread(): void {
    if (!selectedThread) return
    setRenameDraft(selectedThread.name ?? selectedThread.preview)
    setRenameOpen(true)
  }

  async function confirmRename(): Promise<void> {
    if (!selectedThread || !renameDraft.trim()) return
    await runThreadAction(() => window.aster.renameConversation({ threadId: selectedThread.id, name: renameDraft }))
    setRenameOpen(false)
  }

  async function forkSelectedThread(): Promise<void> {
    if (!selectedThread) return
    await runThreadAction(() => window.aster.forkConversation({ threadId: selectedThread.id }))
  }

  async function compactSelectedThread(): Promise<void> {
    if (!selectedThread || !window.confirm('压缩此任务的长上下文？Codex 会保留摘要并继续使用同一任务。')) return
    await runThreadAction(() => window.aster.compactConversation({ threadId: selectedThread.id }))
  }

  async function archiveSelectedThread(): Promise<void> {
    if (!selectedThread) return
    await runThreadAction(() => conversations?.listArchived
      ? window.aster.unarchiveConversation({ threadId: selectedThread.id })
      : window.aster.archiveConversation({ threadId: selectedThread.id }))
  }

  async function deleteSelectedThread(): Promise<void> {
    if (!selectedThread || !window.confirm('永久删除此任务及其 Codex 历史？此操作无法撤销。')) return
    await runThreadAction(() => window.aster.deleteConversation({ threadId: selectedThread.id }))
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
    if (browserOpen) {
      await window.aster.closeBrowser().catch((reason: unknown) => setError(toErrorMessage(reason)))
      setBrowserOpen(false)
    }
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

  const shortcutModifier = bootstrap?.platform === 'darwin' ? '⌘' : 'Ctrl+'
  const commands: CommandAction[] = [
    { id: 'new-task', label: '新建任务', detail: '在当前项目开始新的 Codex 任务', shortcut: `${shortcutModifier}N`, disabled: !selectedProject, run: () => setNewTask(true) },
    { id: 'open-project', label: '打开项目', detail: '使用系统目录选择器添加本地项目', run: openProject },
    { id: 'files', label: '文件与产物', detail: '浏览当前项目或工作树中的真实文件', disabled: !selectedProject, run: () => openFiles() },
    { id: 'terminal', label: '打开终端', detail: '打开绑定当前任务上下文的 app-server PTY', shortcut: `${shortcutModifier}\``, disabled: !selectedProject, run: openTerminal },
    { id: 'browser', label: '本地网页预览', detail: '打开受限 loopback WebContentsView', run: () => { setFilesOpen(false); setTerminalOpen(false); setBrowserOpen(true) } },
    { id: 'git', label: 'Git 工作区', detail: '查看状态、差异、暂存和提交', disabled: !selectedProject, run: () => setGitOpen(true) },
    { id: 'scheduler', label: '计划任务', detail: '管理自动化与运行收件箱', run: () => setSchedulerOpen(true) },
    { id: 'security', label: '安全工作台', detail: '扫描、漏洞、报告和设置', run: () => setSecurityOpen(true) },
    { id: 'settings', label: '设置', detail: '提供商、MCP、技能和配置', run: () => setSettingsOpen(true) },
    { id: 'theme-system', label: '外观：跟随系统', detail: '实时跟随操作系统深浅外观', run: () => setThemePreference('system') },
    { id: 'theme-light', label: '外观：浅色', detail: '固定使用浅色主题', run: () => setThemePreference('light') },
    { id: 'theme-dark', label: '外观：深色', detail: '固定使用深色主题', run: () => setThemePreference('dark') },
  ]

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
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="window-drag-region" />
        <div className="brand-row">
          <div className="brand-mark"><Code2 size={17} strokeWidth={2.2} /></div>
          <span>Aster Code</span>
          <button className="icon-button sidebar-search" aria-label="命令面板" onClick={() => setCommandOpen(true)}><Search size={16} /></button>
        </div>

        <button className="new-task-button" disabled={!selectedProject} onClick={() => setNewTask(true)}>
          <Plus size={16} /><span className="new-task-label">新任务</span><span className="shortcut">{shortcutModifier}N</span>
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
              <div className="project-entry-row">
                <button
                  className={`project-row ${selectedProject?.id === project.id ? 'selected' : ''}`}
                  onClick={() => { setSelectedProject(project); setNewTask(true) }}
                  title={project.path}
                >
                  <FolderCode size={15} /><span>{project.name}</span><ChevronRight size={13} className="project-chevron" />
                </button>
                <button
                  className={`sidebar-pin ${project.pinned ? 'pinned' : ''}`}
                  aria-label={`${project.pinned ? '取消固定项目' : '固定项目'} ${project.name}`}
                  disabled={projectPinBusy !== null}
                  onClick={() => void toggleProjectPinned(project)}
                ><Pin size={11} fill={project.pinned ? 'currentColor' : 'none'} /></button>
              </div>
              {selectedProject?.id === project.id && conversations?.projectId === project.id && (
                <div className="thread-list" aria-label={`${project.name} 任务`}>
                  <div className="thread-filter">
                    <input
                      aria-label="搜索任务"
                      value={threadSearch}
                      onChange={(event) => setThreadSearch(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') void loadConversationPage({ searchTerm: threadSearch }) }}
                      placeholder="搜索任务"
                    />
                    <button className={showArchived ? 'active' : ''} title={showArchived ? '显示活动任务' : '显示已归档任务'} onClick={() => void loadConversationPage({ archived: !showArchived })}>
                      {showArchived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
                    </button>
                  </div>
                  {conversations.threads.map((thread) => (
                    <div className="thread-entry-row" key={thread.id}>
                      <button
                        className={`thread-row ${!newTask && conversations.selectedThreadId === thread.id ? 'selected' : ''}`}
                        onClick={() => void selectThread(thread.id)}
                        title={thread.preview}
                      >
                        <MessageSquare size={12} /><span>{(thread.name ?? thread.preview) || '未命名任务'}</span>
                        {thread.status === 'active' && <span className="active-indicator" />}
                      </button>
                      <button
                        className={`sidebar-pin ${thread.pinned ? 'pinned' : ''}`}
                        aria-label={`${thread.pinned ? '取消固定任务' : '固定任务'} ${(thread.name ?? thread.preview) || '未命名任务'}`}
                        disabled={threadActionBusy}
                        onClick={() => void toggleThreadPinned(thread.id, thread.pinned)}
                      ><Pin size={10} fill={thread.pinned ? 'currentColor' : 'none'} /></button>
                    </div>
                  ))}
                  {conversations.threads.length === 0 && <div className="thread-empty">{showArchived ? '没有已归档任务' : '没有匹配任务'}</div>}
                  {conversations.nextCursor && <button className="thread-load-more" onClick={() => {
                    const cursor = conversations.nextCursor
                    if (cursor) void loadConversationPage({ cursor })
                  }}>加载更多</button>}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button className="secondary-nav" onClick={() => setSchedulerOpen(true)}><Clock3 size={16} /><span>计划任务</span>{Boolean(scheduler?.unreadRuns) && <b>{scheduler?.unreadRuns}</b>}</button>
          <button className="secondary-nav" onClick={() => setSecurityOpen(true)}><ShieldCheck size={16} /><span>安全</span>{security?.activeScanId && <span className="active-indicator" />}</button>
          <button className="secondary-nav" onClick={() => setSettingsOpen(true)}><Settings size={16} /><span>设置</span></button>
          <div className="sidebar-footer">
            <span>v{bootstrap?.appVersion ?? '0.1.0'}</span>
            <button className="icon-button" title={`当前外观：${themePreference === 'system' ? '跟随系统' : themePreference === 'dark' ? '深色' : '浅色'}`} onClick={() => setThemePreference(theme === 'dark' ? 'light' : 'dark')} aria-label="切换主题">
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-title">
            <span>{selectedThread?.name ?? selectedProject?.name ?? '欢迎'}</span>
            {selectedProject && <button className="context-pill" onClick={() => { if (browserOpen) void window.aster.closeBrowser(); setBrowserOpen(false); setGitOpen((value) => !value) }} aria-label="Git 状态">
              <GitBranch size={13} />{gitStatus?.branch ?? (gitStatus?.initialized ? 'Detached' : 'Local')}
              {gitStatus && gitStatus.files.length > 0 && <b>{gitStatus.files.length}</b>}
            </button>}
            <span className={`runtime-pill ${runtime?.phase ?? 'starting'}`} title={runtime?.error ?? runtime?.binaryPath ?? undefined}>
              <span className="runtime-dot" /> Codex {runtimeLabel(runtime)}
            </span>
          </div>
          <div className="topbar-actions">
            {selectedThread && !newTask && <>
              <button className={`icon-button ${selectedGoal ? 'active' : ''}`} aria-label="长期目标" disabled={threadActionBusy} onClick={openGoalDialog}><Target size={15} /></button>
              <button className="icon-button" aria-label="重命名任务" disabled={threadActionBusy} onClick={renameSelectedThread}><Pencil size={15} /></button>
              <button className="icon-button" aria-label="分叉任务" disabled={threadActionBusy || activeTurn} onClick={() => void forkSelectedThread()}><GitFork size={15} /></button>
              <button className="icon-button" aria-label="压缩上下文" disabled={threadActionBusy || activeTurn} onClick={() => void compactSelectedThread()}><Brain size={15} /></button>
              <button className="icon-button" aria-label={conversations?.listArchived ? '恢复任务' : '归档任务'} disabled={threadActionBusy || activeTurn} onClick={() => void archiveSelectedThread()}>{conversations?.listArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />}</button>
              <button className="icon-button danger-action" aria-label="永久删除任务" disabled={threadActionBusy || activeTurn} onClick={() => void deleteSelectedThread()}><Trash2 size={15} /></button>
            </>}
            <button className="icon-button" aria-label={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
            <button className={`icon-button ${filesOpen ? 'active' : ''}`} aria-label="文件与产物" disabled={!selectedProject} onClick={() => openFiles()}><Files size={17} /></button>
            <button className={`icon-button ${browserOpen ? 'active' : ''}`} aria-label="本地网页预览" onClick={() => { setFilesOpen(false); setTerminalOpen(false); setGitOpen(false); setBrowserOpen(true) }}><Globe2 size={17} /></button>
            <button className={`icon-button ${terminalOpen ? 'active' : ''}`} aria-label="终端" onClick={() => void openTerminal()}><TerminalSquare size={17} /></button>
            <button className="icon-button" aria-label="帮助"><CircleHelp size={17} /></button>
          </div>
        </header>

        <section className={`workspace ${selectedThread && !newTask ? 'conversation-workspace' : ''}`}>
          {selectedThread && !newTask ? (
            <ActivityTimeline state={activityState} goal={selectedGoal} openFile={(path) => openFiles(path)} />
          ) : (
            <Welcome selectedProject={selectedProject} runtime={runtime} isOpening={isOpening} openProject={openProject} />
          )}
          {error && <div className="error-banner workspace-error" role="alert">{error}</div>}
          {conversations?.approvals.map((approval) => (
            <ApprovalPanel approval={approval} key={approval.requestId} onError={setError} />
          ))}
          {integrations?.pendingRequests[0] && (
            <IntegrationRequestPanel request={integrations.pendingRequests[0]} onError={setError} />
          )}
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
        {terminalOpen && selectedProject && <Suspense fallback={<WorkbenchLoading label="正在加载终端…" />}><TerminalPanel
          projectId={selectedProject.id}
          sessions={terminalState.sessions}
          selectedId={selectedTerminalId}
          theme={theme}
          select={setSelectedTerminalId}
          close={() => setTerminalOpen(false)}
          create={() => openTerminal(true)}
          onError={setError}
          appendContext={appendTerminalContext}
        /></Suspense>}
        {filesOpen && selectedProject && <Suspense fallback={<WorkbenchLoading label="正在加载文件工作台…" />}><FileWorkbench
          key={`${selectedProject.id}:${selectedWorktree?.id ?? 'local'}:${initialFilePath ?? ''}`}
          project={selectedProject}
          worktree={selectedWorktree}
          initialPath={initialFilePath}
          close={() => { setFilesOpen(false); setInitialFilePath(null) }}
          onError={setError}
        /></Suspense>}
        {browserOpen && <Suspense fallback={<WorkbenchLoading label="正在加载网页预览…" />}><BrowserWorkbench snapshot={browser} close={() => setBrowserOpen(false)} onError={setError} /></Suspense>}
      </main>
      {settingsOpen && <Suspense fallback={<WorkbenchLoading label="正在加载设置…" overlay />}><SettingsWorkbench
        providers={providers}
        account={account}
        apiKey={deepSeekKey}
        setApiKey={setDeepSeekKey}
        project={selectedProject}
        threadId={selectedThread?.id ?? null}
        integrations={integrations}
        updates={updates}
        diagnostics={diagnostics}
        close={() => setSettingsOpen(false)}
        onError={setError}
        onUpdated={(result) => { setProviders(result.providers); setRuntime(result.runtime) }}
        onAccount={setAccount}
        onUpdate={setUpdates}
        onDiagnostics={setDiagnostics}
      /></Suspense>}
      {securityOpen && <Suspense fallback={<WorkbenchLoading label="正在加载安全工作台…" overlay />}><SecurityWorkbench
        snapshot={security}
        project={selectedProject}
        close={() => setSecurityOpen(false)}
        onError={setError}
      /></Suspense>}
      {schedulerOpen && <Suspense fallback={<WorkbenchLoading label="正在加载计划任务…" overlay />}><SchedulerWorkbench
        snapshot={scheduler}
        projects={projects}
        models={runtime?.models ?? []}
        close={() => setSchedulerOpen(false)}
        onError={setError}
      /></Suspense>}
      {renameOpen && <div className="thread-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRenameOpen(false) }}>
        <form className="thread-dialog" role="dialog" aria-label="重命名任务" onSubmit={(event) => { event.preventDefault(); void confirmRename() }}>
          <h2>重命名任务</h2>
          <p>名称只改变任务在列表中的显示，不修改项目文件。</p>
          <input autoFocus aria-label="任务名称" maxLength={120} value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} />
          <div>
            <button type="button" onClick={() => setRenameOpen(false)}>取消</button>
            <button type="submit" disabled={!renameDraft.trim() || threadActionBusy}>保存名称</button>
          </div>
        </form>
      </div>}
      {goalOpen && <div className="thread-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setGoalOpen(false) }}>
        <form className="thread-dialog goal-dialog" role="dialog" aria-label="长期目标" onSubmit={(event) => { event.preventDefault(); void saveGoal() }}>
          <h2>长期目标</h2>
          <p>目标由 Codex app-server 持久化，可在后续任务中继续跟踪用量与状态。</p>
          <label><span>目标</span><textarea autoFocus aria-label="目标内容" maxLength={10_000} rows={5} value={goalObjective} onChange={(event) => setGoalObjective(event.target.value)} /></label>
          <label><span>状态</span><select aria-label="目标状态" value={goalStatus} onChange={(event) => setGoalStatus(event.target.value as ThreadGoalStatus)}>
            <option value="active">进行中</option>
            <option value="paused">已暂停</option>
            <option value="blocked">受阻</option>
            <option value="usageLimited">使用量受限</option>
            <option value="budgetLimited">预算受限</option>
            <option value="complete">已完成</option>
          </select></label>
          <label><span>Token 预算（可选）</span><input aria-label="Token 预算" inputMode="numeric" min="1" max="1000000000" type="number" value={goalTokenBudget} onChange={(event) => setGoalTokenBudget(event.target.value)} /></label>
          <div>
            {selectedGoal && <button type="button" className="goal-clear" disabled={threadActionBusy} onClick={() => void clearGoal()}>清除目标</button>}
            <button type="button" onClick={() => setGoalOpen(false)}>取消</button>
            <button type="submit" disabled={!goalObjective.trim() || threadActionBusy}>保存目标</button>
          </div>
        </form>
      </div>}
      {commandOpen && <Suspense fallback={<WorkbenchLoading label="正在加载命令面板…" overlay />}><CommandPalette actions={commands} close={() => setCommandOpen(false)} onError={setError} /></Suspense>}
    </div>
  )
}

function WorkbenchLoading({ label, overlay = false }: { label: string; overlay?: boolean }): React.JSX.Element {
  return <div className={`workbench-loading ${overlay ? 'overlay' : ''}`} role="status"><LoaderCircle size={16} className="spin" />{label}</div>
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
  const [github, setGitHub] = useState<GitHubRepositoryStatus | null>(null)
  const [githubTitle, setGitHubTitle] = useState('')
  const [githubBody, setGitHubBody] = useState('')
  const [githubBase, setGitHubBase] = useState('')
  const [githubDraft, setGitHubDraft] = useState(true)
  const [githubPushRemote, setGitHubPushRemote] = useState('')
  const [githubBaseRemote, setGitHubBaseRemote] = useState('')
  const [githubMessage, setGitHubMessage] = useState<string | null>(null)
  const staged = snapshot?.files.filter(({ indexStatus }) => indexStatus !== '.' && indexStatus !== '?') ?? []
  const unstaged = snapshot?.files.filter(({ worktreeStatus, kind }) => worktreeStatus !== '.' || kind === 'untracked') ?? []
  const existingPullRequest = github?.existingPullRequest ?? null

  useEffect(() => {
    setGitHub(null)
    setGitHubTitle('')
    setGitHubBody('')
    setGitHubBase('')
    setGitHubDraft(true)
    setGitHubPushRemote('')
    setGitHubBaseRemote('')
    setGitHubMessage(null)
  }, [project.id, snapshot?.branch])

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

  async function checkGitHub(pushRemote = githubPushRemote, baseRemote = githubBaseRemote): Promise<void> {
    setBusy(true)
    onError(null)
    setGitHubMessage(null)
    try {
      const next = await window.aster.getGitHubStatus({
        projectId: project.id,
        ...(pushRemote ? { pushRemote } : {}),
        ...(baseRemote ? { baseRemote } : {}),
      })
      setGitHub(next)
      setGitHubPushRemote(next.pushRemote ?? pushRemote)
      setGitHubBaseRemote(next.baseRemote ?? baseRemote)
      setGitHubBase(next.defaultBranch ?? '')
    } catch (reason) {
      onError(toErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  async function createPullRequest(): Promise<void> {
    const branch = github?.branch
    if (!branch || !githubTitle.trim()) return
    const warning = `将把 ${branch} 推送到 ${githubPushRemote}，并在 ${github.baseRepository ?? githubBaseRemote} 创建 ${githubDraft ? 'Draft ' : ''}Pull Request。继续吗？`
    if (!window.confirm(warning)) return
    setBusy(true)
    onError(null)
    setGitHubMessage(null)
    try {
      const result = await window.aster.createGitHubPullRequest({
        projectId: project.id,
        title: githubTitle.trim(),
        body: githubBody,
        baseBranch: githubBase,
        draft: githubDraft,
        confirmed: true,
        pushRemote: githubPushRemote,
        baseRemote: githubBaseRemote,
      })
      setGitHub(result.status)
      setGitHubMessage(result.created ? `已创建 PR #${String(result.pullRequest.number)}` : `PR #${String(result.pullRequest.number)} 已存在`)
      update(await window.aster.getGitStatus({ projectId: project.id }))
    } catch (reason) {
      onError(toErrorMessage(reason))
    } finally {
      setBusy(false)
    }
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
      <section className="github-pr-box" aria-label="GitHub Pull Request">
        <div className="github-pr-heading"><span><GitPullRequest size={14} />GitHub Pull Request</span><button disabled={busy} onClick={() => void checkGitHub()}>{github ? '重新检查' : '检查 GitHub'}</button></div>
        {!github && <p>通过已安装的 GitHub CLI 检查登录和远端；创建前会再次确认并显式推送当前分支。</p>}
        {github && <>
          <div className="github-pr-meta"><span>{github.available ? `gh ${github.version ?? ''}` : 'gh 不可用'}</span><span>{github.authenticated ? `已登录 ${github.host ?? ''}` : '未登录'}</span></div>
          {snapshot.remotes.length > 0 && <div className="github-remotes">
            <label>推送远端<select aria-label="PR 推送远端" value={githubPushRemote} onChange={(event) => {
              const value = event.target.value
              setGitHubPushRemote(value)
              void checkGitHub(value, githubBaseRemote)
            }}>{snapshot.remotes.map((remote) => <option value={remote.name} key={`push:${remote.name}`}>{remote.name}</option>)}</select></label>
            <label>目标远端<select aria-label="PR 目标远端" value={githubBaseRemote} onChange={(event) => {
              const value = event.target.value
              setGitHubBaseRemote(value)
              void checkGitHub(githubPushRemote, value)
            }}>{snapshot.remotes.map((remote) => <option value={remote.name} key={`base:${remote.name}`}>{remote.name}</option>)}</select></label>
          </div>}
          {github.error && <p className="danger-text">{github.error}</p>}
          {existingPullRequest ? <div className="github-existing-pr">
            <strong>#{existingPullRequest.number} · {existingPullRequest.title}</strong>
            <span>{existingPullRequest.draft ? 'Draft' : existingPullRequest.state} · {existingPullRequest.headBranch} → {existingPullRequest.baseBranch}</span>
            <button onClick={() => window.open(existingPullRequest.url, '_blank')}>在 GitHub 打开</button>
          </div> : github.authenticated && !github.error && <div className="github-pr-form">
            <label>标题<input aria-label="Pull Request 标题" maxLength={256} value={githubTitle} onChange={(event) => setGitHubTitle(event.target.value)} placeholder="简要说明本次变更" /></label>
            <label>目标分支<input aria-label="Pull Request 目标分支" maxLength={255} value={githubBase} onChange={(event) => setGitHubBase(event.target.value)} /></label>
            <label>说明<textarea aria-label="Pull Request 说明" maxLength={65_536} rows={5} value={githubBody} onChange={(event) => setGitHubBody(event.target.value)} placeholder="变更、测试与注意事项" /></label>
            <label className="github-draft"><input type="checkbox" checked={githubDraft} onChange={(event) => setGitHubDraft(event.target.checked)} />先创建为 Draft</label>
            {github.dirtyFileCount > 0 && <p className="github-warning">当前还有 {github.dirtyFileCount} 个未提交文件，不会包含在 PR 中。</p>}
            <button className="github-create-button" disabled={busy || !githubTitle.trim() || !githubBase || !githubPushRemote || !githubBaseRemote} onClick={() => void createPullRequest()}><GitPullRequest size={14} />推送并创建 {githubDraft ? 'Draft ' : ''}PR</button>
          </div>}
          {githubMessage && <p className="github-success">{githubMessage}</p>}
        </>}
      </section>
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

function projectRelativeArtifactPath(path: string, root: string): string {
  const portablePath = path.replaceAll('\\', '/')
  const portableRoot = root.replaceAll('\\', '/').replace(/\/$/u, '')
  return portablePath.startsWith(`${portableRoot}/`) ? portablePath.slice(portableRoot.length + 1) : portablePath
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
      <article><ShieldCheck size={20} /><div><h2>安全工作台</h2><p>扫描、证据、修复与 SARIF</p></div><span className="status-chip connected">已接入</span></article>
    </div>
  </div>
}

function ActivityTimeline({ state, goal, openFile }: {
  state: AgentActivityState | null
  goal: ThreadGoal | null
  openFile: (path: string) => void
}): React.JSX.Element {
  return <div className="activity-timeline" aria-label="智能体活动">
    {goal && <article className="goal-card" aria-label="当前长期目标">
      <div><Target size={15} /><strong>长期目标</strong><span className={`goal-status ${goal.status}`}>{goalStatusLabel(goal.status)}</span></div>
      <p>{goal.objective}</p>
      <small>{goal.tokenBudget === null
        ? `已使用 ${goal.tokensUsed.toLocaleString()} tokens`
        : `${goal.tokensUsed.toLocaleString()} / ${goal.tokenBudget.toLocaleString()} tokens`} · {Math.round(goal.timeUsedSeconds).toLocaleString()} 秒</small>
    </article>}
    {!state || state.activities.length === 0
      ? <div className="empty-timeline"><MessageSquare size={23} /><p>任务已创建，等待第一条活动。</p></div>
      : state.activities.map((activity) => <ActivityCard activity={activity} openFile={openFile} key={`${activity.type}:${activity.id}`} />)}
    {state?.turnStatus === 'inProgress' && <div className="running-row"><LoaderCircle size={14} className="spin" /> Codex 正在工作</div>}
  </div>
}

function ActivityCard({ activity, openFile }: { activity: AgentActivity; openFile: (path: string) => void }): React.JSX.Element {
  if (activity.type === 'thread' || activity.type === 'turn') return <></>
  const icon = activity.type === 'userMessage' || activity.type === 'agentMessage' ? <MessageSquare size={15} />
    : activity.type === 'reasoning' ? <Brain size={15} />
      : activity.type === 'fileChange' ? <FileCode2 size={15} /> : <Wrench size={15} />
  return <article className={`activity-card ${activity.type}`}>
    <div className="activity-icon">{icon}</div>
    <div className="activity-body">
      <div className="activity-heading"><strong>{activityLabel(activity)}</strong><span>{activity.status}</span></div>
      <ActivityContent activity={activity} openFile={openFile} />
    </div>
  </article>
}

function ActivityContent({ activity, openFile }: { activity: AgentActivity; openFile: (path: string) => void }): React.JSX.Element {
  if (activity.type === 'userMessage') return <p>{activity.content.filter(({ type }) => type === 'text').map((item) => item.type === 'text' ? item.text : '').join('\n')}</p>
  if (activity.type === 'agentMessage') return <p>{activity.text}</p>
  if (activity.type === 'reasoning') return <p>{[...activity.summary, ...activity.content].join('\n')}</p>
  if (activity.type === 'command') return <><code>{activity.command}</code>{activity.output && <pre>{activity.output}</pre>}</>
  if (activity.type === 'fileChange') return <>{activity.changes.map((change) => <button className="artifact-link" onClick={() => openFile(change.path)} key={`${change.path}:${change.kind}`}><FileCode2 size={12} />{change.kind} {change.path}</button>)}</>
  if (activity.type === 'plan') return <>{activity.steps.map((step) => <p key={step.step}>• {step.step} — {step.status}</p>)}</>
  if (activity.type === 'error') return <p className="danger-text">{activity.message}</p>
  if (activity.type === 'mcpTool') return <p>{activity.server} / {activity.tool}{activity.progress ? ` · ${activity.progress}` : ''}</p>
  if (activity.type === 'webSearch') return <p>{activity.query}</p>
  if (activity.type === 'dynamicTool') return <p>{activity.namespace ? `${activity.namespace} / ` : ''}{activity.tool}</p>
  return <p>{activity.type}</p>
}

function IntegrationRequestPanel({ request, onError }: {
  request: PendingIntegrationRequest
  onError: (message: string | null) => void
}): React.JSX.Element {
  const [formJson, setFormJson] = useState('{}')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function resolve(action: 'accept' | 'decline' | 'cancel'): Promise<void> {
    setBusy(true)
    onError(null)
    try {
      if (request.kind === 'mcpElicitation') {
        let content: IntegrationJson | undefined
        if (action === 'accept' && request.mode !== 'url') content = JSON.parse(formJson) as IntegrationJson
        await window.aster.resolveIntegrationRequest({
          requestId: request.id,
          action,
          ...(content === undefined ? {} : { content }),
        })
      } else {
        await window.aster.resolveIntegrationRequest({
          requestId: request.id,
          action,
          ...(action === 'accept'
            ? { answers: Object.fromEntries(Object.entries(answers).map(([id, value]) => [id, [value]])) }
            : {}),
        })
      }
    } catch (reason) {
      onError(toErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return <section className="integration-request-panel" aria-label="集成交互请求">
    <div className="integration-request-heading">
      <Wrench size={16} />
      <div>
        <strong>{request.kind === 'mcpElicitation' ? `${request.serverName} 请求输入` : 'Codex 请求补充信息'}</strong>
        <p>{request.kind === 'mcpElicitation' ? request.message : request.questions[0]?.question}</p>
      </div>
    </div>
    {request.kind === 'mcpElicitation' ? (
      request.mode === 'url' ? <button onClick={() => request.url && window.open(request.url, '_blank')}>打开安全授权页面</button>
        : <textarea aria-label="MCP 表单 JSON" rows={3} value={formJson} onChange={(event) => setFormJson(event.target.value)} />
    ) : <div className="integration-questions">{request.questions.map((question) => <label key={question.id}>
      <span>{question.header} · {question.question}</span>
      {question.options.length > 0 ? <select value={answers[question.id] ?? ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}>
        <option value="">请选择</option>
        {question.options.map((option) => <option key={option.label} value={option.label}>{option.label} — {option.description}</option>)}
      </select> : <input type={question.secret ? 'password' : 'text'} value={answers[question.id] ?? ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} />}
    </label>)}</div>}
    <div className="integration-request-actions">
      <button disabled={busy} onClick={() => void resolve('cancel')}>取消</button>
      <button disabled={busy} onClick={() => void resolve('decline')}>拒绝</button>
      <button className="approve" disabled={busy} onClick={() => void resolve('accept')}>提交</button>
    </div>
  </section>
}

function ApprovalPanel({ approval, onError }: { approval: PendingApproval; onError: (message: string) => void }): React.JSX.Element {
  const [selectedPermissions, setSelectedPermissions] = useState(() =>
    new Set(approval.permissions.map(({ id }) => id)))
  async function decide(decision: ApprovalDecision): Promise<void> {
    try {
      await window.aster.resolveApproval({
        requestId: approval.requestId,
        decision,
        ...(approval.kind === 'permissions' ? { grantedPermissionIds: [...selectedPermissions] } : {}),
      })
    }
    catch (reason) { onError(toErrorMessage(reason)) }
  }
  return <section className="approval-panel" aria-label="待审批操作">
    <div><strong>{approval.kind === 'command' ? '允许执行命令？' : approval.kind === 'fileChange' ? '允许修改文件？' : '授予额外权限？'}</strong><p>{approval.command ?? approval.reason ?? approval.grantRoot ?? 'Codex 请求继续执行受保护操作。'}</p>
      {approval.kind === 'permissions' && <div className="permission-request-list">{approval.permissions.map((permission) => <label key={permission.id}>
        <input type="checkbox" checked={selectedPermissions.has(permission.id)} onChange={(event) => {
          const checked = event.currentTarget.checked
          setSelectedPermissions((current) => {
          const next = new Set(current)
          if (checked) next.add(permission.id)
          else next.delete(permission.id)
          return next
          })
        }} />
        <span><b>{permission.access === 'network' ? '网络' : permission.access === 'read' ? '读取' : permission.access === 'write' ? '写入' : '拒绝规则'}</b><code title={permission.target}>{permission.target}</code></span>
      </label>)}</div>}
    </div>
    <button onClick={() => void decide('decline')}><X size={14} />拒绝</button>
    <button onClick={() => void decide('acceptForSession')} disabled={approval.kind === 'permissions' && selectedPermissions.size === 0}>本次会话允许</button>
    <button className="approve" onClick={() => void decide('accept')} disabled={approval.kind === 'permissions' && selectedPermissions.size === 0}><Check size={14} />{approval.kind === 'permissions' ? '本回合允许' : '允许'}</button>
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

function goalStatusLabel(status: ThreadGoalStatus): string {
  switch (status) {
    case 'active': return '进行中'
    case 'paused': return '已暂停'
    case 'blocked': return '受阻'
    case 'usageLimited': return '使用量受限'
    case 'budgetLimited': return '预算受限'
    case 'complete': return '已完成'
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

function sortProjects(projects: ProjectSummary[]): ProjectSummary[] {
  return [...projects].sort((left, right) => Number(right.pinned) - Number(left.pinned)
    || right.lastOpenedAt.localeCompare(left.lastOpenedAt))
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
