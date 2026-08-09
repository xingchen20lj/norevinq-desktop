/**
 * Stable, renderer-safe agent activity types.
 *
 * These types intentionally do not import the generated app-server protocol.
 * The protocol is allowed to evolve independently; the main-process reducer is
 * the compatibility boundary between raw notifications and this domain model.
 */

export const MAX_ACTIVITY_TEXT_LENGTH = 1024 * 1024

export type SerializableValue =
  | null
  | boolean
  | number
  | string
  | SerializableValue[]
  | { [key: string]: SerializableValue }

export type AgentServerEvent = {
  method: string
  params: unknown
  emittedAtMs?: number
}

export type AgentActivityStatus =
  | 'inProgress'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'declined'
  | 'idle'
  | 'unknown'

export type AgentTurnStatus = 'idle' | 'inProgress' | 'completed' | 'failed' | 'interrupted' | 'unknown'

export type AgentActivityBase = {
  id: string
  threadId: string | null
  turnId: string | null
  status: AgentActivityStatus
  startedAtMs: number | null
  completedAtMs: number | null
  truncated: boolean
  truncatedChars: number
}

export type ThreadActivity = AgentActivityBase & {
  type: 'thread'
  modelProvider: string | null
  cwd: string | null
  preview: string
}

export type TurnActivity = AgentActivityBase & {
  type: 'turn'
  error: AgentErrorDetails | null
  durationMs: number | null
}

export type UserMessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; local: boolean }
  | { type: 'audio'; url: string; local: boolean }
  | { type: 'skill'; name: string; path: string }
  | { type: 'mention'; name: string; path: string }
  | { type: 'unknown'; inputType: string; value: SerializableValue }

export type UserMessageActivity = AgentActivityBase & {
  type: 'userMessage'
  clientId: string | null
  content: UserMessageContent[]
}

export type AgentMessageActivity = AgentActivityBase & {
  type: 'agentMessage'
  text: string
  phase: 'commentary' | 'final_answer' | null
}

export type ReasoningActivity = AgentActivityBase & {
  type: 'reasoning'
  summary: string[]
  content: string[]
}

export type CommandActivity = AgentActivityBase & {
  type: 'command'
  command: string
  cwd: string | null
  processId: string | null
  source: string | null
  output: string
  exitCode: number | null
  durationMs: number | null
  commandActions: SerializableValue[]
}

export type FileChange = {
  path: string
  kind: string
  movePath: string | null
  diff: string
}

export type FileChangeActivity = AgentActivityBase & {
  type: 'fileChange'
  changes: FileChange[]
  output: string
}

export type McpToolActivity = AgentActivityBase & {
  type: 'mcpTool'
  server: string
  tool: string
  arguments: SerializableValue
  result: SerializableValue | null
  error: string | null
  progress: string
  durationMs: number | null
}

export type DynamicToolActivity = AgentActivityBase & {
  type: 'dynamicTool'
  namespace: string | null
  tool: string
  arguments: SerializableValue
  contentItems: SerializableValue[]
  success: boolean | null
  durationMs: number | null
}

export type WebSearchActivity = AgentActivityBase & {
  type: 'webSearch'
  query: string
  action: SerializableValue | null
  results: SerializableValue[]
}

export type CollabActivity = AgentActivityBase & {
  type: 'collab'
  tool: string
  senderThreadId: string | null
  receiverThreadIds: string[]
  prompt: string | null
  model: string | null
  reasoningEffort: string | null
  agentsStates: Record<string, SerializableValue>
}

export type SubagentActivity = AgentActivityBase & {
  type: 'subagent'
  kind: string
  agentThreadId: string
  agentPath: string
}

export type PlanStep = {
  step: string
  status: 'pending' | 'inProgress' | 'completed' | 'unknown'
}

export type PlanActivity = AgentActivityBase & {
  type: 'plan'
  text: string
  explanation: string | null
  steps: PlanStep[]
}

export type AgentErrorDetails = {
  message: string
  additionalDetails: string | null
  code: SerializableValue | null
  willRetry: boolean
}

export type AgentErrorActivity = AgentActivityBase & AgentErrorDetails & {
  type: 'error'
}

export type UnknownItemActivity = AgentActivityBase & {
  type: 'unknownItem'
  itemType: string
  raw: SerializableValue
}

export type AgentActivity =
  | ThreadActivity
  | TurnActivity
  | UserMessageActivity
  | AgentMessageActivity
  | ReasoningActivity
  | CommandActivity
  | FileChangeActivity
  | McpToolActivity
  | DynamicToolActivity
  | WebSearchActivity
  | CollabActivity
  | SubagentActivity
  | PlanActivity
  | AgentErrorActivity
  | UnknownItemActivity

export type UnknownAgentEvent = {
  method: string
  params: SerializableValue
  emittedAtMs: number | null
}

export type AgentActivityState = {
  threadId: string | null
  turnId: string | null
  turnStatus: AgentTurnStatus
  activities: AgentActivity[]
  unknownEvents: UnknownAgentEvent[]
  lastError: AgentErrorActivity | null
}
