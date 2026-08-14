import { execFile, type ExecException } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { isAbsolute, join, normalize, sep } from 'node:path'
import { promisify } from 'node:util'
import type {
  GitCommitInput,
  GitDiscardInput,
  GitDiscardRestoreInput,
  GitDiscardSnapshot,
  GitPathsInput,
  GitProjectInput,
  GitPushInput,
  GitRemote,
  GitRepositorySnapshot,
} from '../../shared/git.js'
import type { StateDatabase } from '../state/database.js'
import { parsePorcelainV2Z } from './statusParser.js'

const execFileAsync = promisify(execFile)
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30_000
const DISCARD_REF_PREFIX = 'refs/norevinq/discards/'
const MAX_DISCARD_SNAPSHOTS = 32

export class GitService {
  readonly #database: StateDatabase
  readonly #discardOperations = new Set<string>()

  constructor(database: StateDatabase) {
    this.#database = database
  }

  async getStatus(input: GitProjectInput): Promise<GitRepositorySnapshot> {
    const project = this.#requireProject(input.projectId)
    try {
      const rootResult = await this.#git(project.path, ['rev-parse', '--show-toplevel'])
      const root = rootResult.stdout.trim()
      const [statusResult, remoteResult, discards] = await Promise.all([
        this.#git(project.path, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']),
        this.#git(project.path, ['remote', '-v']),
        this.#listDiscards(project.path),
      ])
      return {
        projectId: input.projectId,
        initialized: true,
        root,
        ...parsePorcelainV2Z(statusResult.stdout),
        discards,
        remotes: parseRemotes(remoteResult.stdout),
        error: null,
      }
    } catch (error) {
      if (isNotRepository(error)) return emptySnapshot(input.projectId)
      throw error
    }
  }

  async initialize(input: GitProjectInput): Promise<GitRepositorySnapshot> {
    const project = this.#requireProject(input.projectId)
    await this.#git(project.path, ['init', '-b', 'main'])
    return this.getStatus(input)
  }

  async stage(input: GitPathsInput): Promise<GitRepositorySnapshot> {
    const project = this.#requireProject(input.projectId)
    const paths = validatePaths(input.paths)
    await this.#git(project.path, ['add', '--', ...paths])
    return this.getStatus(input)
  }

  async unstage(input: GitPathsInput): Promise<GitRepositorySnapshot> {
    const project = this.#requireProject(input.projectId)
    const paths = validatePaths(input.paths)
    await this.#git(project.path, ['restore', '--staged', '--', ...paths])
    return this.getStatus(input)
  }

  async discardFile(input: GitDiscardInput): Promise<GitRepositorySnapshot> {
    const project = this.#requireProject(input.projectId)
    return this.#withDiscardLock(project.path, () => this.#discardFile(input, project.path))
  }

