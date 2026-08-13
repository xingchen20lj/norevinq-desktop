import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs'
import { dirname, isAbsolute, join, matchesGlob, normalize, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type {
  CreateWorktreeInput,
  ManagedWorktree,
  MoveWorktreeChangesInput,
  MoveWorktreeChangesResult,
  RemoveWorktreeInput,
  WorktreeActionInput,
} from '../../shared/worktree.js'
import type { StateDatabase } from '../state/database.js'

const execFileAsync = promisify(execFile)
const MAX_INCLUDE_FILE_BYTES = 10 * 1024 * 1024
const MAX_INCLUDE_TOTAL_BYTES = 100 * 1024 * 1024

export class WorktreeService {
  readonly #database: StateDatabase
  readonly #managedRoot: string
  #handoffInProgress = false

  constructor(database: StateDatabase, managedRoot: string) {
    this.#database = database
    mkdirSync(managedRoot, { mode: 0o700, recursive: true })
    this.#managedRoot = realpathSync(managedRoot)
  }

  async list(projectId: string): Promise<ManagedWorktree[]> {
    const project = this.#requireProject(projectId)
    const actual = await readWorktreeMetadata(project.path)
    return this.#database.listManagedWorktrees(projectId).map((record) => {
      const metadata = actual.get(worktreePathKey(record.path))
      return {
        ...record,
        headOid: metadata?.headOid ?? null,
        locked: metadata?.locked ?? false,
        missing: !existsSync(record.path) || metadata === undefined,
      }
    })
  }

  async create(input: CreateWorktreeInput): Promise<ManagedWorktree> {
    const project = this.#requireProject(input.projectId)
    const id = randomUUID()
    const baseRef = validateRef(input.baseRef ?? 'HEAD', 'base ref')
    const branch = input.branch ? validateRef(input.branch, 'branch') : null
    const repositoryDirectory = join(this.#managedRoot, input.projectId)
    const path = join(repositoryDirectory, id)
    mkdirSync(repositoryDirectory, { mode: 0o700, recursive: true })
    if (existsSync(path)) throw new Error('Managed worktree path already exists.')

    const args = ['worktree', 'add']
    if (branch) args.push('-b', branch)
    else args.push('--detach')
    args.push(path, baseRef)
    await runGit(project.path, args, 120_000)
    let copiedIncludeFiles = 0
    try {
      if (input.copyIncludes !== false) copiedIncludeFiles = await copyWorktreeIncludes(project.path, path)
      const record = { id, projectId: input.projectId, path, baseRef, branch, createdAt: new Date().toISOString(), copiedIncludeFiles }
      this.#database.insertManagedWorktree(record)
      const [created] = await this.list(input.projectId)
      const match = created?.id === id ? created : (await this.list(input.projectId)).find((item) => item.id === id)
      if (!match) throw new Error('Created worktree could not be reloaded.')
      return match
    } catch (error) {
      await runGit(project.path, ['worktree', 'remove', '--force', path], 120_000).catch(() => undefined)
      throw error
    }
  }

  async lock(input: WorktreeActionInput): Promise<ManagedWorktree[]> {
    const { project, worktree } = this.#requireManaged(input.worktreeId)
    await runGit(project.path, ['worktree', 'lock', worktree.path])
    return this.list(project.id)
  }

  async unlock(input: WorktreeActionInput): Promise<ManagedWorktree[]> {
    const { project, worktree } = this.#requireManaged(input.worktreeId)
    await runGit(project.path, ['worktree', 'unlock', worktree.path])
    return this.list(project.id)
  }

  async remove(input: RemoveWorktreeInput): Promise<ManagedWorktree[]> {
    const { project, worktree } = this.#requireManaged(input.worktreeId)
    const associatedThreads = this.#database.countThreadsForWorktree(worktree.id)
    if (associatedThreads > 0) {
      throw new Error(`Hand off ${String(associatedThreads)} conversation${associatedThreads === 1 ? '' : 's'} before removing this worktree.`)
    }
    const args = ['worktree', 'remove']
    if (input.force) args.push('--force')
    args.push(worktree.path)
    if (existsSync(worktree.path)) await runGit(project.path, args, 120_000)
    this.#database.deleteManagedWorktree(worktree.id)
    return this.list(project.id)
  }

  async moveChanges(input: MoveWorktreeChangesInput): Promise<MoveWorktreeChangesResult> {
    if (this.#handoffInProgress) throw new Error('Another worktree handoff is already running.')
    if (input.sourceWorktreeId === input.targetWorktreeId) return { moved: false, recoveryStash: null }
    const project = this.#requireProject(input.projectId)
    const source = this.#contextPath(project.id, project.path, input.sourceWorktreeId)
    const target = this.#contextPath(project.id, project.path, input.targetWorktreeId)
    this.#handoffInProgress = true
    try {
      if (!(await hasChanges(source))) return { moved: false, recoveryStash: null }
      if (await hasUnmergedChanges(source)) throw new Error('Resolve source merge conflicts before handing off changes.')
      if (await hasChanges(target)) throw new Error('The handoff target must be clean before receiving changes.')

      const marker = `aster-handoff-${randomUUID()}`
      await runGit(source, ['stash', 'push', '--include-untracked', '--message', marker, '--'], 120_000)
      const stashOid = (await runGit(source, ['rev-parse', '--verify', 'refs/stash'])).stdout.trim()
      if (!stashOid || await hasChanges(source)) {
        throw new Error('Git could not create a clean handoff recovery stash.')
      }

      try {
        await runGit(target, ['stash', 'apply', '--index', stashOid], 120_000)
      } catch (applyError) {
        const rollbackErrors: string[] = []
        await runGit(target, ['reset', '--hard', 'HEAD'], 120_000).catch((error: unknown) => rollbackErrors.push(errorMessage(error)))
        await runGit(target, ['clean', '-fd'], 120_000).catch((error: unknown) => rollbackErrors.push(errorMessage(error)))
        await runGit(source, ['stash', 'apply', '--index', stashOid], 120_000)
          .catch((error: unknown) => rollbackErrors.push(errorMessage(error)))
        const recoveryStash = await dropTopStashIf(source, stashOid) ? null : stashOid
        const detail = rollbackErrors.length > 0 ? ` Rollback warnings: ${rollbackErrors.join('; ')}` : ''
        throw new Error(`Changes could not be applied to the target; the source was restored.${detail}${recoveryStash ? ` Recovery stash: ${recoveryStash}` : ''}`, { cause: applyError })
      }

      if (!(await hasChanges(target))) throw new Error('Git applied the handoff without producing target changes.')
      const dropped = await dropTopStashIf(source, stashOid)
      return { moved: true, recoveryStash: dropped ? null : stashOid }
    } finally {
      this.#handoffInProgress = false
    }
  }

  #requireProject(projectId: string) {
    const project = this.#database.getProject(projectId)
    if (!project) throw new Error('Project not found.')
    return project
  }

  #requireManaged(worktreeId: string) {
    const worktree = this.#database.getManagedWorktree(worktreeId)
    if (!worktree) throw new Error('Managed worktree not found.')
    const project = this.#requireProject(worktree.projectId)
    const expectedPrefix = join(this.#managedRoot, worktree.projectId) + sep
    if (!worktree.path.startsWith(expectedPrefix)) throw new Error('Managed worktree path failed its ownership check.')
    return { project, worktree }
  }

  #contextPath(projectId: string, projectPath: string, worktreeId: string | null): string {
    if (!worktreeId) return projectPath
    const worktree = this.#database.getManagedWorktree(worktreeId)
    if (worktree?.projectId !== projectId) throw new Error('Managed worktree not found for this project.')
    if (!existsSync(worktree.path)) throw new Error('Managed worktree is missing.')
    return worktree.path
  }
}

