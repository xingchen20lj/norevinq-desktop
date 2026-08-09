import { CalendarClock, Check, Clock3, Inbox, Pause, Play, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { ProjectSummary } from '../../shared/contracts'
import type { CodexModelSummary } from '../../shared/runtime'
import type { ScheduledTask, ScheduledTaskInput, SchedulerSnapshot } from '../../shared/scheduler'

type Tab = 'inbox' | 'tasks'

export function SchedulerWorkbench({ snapshot, projects, models, close, onError }: {
  snapshot: SchedulerSnapshot | null
  projects: ProjectSummary[]
  models: CodexModelSummary[]
  close: () => void
  onError: (message: string | null) => void
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('inbox')
  const [editing, setEditing] = useState<ScheduledTask | 'new' | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true)
    onError(null)
    try { await action() } catch (reason) { onError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <section className="settings-workbench scheduler-workbench" role="dialog" aria-modal="true" aria-label="计划任务工作台">
      <header className="settings-workbench-header"><div><p className="eyebrow">SCHEDULED</p><h2>计划任务</h2></div><button className="icon-button" onClick={close} aria-label="关闭计划任务"><X size={16} /></button></header>
      <nav className="settings-tabs"><button className={tab === 'inbox' ? 'selected' : ''} onClick={() => setTab('inbox')}><Inbox size={14} />收件箱{Boolean(snapshot?.unreadRuns) && <b>{snapshot?.unreadRuns}</b>}</button><button className={tab === 'tasks' ? 'selected' : ''} onClick={() => setTab('tasks')}><CalendarClock size={14} />任务</button><button className="scheduler-add" disabled={projects.length === 0} onClick={() => { setEditing('new'); setTab('tasks') }}><Plus size={13} />新建</button></nav>
      <div className="settings-workbench-body">
        {tab === 'inbox' && <RunInbox snapshot={snapshot} busy={busy} run={run} />}
        {tab === 'tasks' && (editing
          ? <TaskEditor task={editing === 'new' ? null : editing} projects={projects} models={models} busy={busy} cancel={() => setEditing(null)} run={run} />
          : <TaskList snapshot={snapshot} busy={busy} edit={setEditing} run={run} />)}
      </div>
    </section>
  </div>
}

function RunInbox({ snapshot, busy, run }: {
  snapshot: SchedulerSnapshot | null
  busy: boolean
  run: (action: () => Promise<unknown>) => Promise<void>
}): React.JSX.Element {
  const runs = snapshot?.runs ?? []
  return <div className="settings-section"><div className="section-heading"><div><h3>运行收件箱</h3><p>需要关注的成功、失败、取消和跳过运行会标记未读。</p></div><button disabled={busy || !snapshot?.unreadRuns} onClick={() => void run(() => window.aster.markScheduledRunsRead({}))}><Check size={13} />全部已读</button></div>{runs.length === 0 ? <Empty title="没有运行记录" detail="计划任务运行后，结果和错误会显示在这里。" /> : <div className="scheduled-runs">{runs.map((item) => <article className={item.unread ? 'unread' : ''} key={item.id}><i className={item.status} /><div><strong>{item.taskName}</strong><span>{item.projectName} · 第 {item.attempt} 次 · {formatTime(item.scheduledFor)}</span><p>{item.summary ?? item.error ?? scheduledStatus(item.status)}</p></div><em>{scheduledStatus(item.status)}</em>{item.status === 'running' && <button disabled={busy} onClick={() => void run(() => window.aster.cancelScheduledRun({ runId: item.id }))}>取消</button>}{item.unread && <button disabled={busy} onClick={() => void run(() => window.aster.markScheduledRunsRead({ runIds: [item.id] }))}>已读</button>}</article>)}</div>}</div>
}

function TaskList({ snapshot, busy, edit, run }: {
  snapshot: SchedulerSnapshot | null
  busy: boolean
  edit: (task: ScheduledTask) => void
  run: (action: () => Promise<unknown>) => Promise<void>
}): React.JSX.Element {
  const tasks = snapshot?.tasks ?? []
  return <div className="settings-section"><div className="section-heading"><div><h3>计划任务</h3><p>本地项目任务仅在电脑开机且 Aster Code 运行时调度。</p></div></div>{tasks.length === 0 ? <Empty title="没有计划任务" detail="创建任务后可选择 Local 或隔离 worktree，并用 RFC 5545 RRULE 设置频率。" /> : <div className="scheduled-task-list">{tasks.map((task) => <article key={task.id}><header><div><strong>{task.name}</strong><span>{describeRule(task.rrule)} · {task.timezone}</span></div><i className={task.status}>{task.status === 'active' ? '运行中' : '已暂停'}</i></header><p>{task.prompt}</p><div className="task-chips"><span>{task.projectIds.length} 个项目</span><span>{task.executionTarget}</span><span>{task.sandbox}</span><span>下次：{task.nextRunAt ? formatTime(task.nextRunAt) : '—'}</span></div><footer><button disabled={busy} onClick={() => edit(task)}>编辑</button><button disabled={busy} onClick={() => void run(() => window.aster.runScheduledTaskNow({ taskId: task.id }))}><Play size={11} />立即运行</button><button disabled={busy} onClick={() => void run(() => window.aster.setScheduledTaskPaused({ taskId: task.id, paused: task.status === 'active' }))}>{task.status === 'active' ? <><Pause size={11} />暂停</> : <><RotateCcw size={11} />恢复</>}</button><button className="danger-button" disabled={busy} onClick={() => { if (window.confirm('删除计划任务？已有运行历史会保留。')) void run(() => window.aster.deleteScheduledTask({ taskId: task.id })) }}><Trash2 size={11} />删除</button></footer></article>)}</div>}</div>
}

function TaskEditor({ task, projects, models, busy, cancel, run }: {
  task: ScheduledTask | null
  projects: ProjectSummary[]
  models: CodexModelSummary[]
  busy: boolean
  cancel: () => void
  run: (action: () => Promise<unknown>) => Promise<void>
}): React.JSX.Element {
  const [name, setName] = useState(task?.name ?? '')
  const [prompt, setPrompt] = useState(task?.prompt ?? '')
  const [projectIds, setProjectIds] = useState(task?.projectIds ?? (projects[0] ? [projects[0].id] : []))
  const [rrule, setRrule] = useState(task?.rrule ?? 'RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0')
  const [timezone, setTimezone] = useState(task?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [executionTarget, setExecutionTarget] = useState<ScheduledTaskInput['executionTarget']>(task?.executionTarget ?? 'worktree')
  const [conversationMode, setConversationMode] = useState<ScheduledTaskInput['conversationMode']>(task?.conversationMode ?? 'new')
  const [model, setModel] = useState(task?.model ?? '')
  const [effort, setEffort] = useState(task?.reasoningEffort ?? '')
  const [sandbox, setSandbox] = useState<ScheduledTaskInput['sandbox']>(task?.sandbox ?? 'workspace-write')

  const input: ScheduledTaskInput = {
    ...(task ? { id: task.id } : {}), name, prompt, projectIds, rrule, timezone,
    executionTarget, conversationMode, ...(model ? { model } : {}), ...(effort ? { reasoningEffort: effort } : {}),
    sandbox, missedRunPolicy: task?.missedRunPolicy ?? 'run_once', maxAttempts: task?.maxAttempts ?? 2,
    retryBackoffMinutes: task?.retryBackoffMinutes ?? 5,
  }
  return <div className="settings-section"><div className="section-heading"><div><h3>{task ? '编辑计划任务' : '新建计划任务'}</h3><p>先在普通任务中验证提示词；计划运行不会等待审批。</p></div></div><div className="scheduler-form"><label><span>名称</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><label className="wide"><span>每次运行的持久提示词</span><textarea rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label><fieldset className="wide"><legend>项目</legend>{projects.map((project) => <label key={project.id}><input type="checkbox" checked={projectIds.includes(project.id)} onChange={(event) => setProjectIds(event.target.checked ? [...projectIds, project.id] : projectIds.filter((id) => id !== project.id))} />{project.name}</label>)}</fieldset><label className="wide"><span>RFC 5545 RRULE</span><input value={rrule} onChange={(event) => setRrule(event.target.value)} /><small>例如：RRULE:FREQ=WEEKLY;BYDAY=MO,FR;BYHOUR=9;BYMINUTE=0</small></label><label><span>时区</span><input value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label><label><span>执行位置</span><select value={executionTarget} onChange={(event) => { const next = event.target.value as typeof executionTarget; setExecutionTarget(next); if (next === 'worktree') setConversationMode('new') }}><option value="worktree">隔离 worktree</option><option value="local">Local</option></select></label><label><span>对话</span><select value={conversationMode} disabled={executionTarget === 'worktree'} onChange={(event) => setConversationMode(event.target.value as typeof conversationMode)}><option value="new">每次新建</option><option value="continue">继续同一任务</option></select></label><label><span>沙箱</span><select value={sandbox} onChange={(event) => setSandbox(event.target.value as typeof sandbox)}><option value="read-only">只读</option><option value="workspace-write">工作区写入</option><option value="danger-full-access">完整访问（高风险）</option></select></label><label><span>模型</span><select value={model} onChange={(event) => setModel(event.target.value)}><option value="">默认</option>{models.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label><label><span>推理强度</span><input value={effort} onChange={(event) => setEffort(event.target.value)} placeholder="默认" /></label></div>{sandbox === 'danger-full-access' && <div className="provider-warning"><strong>无人值守完整访问风险</strong><span>任务可修改任意文件并访问网络。优先使用 workspace-write 和显式规则。</span></div>}<div className="settings-actions"><button onClick={cancel}>取消</button><button className="primary-button" disabled={busy || !name.trim() || !prompt.trim() || projectIds.length === 0} onClick={() => void run(async () => { await window.aster.saveScheduledTask(input); cancel() })}>保存计划任务</button></div></div>
}

function Empty({ title, detail }: { title: string; detail: string }): React.JSX.Element {
  return <div className="settings-empty"><Clock3 size={20} /><strong>{title}</strong><p>{detail}</p></div>
}

function scheduledStatus(status: string): string {
  return ({ queued: '等待', running: '运行中', succeeded: '完成', failed: '失败', cancelled: '已取消', skipped: '已跳过' } as Record<string, string>)[status] ?? status
}

function describeRule(rule: string): string {
  if (rule.includes('FREQ=DAILY')) return '每天'
  if (rule.includes('FREQ=WEEKLY')) return '每周'
  if (rule.includes('FREQ=HOURLY')) return '每小时'
  if (rule.includes('FREQ=MINUTELY')) return '按分钟'
  return '自定义'
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}