  async #discardFile(input: GitDiscardInput, projectPath: string): Promise<GitRepositorySnapshot> {
    const [path] = validatePaths([input.path])
    if (!path) throw new Error('A valid Git path is required.')
    const status = await this.getStatus({ projectId: input.projectId })
    const file = status.files.find((candidate) => candidate.path === path)
    if (!file || file.kind === 'ignored' || file.kind === 'unmerged') {
      throw new Error('Only a changed, non-conflicted file can be discarded.')
    }
    if (status.discards.length >= MAX_DISCARD_SNAPSHOTS) {
      throw new Error(`Recoverable discard limit reached (${String(MAX_DISCARD_SNAPSHOTS)}). Restore an earlier discard first.`)
    }
    const paths = validatePaths([file.path, ...(file.originalPath ? [file.originalPath] : [])])
    const trackedAtHead = await Promise.all(paths.map(async (candidate) => ({
      path: candidate,
      tracked: await this.#isTrackedAtHead(projectPath, candidate),
    })))
    const id = randomUUID()
    const metadata = Buffer.from(JSON.stringify({ path: file.path, paths: trackedAtHead }), 'utf8').toString('base64url')
    const subject = `norevinq-discard-v1:${id}:${metadata}`
    // For a rename, passing both the destination and the now-missing source
    // makes `git stash` reject the pathspec. Capturing the destination still
    // records both sides of the rename in the stash commit; Git only leaves
    // the source deletion behind, which we restore after securing the ref.
    await this.#git(projectPath, ['stash', 'push', '--include-untracked', '--message', subject, '--', file.path])
    const stash = await this.#findStashBySubject(projectPath, subject)
    if (!stash) throw new Error('Git did not create a recoverable discard snapshot.')
    const discardRef = `${DISCARD_REF_PREFIX}${id}`
    await this.#git(projectPath, ['update-ref', discardRef, stash.oid])
    const verified = await this.#resolveOptionalRef(projectPath, stash.selector)
    if (verified !== stash.oid) throw new Error('Recoverable discard was secured, but its temporary stash entry changed unexpectedly.')
    await this.#git(projectPath, ['stash', 'drop', stash.selector])
    const renameSources = trackedAtHead
      .filter(({ path: candidate, tracked }) => tracked && candidate !== file.path)
      .map(({ path: candidate }) => candidate)
    if (renameSources.length > 0) {
      await this.#git(projectPath, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...renameSources])
    }
    return this.getStatus({ projectId: input.projectId })
  }

  async restoreDiscard(input: GitDiscardRestoreInput): Promise<GitRepositorySnapshot> {
    const project = this.#requireProject(input.projectId)
    return this.#withDiscardLock(project.path, () => this.#restoreDiscard(input, project.path))
  }

  async #restoreDiscard(input: GitDiscardRestoreInput, projectPath: string): Promise<GitRepositorySnapshot> {
    const discard = (await this.#listDiscards(projectPath)).find(({ id }) => id === input.discardId)
    if (!discard || !/^[0-9a-f-]{36}$/u.test(input.discardId)) throw new Error('Recoverable discard not found.')
    const metadata = await this.#readDiscardMetadata(projectPath, input.discardId)
    const current = await this.getStatus({ projectId: input.projectId })
    if (current.files.some((file) => metadata.paths.some(({ path }) => path === file.path || path === file.originalPath))) {
      throw new Error('Discard target has new changes. Commit, stage elsewhere, or clear them before restoring.')
    }
    for (const entry of metadata.paths) {
      if (!entry.tracked && pathExists(join(projectPath, entry.path))) {
        throw new Error('Discard target path is occupied. Remove it before restoring.')
      }
    }
    const ref = `${DISCARD_REF_PREFIX}${input.discardId}`
    // Keep the recovery ref on any apply failure. Git may leave conflict
    // markers behind; automatically cleaning them could erase a concurrent
    // edit made outside Norevinq between the clean-target check and this apply.
    await this.#git(projectPath, ['stash', 'apply', '--index', ref], 120_000)
    await this.#git(projectPath, ['update-ref', '-d', ref])
    return this.getStatus({ projectId: input.projectId })
  }

  async commit(input: GitCommitInput): Promise<GitRepositorySnapshot> {
    const project = this.#requireProject(input.projectId)
    const message = input.message.trim()
    if (!message) throw new Error('Commit message cannot be empty.')
    if (message.length > 5_000) throw new Error('Commit message exceeds 5,000 characters.')
    await this.#git(project.path, ['commit', '-m', message], 120_000)
    return this.getStatus({ projectId: input.projectId })
  }

  async push(input: GitPushInput): Promise<GitRepositorySnapshot> {
    const project = this.#requireProject(input.projectId)
    const args = ['push']
    if (input.setUpstream) args.push('--set-upstream')
    if (input.remote) args.push(validateRef(input.remote, 'remote'))
    if (input.branch) args.push(validateRef(input.branch, 'branch'))
    await this.#git(project.path, args, 120_000)
    return this.getStatus({ projectId: input.projectId })
  }

  #requireProject(projectId: string) {
    const project = this.#database.getProject(projectId)
    if (!project) throw new Error('Project not found.')
    return project
  }

  async #git(cwd: string, args: string[], timeout = DEFAULT_TIMEOUT_MS): Promise<{ stdout: string; stderr: string }> {
    try {
      return await execFileAsync('git', args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: MAX_OUTPUT_BYTES,
        timeout,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
      })
    } catch (error) {
      throw toGitError(error)
    }
  }

  async #listDiscards(cwd: string): Promise<GitDiscardSnapshot[]> {
    const result = await this.#git(cwd, ['for-each-ref', '--format=%(refname:short)%00%(creatordate:iso-strict)%00%(subject)', DISCARD_REF_PREFIX])
    const snapshots: GitDiscardSnapshot[] = []
    for (const line of result.stdout.split('\n')) {
      if (!line) continue
      const [shortRef, createdAt, subject] = line.split('\0')
      const id = shortRef?.slice('norevinq/discards/'.length)
      const match = subject ? /norevinq-discard-v1:[0-9a-f-]{36}:([A-Za-z0-9_-]+)/u.exec(subject) : null
      const encoded = match?.[1]
      if (!id || !createdAt || !encoded || !/^[0-9a-f-]{36}$/u.test(id)) continue
      try {
        const parsed = parseDiscardMetadata(encoded)
        snapshots.push({ id, path: parsed.path, createdAt })
      } catch { /* Ignore malformed refs outside Norevinq's format. */ }
    }
    return snapshots.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  async #readDiscardMetadata(cwd: string, id: string): Promise<DiscardMetadata> {
    const result = await this.#git(cwd, ['show', '-s', '--format=%s', `${DISCARD_REF_PREFIX}${id}`])
    const encoded = /norevinq-discard-v1:[0-9a-f-]{36}:([A-Za-z0-9_-]+)/u.exec(result.stdout.trim())?.[1]
    if (!encoded) throw new Error('Recoverable discard metadata is invalid.')
    return parseDiscardMetadata(encoded)
  }

  async #resolveOptionalRef(cwd: string, ref: string): Promise<string | null> {
    try { return (await this.#git(cwd, ['rev-parse', '--verify', ref])).stdout.trim() || null }
    catch { return null }
  }

  async #isTrackedAtHead(cwd: string, path: string): Promise<boolean> {
    try { await this.#git(cwd, ['cat-file', '-e', `HEAD:${path}`]); return true }
    catch { return false }
  }

  async #findStashBySubject(cwd: string, subject: string): Promise<{ selector: string; oid: string } | null> {
    const result = await this.#git(cwd, ['stash', 'list', '--format=%gd%x00%H%x00%gs'])
    for (const line of result.stdout.split('\n')) {
      const [selector, oid, candidateSubject] = line.split('\0')
      if (selector && oid && candidateSubject?.endsWith(subject)) return { selector, oid }
    }
    return null
  }

  async #withDiscardLock<T>(projectPath: string, operation: () => Promise<T>): Promise<T> {
    if (this.#discardOperations.has(projectPath)) throw new Error('Another recoverable discard operation is already running.')
    this.#discardOperations.add(projectPath)
    try { return await operation() }
    finally { this.#discardOperations.delete(projectPath) }
  }
}

