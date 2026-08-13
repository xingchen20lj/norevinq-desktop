export type ManagedWorktree = {
  id: string
  projectId: string
  path: string
  baseRef: string
  baseOid: string | null
  branch: string | null
  headOid: string | null
  locked: boolean
  missing: boolean
  createdAt: string
  copiedIncludeFiles: number
}

export type ListWorktreesInput = { projectId: string }
export type WorktreeBaseKind = 'current' | 'localBranch' | 'remoteBranch' | 'tag'
export type WorktreeBase = {
  ref: string
  label: string
  kind: WorktreeBaseKind
  oid: string
}
export type WorktreeBaseCatalog = {
  projectId: string
  repositoryInitialized: boolean
  bases: WorktreeBase[]
  truncated: boolean
}
export type ListWorktreeBasesInput = { projectId: string }
export type CreateWorktreeInput = {
  projectId: string
  baseRef?: string
  expectedBaseOid?: string
  branch?: string
  copyIncludes?: boolean
}
export type WorktreeActionInput = { worktreeId: string }
export type RemoveWorktreeInput = { worktreeId: string; force?: boolean }
export type MoveWorktreeChangesInput = {
  projectId: string
  sourceWorktreeId: string | null
  targetWorktreeId: string | null
}
export type MoveWorktreeChangesResult = {
  moved: boolean
  recoveryStash: string | null
}
