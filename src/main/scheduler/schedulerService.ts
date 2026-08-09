import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type {
  ScheduledRun,
  ScheduledTask,
  ScheduledTaskInput,
  SchedulerSnapshot,
  SchedulerSubscription,
} from '../../shared/scheduler.js'
import type { StateDatabase } from '../state/database.js'
import { redactString } from '../logging/redact.js'

const TICK_INTERVAL_MS = 15_000
const MAX_SUMMARY_CHARS = 128 * 1024
const { RRule, rrulestr } = createRequire(import.meta.url)('rrule') as typeof import('rrule')

export type ScheduledTaskExecutionResult = {
  threadId: string
  worktreeId?: string
  summary: string
}

export type ScheduledTaskExecutor = (
  task: ScheduledTask,
  projectId: string,
  signal: AbortSignal,
) => Promise<ScheduledTaskExecutionResult>

export type SchedulerServiceOptions = {
  now?: () => Date
  setTimer?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

export class SchedulerService {
  readonly #database: StateDatabase
  readonly #execute: ScheduledTaskExecutor
  readonly #now: () => Date
  readonly #setTimer: NonNullable<SchedulerServiceOptions['setTimer']>
  readonly #clearTimer: NonNullable<SchedulerServiceOptions['clearTimer']>
  readonly #subscriptions = new Set<SchedulerSubscription>()
  readonly #controllers = new Map<string, AbortController>()
  readonly #activeTaskIds = new Set<string>()
  #timer: ReturnType<typeof setTimeout> | null = null
  #draining = false
  #stopped = true

  constructor(database: StateDatabase, execute: ScheduledTaskExecutor, options: SchedulerServiceOptions = {}) {
    this.#database = database
    this.#execute = execute
    this.#now = options.now ?? (() => new Date())
    this.#setTimer = options.setTimer ?? ((callback, milliseconds) => setTimeout(callback, milliseconds))
    this.#clearTimer = options.clearTimer ?? clearTimeout
    this.#database.recoverInterruptedScheduledRuns()
  }

  getSnapshot(): SchedulerSnapshot {
    const runs = this.#database.listScheduledRuns()
    return {
      tasks: this.#database.listScheduledTasks(),
      runs,
      activeRunIds: [...this.#controllers.keys()],
      unreadRuns: runs.filter(({ unread }) => unread).length,
    }
  }

  subscribe(subscription: SchedulerSubscription): () => void {
    this.#subscriptions.add(subscription)
    return () => this.#subscriptions.delete(subscription)
  }

  start(): void {
    if (!this.#stopped) return
    this.#stopped = false
    void this.tick()
  }

  stop(): void {
    this.#stopped = true
    if (this.#timer) this.#clearTimer(this.#timer)
    this.#timer = null
    for (const controller of this.#controllers.values()) controller.abort(new Error('Application closing'))
    this.#controllers.clear()
    this.#subscriptions.clear()
  }

  saveTask(input: ScheduledTaskInput): SchedulerSnapshot {
    const now = this.#now()
    const existing = input.id ? this.#database.getScheduledTask(input.id) : null
    const projectIds = [...new Set(input.projectIds)]
    if (projectIds.length === 0 || projectIds.length > 20) throw new Error('计划任务必须关联 1 至 20 个项目。')
    for (const projectId of projectIds) {
      if (!this.#database.getProject(projectId)) throw new Error('计划任务包含不存在的项目。')
    }
    const rrule = normalizeRrule(input.rrule)
    validateTimezone(input.timezone)
    if (input.executionTarget === 'worktree' && input.conversationMode === 'continue') {
      throw new Error('隔离工作树运行必须为每次新建任务，不能复用旧对话 cwd。')
    }
    const nextRunAt = nextOccurrence(rrule, input.timezone, now)?.toISOString() ?? null
    const timestamp = now.toISOString()
    const task: ScheduledTask = {
      id: existing?.id ?? randomUUID(),
      name: requireText(input.name, '名称', 160),
      prompt: requireText(input.prompt, '提示词', 100_000),
      projectIds,
      status: existing?.status ?? 'active',
      rrule,
      timezone: input.timezone,
      executionTarget: input.executionTarget,
      conversationMode: input.conversationMode,
      threadIds: existing?.threadIds ?? {},
      model: trimmedOrNull(input.model),
      reasoningEffort: trimmedOrNull(input.reasoningEffort),
      sandbox: input.sandbox,
      missedRunPolicy: input.missedRunPolicy,
      maxAttempts: boundInteger(input.maxAttempts, 1, 4, '最大尝试次数'),
      retryBackoffMinutes: boundInteger(input.retryBackoffMinutes, 1, 1_440, '重试间隔'),
      nextRunAt: existing?.status === 'paused' ? null : nextRunAt,
      lastRunAt: existing?.lastRunAt ?? null,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    this.#database.upsertScheduledTask(task)
    this.#emit()
    this.#scheduleTick()
    return this.getSnapshot()
  }

  setPaused(taskId: string, paused: boolean): SchedulerSnapshot {
    const task = this.#requireTask(taskId)
    const now = this.#now()
    const updated: ScheduledTask = {
      ...task,
      status: paused ? 'paused' : 'active',
      nextRunAt: paused ? null : nextOccurrence(task.rrule, task.timezone, now)?.toISOString() ?? null,
      updatedAt: now.toISOString(),
    }
    this.#database.upsertScheduledTask(updated)
    this.#emit()
    this.#scheduleTick()
    return this.getSnapshot()
  }

  deleteTask(taskId: string): SchedulerSnapshot {
    if (this.#activeTaskIds.has(taskId)) throw new Error('运行中的计划任务不能删除。')
    this.#database.deleteScheduledTask(taskId)
    this.#emit()
    return this.getSnapshot()
  }

  runNow(taskId: string): SchedulerSnapshot {
    const task = this.#requireTask(taskId)
    if (this.#activeTaskIds.has(taskId)) throw new Error('该计划任务已有运行实例。')
    this.#queueTask(task, this.#now(), 1)
    void this.#drain()
    return this.getSnapshot()
  }

  cancelRun(runId: string): SchedulerSnapshot {
    const controller = this.#controllers.get(runId)
    if (!controller) throw new Error('该计划运行当前不可取消。')
    controller.abort(new Error('Cancelled by user'))
    return this.getSnapshot()
  }

  markRead(runIds?: string[]): SchedulerSnapshot {
    this.#database.markScheduledRunsRead(runIds)
    this.#emit()
    return this.getSnapshot()
  }

  async tick(): Promise<void> {
    if (this.#stopped) return
    const now = this.#now()
    for (const task of this.#database.listScheduledTasks()) {
      if (task.status !== 'active' || !task.nextRunAt || new Date(task.nextRunAt) > now) continue
      const scheduledFor = new Date(task.nextRunAt)
      const isMissed = now.getTime() - scheduledFor.getTime() > TICK_INTERVAL_MS * 2
      if (!this.#activeTaskIds.has(task.id) && (!isMissed || task.missedRunPolicy === 'run_once')) {
        this.#queueTask(task, scheduledFor, 1)
      } else if (this.#activeTaskIds.has(task.id)) {
        this.#recordSkipped(task, scheduledFor, '上一轮仍在运行，已跳过重叠运行。')
      } else {
        this.#recordSkipped(task, scheduledFor, '应用未运行期间错过调度，已按任务策略跳过。')
      }
      this.#database.upsertScheduledTask({
        ...task,
        nextRunAt: nextOccurrence(task.rrule, task.timezone, now)?.toISOString() ?? null,
        updatedAt: now.toISOString(),
      })
    }
    await this.#drain()
    this.#emit()
    this.#scheduleTick()
  }

  #queueTask(task: ScheduledTask, scheduledFor: Date, attempt: number): void {
    for (const projectId of task.projectIds) {
      const project = this.#database.getProject(projectId)
      if (!project) continue
      this.#database.upsertScheduledRun({
        id: randomUUID(),
        taskId: task.id,
        taskName: task.name,
        projectId,
        projectName: project.name,
        scheduledFor: scheduledFor.toISOString(),
        startedAt: null,
        finishedAt: null,
        status: 'queued',
        attempt,
        threadId: null,
        worktreeId: null,
        summary: null,
        error: null,
        unread: false,
      })
    }
    this.#emit()
  }

  async #drain(): Promise<void> {
    if (this.#draining) return
    this.#draining = true
    try {
      while (!this.#stopped) {
        const run = this.#database.listDueScheduledRuns(this.#now().toISOString())
          .find((candidate) => !this.#activeTaskIds.has(candidate.taskId))
        if (!run) break
        await this.#executeRun(run)
      }
    } finally {
      this.#draining = false
    }
  }

  async #executeRun(run: ScheduledRun): Promise<void> {
    const task = this.#database.getScheduledTask(run.taskId)
    if (!task) {
      this.#database.upsertScheduledRun({ ...run, status: 'skipped', finishedAt: this.#now().toISOString(), error: '计划任务已删除。', unread: true })
      return
    }
    const controller = new AbortController()
    this.#controllers.set(run.id, controller)
    this.#activeTaskIds.add(task.id)
    const running: ScheduledRun = { ...run, status: 'running', startedAt: this.#now().toISOString() }
    this.#database.upsertScheduledRun(running)
    this.#emit()
    try {
      const result = await this.#execute(task, run.projectId, controller.signal)
      if (this.#stopped) return
      const finishedAt = this.#now().toISOString()
      this.#database.upsertScheduledRun({
        ...running,
        status: 'succeeded',
        finishedAt,
        threadId: result.threadId,
        worktreeId: result.worktreeId ?? null,
        summary: result.summary.slice(0, MAX_SUMMARY_CHARS),
        unread: true,
      })
      const current = this.#database.getScheduledTask(task.id)
      if (current) this.#database.upsertScheduledTask({
        ...current,
        threadIds: current.conversationMode === 'continue'
          ? { ...current.threadIds, [run.projectId]: result.threadId }
          : current.threadIds,
        lastRunAt: finishedAt,
        updatedAt: finishedAt,
      })
    } catch (error) {
      if (this.#stopped) return
      const cancelled = controller.signal.aborted
      const finishedAt = this.#now().toISOString()
      this.#database.upsertScheduledRun({
        ...running,
        status: cancelled ? 'cancelled' : 'failed',
        finishedAt,
        error: safeError(error),
        unread: true,
      })
      if (!cancelled && run.attempt < task.maxAttempts) {
        const retryAt = new Date(this.#now().getTime() + task.retryBackoffMinutes * 60_000)
        this.#queueTask(task, retryAt, run.attempt + 1)
      }
    } finally {
      this.#controllers.delete(run.id)
      this.#activeTaskIds.delete(task.id)
      if (!this.#stopped) this.#emit()
    }
  }

  #recordSkipped(task: ScheduledTask, scheduledFor: Date, reason: string): void {
    for (const projectId of task.projectIds) {
      const project = this.#database.getProject(projectId)
      if (!project) continue
      const timestamp = this.#now().toISOString()
      this.#database.upsertScheduledRun({
        id: randomUUID(), taskId: task.id, taskName: task.name, projectId, projectName: project.name,
        scheduledFor: scheduledFor.toISOString(), startedAt: null, finishedAt: timestamp,
        status: 'skipped', attempt: 1, threadId: null, worktreeId: null,
        summary: null, error: reason, unread: true,
      })
    }
  }

  #requireTask(taskId: string): ScheduledTask {
    const task = this.#database.getScheduledTask(taskId)
    if (!task) throw new Error('Scheduled task not found.')
    return task
  }

  #scheduleTick(): void {
    if (this.#stopped) return
    if (this.#timer) this.#clearTimer(this.#timer)
    this.#timer = this.#setTimer(() => { void this.tick() }, TICK_INTERVAL_MS)
  }

  #emit(): void {
    const snapshot = this.getSnapshot()
    for (const subscription of this.#subscriptions) subscription(snapshot)
  }
}

export function nextOccurrence(rrule: string, timezone: string, after: Date): Date | null {
  validateTimezone(timezone)
  const normalized = normalizeRrule(rrule)
  const local = localDateTime(after, timezone)
  const floatingAfter = new Date(Date.UTC(
    Number(local.slice(0, 4)),
    Number(local.slice(4, 6)) - 1,
    Number(local.slice(6, 8)),
    Number(local.slice(9, 11)),
    Number(local.slice(11, 13)),
    Number(local.slice(13, 15)),
  ))
  const rule = new RRule({
    ...RRule.parseString(normalized.slice('RRULE:'.length)),
    dtstart: floatingAfter,
  })
  const floatingOccurrence = rule.after(floatingAfter, false)
  return floatingOccurrence ? wallTimeToInstant(floatingOccurrence, timezone) : null
}

function localDateTime(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return [value.year, value.month, value.day].map((part) => part ?? '').join('')
    + `T${[value.hour, value.minute, value.second].map((part) => part ?? '').join('')}`
}

function wallTimeToInstant(wallTime: Date, timezone: string): Date {
  const target = wallTime.getTime()
  let instant = target
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = localDateTime(new Date(instant), timezone)
    const represented = Date.UTC(
      Number(local.slice(0, 4)), Number(local.slice(4, 6)) - 1, Number(local.slice(6, 8)),
      Number(local.slice(9, 11)), Number(local.slice(11, 13)), Number(local.slice(13, 15)),
    )
    const difference = target - represented
    instant += difference
    if (difference === 0) break
  }
  return new Date(instant)
}

function normalizeRrule(value: string): string {
  const trimmed = value.trim().toUpperCase()
  const rule = trimmed.startsWith('RRULE:') ? trimmed : `RRULE:${trimmed}`
  if (rule.length > 2_000 || /[\r\n]/u.test(rule)) throw new Error('RRULE 格式无效。')
  try { rrulestr(rule) } catch { throw new Error('RRULE 格式无效。') }
  return rule
}

function validateTimezone(timezone: string): void {
  if (!timezone || timezone.length > 100) throw new Error('时区无效。')
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format() }
  catch { throw new Error('时区无效。') }
}

function requireText(value: string, label: string, max: number): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) throw new Error(`${label}不能为空或过长。`)
  return trimmed
}

function trimmedOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (trimmed === undefined || trimmed === '') return null
  return trimmed
}

function boundInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${label}超出范围。`)
  return value
}

function safeError(error: unknown): string {
  return redactString(error instanceof Error ? error.message : String(error)).slice(0, 4_096)
}
