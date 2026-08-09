import { execFile, type ExecException } from 'node:child_process'
import { isAbsolute, normalize, sep } from 'node:path'
import { promisify } from 'node:util'
import type {
  GitCommitInput,
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

export class GitService {
  readonly #database: StateDatabase

  constructor(database: StateDatabase) {
    this.#database = database
  }

  async getStatus(input: GitProjectInput): Promise<GitRepositorySnapshot> {
    const project = this.#requireProject(input.projectId)
    try {
      const rootResult = await this.#git(project.path, ['rev-parse', '--show-toplevel'])
      const root = rootResult.stdout.trim()
      const [statusResult, remoteResult] = await Promise.all([
        this.#git(project.path, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']),
        this.#git(project.path, ['remote', '-v']),
      ])
      return {
        projectId: input.projectId,
        initialized: true,
        root,
        ...parsePorcelainV2Z(statusResult.stdout),
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
    if (match[3] === 'fetch') current.fetchUrl = match[2]
    else current.pushUrl = match[2]
    remotes.set(match[1], current)
  }
  return [...remotes.values()]
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
