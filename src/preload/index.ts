import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type AsterDesktopApi, type RemoveProjectInput } from '../shared/contracts.js'
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
} from '../shared/conversation.js'
import type { CodexRuntimeSnapshot, RuntimeSubscription } from '../shared/runtime.js'
import type { SaveDeepSeekCredentialInput } from '../shared/providers.js'
import type { GitCommitInput, GitPathsInput, GitProjectInput, GitPushInput } from '../shared/git.js'
import type { CreateWorktreeInput, ListWorktreesInput, RemoveWorktreeInput, WorktreeActionInput } from '../shared/worktree.js'
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

const api: AsterDesktopApi = {
  getBootstrapState: () => ipcRenderer.invoke(IPC_CHANNELS.bootstrap),
  selectProject: () => ipcRenderer.invoke(IPC_CHANNELS.selectProject),
  removeProject: (input: RemoveProjectInput) => ipcRenderer.invoke(IPC_CHANNELS.removeProject, input),
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
  getGitStatus: (input: GitProjectInput) => ipcRenderer.invoke(IPC_CHANNELS.gitStatus, input),
  initializeGit: (input: GitProjectInput) => ipcRenderer.invoke(IPC_CHANNELS.gitInitialize, input),
  stageGitPaths: (input: GitPathsInput) => ipcRenderer.invoke(IPC_CHANNELS.gitStage, input),
  unstageGitPaths: (input: GitPathsInput) => ipcRenderer.invoke(IPC_CHANNELS.gitUnstage, input),
  commitGit: (input: GitCommitInput) => ipcRenderer.invoke(IPC_CHANNELS.gitCommit, input),
  pushGit: (input: GitPushInput) => ipcRenderer.invoke(IPC_CHANNELS.gitPush, input),
  listWorktrees: (input: ListWorktreesInput) => ipcRenderer.invoke(IPC_CHANNELS.worktreeList, input),
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
}

contextBridge.exposeInMainWorld('aster', Object.freeze(api))
