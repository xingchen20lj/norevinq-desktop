export type SecurityScanStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type SecurityScanMode = 'standard' | 'deep'
export type SecurityTargetKind = 'repository' | 'paths' | 'working_tree' | 'refs'
export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational'
export type SecurityModelProvider = 'openai' | 'deepseek'
export type SecurityDeepSeekModel = 'deepseek-v4-flash' | 'deepseek-v4-pro'
export type SecurityReportLanguage = 'zh-CN' | 'en'

export type SecurityScanRequest = {
  projectId: string
  provider?: SecurityModelProvider
  model?: SecurityDeepSeekModel
  reportLanguage?: SecurityReportLanguage
  mode: SecurityScanMode
  target: {
    kind: SecurityTargetKind
    paths?: string[]
    base?: string
    head?: string
  }
  auth: 'auto' | 'chatgpt' | 'api-key'
  maxCostUsd?: number
  deep?: {
    workers: number
    subagents: number
    stopAfterNoNew: number
    maxDiscoveryRuns: number
  }
}

export type SecurityScanProgress = {
  phase: 'preflight' | 'threat_model' | 'discovery' | 'validation' | 'attack_path' | 'reporting'
  filesCompleted: number
  filesTotal: number
  activity?: string
  costUsd?: number
  trustedAccess?: 'granted' | 'not_granted' | 'unknown'
  deepseekUsage?: {
    inputTokens: number
    cachedInputTokens: number
    cacheWriteInputTokens: number
    uncachedInputTokens: number
    outputTokens: number
    reasoningOutputTokens: number
    totalTokens: number
    estimatedUsd: number
    estimatedCny: number
    usdCnyRate: number
    exchangeRateDate: string
    exchangeRateSource: 'frankfurter-ecb' | 'fallback'
    pricingTier: 'current' | 'peak' | 'off_peak'
    pricingVersion: string
  }
}

export type SecurityFinding = {
  findingId: string
  occurrenceId: string
  ruleId: string
  title: string
  summary: string
  severity: SecuritySeverity
  severityScore?: number
  confidence: 'high' | 'medium' | 'low'
  category: string
  cwe: string[]
  locations: { path: string; startLine: number; endLine?: number; role?: string }[]
  evidence: { label: string; path: string; startLine: number; code: string; explanation: string }[]
  rootCause?: string
  remediation: string
  validation?: Record<string, unknown> | null
  attackPath?: Record<string, unknown> | null
  remediationTests: string[]
  preventiveControls: string[]
  triage?: {
    status: 'false_positive'
    reason: string
    updatedAt: string
  }
}

export type SecurityScanResult = {
  scanId: string
  pluginVersion: string
  threadId: string
  reportAvailable: boolean
  sarifAvailable: boolean
  coverage: {
    mode: string
    completeness: 'complete' | 'partial' | 'unknown'
    surfaces: number
    deferred: number
    openQuestions: number
  }
  findings: SecurityFinding[]
}

export type SecurityScanRecord = {
  id: string
  projectId: string
  projectName: string
  projectPath: string
  createdAt: string
  updatedAt: string
  status: SecurityScanStatus
  request: SecurityScanRequest
  progress: SecurityScanProgress | null
  result: SecurityScanResult | null
  error: { code: string; message: string } | null
}

export type SecurityPreflight = {
  projectId: string
  repository: string
  targetKind: SecurityTargetKind
  mode: SecurityScanMode
  outputIsolated: boolean
  authentication: string
  model: string
  modelProvider?: string
  reasoningEffort: string
}

export type SecurityRuntimeStatus = {
  sdkVersion: string
  bundledPluginVersion: string
  codexSdkVersion: string
  codexExecutableVersion: string
  nodeSupported: boolean
  python: { status: 'ready' | 'missing' | 'unknown'; executable?: string; message?: string }
  account: { status: 'authenticated' | 'missing' | 'unknown'; details?: string }
  access: 'granted' | 'not_granted' | 'unknown'
  deepseek: {
    configured: boolean
    integration: 'norevinq-sdk-extension'
    models: SecurityDeepSeekModel[]
  }
}

export type SecuritySnapshot = {
  runtime: SecurityRuntimeStatus
  activeScanId: string | null
  scans: SecurityScanRecord[]
}

export type SecurityArtifactInput = {
  scanId: string
  kind: 'report' | 'sarif' | 'findings' | 'coverage' | 'manifest'
}

export type SecurityArtifact = {
  kind: SecurityArtifactInput['kind']
  content: string
  truncated: boolean
}

export type SecurityFindingActionInput = {
  scanId: string
  occurrenceId: string
  action: 'validate' | 'patch' | 'false_positive'
  confirmed: boolean
  reason?: string
}

export type SecurityFindingActionResult = {
  action: SecurityFindingActionInput['action']
  output: string
  truncated: boolean
}

export type SecurityExportInput = {
  scanId: string
  format: 'json' | 'csv' | 'sarif'
}

export type SecurityExportResult = {
  format: SecurityExportInput['format']
  content: string
  truncated: boolean
}

export type SecuritySaveExportInput = {
  scanId: string
  format: 'report' | SecurityExportInput['format']
}

export type SecuritySaveExportResult = {
  exported: boolean
  fileName: string | null
  bytes: number
}

export type SecuritySubscription = (snapshot: SecuritySnapshot) => void
