export type CrashProcessKind = 'main' | 'renderer' | 'utility'

export type CrashRecord = {
  id: string
  occurredAt: string
  process: CrashProcessKind
  reason: string
  message: string | null
  exitCode: number | null
  processType: string | null
}

export type DiagnosticsSnapshot = {
  retainedCrashCount: number
  latestCrashAt: string | null
  runtimeLogAvailable: boolean
  automaticUpload: false
}

export type DiagnosticsExportResult = {
  exported: boolean
  fileName: string | null
  bytes: number
}

export type CrashRecordInput = {
  process: CrashProcessKind
  reason: string
  message?: string
  exitCode?: number
  processType?: string
}
