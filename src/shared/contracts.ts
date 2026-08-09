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
import type {
  CreateTerminalInput,
  ResizeTerminalInput,
  TerminalContext,
  TerminalSession,
  TerminalSessionInput,
  TerminalState,
  TerminalSubscription,
  WriteTerminalInput,
} from './terminal.js'
import type {
  IntegrationProjectInput,
  IntegrationSnapshot,
  IntegrationSubscription,
  McpResourceReadInput,
  McpResourceReadResult,
  McpServerInput,
  McpToolCallInput,
  McpToolCallResult,
  RemoveSkillRootInput,
  ResolveIntegrationRequestInput,
  SetProjectTrustInput,
  SetSkillEnabledInput,
  WriteSafeConfigInput,
} from './integrations.js'
import type {
  SecurityArtifact,
  SecurityArtifactInput,
  SecurityExportInput,
  SecurityExportResult,
  SecurityFindingActionInput,
  SecurityFindingActionResult,
  SecurityPreflight,
  SecurityScanRequest,
  SecuritySnapshot,
  SecuritySubscription,
} from './security.js'
import type {
  ScheduledTaskInput,
  SchedulerSnapshot,
  SchedulerSubscription,
} from './scheduler.js'
import type { FileOpenInput, FilePathInput, ProjectDirectory, ProjectFilePreview } from './files.js'

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
  terminalState: 'terminal:state',
  terminalCreate: 'terminal:create',
  terminalWrite: 'terminal:write',
  terminalResize: 'terminal:resize',
  terminalTerminate: 'terminal:terminate',
  terminalClose: 'terminal:close',
  terminalClear: 'terminal:clear',
  terminalContext: 'terminal:context',
  terminalEvent: 'terminal:event',
  integrationState: 'integration:state',
  integrationLoad: 'integration:load',
  integrationRefresh: 'integration:refresh',
  integrationProjectTrust: 'integration:project-trust',
  integrationSkillEnabled: 'integration:skill-enabled',
  integrationSkillRootChoose: 'integration:skill-root-choose',
  integrationSkillRootRemove: 'integration:skill-root-remove',
  integrationMcpReload: 'integration:mcp-reload',
  integrationMcpOAuth: 'integration:mcp-oauth',
  integrationMcpResourceRead: 'integration:mcp-resource-read',
  integrationMcpToolCall: 'integration:mcp-tool-call',
  integrationConfigWrite: 'integration:config-write',
  integrationRequestResolve: 'integration:request-resolve',
  integrationChanged: 'integration:changed',
  securityState: 'security:state',
  securityRefreshRuntime: 'security:refresh-runtime',
  securityPreflight: 'security:preflight',
  securityScanStart: 'security:scan-start',
  securityScanCancel: 'security:scan-cancel',
  securityArtifactRead: 'security:artifact-read',
  securityFindingAction: 'security:finding-action',
  securityExport: 'security:export',
  securityChanged: 'security:changed',
  schedulerState: 'scheduler:state',
  schedulerSave: 'scheduler:save',
  schedulerPause: 'scheduler:pause',
  schedulerDelete: 'scheduler:delete',
  schedulerRunNow: 'scheduler:run-now',
  schedulerCancelRun: 'scheduler:cancel-run',
  schedulerMarkRead: 'scheduler:mark-read',
  schedulerChanged: 'scheduler:changed',
  filesList: 'files:list',
  filesPreview: 'files:preview',
  filesOpenExternal: 'files:open-external',
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
  getTerminalState: () => Promise<TerminalState>
  createTerminal: (input: CreateTerminalInput) => Promise<TerminalSession>
  writeTerminal: (input: WriteTerminalInput) => Promise<void>
  resizeTerminal: (input: ResizeTerminalInput) => Promise<void>
  terminateTerminal: (input: TerminalSessionInput) => Promise<void>
  closeTerminal: (input: TerminalSessionInput) => Promise<TerminalState>
  clearTerminal: (input: TerminalSessionInput) => Promise<TerminalSession>
  getTerminalContext: (input: TerminalSessionInput) => Promise<TerminalContext>
  onTerminalEvent: (subscription: TerminalSubscription) => () => void
  getIntegrationState: () => Promise<IntegrationSnapshot>
  loadIntegrations: (input: IntegrationProjectInput) => Promise<IntegrationSnapshot>
  refreshIntegrations: () => Promise<IntegrationSnapshot>
  setProjectTrust: (input: SetProjectTrustInput) => Promise<IntegrationSnapshot>
  setSkillEnabled: (input: SetSkillEnabledInput) => Promise<IntegrationSnapshot>
  chooseExtraSkillRoot: (input: { projectId: string }) => Promise<IntegrationSnapshot | null>
  removeExtraSkillRoot: (input: RemoveSkillRootInput) => Promise<IntegrationSnapshot>
  reloadMcpServers: (input: { projectId: string }) => Promise<IntegrationSnapshot>
  startMcpOAuth: (input: McpServerInput) => Promise<{ authorizationUrl: string }>
  readMcpResource: (input: McpResourceReadInput) => Promise<McpResourceReadResult>
  callMcpTool: (input: McpToolCallInput) => Promise<McpToolCallResult>
  writeSafeConfig: (input: WriteSafeConfigInput) => Promise<IntegrationSnapshot>
  resolveIntegrationRequest: (input: ResolveIntegrationRequestInput) => Promise<IntegrationSnapshot>
  onIntegrationChanged: (subscription: IntegrationSubscription) => () => void
  getSecurityState: () => Promise<SecuritySnapshot>
  refreshSecurityRuntime: () => Promise<SecuritySnapshot>
  preflightSecurityScan: (input: SecurityScanRequest) => Promise<SecurityPreflight>
  startSecurityScan: (input: SecurityScanRequest) => Promise<SecuritySnapshot>
  cancelSecurityScan: (input: { scanId: string }) => Promise<SecuritySnapshot>
  readSecurityArtifact: (input: SecurityArtifactInput) => Promise<SecurityArtifact>
  runSecurityFindingAction: (input: SecurityFindingActionInput) => Promise<SecurityFindingActionResult>
  exportSecurityFindings: (input: SecurityExportInput) => Promise<SecurityExportResult>
  onSecurityChanged: (subscription: SecuritySubscription) => () => void
  getSchedulerState: () => Promise<SchedulerSnapshot>
  saveScheduledTask: (input: ScheduledTaskInput) => Promise<SchedulerSnapshot>
  setScheduledTaskPaused: (input: { taskId: string; paused: boolean }) => Promise<SchedulerSnapshot>
  deleteScheduledTask: (input: { taskId: string }) => Promise<SchedulerSnapshot>
  runScheduledTaskNow: (input: { taskId: string }) => Promise<SchedulerSnapshot>
  cancelScheduledRun: (input: { runId: string }) => Promise<SchedulerSnapshot>
  markScheduledRunsRead: (input: { runIds?: string[] }) => Promise<SchedulerSnapshot>
  onSchedulerChanged: (subscription: SchedulerSubscription) => () => void
  listProjectDirectory: (input: FilePathInput) => Promise<ProjectDirectory>
  previewProjectFile: (input: FilePathInput) => Promise<ProjectFilePreview>
  openProjectFileExternal: (input: FileOpenInput) => Promise<void>
}
