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
