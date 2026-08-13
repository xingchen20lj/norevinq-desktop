import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type AsterDesktopApi,
  type DeepLinkSubscription,
  type DeepLinkTarget,
  type RemoveProjectInput,
  type SetProjectPinnedInput,
} from '../shared/contracts.js'
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
} from '../shared/conversation.js'
import type { CodexRuntimeSnapshot, RuntimeSubscription } from '../shared/runtime.js'
import type { SaveDeepSeekCredentialInput } from '../shared/providers.js'
import type {
  CreateGitHubPullRequestInput,
  GitDiscardInput,
  GitDiscardRestoreInput,
  GitCommitInput,
  GitHubStatusInput,
  GitPathsInput,
  GitProjectInput,
  GitPushInput,
} from '../shared/git.js'
import type { CreateWorktreeInput, ListWorktreeBasesInput, ListWorktreesInput, RemoveWorktreeInput, WorktreeActionInput } from '../shared/worktree.js'
import type { ApplyDiffHunkInput, GetDiffInput } from '../shared/diff.js'
import type {
  CreateTerminalInput,
  ResizeTerminalInput,
  TerminalEvent,
  TerminalSessionInput,
  TerminalSubscription,
  WriteTerminalInput,
} from '../shared/terminal.js'
import type {
  IntegrationProjectInput,
  IntegrationSnapshot,
  IntegrationSubscription,
  McpResourceReadInput,
  McpServerInput,
  McpToolCallInput,
  RemoveSkillRootInput,
  ResolveIntegrationRequestInput,
  SetProjectTrustInput,
  SetSkillEnabledInput,
  WriteSafeConfigInput,
} from '../shared/integrations.js'
import type {
  SecurityArtifactInput,
  SecurityExportInput,
  SecurityFindingActionInput,
  SecurityScanRequest,
  SecuritySnapshot,
  SecuritySubscription,
} from '../shared/security.js'
import type { ScheduledTaskInput, SchedulerSnapshot, SchedulerSubscription } from '../shared/scheduler.js'
import type { FileOpenInput, FilePathInput } from '../shared/files.js'
import type {
  BrowserBounds,
  BrowserExternalInput,
  BrowserNavigateInput,
  BrowserOpenInput,
  BrowserSnapshot,
  BrowserSubscription,
} from '../shared/browser.js'
import type { UpdateSnapshot, UpdateSubscription } from '../shared/update.js'
import type { DiagnosticsExportResult, DiagnosticsSnapshot } from '../shared/diagnostics.js'
import type { AccountSnapshot, AccountSubscription, LoginOpenAiApiKeyInput } from '../shared/account.js'

