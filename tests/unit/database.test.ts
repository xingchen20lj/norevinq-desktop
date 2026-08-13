import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { StateDatabase } from '../../src/main/state/database.js'
import type { ScheduledRun } from '../../src/shared/scheduler.js'
import type { WorktreeHandoffRecovery } from '../../src/shared/worktree.js'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('StateDatabase', () => {
  it('persists and deduplicates recent projects', () => {
    const root = mkdtempSync(join(tmpdir(), 'aster-db-test-'))
    temporaryPaths.push(root)
    const projectPath = mkdtempSync(join(root, 'project-'))
    const otherProjectPath = mkdtempSync(join(root, 'other-project-'))
    const databasePath = join(root, 'state.sqlite3')

    const database = new StateDatabase(databasePath)
    const first = database.upsertProject(projectPath)
    const second = database.upsertProject(projectPath)
    const other = database.upsertProject(otherProjectPath)

    expect(second.id).toBe(first.id)
    expect(database.listProjects()).toHaveLength(2)
    expect(database.setProjectPinned(first.id, true).pinned).toBe(true)
    expect(database.listProjects().map(({ id }) => id)).toEqual([first.id, other.id])
    expect(database.getProject(first.id)?.path).toBe(realpathSync(projectPath))
    expect(database.getProject('missing')).toBeNull()
    expect(database.setProjectTrust(first.id, true).trusted).toBe(true)
    database.associateThread(first.id, 'thread-a')
    database.associateThread(first.id, 'thread-b')
    database.associateThread(first.id, 'thread-a')
    expect(database.listProjectThreadIds(first.id)).toEqual(['thread-a', 'thread-b'])
    expect(database.hasProjectThread(first.id, 'thread-a')).toBe(true)
    expect(database.hasProjectThread(other.id, 'thread-a')).toBe(false)
    database.setThreadPinned(first.id, 'thread-b', true)
    expect(database.listProjectThreadIds(first.id)).toEqual(['thread-b', 'thread-a'])
    expect(database.listPinnedProjectThreadIds(first.id, false)).toEqual(['thread-b'])
    database.setThreadArchived('thread-b', true)
    expect(database.listPinnedProjectThreadIds(first.id, false)).toEqual([])
    expect(database.listPinnedProjectThreadIds(first.id, true)).toEqual(['thread-b'])
    database.setAppSetting('window.state', { width: 1200, maximized: false })
    expect(database.getAppSetting('window.state')).toEqual({ width: 1200, maximized: false })
    expect(() => database.setAppSetting('../invalid', true)).toThrow(/key/u)
    database.close()

    const reopened = new StateDatabase(databasePath)
    expect(reopened.listProjects()[0]?.path).toBe(realpathSync(projectPath))
    expect(reopened.listProjects()[0]?.pinned).toBe(true)
    expect(reopened.getProject(first.id)?.trusted).toBe(true)
    expect(reopened.listProjectThreadIds(first.id)).toEqual(['thread-b', 'thread-a'])
    expect(reopened.isThreadPinned('thread-b')).toBe(true)
    expect(reopened.listPinnedProjectThreadIds(first.id, true)).toEqual(['thread-b'])
    expect(reopened.getAppSetting('window.state')).toEqual({ width: 1200, maximized: false })
    reopened.removeProject(first.id)
    reopened.removeProject(other.id)
    expect(reopened.listProjects()).toEqual([])
    expect(reopened.listProjectThreadIds(first.id)).toEqual([])
    reopened.close()
  })

  it('migrates v7 project and thread records to pinned metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'aster-db-migration-'))
    temporaryPaths.push(root)
    const databasePath = join(root, 'state.sqlite3')
    const legacy = new DatabaseSync(databasePath)
    legacy.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
        trusted INTEGER NOT NULL DEFAULT 0, last_opened_at TEXT NOT NULL
      );
      CREATE TABLE project_threads (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        thread_id TEXT PRIMARY KEY, last_opened_at TEXT NOT NULL
      );
      CREATE TABLE managed_worktrees (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
        base_ref TEXT NOT NULL, branch TEXT, created_at TEXT NOT NULL,
        copied_include_files INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO projects VALUES ('project-1', 'legacy', '/legacy', 0, '2026-01-01T00:00:00.000Z');
      INSERT INTO project_threads VALUES ('project-1', 'thread-1', '2026-01-01T00:00:00.000Z');
      PRAGMA user_version = 7;
    `)
    legacy.close()

    const migrated = new StateDatabase(databasePath)
    expect(migrated.getProject('project-1')).toMatchObject({ pinned: false })
    expect(migrated.isThreadPinned('thread-1')).toBe(false)
    expect(migrated.getThreadWorktreeId('thread-1')).toBeNull()
    expect(migrated.listPinnedProjectThreadIds('project-1', false)).toEqual([])
    migrated.close()
    const verified = new DatabaseSync(databasePath)
    expect((verified.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(11)
    verified.close()
  })

  it('persists conversation worktree context without erasing it during list refreshes', () => {
    const root = mkdtempSync(join(tmpdir(), 'aster-db-worktree-context-'))
    temporaryPaths.push(root)
    const projectPath = mkdtempSync(join(root, 'project-'))
    const worktreePath = mkdtempSync(join(root, 'worktree-'))
    const database = new StateDatabase(join(root, 'state.sqlite3'))
    const project = database.upsertProject(projectPath)
    database.insertManagedWorktree({
      id: 'worktree-1',
      projectId: project.id,
      path: worktreePath,
      baseRef: 'HEAD',
      baseOid: null,
      branch: null,
      createdAt: new Date().toISOString(),
      copiedIncludeFiles: 0,
    })

    database.associateThread(project.id, 'thread-1', false, 'worktree-1')
    expect(database.countThreadsForWorktree('worktree-1')).toBe(1)
    database.associateThread(project.id, 'thread-1', true)
    expect(database.getThreadProjectContext('thread-1')).toEqual({
      projectId: project.id,
      worktreeId: 'worktree-1',
    })
    database.setThreadWorktree(project.id, 'thread-1', null)
    expect(database.getThreadWorktreeId('thread-1')).toBeNull()
    expect(database.countThreadsForWorktree('worktree-1')).toBe(0)
    expect(() => database.setThreadWorktree(project.id, 'missing-thread', 'worktree-1'))
      .toThrow('Conversation association not found')
    database.close()
  })

  it('persists durable worktree handoff recovery metadata across restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'aster-db-handoff-recovery-'))
    temporaryPaths.push(root)
    const databasePath = join(root, 'state.sqlite3')
    const projectPath = mkdtempSync(join(root, 'project-'))
    const database = new StateDatabase(databasePath)
    const project = database.upsertProject(projectPath)
    database.associateThread(project.id, 'thread-recovery')
    const operation: WorktreeHandoffRecovery = {
      id: '11111111-1111-7111-8111-111111111111',
      projectId: project.id,
      threadId: 'thread-recovery',
      sourceWorktreeId: null,
      targetWorktreeId: '22222222-2222-7222-8222-222222222222',
      recoveryRef: 'refs/aster/handoffs/11111111-1111-7111-8111-111111111111',
      stashOid: 'a'.repeat(40),
      sourceHeadOid: 'b'.repeat(40),
      sourceTreeOid: 'c'.repeat(40),
      sourceIndexOid: 'd'.repeat(40),
      targetHeadOid: 'e'.repeat(40),
      targetCleanTreeOid: 'f'.repeat(40),
      targetTreeOid: null,
      targetIndexOid: null,
      phase: 'stashed',
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
      error: null,
    }
    database.insertWorktreeHandoff(operation)
    database.updateWorktreeHandoff(operation.id, {
      phase: 'needsAttention',
      targetTreeOid: '1'.repeat(40),
      targetIndexOid: '2'.repeat(40),
      error: 'safe recovery required',
    })
    database.close()

    const reopened = new StateDatabase(databasePath)
    expect(reopened.listWorktreeHandoffs(project.id)).toEqual([
      expect.objectContaining({
        id: operation.id,
        phase: 'needsAttention',
        targetTreeOid: '1'.repeat(40),
        targetIndexOid: '2'.repeat(40),
        error: 'safe recovery required',
      }),
    ])
    expect(reopened.countWorktreeHandoffsForWorktree(operation.targetWorktreeId ?? '')).toBe(1)
    reopened.deleteWorktreeHandoff(operation.id)
    expect(reopened.listWorktreeHandoffs(project.id)).toEqual([])
    reopened.close()
  })

  it('bounds pinned conversation hydration to twenty records per project', () => {
    const root = mkdtempSync(join(tmpdir(), 'aster-db-pins-'))
    temporaryPaths.push(root)
    const projectPath = mkdtempSync(join(root, 'project-'))
    const database = new StateDatabase(join(root, 'state.sqlite3'))
    const project = database.upsertProject(projectPath)
    for (let index = 0; index < 20; index += 1) {
      const threadId = `thread-${String(index)}`
      database.associateThread(project.id, threadId)
      database.setThreadPinned(project.id, threadId, true)
    }
    database.associateThread(project.id, 'thread-overflow')
    expect(() => database.setThreadPinned(project.id, 'thread-overflow', true)).toThrow('at most 20')
    expect(database.listPinnedProjectThreadIds(project.id, false)).toHaveLength(20)
    database.close()
  })

  it('writes scheduler history atomically in a batch', () => {
    const root = mkdtempSync(join(tmpdir(), 'aster-db-scheduler-batch-'))
    temporaryPaths.push(root)
    const database = new StateDatabase(join(root, 'state.sqlite3'))
    const base: ScheduledRun = {
      id: 'run-1',
      taskId: 'task-1',
      taskName: 'Batch task',
      projectId: 'project-1',
      projectName: 'Batch project',
      scheduledFor: '2026-08-11T00:00:00.000Z',
      startedAt: null,
      finishedAt: null,
      status: 'queued',
      attempt: 1,
      threadId: null,
      worktreeId: null,
      summary: null,
      error: null,
      unread: true,
    }
    database.upsertScheduledRuns([
      base,
      { ...base, id: 'run-2', scheduledFor: '2026-08-11T00:01:00.000Z' },
    ])
    expect(database.listScheduledRuns()).toEqual([
      expect.objectContaining({ id: 'run-2' }),
      expect.objectContaining({ id: 'run-1' }),
    ])
    database.upsertScheduledRuns([])
    database.close()
  })
})
