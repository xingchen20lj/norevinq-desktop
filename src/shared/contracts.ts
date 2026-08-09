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
}
