export type CodexRuntimePhase =
  | 'stopped'
  | 'discovering'
  | 'starting'
  | 'initializing'
  | 'ready'
  | 'restarting'
  | 'unavailable'
  | 'failed'

export type CodexModelSummary = {
  id: string
  displayName: string
  description: string | null
  isDefault: boolean
  hidden: boolean
  defaultReasoningEffort: string | null
  supportedReasoningEfforts: string[]
  inputModalities: string[]
  supportsPersonality: boolean
}

export type CodexRuntimeSnapshot = {
  phase: CodexRuntimePhase
  generation: number
  binaryPath: string | null
  version: string | null
  userAgent: string | null
  platformFamily: string | null
  platformOs: string | null
  startedAt: string | null
  readyAt: string | null
  lastExitCode: number | null
  lastSignal: string | null
  restartAttempt: number
  error: string | null
  models: CodexModelSummary[]
}

export type RuntimeSubscription = (snapshot: CodexRuntimeSnapshot) => void