const api: AsterDesktopApi = {
  getBootstrapState: () => ipcRenderer.invoke(IPC_CHANNELS.bootstrap),
  selectProject: () => ipcRenderer.invoke(IPC_CHANNELS.selectProject),
  removeProject: (input: RemoveProjectInput) => ipcRenderer.invoke(IPC_CHANNELS.removeProject, input),
  setProjectPinned: (input: SetProjectPinnedInput) => ipcRenderer.invoke(IPC_CHANNELS.projectPinnedSet, input),
  openDeepLink: (target: DeepLinkTarget) => ipcRenderer.invoke(IPC_CHANNELS.deepLinkOpen, target),
  onDeepLink: (subscription: DeepLinkSubscription) => {
    const listener = (_event: Electron.IpcRendererEvent, target: DeepLinkTarget): void => subscription(target)
    ipcRenderer.on(IPC_CHANNELS.deepLinkOpened, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.deepLinkOpened, listener)
  },
  getUpdateState: () => ipcRenderer.invoke(IPC_CHANNELS.updateState),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.updateCheck),
  downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.updateDownload),
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.updateInstall),
  onUpdateChanged: (subscription: UpdateSubscription) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: UpdateSnapshot): void => subscription(snapshot)
    ipcRenderer.on(IPC_CHANNELS.updateChanged, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.updateChanged, listener)
  },
  getDiagnosticsState: (): Promise<DiagnosticsSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.diagnosticsState),
  exportDiagnostics: (): Promise<DiagnosticsExportResult> => ipcRenderer.invoke(IPC_CHANNELS.diagnosticsExport),
  getRuntimeStatus: () => ipcRenderer.invoke(IPC_CHANNELS.runtimeStatus),
  restartRuntime: () => ipcRenderer.invoke(IPC_CHANNELS.runtimeRestart),
  onRuntimeStatus: (subscription: RuntimeSubscription) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: CodexRuntimeSnapshot): void => subscription(snapshot)
    ipcRenderer.on(IPC_CHANNELS.runtimeStatusChanged, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.runtimeStatusChanged, listener)
  },
  loadProjectConversations: (input: LoadProjectConversationsInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationsLoad, input),
  selectConversation: (input: SelectConversationInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationSelect, input),
  renameConversation: (input: RenameConversationInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationRename, input),
  archiveConversation: (input: SelectConversationInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationArchive, input),
  unarchiveConversation: (input: SelectConversationInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationUnarchive, input),
  deleteConversation: (input: SelectConversationInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationDelete, input),
  forkConversation: (input: ForkConversationInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationFork, input),
  compactConversation: (input: SelectConversationInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationCompact, input),
  setConversationPinned: (input: SetConversationPinnedInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationPinnedSet, input),
  setThreadGoal: (input: SetThreadGoalInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationGoalSet, input),
  clearThreadGoal: (input: SelectConversationInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationGoalClear, input),
  handoffConversation: (input: HandoffConversationInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationHandoff, input),
  startConversation: (input: StartConversationInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationStart, input),
  startTurn: (input: StartTurnInput) => ipcRenderer.invoke(IPC_CHANNELS.conversationTurnStart, input),
  steerTurn: (input: SteerTurnInput) => ipcRenderer.invoke(IPC_CHANNELS.conversationSteer, input),
  interruptTurn: (input: InterruptTurnInput) => ipcRenderer.invoke(IPC_CHANNELS.conversationInterrupt, input),
  resolveApproval: (input: ResolveApprovalInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationApprovalResolve, input),
  onConversationChanged: (subscription: ConversationSubscription) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: ConversationSnapshot): void => subscription(snapshot)
    ipcRenderer.on(IPC_CHANNELS.conversationChanged, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.conversationChanged, listener)
  },
  saveDeepSeekCredential: (input: SaveDeepSeekCredentialInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.providerDeepSeekSave, input),
  deleteDeepSeekCredential: () => ipcRenderer.invoke(IPC_CHANNELS.providerDeepSeekDelete),
  getAccountState: (): Promise<AccountSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.accountState),
  refreshOpenAiAccount: (input?: { refreshToken?: boolean }): Promise<AccountSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountRefresh, input),
  loginOpenAiApiKey: (input: LoginOpenAiApiKeyInput): Promise<AccountSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountLoginApiKey, input),
  startChatGptBrowserLogin: (): Promise<AccountSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountLoginBrowser),
  startChatGptDeviceCodeLogin: (): Promise<AccountSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountLoginDeviceCode),
  openPendingChatGptLogin: (): Promise<AccountSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountLoginOpen),
  cancelPendingChatGptLogin: (): Promise<AccountSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountLoginCancel),
  logoutOpenAiAccount: (): Promise<AccountSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.accountLogout),
  onAccountChanged: (subscription: AccountSubscription) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AccountSnapshot): void => subscription(snapshot)
    ipcRenderer.on(IPC_CHANNELS.accountChanged, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.accountChanged, listener)
  },
  getGitStatus: (input: GitProjectInput) => ipcRenderer.invoke(IPC_CHANNELS.gitStatus, input),
  initializeGit: (input: GitProjectInput) => ipcRenderer.invoke(IPC_CHANNELS.gitInitialize, input),
  stageGitPaths: (input: GitPathsInput) => ipcRenderer.invoke(IPC_CHANNELS.gitStage, input),
  unstageGitPaths: (input: GitPathsInput) => ipcRenderer.invoke(IPC_CHANNELS.gitUnstage, input),
  discardGitFile: (input: GitDiscardInput) => ipcRenderer.invoke(IPC_CHANNELS.gitDiscardFile, input),
  restoreGitDiscard: (input: GitDiscardRestoreInput) => ipcRenderer.invoke(IPC_CHANNELS.gitDiscardRestore, input),
  commitGit: (input: GitCommitInput) => ipcRenderer.invoke(IPC_CHANNELS.gitCommit, input),
  pushGit: (input: GitPushInput) => ipcRenderer.invoke(IPC_CHANNELS.gitPush, input),
  getGitHubStatus: (input: GitHubStatusInput) => ipcRenderer.invoke(IPC_CHANNELS.githubStatus, input),
  createGitHubPullRequest: (input: CreateGitHubPullRequestInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.githubPullRequestCreate, input),
  listWorktrees: (input: ListWorktreesInput) => ipcRenderer.invoke(IPC_CHANNELS.worktreeList, input),
  listWorktreeBases: (input: ListWorktreeBasesInput) => ipcRenderer.invoke(IPC_CHANNELS.worktreeBases, input),
  createWorktree: (input: CreateWorktreeInput) => ipcRenderer.invoke(IPC_CHANNELS.worktreeCreate, input),
  lockWorktree: (input: WorktreeActionInput) => ipcRenderer.invoke(IPC_CHANNELS.worktreeLock, input),
  unlockWorktree: (input: WorktreeActionInput) => ipcRenderer.invoke(IPC_CHANNELS.worktreeUnlock, input),
  removeWorktree: (input: RemoveWorktreeInput) => ipcRenderer.invoke(IPC_CHANNELS.worktreeRemove, input),
  getDiff: (input: GetDiffInput) => ipcRenderer.invoke(IPC_CHANNELS.diffGet, input),
  applyDiffHunk: (input: ApplyDiffHunkInput) => ipcRenderer.invoke(IPC_CHANNELS.diffHunkApply, input),
  getTerminalState: () => ipcRenderer.invoke(IPC_CHANNELS.terminalState),
  createTerminal: (input: CreateTerminalInput) => ipcRenderer.invoke(IPC_CHANNELS.terminalCreate, input),
  writeTerminal: (input: WriteTerminalInput) => ipcRenderer.invoke(IPC_CHANNELS.terminalWrite, input),
  resizeTerminal: (input: ResizeTerminalInput) => ipcRenderer.invoke(IPC_CHANNELS.terminalResize, input),
  terminateTerminal: (input: TerminalSessionInput) => ipcRenderer.invoke(IPC_CHANNELS.terminalTerminate, input),
  closeTerminal: (input: TerminalSessionInput) => ipcRenderer.invoke(IPC_CHANNELS.terminalClose, input),
  clearTerminal: (input: TerminalSessionInput) => ipcRenderer.invoke(IPC_CHANNELS.terminalClear, input),
  getTerminalContext: (input: TerminalSessionInput) => ipcRenderer.invoke(IPC_CHANNELS.terminalContext, input),
  onTerminalEvent: (subscription: TerminalSubscription) => {
    const listener = (_event: Electron.IpcRendererEvent, terminalEvent: TerminalEvent): void => subscription(terminalEvent)
    ipcRenderer.on(IPC_CHANNELS.terminalEvent, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.terminalEvent, listener)
  },
  getIntegrationState: () => ipcRenderer.invoke(IPC_CHANNELS.integrationState),
  loadIntegrations: (input: IntegrationProjectInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.integrationLoad, input),
  refreshIntegrations: () => ipcRenderer.invoke(IPC_CHANNELS.integrationRefresh),
  setProjectTrust: (input: SetProjectTrustInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.integrationProjectTrust, input),
  setSkillEnabled: (input: SetSkillEnabledInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.integrationSkillEnabled, input),
  chooseExtraSkillRoot: (input: { projectId: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.integrationSkillRootChoose, input),
  removeExtraSkillRoot: (input: RemoveSkillRootInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.integrationSkillRootRemove, input),
  reloadMcpServers: (input: { projectId: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.integrationMcpReload, input),
  startMcpOAuth: (input: McpServerInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.integrationMcpOAuth, input),
  readMcpResource: (input: McpResourceReadInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.integrationMcpResourceRead, input),
  callMcpTool: (input: McpToolCallInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.integrationMcpToolCall, input),
  writeSafeConfig: (input: WriteSafeConfigInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.integrationConfigWrite, input),
  resolveIntegrationRequest: (input: ResolveIntegrationRequestInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.integrationRequestResolve, input),
  onIntegrationChanged: (subscription: IntegrationSubscription) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: IntegrationSnapshot): void => subscription(snapshot)
    ipcRenderer.on(IPC_CHANNELS.integrationChanged, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.integrationChanged, listener)
  },
  getSecurityState: () => ipcRenderer.invoke(IPC_CHANNELS.securityState),
  refreshSecurityRuntime: () => ipcRenderer.invoke(IPC_CHANNELS.securityRefreshRuntime),
  preflightSecurityScan: (input: SecurityScanRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.securityPreflight, input),
  startSecurityScan: (input: SecurityScanRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.securityScanStart, input),
  cancelSecurityScan: (input: { scanId: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.securityScanCancel, input),
  readSecurityArtifact: (input: SecurityArtifactInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.securityArtifactRead, input),
  runSecurityFindingAction: (input: SecurityFindingActionInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.securityFindingAction, input),
  exportSecurityFindings: (input: SecurityExportInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.securityExport, input),
  onSecurityChanged: (subscription: SecuritySubscription) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: SecuritySnapshot): void => subscription(snapshot)
    ipcRenderer.on(IPC_CHANNELS.securityChanged, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.securityChanged, listener)
  },
  getSchedulerState: () => ipcRenderer.invoke(IPC_CHANNELS.schedulerState),
  saveScheduledTask: (input: ScheduledTaskInput) => ipcRenderer.invoke(IPC_CHANNELS.schedulerSave, input),
  setScheduledTaskPaused: (input: { taskId: string; paused: boolean }) =>
    ipcRenderer.invoke(IPC_CHANNELS.schedulerPause, input),
  deleteScheduledTask: (input: { taskId: string }) => ipcRenderer.invoke(IPC_CHANNELS.schedulerDelete, input),
  runScheduledTaskNow: (input: { taskId: string }) => ipcRenderer.invoke(IPC_CHANNELS.schedulerRunNow, input),
  cancelScheduledRun: (input: { runId: string }) => ipcRenderer.invoke(IPC_CHANNELS.schedulerCancelRun, input),
  markScheduledRunsRead: (input: { runIds?: string[] }) => ipcRenderer.invoke(IPC_CHANNELS.schedulerMarkRead, input),
  onSchedulerChanged: (subscription: SchedulerSubscription) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: SchedulerSnapshot): void => subscription(snapshot)
    ipcRenderer.on(IPC_CHANNELS.schedulerChanged, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.schedulerChanged, listener)
  },
  listProjectDirectory: (input: FilePathInput) => ipcRenderer.invoke(IPC_CHANNELS.filesList, input),
  previewProjectFile: (input: FilePathInput) => ipcRenderer.invoke(IPC_CHANNELS.filesPreview, input),
  openProjectFileExternal: (input: FileOpenInput) => ipcRenderer.invoke(IPC_CHANNELS.filesOpenExternal, input),
  getBrowserState: () => ipcRenderer.invoke(IPC_CHANNELS.browserState),
  openBrowser: (input: BrowserOpenInput) => ipcRenderer.invoke(IPC_CHANNELS.browserOpen, input),
  closeBrowser: () => ipcRenderer.invoke(IPC_CHANNELS.browserClose),
  navigateBrowser: (input: BrowserNavigateInput) => ipcRenderer.invoke(IPC_CHANNELS.browserNavigate, input),
  reloadBrowser: () => ipcRenderer.invoke(IPC_CHANNELS.browserReload),
  stopBrowser: () => ipcRenderer.invoke(IPC_CHANNELS.browserStop),
  goBackBrowser: () => ipcRenderer.invoke(IPC_CHANNELS.browserBack),
  goForwardBrowser: () => ipcRenderer.invoke(IPC_CHANNELS.browserForward),
  setBrowserBounds: (input: BrowserBounds) => ipcRenderer.invoke(IPC_CHANNELS.browserBounds, input),
  clearBrowserLogs: () => ipcRenderer.invoke(IPC_CHANNELS.browserClearLogs),
  openBrowserExternal: (input: BrowserExternalInput) => ipcRenderer.invoke(IPC_CHANNELS.browserExternal, input),
  onBrowserChanged: (subscription: BrowserSubscription) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: BrowserSnapshot): void => subscription(snapshot)
    ipcRenderer.on(IPC_CHANNELS.browserChanged, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.browserChanged, listener)
  },
}

contextBridge.exposeInMainWorld('aster', Object.freeze(api))
