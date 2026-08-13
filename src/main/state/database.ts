import { randomUUID } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ProjectSummary } from '../../shared/contracts.js'
import type { SecurityScanRecord } from '../../shared/security.js'
import type { ScheduledRun, ScheduledTask } from '../../shared/scheduler.js'
import type { ManagedWorktree } from '../../shared/worktree.js'

type ProjectRow = {
  id: string
  name: string
  path: string
  trusted: number
  pinned: number
  last_opened_at: string
}

const MAX_PINNED_THREADS_PER_PROJECT = 20
const UPSERT_SCHEDULED_RUN_SQL = `
  INSERT INTO scheduled_runs (id, task_id, run_json, status, scheduled_for, unread)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET run_json=excluded.run_json, status=excluded.status,
    scheduled_for=excluded.scheduled_for, unread=excluded.unread
`

type WorktreeRow = {
  id: string
  project_id: string
  path: string
  base_ref: string
  base_oid: string | null
  branch: string | null
  created_at: string
  copied_include_files: number
}

type SecurityScanRow = {
  id: string
  project_id: string
  project_name: string
  project_path: string
  created_at: string
  updated_at: string
  status: SecurityScanRecord['status']
  request_json: string
  progress_json: string | null
  result_json: string | null
  error_json: string | null
}

export class StateDatabase {
  readonly #database: DatabaseSync

  constructor(path: string) {
    this.#database = new DatabaseSync(path)
    this.#database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.#migrate()
  }

  close(): void {
    this.#database.close()
  }

  listProjects(): ProjectSummary[] {
    const rows = this.#database
      .prepare('SELECT id, name, path, trusted, pinned, last_opened_at FROM projects ORDER BY pinned DESC, last_opened_at DESC LIMIT 500')
      .all() as ProjectRow[]

    return rows.map(toProjectSummary)
  }

  getProject(projectId: string): ProjectSummary | null {
    const row = this.#database
      .prepare('SELECT id, name, path, trusted, pinned, last_opened_at FROM projects WHERE id = ?')
      .get(projectId) as ProjectRow | undefined
    return row ? toProjectSummary(row) : null
  }

