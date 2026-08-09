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
}

contextBridge.exposeInMainWorld('aster', Object.freeze(api))
