export type ScheduledTaskStatus = 'active' | 'paused'
export type ScheduledExecutionTarget = 'local' | 'worktree'
export type ScheduledConversationMode = 'new' | 'continue'
export type MissedRunPolicy = 'run_once' | 'skip'
export type ScheduledRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped'

export type ScheduledTask = {
  id: string
  name: string
  prompt: string
  projectIds: string[]
  status: ScheduledTaskStatus
  rrule: string
  timezone: string
  executionTarget: ScheduledExecutionTarget
  conversationMode: ScheduledConversationMode
  threadIds: Record<string, string>
  model: string | null
  reasoningEffort: string | null
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'
  missedRunPolicy: MissedRunPolicy
  maxAttempts: number
  retryBackoffMinutes: number
  nextRunAt: string | null
  lastRunAt: string | null
  createdAt: string
  updatedAt: string
}

export type ScheduledRun = {
  id: string
  taskId: string
  taskName: string
  projectId: string
  projectName: string
  scheduledFor: string
  startedAt: string | null
  finishedAt: string | null
  status: ScheduledRunStatus
  attempt: number
  threadId: string | null
  worktreeId: string | null
  summary: string | null
  error: string | null
  unread: boolean
}

export type ScheduledTaskInput = {
  id?: string
  name: string
  prompt: string
  projectIds: string[]
  rrule: string
  timezone: string
  executionTarget: ScheduledExecutionTarget
  conversationMode: ScheduledConversationMode
  model?: string
  reasoningEffort?: string
  sandbox: ScheduledTask['sandbox']
  missedRunPolicy: MissedRunPolicy
  maxAttempts: number
  retryBackoffMinutes: number
}

export type SchedulerSnapshot = {
  tasks: ScheduledTask[]
  runs: ScheduledRun[]
  activeRunIds: string[]
  unreadRuns: number
}

export type SchedulerSubscription = (snapshot: SchedulerSnapshot) => void
