import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { nextOccurrence, SchedulerService } from '../../src/main/scheduler/schedulerService.js'
import { StateDatabase } from '../../src/main/state/database.js'
import type { ScheduledTaskInput } from '../../src/shared/scheduler.js'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('SchedulerService', () => {
  it('computes timezone-aware RFC 5545 occurrences', () => {
    const next = nextOccurrence(
      'RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=30;BYSECOND=0',
      'Asia/Shanghai',
      new Date('2026-08-10T00:00:00.000Z'),
    )
    expect(next?.toISOString()).toBe('2026-08-10T01:30:00.000Z')
  })

  it('persists, pauses, resumes, runs, and records unread results', async () => {
    const fixture = createFixture()
    let now = new Date('2026-08-10T00:00:00.000Z')
    const scheduler = new SchedulerService(fixture.database, (_task, _projectId, signal) => {
      expect(signal.aborted).toBe(false)
      return Promise.resolve({ threadId: 'thread-scheduled', summary: 'SCHEDULED_OK' })
    }, {
      now: () => now,
      setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimer: () => undefined,
    })
    const saved = scheduler.saveTask(taskInput(fixture.projectId))
    const task = saved.tasks[0]
    const taskId = task?.id ?? ''
    expect(task?.nextRunAt).toBeTruthy()
    expect(scheduler.setPaused(taskId, true).tasks[0]?.nextRunAt).toBeNull()
    expect(scheduler.setPaused(taskId, false).tasks[0]?.nextRunAt).toBeTruthy()
    scheduler.start()
    scheduler.runNow(taskId)
    const completed = await waitForRun(scheduler, 'succeeded')
    expect(completed.runs[0]).toMatchObject({ summary: 'SCHEDULED_OK', threadId: 'thread-scheduled', unread: true })
    expect(completed.unreadRuns).toBe(1)
    expect(scheduler.markRead().unreadRuns).toBe(0)
    expect(scheduler.saveTask({ ...taskInput(fixture.projectId), id: taskId, name: '已编辑任务' }).tasks[0]?.name)
      .toBe('已编辑任务')
    expect(scheduler.deleteTask(taskId).tasks).toHaveLength(0)
    expect(scheduler.getSnapshot().runs).toHaveLength(1)
    now = new Date('2026-08-10T00:05:00.000Z')
    scheduler.stop()
    fixture.database.close()
  })

  it('retries failures and never marks them successful', async () => {
    const fixture = createFixture()
    let now = new Date('2026-08-10T00:00:00.000Z')
    let attempts = 0
    const scheduler = new SchedulerService(fixture.database, () => {
      attempts += 1
      return Promise.reject(new Error('api_key=[fixture-secret] failed'))
    }, {
      now: () => now,
      setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimer: () => undefined,
    })
    const input = { ...taskInput(fixture.projectId), maxAttempts: 2, retryBackoffMinutes: 1 }
    const taskId = scheduler.saveTask(input).tasks[0]?.id ?? ''
    scheduler.start()
    scheduler.runNow(taskId)
    await waitForRun(scheduler, 'failed')
    now = new Date('2026-08-10T00:01:01.000Z')
    await scheduler.tick()
    await waitForAttempts(() => attempts, 2)
    const snapshot = scheduler.getSnapshot()
    expect(snapshot.runs.filter(({ status }) => status === 'failed')).toHaveLength(2)
    expect(snapshot.runs.every(({ error }) => !error?.includes('[fixture-secret]'))).toBe(true)
    scheduler.stop()
    fixture.database.close()
  })

  it('records missed runs when the task policy skips catch-up work', async () => {
    const fixture = createFixture()
    let now = new Date('2026-08-10T00:00:00.000Z')
    let executions = 0
    const scheduler = new SchedulerService(fixture.database, () => {
      executions += 1
      return Promise.resolve({ threadId: 'unexpected', summary: 'unexpected' })
    }, {
      now: () => now,
      setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimer: () => undefined,
    })
    scheduler.saveTask({
      ...taskInput(fixture.projectId),
      rrule: 'RRULE:FREQ=DAILY;BYHOUR=8;BYMINUTE=1;BYSECOND=0',
      missedRunPolicy: 'skip',
    })
    now = new Date('2026-08-10T00:10:00.000Z')
    scheduler.start()
    const skipped = await waitForRun(scheduler, 'skipped')
    expect(executions).toBe(0)
    expect(skipped.runs[0]).toMatchObject({ status: 'skipped', unread: true })
    expect(skipped.runs[0]?.error).toContain('错过调度')
    scheduler.stop()
    fixture.database.close()
  })

  it('cancels an active executor through AbortSignal', async () => {
    const fixture = createFixture()
    const scheduler = new SchedulerService(fixture.database, (_task, _projectId, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason instanceof Error ? signal.reason : new Error('cancelled')), { once: true })
    }), {
      setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimer: () => undefined,
    })
    const taskId = scheduler.saveTask(taskInput(fixture.projectId)).tasks[0]?.id ?? ''
    scheduler.start()
    scheduler.runNow(taskId)
    const running = await waitForRun(scheduler, 'running')
    const runId = running.runs.find(({ status }) => status === 'running')?.id ?? ''
    scheduler.cancelRun(runId)
    const cancelled = await waitForRun(scheduler, 'cancelled')
    expect(cancelled.runs.find(({ id }) => id === runId)).toMatchObject({ status: 'cancelled', unread: true })
    scheduler.stop()
    fixture.database.close()
  })
})

function createFixture(): { database: StateDatabase; projectId: string } {
  const root = mkdtempSync(join(tmpdir(), 'aster-scheduler-test-'))
  temporaryPaths.push(root)
  const database = new StateDatabase(join(root, 'state.sqlite3'))
  const project = database.upsertProject(root)
  return { database, projectId: project.id }
}

function taskInput(projectId: string): ScheduledTaskInput {
  return {
    name: '每日检查',
    prompt: '检查项目并仅报告真实问题。',
    projectIds: [projectId],
    rrule: 'RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
    timezone: 'Asia/Shanghai',
    executionTarget: 'local',
    conversationMode: 'continue',
    sandbox: 'read-only',
    missedRunPolicy: 'run_once',
    maxAttempts: 1,
    retryBackoffMinutes: 5,
  }
}

async function waitForRun(scheduler: SchedulerService, status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped') {
  for (let index = 0; index < 100; index += 1) {
    const snapshot = scheduler.getSnapshot()
    if (snapshot.runs.some((run) => run.status === status)) return snapshot
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Timed out waiting for ${status}`)
}

async function waitForAttempts(read: () => number, count: number): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (read() >= count) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for retry')
}
