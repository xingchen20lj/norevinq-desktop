import {
  Bot,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  FolderCode,
  FolderOpen,
  GitBranch,
  Moon,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  TerminalSquare,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { BootstrapState, ProjectSummary } from '../../shared/contracts'
import type { CodexRuntimeSnapshot } from '../../shared/runtime'

type Theme = 'dark' | 'light'

export function App(): React.JSX.Element {
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null)
  const [runtime, setRuntime] = useState<CodexRuntimeSnapshot | null>(null)
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isOpening, setIsOpening] = useState(false)
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
    void window.aster
      .getBootstrapState()
      .then((state) => {
        setBootstrap(state)
        setRuntime(state.runtime)
        setSelectedProject(state.projects[0] ?? null)
      })
      .catch((reason: unknown) => setError(toErrorMessage(reason)))
  }, [])

  useEffect(() => {
    const unsubscribe = window.aster.onRuntimeStatus(setRuntime)
    void window.aster.getRuntimeStatus().then(setRuntime).catch((reason: unknown) => setError(toErrorMessage(reason)))
    return unsubscribe
  }, [])

  const projects = bootstrap?.projects ?? []
  const subtitle = useMemo(() => {
    if (selectedProject) return selectedProject.path
    return '由 Codex app-server 驱动的本地智能编程工作台'
  }, [selectedProject])

  async function openProject(): Promise<void> {
    setIsOpening(true)
    setError(null)
    try {
      const project = await window.aster.selectProject()
      if (!project) return
      setSelectedProject(project)
      setBootstrap((current) => {
        if (!current) return current
        return { ...current, projects: [project, ...current.projects.filter(({ id }) => id !== project.id)] }
      })
    } catch (reason) {
      setError(toErrorMessage(reason))
    } finally {
      setIsOpening(false)
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

        <button className="new-task-button" disabled={!selectedProject}>
          <Plus size={16} /> 新任务 <span className="shortcut">⌘N</span>
        </button>

        <nav className="sidebar-nav" aria-label="项目导航">
          <div className="nav-heading">
            <span>项目</span>
            <button className="icon-button" onClick={() => void openProject()} aria-label="打开项目"><Plus size={14} /></button>
          </div>
          {projects.length === 0 ? (
            <button className="empty-project" onClick={() => void openProject()}>
              <FolderOpen size={15} /> 打开第一个项目
            </button>
          ) : projects.map((project) => (
            <button
              className={`project-row ${selectedProject?.id === project.id ? 'selected' : ''}`}
              key={project.id}
              onClick={() => setSelectedProject(project)}
              title={project.path}
            >
              <FolderCode size={15} />
              <span>{project.name}</span>
              <ChevronRight size={13} className="project-chevron" />
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button className="secondary-nav"><Clock3 size={16} />计划任务</button>
          <button className="secondary-nav"><ShieldCheck size={16} />安全</button>
          <button className="secondary-nav"><Settings size={16} />设置</button>
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
            <span>{selectedProject?.name ?? '欢迎'}</span>
            {selectedProject && <span className="context-pill"><GitBranch size={13} />Local</span>}
            <span className={`runtime-pill ${runtime?.phase ?? 'starting'}`} title={runtime?.error ?? runtime?.binaryPath ?? undefined}>
              <span className="runtime-dot" /> Codex {runtimeLabel(runtime)}
            </span>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" aria-label="终端"><TerminalSquare size={17} /></button>
            <button className="icon-button" aria-label="帮助"><CircleHelp size={17} /></button>
          </div>
        </header>

        <section className="workspace">
          <div className="hero">
            <div className="hero-orbit" aria-hidden="true">
              <div className="hero-core"><Sparkles size={27} /></div>
            </div>
            <p className="eyebrow">LOCAL-FIRST CODING AGENT</p>
            <h1>{selectedProject ? `开始处理 ${selectedProject.name}` : '把复杂开发工作交给智能体'}</h1>
            <p className="hero-subtitle">{subtitle}</p>

            {!selectedProject && (
              <button className="primary-button" onClick={() => void openProject()} disabled={isOpening}>
                <FolderOpen size={17} /> {isOpening ? '正在打开…' : '打开本地项目'}
              </button>
            )}

            {error && <div className="error-banner" role="alert">{error}</div>}

            <div className="capability-grid">
              <article>
                <Bot size={20} />
                <div><h2>Codex 任务</h2><p>{runtime?.version ? `${runtime.version} · ${String(runtime.models.length)} 个模型` : '流式活动、审批与可中断任务'}</p></div>
                {runtime?.phase === 'failed' || runtime?.phase === 'unavailable' ? (
                  <button className="status-chip runtime-retry" onClick={() => void window.aster.restartRuntime()}>重试连接</button>
                ) : (
                  <span className={`status-chip ${runtime?.phase === 'ready' ? 'connected' : 'planned'}`}>{runtime?.phase === 'ready' ? '已连接' : runtimeLabel(runtime)}</span>
                )}
              </article>
              <article>
                <GitBranch size={20} />
                <div><h2>隔离工作树</h2><p>并行开发，不干扰本地修改</p></div>
                <span className="status-chip planned">即将接入</span>
              </article>
              <article>
                <ShieldCheck size={20} />
                <div><h2>安全工作台</h2><p>扫描、证据、修复与 SARIF</p></div>
                <span className="status-chip planned">即将接入</span>
              </article>
            </div>
          </div>

          <div className="composer-shell">
            <textarea
              aria-label="任务输入"
              placeholder={selectedProject ? '描述你希望 Aster Code 完成的任务…' : '请先打开一个本地项目'}
              disabled={!selectedProject}
              rows={2}
            />
            <div className="composer-footer">
              <div className="composer-options">
                <button disabled><Bot size={14} />Codex</button>
                <button disabled>Medium</button>
                <button disabled><GitBranch size={14} />Local</button>
              </div>
              <button className="send-button" disabled title="Codex runtime 将在阶段 2 接入"><ChevronRight size={17} /></button>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

function toErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : '发生未知错误。'
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
