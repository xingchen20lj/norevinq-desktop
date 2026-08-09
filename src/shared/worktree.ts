export type ManagedWorktree = {
  id: string
  projectId: string
  path: string
  baseRef: string
  branch: string | null
  headOid: string | null
  locked: boolean
  missing: boolean
  createdAt: string
  copiedIncludeFiles: number
}

export type ListWorktreesInput = { projectId: string }
export type CreateWorktreeInput = {
  projectId: string
  baseRef?: string
  branch?: string
  copyIncludes?: boolean
}
export type WorktreeActionInput = { worktreeId: string }
export type RemoveWorktreeInput = { worktreeId: string; force?: boolean }
