import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterEach, describe, expect, it } from 'vitest'
import { reduceAgentActivity } from '../../src/main/agent/activityReducer.js'
import { StateDatabase } from '../../src/main/state/database.js'
import type { AgentActivity, AgentActivityState } from '../../src/shared/agent.js'
import type { ScheduledRun } from '../../src/shared/scheduler.js'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, {
    force: true, recursive: true, maxRetries: 5, retryDelay: 100,
  })
})

describe('performance baselines', () => {
  it('updates the newest activity in a 5,000-item history without a forward history scan', () => {
    const activities: AgentActivity[] = Array.from({ length: 5_000 }, (_, index) => ({
      id: `message-${String(index)}`,
      threadId: 'thread-performance',
      turnId: 'turn-performance',
      status: 'inProgress',
      startedAtMs: index,
      completedAtMs: null,
      truncated: false,
      truncatedChars: 0,
      type: 'agentMessage',
      text: '',
      phase: null,
    }))
    let state: AgentActivityState = {
      threadId: 'thread-performance',
      turnId: 'turn-performance',
      turnStatus: 'inProgress',
      activities,
      unknownEvents: [],
      lastError: null,
    }
    const startedAt = performance.now()
    for (let index = 0; index < 2_000; index += 1) {
      state = reduceAgentActivity(state, {
        method: 'item/agentMessage/delta',
        params: { threadId: 'thread-performance', turnId: 'turn-performance', itemId: 'message-4999', delta: 'x' },
      })
    }
    const durationMs = performance.now() - startedAt

    expect(state.activities.at(-1)).toMatchObject({ id: 'message-4999', text: 'x'.repeat(2_000) })
    expect(durationMs).toBeLessThan(2_000)
    console.info(`activity-reducer newest-item: ${durationMs.toFixed(1)}ms`)
  })

  it('lists and marks a 3,000-run scheduler history within bounded time', () => {
    const root = mkdtempSync(join(tmpdir(), 'norevinq-performance-'))
    temporaryPaths.push(root)
    const database = new StateDatabase(join(root, 'state.sqlite3'))
    const run: ScheduledRun = {
      id: '',
      taskId: 'task-performance',
      taskName: 'Performance task',
      projectId: 'project-performance',
      projectName: 'Performance project',
      scheduledFor: '2026-08-11T00:00:00.000Z',
      startedAt: null,
      finishedAt: null,
      status: 'succeeded',
      attempt: 1,
      threadId: null,
      worktreeId: null,
      summary: 'completed',
      error: null,
      unread: true,
    }
    try {
      database.upsertScheduledRuns(Array.from({ length: 3_000 }, (_, index) => ({
        ...run,
        id: `run-${String(index)}`,
        scheduledFor: new Date(index * 1_000).toISOString(),
      })))

      const startedAt = performance.now()
      const latest = database.listScheduledRuns(1_000)
      database.markScheduledRunsRead()
      const durationMs = performance.now() - startedAt

      expect(latest).toHaveLength(1_000)
      expect(database.listScheduledRuns(1_000).every(({ unread }) => !unread)).toBe(true)
      expect(durationMs).toBeLessThan(2_000)
      console.info(`scheduler list+bulk-read: ${durationMs.toFixed(1)}ms`)
    } finally {
      database.close()
    }
  })
})
