import { spawn } from 'node:child_process'
import type {
  CreateGitHubPullRequestInput,
  CreateGitHubPullRequestResult,
  GitHubPullRequest,
  GitHubRepositoryStatus,
  GitHubStatusInput,
  GitRemote,
} from '../../shared/git.js'
import { redactString } from '../logging/redact.js'
import type { StateDatabase } from '../state/database.js'
import type { GitService } from './gitService.js'

const DEFAULT_TIMEOUT_MS = 30_000
const CREATE_TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 1024 * 1024
const MAX_ERROR_CHARS = 4_000
const REPOSITORY_COMPONENT = /^[A-Za-z0-9_.-]{1,100}$/u
const REF = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/@{}^~+/-]{1,255}$/u

type CommandResult = { stdout: string; stderr: string }
type CommandOptions = { cwd: string; timeoutMs?: number; stdin?: string }
export type GitHubCommandRunner = (
  executable: string,
  args: readonly string[],
  options: CommandOptions,
) => Promise<CommandResult>

export type GitHubServiceOptions = {
  ghBinary?: string
  runCommand?: GitHubCommandRunner
}

type RepositoryReference = {
  host: string
  owner: string
  name: string
  remoteName: string
}

type RepositoryDetails = RepositoryReference & {
  repository: string
  repositoryUrl: string
  defaultBranch: string
}

type PullRequestJson = {
  number?: unknown
  title?: unknown
  url?: unknown
  state?: unknown
  isDraft?: unknown
  baseRefName?: unknown
  headRefName?: unknown
}

export class GitHubService {
  readonly #database: StateDatabase
  readonly #git: Pick<GitService, 'getStatus' | 'push'>
  readonly #ghBinary: string
  readonly #runCommand: GitHubCommandRunner
  readonly #activeCreates = new Map<string, Promise<CreateGitHubPullRequestResult>>()

  constructor(
    database: StateDatabase,
    git: Pick<GitService, 'getStatus' | 'push'>,
    options: GitHubServiceOptions = {},
  ) {
    this.#database = database
    this.#git = git
    this.#ghBinary = options.ghBinary ?? 'gh'
    this.#runCommand = options.runCommand ?? runGitHubCommand
  }

