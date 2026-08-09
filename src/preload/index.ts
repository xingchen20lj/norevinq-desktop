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
}

contextBridge.exposeInMainWorld('aster', Object.freeze(api))
