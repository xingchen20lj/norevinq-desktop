export type UpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'upToDate'
  | 'error'

export type UpdateProgress = {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export type UpdateSnapshot = {
  phase: UpdatePhase
  currentVersion: string
  configured: boolean
  supported: boolean
  automaticChecks: boolean
  installOnQuit: boolean
  availableVersion: string | null
  releaseDate: string | null
  releaseNotes: string | null
  progress: UpdateProgress | null
  checkedAt: string | null
  error: string | null
  disabledReason: string | null
}

export type UpdateSubscription = (snapshot: UpdateSnapshot) => void