  async getStatus(input: GitHubStatusInput): Promise<GitHubRepositoryStatus> {
    const project = this.#database.getProject(input.projectId)
    if (!project) throw new Error('Project not found.')
    const repository = await this.#git.getStatus({ projectId: input.projectId })
    const initial = emptyStatus(input.projectId, repository.files.length)
    if (!repository.initialized) return { ...initial, error: '请先初始化 Git 仓库。' }
    if (!repository.branch || repository.detached) {
      return { ...initial, error: 'Detached HEAD 不能创建 Pull Request；请先切换到命名分支。' }
    }
    if (!repository.headOid) return { ...initial, branch: repository.branch, error: '当前分支还没有提交。' }

    let version: string
    try {
      version = parseVersion((await this.#gh(project.path, ['--version'])).stdout)
    } catch (error) {
      return { ...initial, branch: repository.branch, error: `GitHub CLI 不可用：${safeError(error)}` }
    }

    let selected: { push: RepositoryReference; base: RepositoryReference }
    try {
      selected = selectRepositories(repository.remotes, repository.upstream, input)
    } catch (error) {
      return { ...initial, available: true, version, branch: repository.branch, error: safeError(error) }
    }
    if (selected.push.host !== selected.base.host) {
      return {
        ...initial,
        available: true,
        version,
        branch: repository.branch,
        pushRemote: selected.push.remoteName,
        baseRemote: selected.base.remoteName,
        error: 'Head 与 base 仓库必须位于同一个 GitHub 主机。',
      }
    }

    const partial = {
      ...initial,
      available: true,
      version,
      host: selected.base.host,
      branch: repository.branch,
      pushRemote: selected.push.remoteName,
      baseRemote: selected.base.remoteName,
      pushRepository: `${selected.push.owner}/${selected.push.name}`,
      baseRepository: `${selected.base.owner}/${selected.base.name}`,
    }
    try {
      await this.#gh(project.path, ['auth', 'status', '--hostname', selected.base.host])
    } catch (error) {
      return { ...partial, authenticated: false, error: `GitHub CLI 尚未登录 ${selected.base.host}：${safeError(error)}` }
    }

    try {
      const base = await this.#readRepository(project.path, selected.base)
      const pullRequest = await this.#findOpenPullRequest(project.path, base, selected.push.owner, repository.branch)
      return {
        ...partial,
        authenticated: true,
        baseRepository: base.repository,
        repositoryUrl: base.repositoryUrl,
        defaultBranch: base.defaultBranch,
        existingPullRequest: pullRequest,
        error: null,
      }
    } catch (error) {
      return { ...partial, authenticated: true, error: safeError(error) }
    }
  }

  createPullRequest(input: CreateGitHubPullRequestInput): Promise<CreateGitHubPullRequestResult> {
    const active = this.#activeCreates.get(input.projectId)
    if (active) return active
    const pending = this.#createPullRequest(input).finally(() => {
      if (this.#activeCreates.get(input.projectId) === pending) this.#activeCreates.delete(input.projectId)
    })
    this.#activeCreates.set(input.projectId, pending)
    return pending
  }

  async #createPullRequest(input: CreateGitHubPullRequestInput): Promise<CreateGitHubPullRequestResult> {
    if (!input.confirmed) throw new Error('Creating a Pull Request requires explicit confirmation.')
    const title = input.title.trim()
    const body = input.body.trim()
    if (!title || title.length > 256) throw new Error('Pull Request title must contain 1–256 characters.')
    if (body.length > 65_536) throw new Error('Pull Request body exceeds 65,536 characters.')

    const before = await this.getStatus(input)
    if (!before.available || !before.authenticated || before.error) {
      throw new Error(before.error ?? 'GitHub Pull Request preflight failed.')
    }
    if (!before.branch || !before.pushRemote || !before.baseRemote || !before.host || !before.pushRepository || !before.baseRepository) {
      throw new Error('GitHub repository preflight returned incomplete data.')
    }
    if (before.existingPullRequest) {
      return { status: before, pullRequest: before.existingPullRequest, created: false, pushed: false }
    }
    const baseBranch = validateRef(input.baseBranch ?? before.defaultBranch, 'base branch')
    if (baseBranch === before.branch) throw new Error('Base branch must differ from the current branch.')

    await this.#git.push({
      projectId: input.projectId,
      remote: before.pushRemote,
      branch: before.branch,
      setUpstream: true,
    })

    const project = this.#database.getProject(input.projectId)
    if (!project) throw new Error('Project not found.')
    const pushRepository = parseRepositoryName(before.pushRepository)
    const head = `${pushRepository.owner}:${before.branch}`
    const args = [
      'pr', 'create',
      '--repo', repositorySpecifier(before.host, before.baseRepository),
      '--base', baseBranch,
      '--head', head,
      '--title', title,
      '--body-file', '-',
    ]
    if (input.draft) args.push('--draft')
    await this.#gh(project.path, args, CREATE_TIMEOUT_MS, body)

    const after = await this.getStatus(input)
    if (after.error || !after.existingPullRequest) {
      throw new Error(after.error ?? 'Pull Request may have been created, but GitHub did not return it during verification.')
    }
    return { status: after, pullRequest: after.existingPullRequest, created: true, pushed: true }
  }

  async #readRepository(cwd: string, reference: RepositoryReference): Promise<RepositoryDetails> {
    const result = await this.#gh(cwd, [
      'repo', 'view', repositorySpecifier(reference.host, `${reference.owner}/${reference.name}`),
      '--json', 'nameWithOwner,url,defaultBranchRef',
    ])
    const parsed = parseJsonObject(result.stdout, 'repository')
    const nameWithOwner = requireString(parsed.nameWithOwner, 'repository name')
    const canonical = parseRepositoryName(nameWithOwner)
    const defaultBranchRef = parsed.defaultBranchRef
    if (!defaultBranchRef || typeof defaultBranchRef !== 'object' || Array.isArray(defaultBranchRef)) {
      throw new Error('GitHub repository has no default branch.')
    }
    const defaultBranch = validateRef(
      requireString((defaultBranchRef as Record<string, unknown>).name, 'default branch'),
      'default branch',
    )
    const repositoryUrl = validateRepositoryUrl(requireString(parsed.url, 'repository URL'), reference.host, canonical)
    return {
      ...reference,
      owner: canonical.owner,
      name: canonical.name,
      repository: `${canonical.owner}/${canonical.name}`,
      repositoryUrl,
      defaultBranch,
    }
  }

  async #findOpenPullRequest(
    cwd: string,
    repository: RepositoryDetails,
    headOwner: string,
    branch: string,
  ): Promise<GitHubPullRequest | null> {
    const result = await this.#gh(cwd, [
      'pr', 'list',
      '--repo', repositorySpecifier(repository.host, repository.repository),
      '--head', `${headOwner}:${branch}`,
      '--state', 'open',
      '--limit', '1',
      '--json', 'number,title,url,state,isDraft,baseRefName,headRefName',
    ])
    const value: unknown = JSON.parse(result.stdout)
    if (!Array.isArray(value)) throw new Error('GitHub CLI returned an invalid Pull Request list.')
    const first = value[0] as PullRequestJson | undefined
    return first ? parsePullRequest(first, repository) : null
  }

  #gh(cwd: string, args: readonly string[], timeoutMs = DEFAULT_TIMEOUT_MS, stdin?: string): Promise<CommandResult> {
    return this.#runCommand(this.#ghBinary, args, { cwd, timeoutMs, ...(stdin === undefined ? {} : { stdin }) })
  }
}