  upsertProject(path: string): ProjectSummary {
    const canonicalPath = realpathSync(path)
    if (!statSync(canonicalPath).isDirectory()) {
      throw new Error('The selected project path is not a directory.')
    }

    const now = new Date().toISOString()
    const existing = this.#database
      .prepare('SELECT id, name, path, trusted, pinned, last_opened_at FROM projects WHERE path = ?')
      .get(canonicalPath) as ProjectRow | undefined

    if (existing) {
      this.#database.prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?').run(now, existing.id)
      return toProjectSummary({ ...existing, last_opened_at: now })
    }

    const project: ProjectRow = {
      id: randomUUID(),
      name: basename(canonicalPath),
      path: canonicalPath,
      trusted: 0,
      pinned: 0,
      last_opened_at: now,
    }
    this.#database
      .prepare('INSERT INTO projects (id, name, path, trusted, pinned, last_opened_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(project.id, project.name, project.path, project.trusted, project.pinned, project.last_opened_at)
    return toProjectSummary(project)
  }

  removeProject(projectId: string): void {
    this.#database.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
  }

  setProjectPinned(projectId: string, pinned: boolean): ProjectSummary {
    const result = this.#database.prepare('UPDATE projects SET pinned = ? WHERE id = ?')
      .run(pinned ? 1 : 0, projectId)
    if (result.changes !== 1) throw new Error('Project not found.')
    const project = this.getProject(projectId)
    if (!project) throw new Error('Project not found.')
    return project
  }

  getAppSetting(key: string): unknown {
    validateSettingKey(key)
    const row = this.#database.prepare('SELECT value_json FROM app_settings WHERE key = ?')
      .get(key) as { value_json: string } | undefined
    return row ? JSON.parse(row.value_json) as unknown : null
  }

  setAppSetting(key: string, value: unknown): void {
    validateSettingKey(key)
    const serialized = JSON.stringify(value) as string | undefined
    if (serialized === undefined) throw new Error('Application setting must be JSON serializable.')
    if (serialized.length > 64 * 1024) throw new Error('Application setting exceeds 64 KiB.')
    this.#database.prepare(`
      INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
    `).run(key, serialized, new Date().toISOString())
  }

  setProjectTrust(projectId: string, trusted: boolean): ProjectSummary {
    const result = this.#database
      .prepare('UPDATE projects SET trusted = ? WHERE id = ?')
      .run(trusted ? 1 : 0, projectId)
    if (result.changes !== 1) throw new Error('Project not found.')
    const project = this.getProject(projectId)
    if (!project) throw new Error('Project not found.')
    return project
  }

  associateThread(projectId: string, threadId: string, archived?: boolean, worktreeId?: string | null): void {
    const archivedValue = archived === undefined ? null : archived ? 1 : 0
    const updateWorktree = worktreeId === undefined ? 0 : 1
    this.#database
      .prepare(`
        INSERT INTO project_threads (project_id, thread_id, last_opened_at, pinned, archived, worktree_id)
        VALUES (?, ?, ?, 0, COALESCE(?, 0), ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          project_id = excluded.project_id,
          last_opened_at = excluded.last_opened_at,
          archived = CASE WHEN ? IS NULL THEN project_threads.archived ELSE ? END,
          worktree_id = CASE WHEN ? = 0 THEN project_threads.worktree_id ELSE ? END
      `)
      .run(
        projectId,
        threadId,
        new Date().toISOString(),
        archivedValue,
        worktreeId ?? null,
        archivedValue,
        archivedValue,
        updateWorktree,
        worktreeId ?? null,
      )
  }

  getThreadWorktreeId(threadId: string): string | null {
    const row = this.#database.prepare('SELECT worktree_id FROM project_threads WHERE thread_id = ?')
      .get(threadId) as { worktree_id: string | null } | undefined
    return row?.worktree_id ?? null
  }

  getThreadProjectContext(threadId: string): { projectId: string; worktreeId: string | null } | null {
    const row = this.#database.prepare(`
      SELECT project_id, worktree_id FROM project_threads WHERE thread_id = ?
    `).get(threadId) as { project_id: string; worktree_id: string | null } | undefined
    return row ? { projectId: row.project_id, worktreeId: row.worktree_id } : null
  }

  countThreadsForWorktree(worktreeId: string): number {
    const row = this.#database.prepare(`
      SELECT COUNT(*) AS count FROM project_threads WHERE worktree_id = ?
    `).get(worktreeId) as { count: number }
    return row.count
  }

  setThreadWorktree(projectId: string, threadId: string, worktreeId: string | null): void {
    if (worktreeId) {
      const worktree = this.getManagedWorktree(worktreeId)
      if (worktree?.projectId !== projectId) throw new Error('Managed worktree not found for this project.')
    }
    const result = this.#database.prepare(`
      UPDATE project_threads SET worktree_id = ?, last_opened_at = ?
      WHERE project_id = ? AND thread_id = ?
    `).run(worktreeId, new Date().toISOString(), projectId, threadId)
    if (result.changes !== 1) throw new Error('Conversation association not found.')
  }

  listProjectThreadIds(projectId: string): string[] {
    const rows = this.#database
      .prepare('SELECT thread_id FROM project_threads WHERE project_id = ? ORDER BY pinned DESC, last_opened_at DESC')
      .all(projectId) as { thread_id: string }[]
    return rows.map(({ thread_id }) => thread_id)
  }

  hasProjectThread(projectId: string, threadId: string): boolean {
    const row = this.#database.prepare(`
      SELECT 1 AS found FROM project_threads WHERE project_id = ? AND thread_id = ?
    `).get(projectId, threadId) as { found: number } | undefined
    return row?.found === 1
  }

  removeThreadAssociation(threadId: string): void {
    this.#database.prepare('DELETE FROM project_threads WHERE thread_id = ?').run(threadId)
  }

  setThreadPinned(projectId: string, threadId: string, pinned: boolean): void {
    if (pinned && !this.isThreadPinned(threadId)) {
      const row = this.#database.prepare(`
        SELECT COUNT(*) AS count FROM project_threads WHERE project_id = ? AND pinned = 1
      `).get(projectId) as { count: number }
      if (row.count >= MAX_PINNED_THREADS_PER_PROJECT) {
        throw new Error(`A project can pin at most ${String(MAX_PINNED_THREADS_PER_PROJECT)} conversations.`)
      }
    }
    const result = this.#database.prepare(`
      UPDATE project_threads SET pinned = ? WHERE project_id = ? AND thread_id = ?
    `).run(pinned ? 1 : 0, projectId, threadId)
    if (result.changes !== 1) throw new Error('Conversation association not found.')
  }

  isThreadPinned(threadId: string): boolean {
    const row = this.#database.prepare('SELECT pinned FROM project_threads WHERE thread_id = ?')
      .get(threadId) as { pinned: number } | undefined
    return row?.pinned === 1
  }

  listPinnedProjectThreadIds(projectId: string, archived: boolean): string[] {
    const rows = this.#database.prepare(`
      SELECT thread_id FROM project_threads
      WHERE project_id = ? AND pinned = 1 AND archived = ?
      ORDER BY last_opened_at DESC LIMIT ?
    `).all(projectId, archived ? 1 : 0, MAX_PINNED_THREADS_PER_PROJECT) as { thread_id: string }[]
    return rows.map(({ thread_id }) => thread_id)
  }

  setThreadArchived(threadId: string, archived: boolean): void {
    this.#database.prepare('UPDATE project_threads SET archived = ? WHERE thread_id = ?')
      .run(archived ? 1 : 0, threadId)
  }

  insertManagedWorktree(worktree: Omit<ManagedWorktree, 'headOid' | 'locked' | 'missing'>): void {
    this.#database.prepare(`
      INSERT INTO managed_worktrees
        (id, project_id, path, base_ref, base_oid, branch, created_at, copied_include_files)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      worktree.id,
      worktree.projectId,
      worktree.path,
      worktree.baseRef,
      worktree.baseOid,
      worktree.branch,
      worktree.createdAt,
      worktree.copiedIncludeFiles,
    )
  }

  listManagedWorktrees(projectId: string): Omit<ManagedWorktree, 'headOid' | 'locked' | 'missing'>[] {
    const rows = this.#database.prepare(`
      SELECT id, project_id, path, base_ref, base_oid, branch, created_at, copied_include_files
      FROM managed_worktrees WHERE project_id = ? ORDER BY created_at DESC
    `).all(projectId) as WorktreeRow[]
    return rows.map(toManagedWorktreeRecord)
  }

  getManagedWorktree(worktreeId: string): Omit<ManagedWorktree, 'headOid' | 'locked' | 'missing'> | null {
    const row = this.#database.prepare(`
      SELECT id, project_id, path, base_ref, base_oid, branch, created_at, copied_include_files
      FROM managed_worktrees WHERE id = ?
    `).get(worktreeId) as WorktreeRow | undefined
    return row ? toManagedWorktreeRecord(row) : null
  }

  deleteManagedWorktree(worktreeId: string): void {
    this.#database.prepare('UPDATE project_threads SET worktree_id = NULL WHERE worktree_id = ?').run(worktreeId)
    this.#database.prepare('DELETE FROM managed_worktrees WHERE id = ?').run(worktreeId)
  }

  upsertSecurityScan(scan: SecurityScanRecord): void {
    this.#database.prepare(`
      INSERT INTO security_scans
        (id, project_id, project_name, project_path, created_at, updated_at, status,
         request_json, progress_json, result_json, error_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        status = excluded.status,
        progress_json = excluded.progress_json,
        result_json = excluded.result_json,
        error_json = excluded.error_json
    `).run(
      scan.id,
      scan.projectId,
      scan.projectName,
      scan.projectPath,
      scan.createdAt,
      scan.updatedAt,
      scan.status,
      JSON.stringify(scan.request),
      scan.progress ? JSON.stringify(scan.progress) : null,
      scan.result ? JSON.stringify(scan.result) : null,
      scan.error ? JSON.stringify(scan.error) : null,
    )
  }

  listSecurityScans(limit = 100): SecurityScanRecord[] {
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)))
    const rows = this.#database.prepare(`
      SELECT id, project_id, project_name, project_path, created_at, updated_at, status,
             request_json, progress_json, result_json, error_json
      FROM security_scans ORDER BY created_at DESC LIMIT ?
    `).all(boundedLimit) as SecurityScanRow[]
    return rows.map(toSecurityScanRecord)
  }

  getSecurityScan(scanId: string): SecurityScanRecord | null {
    const row = this.#database.prepare(`
      SELECT id, project_id, project_name, project_path, created_at, updated_at, status,
             request_json, progress_json, result_json, error_json
      FROM security_scans WHERE id = ?
    `).get(scanId) as SecurityScanRow | undefined
    return row ? toSecurityScanRecord(row) : null
  }

  upsertScheduledTask(task: ScheduledTask): void {
    this.#database.prepare(`
      INSERT INTO scheduled_tasks (id, task_json, status, next_run_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET task_json=excluded.task_json, status=excluded.status,
        next_run_at=excluded.next_run_at, updated_at=excluded.updated_at
    `).run(task.id, JSON.stringify(task), task.status, task.nextRunAt, task.updatedAt)
  }

  getScheduledTask(taskId: string): ScheduledTask | null {
    const row = this.#database.prepare('SELECT task_json FROM scheduled_tasks WHERE id = ?')
      .get(taskId) as { task_json: string } | undefined
    return row ? JSON.parse(row.task_json) as ScheduledTask : null
  }

  listScheduledTasks(): ScheduledTask[] {
    const rows = this.#database.prepare('SELECT task_json FROM scheduled_tasks ORDER BY updated_at DESC')
      .all() as { task_json: string }[]
    return rows.map(({ task_json }) => JSON.parse(task_json) as ScheduledTask)
  }

  deleteScheduledTask(taskId: string): void {
    this.#database.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(taskId)
  }

  upsertScheduledRun(run: ScheduledRun): void {
    this.#writeScheduledRun(this.#database.prepare(UPSERT_SCHEDULED_RUN_SQL), run)
  }

  upsertScheduledRuns(runs: readonly ScheduledRun[]): void {
    if (runs.length === 0) return
    const statement = this.#database.prepare(UPSERT_SCHEDULED_RUN_SQL)
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      for (const run of runs) this.#writeScheduledRun(statement, run)
      this.#database.exec('COMMIT')
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw error
    }
  }

  listScheduledRuns(limit = 200): ScheduledRun[] {
    const bounded = Math.max(1, Math.min(1_000, Math.trunc(limit)))
    const rows = this.#database.prepare('SELECT run_json FROM scheduled_runs ORDER BY scheduled_for DESC LIMIT ?')
      .all(bounded) as { run_json: string }[]
    return rows.map(({ run_json }) => JSON.parse(run_json) as ScheduledRun)
  }

  listDueScheduledRuns(now: string): ScheduledRun[] {
    const rows = this.#database.prepare(`
      SELECT run_json FROM scheduled_runs WHERE status = 'queued' AND scheduled_for <= ?
      ORDER BY scheduled_for ASC LIMIT 100
    `).all(now) as { run_json: string }[]
    return rows.map(({ run_json }) => JSON.parse(run_json) as ScheduledRun)
  }

  markScheduledRunsRead(runIds?: string[]): void {
    if (!runIds) {
      this.#database.prepare(`
        UPDATE scheduled_runs
        SET unread = 0, run_json = json_set(run_json, '$.unread', json('false'))
        WHERE unread = 1
      `).run()
      return
    }
    const runs = this.listScheduledRuns(1_000)
    const selected = new Set(runIds)
    for (const run of runs) {
      if (!run.unread || !selected.has(run.id)) continue
      this.upsertScheduledRun({ ...run, unread: false })
    }
  }

  recoverInterruptedScheduledRuns(): void {
    const now = new Date().toISOString()
    for (const run of this.listScheduledRuns(1_000)) {
      if (run.status !== 'running') continue
      this.upsertScheduledRun({
        ...run,
        status: 'failed',
        finishedAt: now,
        error: '应用在计划任务运行期间退出；为避免重复副作用，未自动重放。',
        unread: true,
      })
    }
  }

  #writeScheduledRun(statement: ReturnType<DatabaseSync['prepare']>, run: ScheduledRun): void {
    statement.run(run.id, run.taskId, JSON.stringify(run), run.status, run.scheduledFor, run.unread ? 1 : 0)
  }

  #migrate(): void {
    const version = this.#database.prepare('PRAGMA user_version').get() as { user_version: number }
    if (version.user_version < 1) {
      this.#database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          trusted INTEGER NOT NULL DEFAULT 0 CHECK (trusted IN (0, 1)),
          last_opened_at TEXT NOT NULL
        );
        PRAGMA user_version = 1;
        COMMIT;
      `)
    }
    if (version.user_version < 2) {
      this.#database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS project_threads (
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          thread_id TEXT PRIMARY KEY,
          last_opened_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS project_threads_project_id_idx
          ON project_threads(project_id, last_opened_at DESC);
        PRAGMA user_version = 2;
        COMMIT;
      `)
    }
    if (version.user_version < 3) {
      this.#database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS managed_worktrees (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          path TEXT NOT NULL UNIQUE,
          base_ref TEXT NOT NULL,
          branch TEXT,
          created_at TEXT NOT NULL,
          copied_include_files INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS managed_worktrees_project_idx
          ON managed_worktrees(project_id, created_at DESC);
        PRAGMA user_version = 3;
        COMMIT;
      `)
    }
    if (version.user_version < 4) {
      this.#database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS security_scans (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          project_name TEXT NOT NULL,
          project_path TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
          request_json TEXT NOT NULL,
          progress_json TEXT,
          result_json TEXT,
          error_json TEXT
        );
        CREATE INDEX IF NOT EXISTS security_scans_created_idx
          ON security_scans(created_at DESC);
        CREATE INDEX IF NOT EXISTS security_scans_project_idx
          ON security_scans(project_id, created_at DESC);
        PRAGMA user_version = 4;
        COMMIT;
      `)
    }
    if (version.user_version < 5) {
      this.#database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS scheduled_tasks (
          id TEXT PRIMARY KEY,
          task_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
          next_run_at TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS scheduled_tasks_due_idx ON scheduled_tasks(status, next_run_at);
        CREATE TABLE IF NOT EXISTS scheduled_runs (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          run_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'skipped')),
          scheduled_for TEXT NOT NULL,
          unread INTEGER NOT NULL DEFAULT 0 CHECK (unread IN (0, 1))
        );
        CREATE INDEX IF NOT EXISTS scheduled_runs_due_idx ON scheduled_runs(status, scheduled_for);
        CREATE INDEX IF NOT EXISTS scheduled_runs_task_idx ON scheduled_runs(task_id, scheduled_for DESC);
        PRAGMA user_version = 5;
        COMMIT;
      `)
    }
    if (version.user_version < 6) {
      this.#database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        PRAGMA user_version = 6;
        COMMIT;
      `)
    }
    if (version.user_version < 7) {
      this.#database.exec(`
        BEGIN IMMEDIATE;
        CREATE INDEX IF NOT EXISTS projects_last_opened_idx ON projects(last_opened_at DESC);
        CREATE INDEX IF NOT EXISTS scheduled_runs_scheduled_idx ON scheduled_runs(scheduled_for DESC);
        PRAGMA user_version = 7;
        COMMIT;
      `)
    }
    if (version.user_version < 8) {
      this.#database.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1));
        ALTER TABLE project_threads ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1));
        ALTER TABLE project_threads ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1));
        CREATE INDEX IF NOT EXISTS projects_pinned_opened_idx
          ON projects(pinned DESC, last_opened_at DESC);
        CREATE INDEX IF NOT EXISTS project_threads_pinned_idx
          ON project_threads(project_id, archived, pinned DESC, last_opened_at DESC);
        PRAGMA user_version = 8;
        COMMIT;
      `)
    }
    if (version.user_version < 9) {
      this.#database.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE project_threads ADD COLUMN worktree_id TEXT;
        CREATE INDEX IF NOT EXISTS project_threads_worktree_idx
          ON project_threads(worktree_id);
        PRAGMA user_version = 9;
        COMMIT;
      `)
    }
    if (version.user_version < 10) {
      this.#database.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE managed_worktrees ADD COLUMN base_oid TEXT;
        PRAGMA user_version = 10;
        COMMIT;
      `)
    }
  }
}

function validateSettingKey(key: string): void {
  if (!/^[a-z][a-z0-9._-]{0,79}$/u.test(key)) throw new Error('Application setting key is invalid.')
}

function toSecurityScanRecord(row: SecurityScanRow): SecurityScanRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    projectPath: row.project_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    request: JSON.parse(row.request_json) as SecurityScanRecord['request'],
    progress: row.progress_json ? JSON.parse(row.progress_json) as SecurityScanRecord['progress'] : null,
    result: row.result_json ? JSON.parse(row.result_json) as SecurityScanRecord['result'] : null,
    error: row.error_json ? JSON.parse(row.error_json) as SecurityScanRecord['error'] : null,
  }
}

function toManagedWorktreeRecord(row: WorktreeRow): Omit<ManagedWorktree, 'headOid' | 'locked' | 'missing'> {
  return {
    id: row.id,
    projectId: row.project_id,
    path: row.path,
    baseRef: row.base_ref,
    baseOid: row.base_oid,
    branch: row.branch,
    createdAt: row.created_at,
    copiedIncludeFiles: row.copied_include_files,
  }
}

function toProjectSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    trusted: row.trusted === 1,
    pinned: row.pinned === 1,
    lastOpenedAt: row.last_opened_at,
  }
}
