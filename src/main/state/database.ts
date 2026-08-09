import { randomUUID } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ProjectSummary } from '../../shared/contracts.js'
import type { ManagedWorktree } from '../../shared/worktree.js'

type ProjectRow = {
  id: string
  name: string
  path: string
  trusted: number
  last_opened_at: string
}

type WorktreeRow = {
  id: string
  project_id: string
  path: string
  base_ref: string
  branch: string | null
  created_at: string
  copied_include_files: number
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
      .prepare('SELECT id, name, path, trusted, last_opened_at FROM projects ORDER BY last_opened_at DESC')
      .all() as ProjectRow[]

    return rows.map(toProjectSummary)
  }

  getProject(projectId: string): ProjectSummary | null {
    const row = this.#database
      .prepare('SELECT id, name, path, trusted, last_opened_at FROM projects WHERE id = ?')
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
      .prepare('SELECT id, name, path, trusted, last_opened_at FROM projects WHERE path = ?')
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
      last_opened_at: now,
    }
    this.#database
      .prepare('INSERT INTO projects (id, name, path, trusted, last_opened_at) VALUES (?, ?, ?, ?, ?)')
      .run(project.id, project.name, project.path, project.trusted, project.last_opened_at)
    return toProjectSummary(project)
  }

  removeProject(projectId: string): void {
    this.#database.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
  }

  associateThread(projectId: string, threadId: string): void {
    this.#database
      .prepare(`
        INSERT INTO project_threads (project_id, thread_id, last_opened_at)
        VALUES (?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          project_id = excluded.project_id,
          last_opened_at = excluded.last_opened_at
      `)
      .run(projectId, threadId, new Date().toISOString())
  }

  listProjectThreadIds(projectId: string): string[] {
    const rows = this.#database
      .prepare('SELECT thread_id FROM project_threads WHERE project_id = ? ORDER BY last_opened_at DESC')
      .all(projectId) as { thread_id: string }[]
    return rows.map(({ thread_id }) => thread_id)
  }

  insertManagedWorktree(worktree: Omit<ManagedWorktree, 'headOid' | 'locked' | 'missing'>): void {
    this.#database.prepare(`
      INSERT INTO managed_worktrees
        (id, project_id, path, base_ref, branch, created_at, copied_include_files)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      worktree.id,
      worktree.projectId,
      worktree.path,
      worktree.baseRef,
      worktree.branch,
      worktree.createdAt,
      worktree.copiedIncludeFiles,
    )
  }

  listManagedWorktrees(projectId: string): Omit<ManagedWorktree, 'headOid' | 'locked' | 'missing'>[] {
    const rows = this.#database.prepare(`
      SELECT id, project_id, path, base_ref, branch, created_at, copied_include_files
      FROM managed_worktrees WHERE project_id = ? ORDER BY created_at DESC
    `).all(projectId) as WorktreeRow[]
    return rows.map(toManagedWorktreeRecord)
  }

  getManagedWorktree(worktreeId: string): Omit<ManagedWorktree, 'headOid' | 'locked' | 'missing'> | null {
    const row = this.#database.prepare(`
      SELECT id, project_id, path, base_ref, branch, created_at, copied_include_files
      FROM managed_worktrees WHERE id = ?
    `).get(worktreeId) as WorktreeRow | undefined
    return row ? toManagedWorktreeRecord(row) : null
  }

  deleteManagedWorktree(worktreeId: string): void {
    this.#database.prepare('DELETE FROM managed_worktrees WHERE id = ?').run(worktreeId)
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
  }
}

function toManagedWorktreeRecord(row: WorktreeRow): Omit<ManagedWorktree, 'headOid' | 'locked' | 'missing'> {
  return {
    id: row.id,
    projectId: row.project_id,
    path: row.path,
    baseRef: row.base_ref,
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
    lastOpenedAt: row.last_opened_at,
  }
}
