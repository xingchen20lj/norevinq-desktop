export type GitFileStatus = {
  path: string
  originalPath: string | null
  indexStatus: string
  worktreeStatus: string
  kind: 'ordinary' | 'renamed' | 'unmerged' | 'untracked' | 'ignored'
}

export type GitRemote = {
  name: string
  fetchUrl: string | null
  pushUrl: string | null
}

export type GitRepositorySnapshot = {
  projectId: string
  initialized: boolean
  root: string | null
  branch: string | null
  detached: boolean
  headOid: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
  remotes: GitRemote[]
  error: string | null
}

export type GitProjectInput = { projectId: string }
export type GitPathsInput = { projectId: string; paths: string[] }
export type GitCommitInput = { projectId: string; message: string }
export type GitPushInput = { projectId: string; remote?: string; branch?: string; setUpstream?: boolean }

export type GitHubPullRequest = {
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED' | 'UNKNOWN'
  draft: boolean
  baseBranch: string
  headBranch: string
}

export type GitHubRepositoryStatus = {
  projectId: string
  available: boolean
  version: string | null
  authenticated: boolean
  host: string | null
  branch: string | null
  pushRemote: string | null
  baseRemote: string | null
  pushRepository: string | null
  baseRepository: string | null
  repositoryUrl: string | null
  defaultBranch: string | null
  dirtyFileCount: number
  existingPullRequest: GitHubPullRequest | null
  error: string | null
}

export type GitHubStatusInput = {
  projectId: string
  pushRemote?: string
  baseRemote?: string
}

export type CreateGitHubPullRequestInput = GitHubStatusInput & {
  title: string
  body: string
  baseBranch?: string
  draft: boolean
  confirmed: boolean
}

export type CreateGitHubPullRequestResult = {
  status: GitHubRepositoryStatus
  pullRequest: GitHubPullRequest
  created: boolean
  pushed: boolean
}
