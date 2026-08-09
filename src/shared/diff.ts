export type DiffMode = 'working' | 'staged'
export type DiffLineKind = 'context' | 'addition' | 'deletion' | 'metadata'
export type DiffLine = {
  kind: DiffLineKind
  content: string
  oldLine: number | null
  newLine: number | null
}
export type DiffHunk = {
  id: string
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}
export type DiffFile = {
  path: string
  oldPath: string | null
  status: string
  additions: number
  deletions: number
  binary: boolean
  patch: string
  truncated: boolean
  hunks: DiffHunk[]
}
export type DiffSnapshot = {
  id: string
  projectId: string
  mode: DiffMode
  files: DiffFile[]
  totalAdditions: number
  totalDeletions: number
  truncated: boolean
}
export type GetDiffInput = { projectId: string; mode: DiffMode }
export type DiffHunkAction = 'stage' | 'unstage' | 'revert'
export type ApplyDiffHunkInput = {
  projectId: string
  snapshotId: string
  hunkId: string
  action: DiffHunkAction
}