type DiscardPathMetadata = { path: string; tracked: boolean }
type DiscardMetadata = { path: string; paths: DiscardPathMetadata[] }

function pathExists(path: string): boolean {
  try { lstatSync(path); return true }
  catch { return false }
}

function parseDiscardMetadata(encoded: string): DiscardMetadata {
  const value: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  if (!value || typeof value !== 'object') throw new Error('Invalid discard metadata.')
  const record = value as { path?: unknown; paths?: unknown }
  if (typeof record.path !== 'string' || !Array.isArray(record.paths)) throw new Error('Invalid discard metadata.')
  const [path] = validatePaths([record.path])
  const paths = record.paths.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid discard metadata.')
    const candidate = entry as { path?: unknown; tracked?: unknown }
    if (typeof candidate.path !== 'string' || typeof candidate.tracked !== 'boolean') throw new Error('Invalid discard metadata.')
    const [normalizedPath] = validatePaths([candidate.path])
    if (!normalizedPath) throw new Error('Invalid discard metadata.')
    return { path: normalizedPath, tracked: candidate.tracked }
  })
  if (!path || paths.length === 0 || paths.length > 2) throw new Error('Invalid discard metadata.')
  return { path, paths }
}

function validatePaths(paths: string[]): string[] {
  if (paths.length === 0 || paths.length > 10_000) throw new Error('At least one valid path is required.')
  return [...new Set(paths.map((path) => {
    if (!path || path.includes('\0') || isAbsolute(path)) throw new Error('Git paths must be project-relative.')
    const normalized = normalize(path)
    if (normalized === '..' || normalized.startsWith(`..${sep}`)) throw new Error('Git path escapes the project root.')
    return normalized
  }))]
}

function validateRef(value: string, label: string): string {
  if (!/^[A-Za-z0-9._/-]{1,255}$/.test(value) || value.startsWith('-') || value.includes('..')) {
    throw new Error(`Invalid Git ${label}.`)
  }
  return value
}

function parseRemotes(output: string): GitRemote[] {
  const remotes = new Map<string, GitRemote>()
  for (const line of output.split('\n')) {
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line)
    if (!match?.[1] || !match[2] || !match[3]) continue
    const current = remotes.get(match[1]) ?? { name: match[1], fetchUrl: null, pushUrl: null }
    const url = sanitizeRemoteUrl(match[2])
    if (match[3] === 'fetch') current.fetchUrl = url
    else current.pushUrl = url
    remotes.set(match[1], current)
  }
  return [...remotes.values()]
}

function sanitizeRemoteUrl(value: string): string {
  if (!value.includes('://')) return value
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return '[REDACTED INVALID REMOTE URL]'
  }
}

function emptySnapshot(projectId: string): GitRepositorySnapshot {
  return {
    projectId,
    initialized: false,
    root: null,
    branch: null,
    detached: false,
    headOid: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
    discards: [],
    remotes: [],
    error: null,
  }
}

function isNotRepository(error: unknown): boolean {
  return error instanceof Error && /not a git repository/i.test(error.message)
}

function toGitError(error: unknown): Error {
  const value = error as ExecException & { stderr?: string; stdout?: string; killed?: boolean }
  const details = (value.stderr ?? value.stdout ?? value.message).trim()
  return new Error(details.length > 4_000 ? `${details.slice(0, 4_000)}…` : details)
}