export function runGitHubCommand(
  executable: string,
  args: readonly string[],
  options: CommandOptions,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: {
        ...githubEnvironment(process.env),
        GH_PROMPT_DISABLED: '1',
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C',
        NO_COLOR: '1',
        PAGER: 'cat',
      },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputBytes = 0
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      child.kill()
      finish(new Error('GitHub CLI timed out.'))
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    timeout.unref()

    function collect(target: Buffer[], chunk: Buffer): void {
      outputBytes += chunk.byteLength
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill()
        finish(new Error('GitHub CLI output exceeded 1 MiB.'))
        return
      }
      target.push(chunk)
    }
    function finish(error?: Error, result?: CommandResult): void {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) reject(error)
      else if (result) resolve(result)
    }

    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk))
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk))
    child.once('error', (error) => finish(error))
    child.once('close', (code, signal) => {
      if (settled) return
      const result = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }
      if (code === 0) finish(undefined, result)
      else finish(new Error(result.stderr.trim() || result.stdout.trim() || `GitHub CLI exited with ${signal ?? String(code)}.`))
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(options.stdin ?? '')
  })
}

function githubEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const key of [
    'APPDATA', 'COMSPEC', 'GH_CONFIG_DIR', 'GH_ENTERPRISE_TOKEN', 'GH_HOST', 'GH_TOKEN',
    'GITHUB_ENTERPRISE_TOKEN', 'GITHUB_TOKEN', 'HOME', 'HOMEDRIVE', 'HOMEPATH',
    'HTTP_PROXY', 'HTTPS_PROXY', 'LOCALAPPDATA', 'NO_PROXY', 'PATH', 'PATHEXT',
    'SSH_AUTH_SOCK', 'SSL_CERT_DIR', 'SSL_CERT_FILE', 'SystemRoot', 'TEMP', 'TMP',
    'TMPDIR', 'USERPROFILE', 'XDG_CONFIG_HOME', 'http_proxy', 'https_proxy', 'no_proxy',
  ]) {
    const value = source[key]
    if (value !== undefined) result[key] = value
  }
  return result
}

function emptyStatus(projectId: string, dirtyFileCount: number): GitHubRepositoryStatus {
  return {
    projectId,
    available: false,
    version: null,
    authenticated: false,
    host: null,
    branch: null,
    pushRemote: null,
    baseRemote: null,
    pushRepository: null,
    baseRepository: null,
    repositoryUrl: null,
    defaultBranch: null,
    dirtyFileCount,
    existingPullRequest: null,
    error: null,
  }
}

function selectRepositories(
  remotes: GitRemote[],
  upstream: string | null,
  input: GitHubStatusInput,
): { push: RepositoryReference; base: RepositoryReference } {
  if (remotes.length === 0) throw new Error('没有可用于 Pull Request 的 Git 远端。')
  const upstreamRemote = upstream?.split('/', 1)[0]
  const pushRemote = requireRemote(remotes, input.pushRemote ?? upstreamRemote ?? namedRemote(remotes, 'origin') ?? remotes[0]?.name)
  const baseRemote = requireRemote(remotes, input.baseRemote ?? namedRemote(remotes, 'upstream') ?? pushRemote.name)
  return { push: parseRemote(pushRemote), base: parseRemote(baseRemote) }
}

function namedRemote(remotes: GitRemote[], name: string): string | undefined {
  return remotes.find((remote) => remote.name === name)?.name
}

function requireRemote(remotes: GitRemote[], name: string | undefined): GitRemote {
  const remote = remotes.find((candidate) => candidate.name === name)
  if (!remote) throw new Error('所选 Git 远端不存在。')
  return remote
}

