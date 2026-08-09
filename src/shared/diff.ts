export type DiffMode = 'working' | 'staged'
export type DiffFile = {
  path: string
  oldPath: string | null
  status: string
  additions: number
  deletions: number
  binary: boolean
  patch: string
  truncated: boolean
}
export type DiffSnapshot = {
  projectId: string
  mode: DiffMode
  files: DiffFile[]
  totalAdditions: number
  totalDeletions: number
  truncated: boolean
}
export type GetDiffInput = { projectId: string; mode: DiffMode }
