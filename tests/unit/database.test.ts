import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { StateDatabase } from '../../src/main/state/database.js'

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
      INSERT INTO projects VALUES ('project-1', 'legacy', '/legacy', 0, '2026-01-01T00:00:00.000Z');
      INSERT INTO project_threads VALUES ('project-1', 'thread-1', '2026-01-01T00:00:00.000Z');
      PRAGMA user_version = 7;
    `)
    legacy.close()

    const migrated = new StateDatabase(databasePath)
    expect(migrated.getProject('project-1')).toMatchObject({ pinned: false })
    expect(migrated.isThreadPinned('thread-1')).toBe(false)
    expect(migrated.listPinnedProjectThreadIds('project-1', false)).toEqual([])
    migrated.close()
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
})