function parseRemote(remote: GitRemote): RepositoryReference {
  const value = remote.pushUrl ?? remote.fetchUrl
  if (!value) throw new Error(`Git 远端 ${remote.name} 没有 URL。`)
  const normalized = value.trim()
  let host: string
  let path: string
  const scp = /^(?:[^@\s]+@)?([^:/\s]+):(.+)$/u.exec(normalized)
  if (scp && !normalized.includes('://')) {
    host = scp[1] ?? ''
    path = scp[2] ?? ''
  } else {
    let url: URL
    try { url = new URL(normalized) }
    catch { throw new Error(`Git 远端 ${remote.name} 不是 GitHub HTTPS/SSH URL。`) }
    if (!['https:', 'ssh:'].includes(url.protocol)) {
      throw new Error(`Git 远端 ${remote.name} 必须使用 HTTPS 或 SSH。`)
    }
    host = url.hostname
    path = url.pathname.replace(/^\//u, '')
  }
  const segments = path.replace(/\.git$/iu, '').split('/').filter(Boolean)
  if (segments.length !== 2) throw new Error(`Git 远端 ${remote.name} 不是 owner/repository。`)
  const [owner, name] = segments
  if (!owner || !name || !REPOSITORY_COMPONENT.test(owner) || !REPOSITORY_COMPONENT.test(name)) {
    throw new Error(`Git 远端 ${remote.name} 包含无效仓库名称。`)
  }
  if (!host || host.includes('/') || host.includes('\\')) throw new Error('GitHub 主机无效。')
  return { host: host.toLowerCase(), owner, name, remoteName: remote.name }
}

function parseVersion(output: string): string {
  const first = output.split(/\r?\n/u)[0]?.trim()
  if (!first || first.length > 200 || !/^gh version \d+\.\d+\.\d+/u.test(first)) {
    throw new Error('GitHub CLI returned an invalid version string.')
  }
  return first.replace(/^gh version /u, '').split(' ')[0] ?? first
}

function parseJsonObject(output: string, label: string): Record<string, unknown> {
  const value: unknown = JSON.parse(output)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`GitHub CLI returned invalid ${label} JSON.`)
  return value as Record<string, unknown>
}

function parseRepositoryName(value: string | null): { owner: string; name: string } {
  if (!value) throw new Error('GitHub repository name is missing.')
  const [owner, name, extra] = value.split('/')
  if (extra || !owner || !name || !REPOSITORY_COMPONENT.test(owner) || !REPOSITORY_COMPONENT.test(name)) {
    throw new Error('GitHub repository name is invalid.')
  }
  return { owner, name }
}

function repositorySpecifier(host: string, repository: string): string {
  return host === 'github.com' ? repository : `${host}/${repository}`
}

function validateRepositoryUrl(
  value: string,
  host: string,
  repository: { owner: string; name: string },
): string {
  let url: URL
  try { url = new URL(value) }
  catch { throw new Error('GitHub returned an invalid repository URL.') }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== host) {
    throw new Error('GitHub repository URL did not match the authenticated host.')
  }
  const expected = `/${repository.owner}/${repository.name}`.toLowerCase()
  if (url.pathname.replace(/\/$/u, '').toLowerCase() !== expected) {
    throw new Error('GitHub repository URL did not match the selected repository.')
  }
  return url.toString()
}

function parsePullRequest(value: PullRequestJson, repository: RepositoryDetails): GitHubPullRequest {
  const number = value.number
  if (!Number.isSafeInteger(number) || (number as number) < 1) throw new Error('GitHub returned an invalid Pull Request number.')
  const title = requireString(value.title, 'Pull Request title')
  const rawUrl = requireString(value.url, 'Pull Request URL')
  let url: URL
  try { url = new URL(rawUrl) }
  catch { throw new Error('GitHub returned an invalid Pull Request URL.') }
  const expectedPath = `/${repository.owner}/${repository.name}/pull/${String(number)}`.toLowerCase()
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== repository.host || url.pathname.toLowerCase() !== expectedPath) {
    throw new Error('GitHub Pull Request URL did not match the selected repository.')
  }
  const state = typeof value.state === 'string' && ['OPEN', 'CLOSED', 'MERGED'].includes(value.state)
    ? value.state as GitHubPullRequest['state']
    : 'UNKNOWN'
  if (typeof value.isDraft !== 'boolean') throw new Error('GitHub returned an invalid draft state.')
  return {
    number: number as number,
    title,
    url: url.toString(),
    state,
    draft: value.isDraft,
    baseBranch: validateRef(requireString(value.baseRefName, 'base branch'), 'base branch'),
    headBranch: validateRef(requireString(value.headRefName, 'head branch'), 'head branch'),
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4_096) throw new Error(`GitHub returned an invalid ${label}.`)
  return value
}

function validateRef(value: string | null | undefined, label: string): string {
  if (!value || !REF.test(value)) throw new Error(`Invalid GitHub ${label}.`)
  return value
}

function safeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const safe = redactString(raw).trim()
  return safe.length > MAX_ERROR_CHARS ? `${safe.slice(0, MAX_ERROR_CHARS)}…` : safe
}
