export type TerminalSessionStatus = 'starting' | 'running' | 'terminating' | 'exited' | 'failed'

export type TerminalSession = {
  id: string
  projectId: string
  worktreeId: string | null
  threadId: string | null
  cwd: string
  shell: string
  status: TerminalSessionStatus
  output: string
  outputTruncated: boolean
  cols: number
  rows: number
  exitCode: number | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export type TerminalState = {
  sessions: TerminalSession[]
}

export type TerminalEvent =
  | { type: 'session'; session: TerminalSession }
  | { type: 'output'; sessionId: string; data: string; outputTruncated: boolean; status: TerminalSessionStatus }
  | { type: 'removed'; sessionId: string }

export type CreateTerminalInput = {
  projectId: string
  worktreeId?: string
  threadId?: string
  cols?: number
  rows?: number
}

export type TerminalSessionInput = { sessionId: string }
export type WriteTerminalInput = TerminalSessionInput & { data: string }
export type ResizeTerminalInput = TerminalSessionInput & { cols: number; rows: number }

export type TerminalContext = {
  sessionId: string
  cwd: string
  content: string
  truncated: boolean
}

export type TerminalSubscription = (event: TerminalEvent) => void
