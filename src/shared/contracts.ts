import type { CodexRuntimeSnapshot, RuntimeSubscription } from './runtime.js'
import type {
  ConversationSnapshot,
  ConversationSubscription,
  InterruptTurnInput,
  LoadProjectConversationsInput,
  ResolveApprovalInput,
  SelectConversationInput,
  StartConversationInput,
  StartTurnInput,
  SteerTurnInput,
} from './conversation.js'
import type { ProviderStatus, SaveDeepSeekCredentialInput } from './providers.js'
import type {
  GitCommitInput,
  GitPathsInput,
  GitProjectInput,
  GitPushInput,
  GitRepositorySnapshot,
} from './git.js'
import type {
  CreateWorktreeInput,
  ListWorktreesInput,
  ManagedWorktree,
  RemoveWorktreeInput,
  WorktreeActionInput,
} from './worktree.js'
import type { ApplyDiffHunkInput, DiffSnapshot, GetDiffInput } from './diff.js'

export const IPC_CHANNELS = {
  bootstrap: 'app:bootstrap',
  selectProject: 'project:select',
  removeProject: 'project:remove',
  runtimeStatus: 'runtime:status',
  runtimeRestart: 'runtime:restart',
  runtimeStatusChanged: 'runtime:status-changed',
  conversationsLoad: 'conversations:load',
  conversationSelect: 'conversation:select',
  conversationStart: 'conversation:start',
  conversationTurnStart: 'conversation:turn-start',
  conversationSteer: 'conversation:steer',
  conversationInterrupt: 'conversation:interrupt',
  conversationApprovalResolve: 'conversation:approval-resolve',
  conversationChanged: 'conversation:changed',
  providerDeepSeekSave: 'provider:deepseek-save',
  providerDeepSeekDelete: 'provider:deepseek-delete',
  gitStatus: 'git:status',
  gitInitialize: 'git:initialize',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitCommit: 'git:commit',
  gitPush: 'git:push',
  worktreeList: 'worktree:list',
  worktreeCreate: 'worktree:create',
  worktreeLock: 'worktree:lock',
  worktreeUnlock: 'worktree:unlock',
  worktreeRemove: 'worktree:remove',
  diffGet: 'diff:get',
  diffHunkApply: 'diff:hunk-apply',
} as const

export type ProjectSummary = {
  id: string
  name: string
  path: string
  trusted: boolean
  lastOpenedAt: string
}

export type BootstrapState = {
  appVersion: string
  platform: string
  projects: ProjectSummary[]
  runtime: CodexRuntimeSnapshot
  providers: ProviderStatus
}

export type RemoveProjectInput = {
  projectId: string
}

export type AsterDesktopApi = {
  getBootstrapState: () => Promise<BootstrapState>
  selectProject: () => Promise<ProjectSummary | null>
  removeProject: (input: RemoveProjectInput) => Promise<void>
  getRuntimeStatus: () => Promise<CodexRuntimeSnapshot>
  restartRuntime: () => Promise<CodexRuntimeSnapshot>
  onRuntimeStatus: (subscription: RuntimeSubscription) => () => void
  loadProjectConversations: (input: LoadProjectConversationsInput) => Promise<ConversationSnapshot>
  selectConversation: (input: SelectConversationInput) => Promise<ConversationSnapshot>
  startConversation: (input: StartConversationInput) => Promise<ConversationSnapshot>
  startTurn: (input: StartTurnInput) => Promise<ConversationSnapshot>
  steerTurn: (input: SteerTurnInput) => Promise<ConversationSnapshot>
  interruptTurn: (input: InterruptTurnInput) => Promise<ConversationSnapshot>
  resolveApproval: (input: ResolveApprovalInput) => Promise<ConversationSnapshot>
  onConversationChanged: (subscription: ConversationSubscription) => () => void
  saveDeepSeekCredential: (input: SaveDeepSeekCredentialInput) => Promise<{
    providers: ProviderStatus
    runtime: CodexRuntimeSnapshot
  }>
  deleteDeepSeekCredential: () => Promise<{ providers: ProviderStatus; runtime: CodexRuntimeSnapshot }>
  getGitStatus: (input: GitProjectInput) => Promise<GitRepositorySnapshot>
  initializeGit: (input: GitProjectInput) => Promise<GitRepositorySnapshot>
  stageGitPaths: (input: GitPathsInput) => Promise<GitRepositorySnapshot>
  unstageGitPaths: (input: GitPathsInput) => Promise<GitRepositorySnapshot>
  commitGit: (input: GitCommitInput) => Promise<GitRepositorySnapshot>
  pushGit: (input: GitPushInput) => Promise<GitRepositorySnapshot>
  listWorktrees: (input: ListWorktreesInput) => Promise<ManagedWorktree[]>
  createWorktree: (input: CreateWorktreeInput) => Promise<ManagedWorktree>
  lockWorktree: (input: WorktreeActionInput) => Promise<ManagedWorktree[]>
  unlockWorktree: (input: WorktreeActionInput) => Promise<ManagedWorktree[]>
  removeWorktree: (input: RemoveWorktreeInput) => Promise<ManagedWorktree[]>
  getDiff: (input: GetDiffInput) => Promise<DiffSnapshot>
  applyDiffHunk: (input: ApplyDiffHunkInput) => Promise<DiffSnapshot>
}
