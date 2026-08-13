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
export type WorktreeHandoffPhase =
  | 'preparing'
  | 'stashed'
  | 'applying'
  | 'applied'
  | 'rollingBack'
  | 'needsAttention'
export type WorktreeHandoffRecovery = {
  id: string
  projectId: string
  threadId: string
  sourceWorktreeId: string | null
  targetWorktreeId: string | null
  recoveryRef: string
  stashOid: string | null
  sourceHeadOid: string
  sourceTreeOid: string
  sourceIndexOid: string
  targetHeadOid: string
  targetCleanTreeOid: string
  targetTreeOid: string | null
  targetIndexOid: string | null
  phase: WorktreeHandoffPhase
  createdAt: string
  updatedAt: string
  error: string | null
}
export type WorktreeHandoffRecoverySummary = Pick<WorktreeHandoffRecovery,
  | 'id'
  | 'projectId'
  | 'threadId'
  | 'sourceWorktreeId'
  | 'targetWorktreeId'
  | 'phase'
  | 'createdAt'
  | 'updatedAt'
  | 'error'
>
export type ListWorktreeRecoveriesInput = { projectId: string }
export type RetryWorktreeRecoveryInput = { recoveryId: string }
export type MoveWorktreeChangesInput = {
  projectId: string
  threadId: string
  sourceWorktreeId: string | null
  targetWorktreeId: string | null
}
export type MoveWorktreeChangesResult = {
  moved: boolean
  operationId: string | null
}
