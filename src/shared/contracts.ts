import type { CodexRuntimeSnapshot, RuntimeSubscription } from './runtime.js'
import type {
  ConversationSnapshot,
  ConversationSubscription,
  ForkConversationInput,
  HandoffConversationInput,
  InterruptTurnInput,
  LoadProjectConversationsInput,
  RenameConversationInput,
  ResolveApprovalInput,
  SelectConversationInput,
  SetConversationPinnedInput,
  SetThreadGoalInput,
  StartConversationInput,
  StartTurnInput,
  SteerTurnInput,
} from './conversation.js'
import type { ProviderStatus, SaveDeepSeekCredentialInput } from './providers.js'
import type {
  GitDiscardInput,
  GitDiscardRestoreInput,
  GitCommitInput,
  CreateGitHubPullRequestInput,
  CreateGitHubPullRequestResult,
  GitHubRepositoryStatus,
  GitHubStatusInput,
  GitPathsInput,
  GitProjectInput,
  GitPushInput,
  GitRepositorySnapshot,
} from './git.js'
import type {
  CreateWorktreeInput,
  ListWorktreesInput,
  ListWorktreeBasesInput,
  ListWorktreeRecoveriesInput,
  ManagedWorktree,
  RemoveWorktreeInput,
  RetryWorktreeRecoveryInput,
  WorktreeActionInput,
  WorktreeBaseCatalog,
  WorktreeHandoffRecoverySummary,
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
  SecuritySaveExportInput,
  SecuritySaveExportResult,
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
import type { AgentImagePreview, AgentImagePreviewInput, FileOpenInput, FilePathInput, ProjectDirectory, ProjectFilePreview } from './files.js'
import type {
  BrowserBounds,
  BrowserExternalInput,
  BrowserNavigateInput,
  BrowserOpenInput,
  BrowserSnapshot,
  BrowserSubscription,
} from './browser.js'
import type { UpdateSnapshot, UpdateSubscription } from './update.js'
import type { DiagnosticsExportResult, DiagnosticsSnapshot } from './diagnostics.js'
import type {
  AccountSnapshot,
  AccountSubscription,
  LoginOpenAiApiKeyInput,
} from './account.js'

export const IPC_CHANNELS = {
  bootstrap: 'app:bootstrap',
  selectProject: 'project:select',
  removeProject: 'project:remove',
  projectPinnedSet: 'project:pinned-set',
  deepLinkOpened: 'app:deep-link-opened',
  deepLinkOpen: 'app:deep-link-open',
  updateState: 'app:update-state',
  updateCheck: 'app:update-check',
  updateDownload: 'app:update-download',
  updateInstall: 'app:update-install',
  updateChanged: 'app:update-changed',
  diagnosticsState: 'app:diagnostics-state',
  diagnosticsExport: 'app:diagnostics-export',
  runtimeStatus: 'runtime:status',
  runtimeRestart: 'runtime:restart',
  runtimeStatusChanged: 'runtime:status-changed',
  conversationsLoad: 'conversations:load',
  conversationSelect: 'conversation:select',
  conversationRename: 'conversation:rename',
  conversationArchive: 'conversation:archive',
  conversationUnarchive: 'conversation:unarchive',
  conversationDelete: 'conversation:delete',
  conversationFork: 'conversation:fork',
  conversationCompact: 'conversation:compact',
  conversationPinnedSet: 'conversation:pinned-set',
  conversationGoalSet: 'conversation:goal-set',
  conversationGoalClear: 'conversation:goal-clear',
  conversationHandoff: 'conversation:handoff',
  conversationStart: 'conversation:start',
  conversationTurnStart: 'conversation:turn-start',
  conversationSteer: 'conversation:steer',
  conversationInterrupt: 'conversation:interrupt',
  conversationApprovalResolve: 'conversation:approval-resolve',
  conversationChanged: 'conversation:changed',
  providerDeepSeekSave: 'provider:deepseek-save',
  providerDeepSeekDelete: 'provider:deepseek-delete',
  accountState: 'account:state',
  accountRefresh: 'account:refresh',
  accountLoginApiKey: 'account:login-api-key',
  accountLoginBrowser: 'account:login-browser',
  accountLoginDeviceCode: 'account:login-device-code',
  accountLoginOpen: 'account:login-open',
  accountLoginCancel: 'account:login-cancel',
  accountLogout: 'account:logout',
  accountChanged: 'account:changed',
  gitStatus: 'git:status',
  gitInitialize: 'git:initialize',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitDiscardFile: 'git:discard-file',
  gitDiscardRestore: 'git:discard-restore',
  gitCommit: 'git:commit',
  gitPush: 'git:push',
  githubStatus: 'github:status',
  githubPullRequestCreate: 'github:pull-request-create',
  worktreeList: 'worktree:list',
  worktreeBases: 'worktree:bases',
  worktreeCreate: 'worktree:create',
  worktreeLock: 'worktree:lock',
  worktreeUnlock: 'worktree:unlock',
  worktreeRemove: 'worktree:remove',
  worktreeRecoveries: 'worktree:recoveries',
  worktreeRecoveryRetry: 'worktree:recovery-retry',
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
  securityExportSave: 'security:export-save',
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
  filesAgentImagePreview: 'files:agent-image-preview',
  filesOpenExternal: 'files:open-external',
  browserState: 'browser:state',
  browserOpen: 'browser:open',
  browserClose: 'browser:close',
  browserNavigate: 'browser:navigate',
  browserReload: 'browser:reload',
  browserStop: 'browser:stop',
  browserBack: 'browser:back',
  browserForward: 'browser:forward',
  browserBounds: 'browser:bounds',
  browserClearLogs: 'browser:clear-logs',
  browserExternal: 'browser:external',
  browserChanged: 'browser:changed',
} as const

export type ProjectSummary = {
  id: string
  name: string
  path: string
  trusted: boolean
  pinned: boolean
  lastOpenedAt: string
}

export type BootstrapState = {
  appVersion: string
  platform: string
  projects: ProjectSummary[]
  runtime: CodexRuntimeSnapshot
  providers: ProviderStatus
  account: AccountSnapshot
  updates: UpdateSnapshot
  diagnostics: DiagnosticsSnapshot
}

export type RemoveProjectInput = {
  projectId: string
}

export type SetProjectPinnedInput = RemoveProjectInput & {
  pinned: boolean
}

export type DeepLinkTarget =
  | { kind: 'project'; projectId: string }
  | { kind: 'thread'; projectId: string; threadId: string }

export type DeepLinkSubscription = (target: DeepLinkTarget) => void

export type NorevinqDesktopApi = {
  getBootstrapState: () => Promise<BootstrapState>
  selectProject: () => Promise<ProjectSummary | null>
  removeProject: (input: RemoveProjectInput) => Promise<void>
  setProjectPinned: (input: SetProjectPinnedInput) => Promise<ProjectSummary[]>
  openDeepLink: (target: DeepLinkTarget) => Promise<ConversationSnapshot | null>
  onDeepLink: (subscription: DeepLinkSubscription) => () => void
  getUpdateState: () => Promise<UpdateSnapshot>
  checkForUpdates: () => Promise<UpdateSnapshot>
  downloadUpdate: () => Promise<UpdateSnapshot>
  installUpdate: () => Promise<void>
  onUpdateChanged: (subscription: UpdateSubscription) => () => void
  getDiagnosticsState: () => Promise<DiagnosticsSnapshot>
  exportDiagnostics: () => Promise<DiagnosticsExportResult>
  getRuntimeStatus: () => Promise<CodexRuntimeSnapshot>
  restartRuntime: () => Promise<CodexRuntimeSnapshot>
  onRuntimeStatus: (subscription: RuntimeSubscription) => () => void
  loadProjectConversations: (input: LoadProjectConversationsInput) => Promise<ConversationSnapshot>
  selectConversation: (input: SelectConversationInput) => Promise<ConversationSnapshot>
  renameConversation: (input: RenameConversationInput) => Promise<ConversationSnapshot>
  archiveConversation: (input: SelectConversationInput) => Promise<ConversationSnapshot>
  unarchiveConversation: (input: SelectConversationInput) => Promise<ConversationSnapshot>
  deleteConversation: (input: SelectConversationInput) => Promise<ConversationSnapshot>
  forkConversation: (input: ForkConversationInput) => Promise<ConversationSnapshot>
  compactConversation: (input: SelectConversationInput) => Promise<ConversationSnapshot>
  setConversationPinned: (input: SetConversationPinnedInput) => Promise<ConversationSnapshot>
  setThreadGoal: (input: SetThreadGoalInput) => Promise<ConversationSnapshot>
  clearThreadGoal: (input: SelectConversationInput) => Promise<ConversationSnapshot>
  handoffConversation: (input: HandoffConversationInput) => Promise<ConversationSnapshot>
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
  getAccountState: () => Promise<AccountSnapshot>
  refreshOpenAiAccount: (input?: { refreshToken?: boolean }) => Promise<AccountSnapshot>
  loginOpenAiApiKey: (input: LoginOpenAiApiKeyInput) => Promise<AccountSnapshot>
  startChatGptBrowserLogin: () => Promise<AccountSnapshot>
  startChatGptDeviceCodeLogin: () => Promise<AccountSnapshot>
  openPendingChatGptLogin: () => Promise<AccountSnapshot>
  cancelPendingChatGptLogin: () => Promise<AccountSnapshot>
  logoutOpenAiAccount: () => Promise<AccountSnapshot>
  onAccountChanged: (subscription: AccountSubscription) => () => void
  getGitStatus: (input: GitProjectInput) => Promise<GitRepositorySnapshot>
  initializeGit: (input: GitProjectInput) => Promise<GitRepositorySnapshot>
  stageGitPaths: (input: GitPathsInput) => Promise<GitRepositorySnapshot>
  unstageGitPaths: (input: GitPathsInput) => Promise<GitRepositorySnapshot>
  discardGitFile: (input: GitDiscardInput) => Promise<GitRepositorySnapshot>
  restoreGitDiscard: (input: GitDiscardRestoreInput) => Promise<GitRepositorySnapshot>
  commitGit: (input: GitCommitInput) => Promise<GitRepositorySnapshot>
  pushGit: (input: GitPushInput) => Promise<GitRepositorySnapshot>
  getGitHubStatus: (input: GitHubStatusInput) => Promise<GitHubRepositoryStatus>
  createGitHubPullRequest: (input: CreateGitHubPullRequestInput) => Promise<CreateGitHubPullRequestResult>
  listWorktrees: (input: ListWorktreesInput) => Promise<ManagedWorktree[]>
  listWorktreeBases: (input: ListWorktreeBasesInput) => Promise<WorktreeBaseCatalog>
  createWorktree: (input: CreateWorktreeInput) => Promise<ManagedWorktree>
  lockWorktree: (input: WorktreeActionInput) => Promise<ManagedWorktree[]>
  unlockWorktree: (input: WorktreeActionInput) => Promise<ManagedWorktree[]>
  removeWorktree: (input: RemoveWorktreeInput) => Promise<ManagedWorktree[]>
  listWorktreeRecoveries: (input: ListWorktreeRecoveriesInput) => Promise<WorktreeHandoffRecoverySummary[]>
  retryWorktreeRecovery: (input: RetryWorktreeRecoveryInput) => Promise<WorktreeHandoffRecoverySummary[]>
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
  saveSecurityExport: (input: SecuritySaveExportInput) => Promise<SecuritySaveExportResult>
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
  previewAgentImage: (input: AgentImagePreviewInput) => Promise<AgentImagePreview>
  openProjectFileExternal: (input: FileOpenInput) => Promise<void>
  getBrowserState: () => Promise<BrowserSnapshot>
  openBrowser: (input: BrowserOpenInput) => Promise<BrowserSnapshot>
  closeBrowser: () => Promise<BrowserSnapshot>
  navigateBrowser: (input: BrowserNavigateInput) => Promise<BrowserSnapshot>
  reloadBrowser: () => Promise<BrowserSnapshot>
  stopBrowser: () => Promise<BrowserSnapshot>
  goBackBrowser: () => Promise<BrowserSnapshot>
  goForwardBrowser: () => Promise<BrowserSnapshot>
  setBrowserBounds: (input: BrowserBounds) => Promise<void>
  clearBrowserLogs: () => Promise<BrowserSnapshot>
  openBrowserExternal: (input: BrowserExternalInput) => Promise<void>
  onBrowserChanged: (subscription: BrowserSubscription) => () => void
}