async function hasChanges(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  return result.stdout.length > 0
}

async function hasUnmergedChanges(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ['diff', '--name-only', '--diff-filter=U', '-z'])
  return result.stdout.length > 0
}

async function dropTopStashIf(cwd: string, expectedOid: string): Promise<boolean> {
  const current = await runGit(cwd, ['rev-parse', '--verify', 'refs/stash']).catch(() => null)
  if (current?.stdout.trim() !== expectedOid) return false
  await runGit(cwd, ['stash', 'drop', 'stash@{0}'])
  return true
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function copyWorktreeIncludes(sourceRoot: string, targetRoot: string): Promise<number> {
  const includePath = join(sourceRoot, '.worktreeinclude')
  if (!existsSync(includePath)) return 0
  const patterns = readFileSync(includePath, 'utf8').split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  if (patterns.length === 0) return 0
  const result = await runGit(sourceRoot, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'])
  let totalBytes = 0
  let copied = 0
  for (const path of result.stdout.split('\0')) {
    if (!path || !matchesInclude(path, patterns)) continue
    const safePath = validateRelativePath(path)
    const source = join(sourceRoot, safePath)
    const metadata = lstatSync(source)
    if (!metadata.isFile() || metadata.isSymbolicLink()) continue
    if (metadata.size > MAX_INCLUDE_FILE_BYTES) throw new Error(`Included worktree file exceeds 10 MiB: ${safePath}`)
    totalBytes += metadata.size
    if (totalBytes > MAX_INCLUDE_TOTAL_BYTES) throw new Error('Included worktree files exceed the 100 MiB total limit.')
    const destination = join(targetRoot, safePath)
    mkdirSync(dirname(destination), { mode: 0o700, recursive: true })
    copyFileSync(source, destination)
    copied += 1
  }
  return copied
}

function matchesInclude(path: string, patterns: string[]): boolean {
  let included = false
  for (const rawPattern of patterns) {
    const negated = rawPattern.startsWith('!')
    const pattern = negated ? rawPattern.slice(1) : rawPattern
    if (!pattern || isAbsolute(pattern) || pattern.includes('\0') || pattern.split('/').includes('..')) continue
    if (matchesGlob(path, pattern)) included = !negated
  }
  return included
}

function validateRelativePath(path: string): string {
  if (isAbsolute(path) || path.includes('\0')) throw new Error('Worktree include path must be relative.')
  const value = normalize(path)
  if (value === '..' || value.startsWith(`..${sep}`)) throw new Error('Worktree include path escapes the repository.')
  return value
}

function validateRef(value: string, label: string): string {
  if (!/^[A-Za-z0-9._/@{}^~+-]{1,255}$/.test(value) || value.startsWith('-') || value.includes('..')) {
    throw new Error(`Invalid worktree ${label}.`)
  }
  return value
}

type WorktreeMetadata = { headOid: string | null; locked: boolean }

function worktreePathKey(path: string): string {
  // Git for Windows may report the same directory through its 8.3 short path
  // while Node stores the long path (or vice versa). Resolve both spellings to
  // the operating-system file identity before applying case folding.
  let key: string
  try {
    key = realpathSync.native(path)
  } catch {
    key = resolve(path)
  }
  return process.platform === 'win32' ? key.toLowerCase() : key
}

async function readWorktreeMetadata(repositoryPath: string): Promise<Map<string, WorktreeMetadata>> {
  const result = await runGit(repositoryPath, ['worktree', 'list', '--porcelain'])
  const worktrees = new Map<string, WorktreeMetadata>()
  let path: string | null = null
  let headOid: string | null = null
  let locked = false
  const flush = (): void => {
    if (path) worktrees.set(worktreePathKey(path), { headOid, locked })
    path = null
    headOid = null
    locked = false
  }
  for (const line of `${result.stdout}\n`.split(/\r?\n/u)) {
    if (!line) { flush(); continue }
    if (line.startsWith('worktree ')) path = line.slice(9)
    else if (line.startsWith('HEAD ')) headOid = line.slice(5)
    else if (line === 'locked' || line.startsWith('locked ')) locked = true
  }
  return worktrees
}

async function runGit(cwd: string, args: string[], timeout = 30_000): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync('git', args, {
      cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    })
  } catch (error) {
    const value = error as Error & { stderr?: string; stdout?: string }
    throw new Error((value.stderr ?? value.stdout ?? value.message).trim(), { cause: error })
  }
}
