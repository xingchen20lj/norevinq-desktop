import type { AgentActivityState } from './agent.js'

export type ConversationThreadStatus = 'notLoaded' | 'idle' | 'active' | 'systemError' | 'unknown'

export type ConversationThreadSummary = {
  id: string
  sessionId: string
  projectPath: string
  preview: string
  name: string | null
  modelProvider: string
  status: ConversationThreadStatus
  createdAt: number
  updatedAt: number
  forkedFromId: string | null
  parentThreadId: string | null
  cliVersion: string
}

export type ApprovalKind = 'command' | 'fileChange'
export type ApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel'

export type PendingApproval = {
  requestId: string
  kind: ApprovalKind
  threadId: string
  turnId: string
  itemId: string
  startedAtMs: number
  reason: string | null
  command: string | null
  cwd: string | null
  grantRoot: string | null
}

export type ConversationSnapshot = {
  projectId: string | null
  threads: ConversationThreadSummary[]
  selectedThreadId: string | null
  threadStates: Record<string, AgentActivityState>
  approvals: PendingApproval[]
  error: string | null
}

export type StartConversationInput = {
  projectId: string
  worktreeId?: string
  text: string
  model?: string
  modelProvider?: string
  reasoningEffort?: string
  approvalPolicy?: 'untrusted' | 'on-request' | 'never'
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
}

export type StartTurnInput = {
  threadId: string
  text: string
  reasoningEffort?: string
}

export type LoadProjectConversationsInput = {
  projectId: string
}

export type SelectConversationInput = {
  threadId: string
}

export type SteerTurnInput = {
  threadId: string
  turnId: string
  text: string
}

export type InterruptTurnInput = {
  threadId: string
  turnId: string
}

export type ResolveApprovalInput = {
  requestId: string
  decision: ApprovalDecision
}

export type ConversationSubscription = (snapshot: ConversationSnapshot) => void
