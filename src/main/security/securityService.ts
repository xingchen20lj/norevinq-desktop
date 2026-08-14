import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  BUNDLED_PLUGIN_VERSION,
  CodexSecurity,
  DiffTarget,
  VERSION,
  resolvePluginPython,
  type AccountStatus,
  type CodexSecurityConfig,
  type ScanOptions,
  type ScanPreflight,
  type ScanResult,
  type ScanTokenUsage,
} from '@openai/codex-security'
import type {
  SecurityArtifact,
  SecurityArtifactInput,
  SecurityExportInput,
  SecurityExportResult,
  SecurityFinding,
  SecurityFindingActionInput,
  SecurityFindingActionResult,
  SecurityPreflight,
  SecurityRuntimeStatus,
  SecurityScanRecord,
  SecurityScanRequest,
  SecuritySnapshot,
  SecuritySubscription,
} from '../../shared/security.js'
import type { StateDatabase } from '../state/database.js'
import { redactString } from '../logging/redact.js'
import {
  createDeepSeekSecurityConfig,
  DEEPSEEK_SECURITY_MODELS,
  isDeepSeekSecurityModel,
} from '../providers/deepseek.js'
import {
  DeepSeekUsageAccumulator,
  resolveUsdCnyQuote,
  type UsdCnyQuote,
} from '../providers/deepseekPricing.js'

const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024

type SecuritySdk = Pick<CodexSecurity, 'metadata' | 'preflight' | 'run' | 'account' | 'close'>
type SecuritySdkFactory = (config?: CodexSecurityConfig) => SecuritySdk

export type SecurityServiceOptions = {
  sdkFactory?: SecuritySdkFactory
  deepSeekCredential?: () => string | null
  codexBinary?: () => string | null
  environment?: NodeJS.ProcessEnv
  exchangeRateResolver?: () => Promise<UsdCnyQuote>
  pythonResolver?: () => Promise<string>
  now?: () => Date
  cliRunner?: (cwd: string, args: string[]) => Promise<string>
}

export class SecurityService {
  readonly #database: StateDatabase
  readonly #outputRoot: string
  readonly #stateRoot: string
  readonly #sdk: SecuritySdk
  readonly #sdkFactory: SecuritySdkFactory
  readonly #deepSeekCredential: () => string | null
  readonly #codexBinary: () => string | null
  readonly #requireCodexBinary: boolean
  readonly #environment: NodeJS.ProcessEnv
  readonly #exchangeRateResolver: () => Promise<UsdCnyQuote>
  readonly #pythonResolver: () => Promise<string>
  readonly #now: () => Date
  readonly #cliRunner: (cwd: string, args: string[]) => Promise<string>
  readonly #subscriptions = new Set<SecuritySubscription>()
  readonly #abortControllers = new Map<string, AbortController>()
  readonly #ephemeralSdks = new Set<SecuritySdk>()
  #snapshot: SecuritySnapshot
  #lastPersistedAt = 0

  constructor(database: StateDatabase, securityRoot: string, options: SecurityServiceOptions = {}) {
    this.#database = database
    this.#outputRoot = join(securityRoot, 'scans')
    this.#stateRoot = join(securityRoot, 'sdk-state')
    this.#now = options.now ?? (() => new Date())
    preparePrivateDirectory(securityRoot)
    preparePrivateDirectory(this.#outputRoot)
    preparePrivateDirectory(this.#stateRoot)
    process.env.CODEX_SECURITY_STATE_DIR = this.#stateRoot
    this.#sdkFactory = options.sdkFactory ?? ((config) => new CodexSecurity(config))
    this.#sdk = this.#sdkFactory()
    this.#deepSeekCredential = options.deepSeekCredential ?? (() => null)
    this.#codexBinary = options.codexBinary ?? (() => null)
    this.#requireCodexBinary = options.codexBinary !== undefined
    this.#environment = options.environment ?? process.env
    this.#exchangeRateResolver = options.exchangeRateResolver ?? (() => resolveUsdCnyQuote())
    this.#pythonResolver = options.pythonResolver ?? (() => resolvePluginPython({
      environment: process.env,
      protectedRoot: this.#stateRoot,
    }))
    this.#cliRunner = options.cliRunner ?? ((cwd, args) => runSecurityCli(this.#stateRoot, cwd, args))
    this.#snapshot = {
      runtime: initialRuntime(this.#sdk, this.#deepSeekCredential() !== null),
      activeScanId: null,
      scans: this.#database.listSecurityScans(),
    }
  }

  getSnapshot(): SecuritySnapshot {
    return structuredClone(this.#snapshot)
  }

  subscribe(subscription: SecuritySubscription): () => void {
    this.#subscriptions.add(subscription)
    return () => this.#subscriptions.delete(subscription)
  }

  async refreshRuntime(): Promise<SecuritySnapshot> {
    const runtime = initialRuntime(this.#sdk, this.#deepSeekCredential() !== null)
    const [python, account] = await Promise.allSettled([this.#pythonResolver(), this.#sdk.account()])
    runtime.python = python.status === 'fulfilled'
      ? { status: 'ready', executable: python.value }
      : { status: 'missing', message: safeErrorMessage(python.reason) }
    runtime.account = account.status === 'fulfilled'
      ? toAccountStatus(account.value)
      : { status: classifyAccountFailure(account.reason), details: safeErrorMessage(account.reason) }
    this.#snapshot = { ...this.#snapshot, runtime }
    this.#emit()
    return this.getSnapshot()
  }

  async preflight(request: SecurityScanRequest): Promise<SecurityPreflight> {
    const project = this.#requireProject(request.projectId)
    const outputDir = join(this.#outputRoot, `preflight-${randomUUID()}`)
    const selected = this.#sdkForRequest(request)
    try {
      const result = await selected.sdk.preflight(project.path, this.#scanOptions(request, outputDir))
      return toSecurityPreflight(request.projectId, result, this.#outputRoot)
    } finally {
      if (selected.ephemeral) await this.#closeEphemeralSdk(selected.sdk)
    }
  }

  startScan(request: SecurityScanRequest): SecuritySnapshot {
    if (this.#snapshot.activeScanId) throw new Error('已有安全扫描正在运行；请等待完成或先取消。')
    this.#validateProviderRequest(request)
    const project = this.#requireProject(request.projectId)
    const id = randomUUID()
    const timestamp = this.#now().toISOString()
    const record: SecurityScanRecord = {
      id,
      projectId: project.id,
      projectName: project.name,
      projectPath: project.path,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'queued',
      request: structuredClone(request),
      progress: { phase: 'preflight', filesCompleted: 0, filesTotal: 0 },
      result: null,
      error: null,
    }
    this.#database.upsertSecurityScan(record)
    this.#snapshot = { ...this.#snapshot, activeScanId: id, scans: [record, ...this.#snapshot.scans] }
    this.#emit()
    void this.#executeScan(record)
    return this.getSnapshot()
  }

  cancelScan(scanId: string): SecuritySnapshot {
    if (this.#snapshot.activeScanId !== scanId) throw new Error('该扫描当前未运行。')
    const controller = this.#abortControllers.get(scanId)
    if (!controller) throw new Error('扫描仍在准备中，请稍后重试取消。')
    controller.abort(new Error('Cancelled by user'))
    return this.getSnapshot()
  }

  readArtifact(input: SecurityArtifactInput): SecurityArtifact {
    const scan = this.#database.getSecurityScan(input.scanId)
    if (!scan?.result || scan.status !== 'completed') throw new Error('扫描产物不可用。')
    const scanRoot = join(this.#outputRoot, scan.id)
    const relativePath = artifactRelativePath(input.kind)
    const candidate = resolve(scanRoot, relativePath)
    if (!existsSync(candidate) || !statSync(candidate).isFile()) throw new Error('请求的扫描产物不存在。')
    const canonicalRoot = realpathSync(scanRoot)
    const canonicalFile = realpathSync(candidate)
    const pathFromRoot = relative(canonicalRoot, canonicalFile)
    if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) throw new Error('扫描产物路径越界。')
    const size = statSync(canonicalFile).size
    const bytes = readFileSync(canonicalFile).subarray(0, MAX_ARTIFACT_BYTES)
    return { kind: input.kind, content: bytes.toString('utf8'), truncated: size > MAX_ARTIFACT_BYTES }
  }

  async runFindingAction(input: SecurityFindingActionInput): Promise<SecurityFindingActionResult> {
    if (!input.confirmed) throw new Error('安全漏洞操作需要显式确认。')
    const scan = this.#requireCompletedScan(input.scanId)
    const finding = scan.result.findings.find(({ occurrenceId }) => occurrenceId === input.occurrenceId)
    if (!finding) throw new Error('Finding not found in this scan.')
    let args: string[]
    if (input.action === 'false_positive') {
      const reason = input.reason?.trim()
      if (!reason) throw new Error('标记误报必须提供原因。')
      args = ['findings', 'false-positive', finding.occurrenceId, '--reason', reason]
    } else {
      const issue = findingActionText(finding)
      args = [input.action === 'validate' ? 'validate' : 'patch', issue, '--effort', 'high']
    }
    const output = await this.#cliRunner(scan.projectPath, args)
    return {
      action: input.action,
      output: output.slice(0, MAX_ARTIFACT_BYTES),
      truncated: Buffer.byteLength(output) > MAX_ARTIFACT_BYTES,
    }
  }

  async exportFindings(input: SecurityExportInput): Promise<SecurityExportResult> {
    const scan = this.#requireCompletedScan(input.scanId)
    const scanDir = join(this.#outputRoot, scan.id)
    const extension = input.format === 'sarif' ? 'sarif' : input.format
    const outputPath = join(scanDir, 'exports', `aster-findings.${extension}`)
    mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 })
    await this.#cliRunner(scan.projectPath, [
      'export', scanDir, '--export-format', input.format, '--output', outputPath,
    ])
    const canonicalRoot = realpathSync(scanDir)
    const canonicalOutput = realpathSync(outputPath)
    const fromRoot = relative(canonicalRoot, canonicalOutput)
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new Error('导出路径越界。')
    const size = statSync(canonicalOutput).size
    return {
      format: input.format,
      content: readFileSync(canonicalOutput).subarray(0, MAX_ARTIFACT_BYTES).toString('utf8'),
      truncated: size > MAX_ARTIFACT_BYTES,
    }
  }

  async dispose(): Promise<void> {
    for (const controller of this.#abortControllers.values()) controller.abort(new Error('Application closing'))
    this.#abortControllers.clear()
    this.#subscriptions.clear()
    await Promise.allSettled([...this.#ephemeralSdks].map((sdk) => sdk.close()))
    this.#ephemeralSdks.clear()
    await this.#sdk.close()
  }

  async #executeScan(initial: SecurityScanRecord): Promise<void> {
    const controller = new AbortController()
    this.#abortControllers.set(initial.id, controller)
    this.#replaceScan(initial.id, { status: 'running', error: null }, true)
    const outputDir = join(this.#outputRoot, initial.id)
    let selected: { sdk: SecuritySdk; ephemeral: boolean } | null = null
    try {
      selected = this.#sdkForRequest(initial.request)
      const usageAccumulator = await this.#usageAccumulator(initial.request)
      if (controller.signal.aborted) throw controller.signal.reason
      const result = await selected.sdk.run(initial.projectPath, {
        ...this.#scanOptions(initial.request, outputDir),
        signal: controller.signal,
        onAuthentication: (authentication) => this.#updateProgress(initial.id, {
          activity: `认证来源：${authentication.method}`,
        }),
        onTrustedAccessStatus: (access) => {
          this.#snapshot = { ...this.#snapshot, runtime: { ...this.#snapshot.runtime, access } }
          this.#updateProgress(initial.id, { trustedAccess: access })
        },
        onScanStarted: () => this.#updateProgress(initial.id, { activity: '安全扫描已启动' }),
        onProgress: (progress) => this.#updateProgress(initial.id, progress),
        onActivity: (activity) => this.#updateProgress(initial.id, { activity: activity.description }),
        onCost: (cost) => this.#updateProgress(initial.id, { costUsd: cost.estimatedUsd }),
        ...(usageAccumulator ? {
          onUsage: (usage: ScanTokenUsage) => this.#updateProgress(initial.id, {
            deepseekUsage: usageAccumulator.update(usage, this.#now()),
          }),
        } : {}),
        onReconnect: (attempt, maxAttempts) => this.#updateProgress(initial.id, {
          activity: `连接恢复 ${String(attempt)}/${String(maxAttempts)}`,
        }),
        onWarning: (warning) => this.#updateProgress(initial.id, { activity: `警告：${warning}` }),
      })
      this.#replaceScan(initial.id, {
        status: 'completed',
        result: toSecurityResult(result),
        error: null,
      }, true)
    } catch (error) {
      const cancelled = controller.signal.aborted
      this.#replaceScan(initial.id, {
        status: cancelled ? 'cancelled' : 'failed',
        error: { code: classifySecurityError(error), message: safeErrorMessage(error) },
      }, true)
    } finally {
      if (selected?.ephemeral) await this.#closeEphemeralSdk(selected.sdk)
      this.#abortControllers.delete(initial.id)
      this.#snapshot = { ...this.#snapshot, activeScanId: null }
      this.#emit()
    }
  }

  #scanOptions(request: SecurityScanRequest, outputDir: string): ScanOptions {
    const provider = request.provider ?? 'openai'
    const options: ScanOptions = {
      auth: provider === 'deepseek' ? 'api-key' : request.auth,
      mode: request.mode,
      outputDir,
      archiveExisting: false,
      target: toSdkTarget(request),
      ...(provider === 'deepseek' || request.maxCostUsd === undefined ? {} : { maxCostUsd: request.maxCostUsd }),
    }
    if (request.mode === 'deep' && request.deep) {
      options.workers = request.deep.workers
      options.subagents = request.deep.subagents
      options.stopAfterNoNew = request.deep.stopAfterNoNew
      options.maxDiscoveryRuns = request.deep.maxDiscoveryRuns
    }
    return options
  }

  #sdkForRequest(request: SecurityScanRequest): { sdk: SecuritySdk; ephemeral: boolean } {
    if ((request.provider ?? 'openai') === 'openai') return { sdk: this.#sdk, ephemeral: false }
    this.#validateProviderRequest(request)
    const credential = this.#deepSeekCredential()
    if (!credential) throw new Error('尚未配置 DeepSeek API Key；请先前往设置保存凭据。')
    const model = request.model
    if (!model || !isDeepSeekSecurityModel(model)) throw new Error('DeepSeek 安全扫描模型无效。')
    const codexBinary = this.#codexBinary()
    if (this.#requireCodexBinary && !codexBinary) {
      throw new Error('Aster 智能体运行时尚未就绪；请等待状态变为已就绪后重试安全扫描。')
    }
    const sdk = this.#sdkFactory(createDeepSeekSecurityConfig(
      model,
      credential,
      this.#stateRoot,
      this.#environment,
      codexBinary,
    ))
    this.#ephemeralSdks.add(sdk)
    return { sdk, ephemeral: true }
  }

  #validateProviderRequest(request: SecurityScanRequest): void {
    if ((request.provider ?? 'openai') !== 'deepseek') return
    if (!this.#deepSeekCredential()) throw new Error('尚未配置 DeepSeek API Key；请先前往设置保存凭据。')
    if (!request.model || !isDeepSeekSecurityModel(request.model)) throw new Error('请选择有效的 DeepSeek 安全扫描模型。')
    if (request.maxCostUsd !== undefined) {
      throw new Error('Aster 安全引擎尚无 DeepSeek 官方计价器，不能为该扫描提供可靠的美元硬上限。')
    }
  }

  async #closeEphemeralSdk(sdk: SecuritySdk): Promise<void> {
    this.#ephemeralSdks.delete(sdk)
    await sdk.close()
  }

  async #usageAccumulator(request: SecurityScanRequest): Promise<DeepSeekUsageAccumulator | null> {
    if ((request.provider ?? 'openai') !== 'deepseek' || !request.model) return null
    const quote = await this.#exchangeRateResolver()
    return new DeepSeekUsageAccumulator(request.model, quote)
  }

  #updateProgress(scanId: string, patch: Partial<NonNullable<SecurityScanRecord['progress']>>): void {
    const current = this.#snapshot.scans.find(({ id }) => id === scanId)?.progress
    const activity = patch.activity ?? current?.activity
    const costUsd = patch.costUsd ?? current?.costUsd
    const trustedAccess = patch.trustedAccess ?? current?.trustedAccess
    const deepseekUsage = patch.deepseekUsage ?? current?.deepseekUsage
    this.#replaceScan(scanId, {
      progress: {
        phase: patch.phase ?? current?.phase ?? 'preflight',
        filesCompleted: patch.filesCompleted ?? current?.filesCompleted ?? 0,
        filesTotal: patch.filesTotal ?? current?.filesTotal ?? 0,
        ...(activity === undefined ? {} : { activity }),
        ...(costUsd === undefined ? {} : { costUsd }),
        ...(trustedAccess === undefined ? {} : { trustedAccess }),
        ...(deepseekUsage === undefined ? {} : { deepseekUsage }),
      },
    }, Date.now() - this.#lastPersistedAt >= 500)
  }

  #replaceScan(scanId: string, patch: Partial<SecurityScanRecord>, persist: boolean): void {
    const index = this.#snapshot.scans.findIndex(({ id }) => id === scanId)
    if (index < 0) return
    const current = this.#snapshot.scans[index]
    if (!current) return
    const updated: SecurityScanRecord = { ...current, ...patch, updatedAt: this.#now().toISOString() }
    const scans = this.#snapshot.scans.with(index, updated)
    this.#snapshot = { ...this.#snapshot, scans }
    if (persist) {
      this.#database.upsertSecurityScan(updated)
      this.#lastPersistedAt = Date.now()
    }
    this.#emit()
  }

  #requireProject(projectId: string): NonNullable<ReturnType<StateDatabase['getProject']>> {
    const project = this.#database.getProject(projectId)
    if (!project) throw new Error('Project not found.')
    return project
  }

  #requireCompletedScan(scanId: string): SecurityScanRecord & { result: NonNullable<SecurityScanRecord['result']> } {
    const scan = this.#database.getSecurityScan(scanId)
    if (!scan?.result || scan.status !== 'completed') throw new Error('只有完整密封的扫描可执行此操作。')
    return scan as SecurityScanRecord & { result: NonNullable<SecurityScanRecord['result']> }
  }

  #emit(): void {
    const snapshot = this.getSnapshot()
    for (const subscription of this.#subscriptions) subscription(snapshot)
  }
}

function initialRuntime(sdk: SecuritySdk, deepSeekConfigured: boolean): SecurityRuntimeStatus {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
  return {
    sdkVersion: VERSION,
    bundledPluginVersion: BUNDLED_PLUGIN_VERSION,
    codexSdkVersion: sdk.metadata.sdkVersion,
    codexExecutableVersion: sdk.metadata.executableVersion,
    nodeSupported: major === 22 || major === 24 || major === 26,
    python: { status: 'unknown' },
    account: { status: 'unknown' },
    access: 'unknown',
    deepseek: {
      configured: deepSeekConfigured,
      integration: 'aster-sdk-extension',
      models: [...DEEPSEEK_SECURITY_MODELS],
    },
  }
}

function toAccountStatus(account: AccountStatus): SecurityRuntimeStatus['account'] {
  return account.authenticated
    ? { status: 'authenticated', details: redactString(account.details) }
    : { status: 'missing', details: redactString(account.details) }
}

function classifyAccountFailure(error: unknown): 'missing' | 'unknown' {
  return errorName(error) === 'AuthenticationRequiredError' ? 'missing' : 'unknown'
}

function toSecurityPreflight(projectId: string, value: ScanPreflight, outputRoot: string): SecurityPreflight {
  const output = value.outputDir ? resolve(value.outputDir) : ''
  const root = resolve(outputRoot)
  const relativeOutput = relative(root, output)
  return {
    projectId,
    repository: value.repository,
    targetKind: value.target.kind,
    mode: value.mode,
    outputIsolated: Boolean(output) && !relativeOutput.startsWith('..') && !isAbsolute(relativeOutput),
    authentication: value.authentication.method,
    model: value.model,
    ...(value.modelProvider ? { modelProvider: value.modelProvider } : {}),
    reasoningEffort: value.reasoningEffort,
  }
}

function toSdkTarget(request: SecurityScanRequest): NonNullable<ScanOptions['target']> {
  switch (request.target.kind) {
    case 'repository': return 'repository'
    case 'paths': return request.target.paths ?? []
    case 'working_tree': return DiffTarget.workingTree({ base: request.target.base ?? 'HEAD' })
    case 'refs': return DiffTarget.refs({
      base: request.target.base ?? 'HEAD~1',
      ...(request.target.head ? { head: request.target.head } : {}),
    })
  }
}

function toSecurityResult(result: ScanResult): NonNullable<SecurityScanRecord['result']> {
  return {
    scanId: result.manifest.scan.id,
    pluginVersion: result.pluginVersion,
    threadId: result.threadId,
    reportAvailable: true,
    sarifAvailable: result.sarifPath !== null,
    coverage: {
      mode: result.coverage.mode,
      completeness: result.coverage.completeness,
      surfaces: result.coverage.surfaces.length,
      deferred: result.coverage.deferred.length,
      openQuestions: result.coverage.openQuestions?.length ?? 0,
    },
    findings: result.findings.findings.map(toSecurityFinding),
  }
}

function toSecurityFinding(finding: ScanResult['findings']['findings'][number]): SecurityFinding {
  const rootCause = typeof finding.rootCause === 'string'
    ? finding.rootCause
    : finding.rootCause?.summary
  return {
    findingId: finding.findingId,
    occurrenceId: finding.occurrenceId,
    ruleId: finding.ruleId,
    title: finding.title,
    summary: finding.summary,
    severity: finding.severity.level,
    ...(finding.severity.score === undefined ? {} : { severityScore: finding.severity.score }),
    confidence: finding.confidence.level,
    category: finding.taxonomy.category,
    cwe: [...finding.taxonomy.cwe],
    locations: finding.locations.map((location) => ({
      path: location.path,
      startLine: location.startLine,
      ...(location.endLine === undefined ? {} : { endLine: location.endLine }),
      ...(location.role === undefined ? {} : { role: location.role }),
    })),
    evidence: (finding.codeEvidence ?? []).map((evidence) => ({
      label: evidence.label,
      path: evidence.path,
      startLine: evidence.startLine,
      code: evidence.code,
      explanation: evidence.explanation,
    })),
    ...(rootCause ? { rootCause } : {}),
    remediation: finding.remediation,
    validation: finding.validation ?? null,
    attackPath: finding.attackPath ?? null,
    remediationTests: [...(finding.remediationTests ?? [])],
    preventiveControls: [...(finding.preventiveControls ?? [])],
  }
}

function classifySecurityError(error: unknown): string {
  const name = errorName(error)
  const mapping: Record<string, string> = {
    AuthenticationRequiredError: 'authentication_required',
    ConfigurationError: 'configuration',
    ContractValidationError: 'contract_validation',
    IncompleteScanError: 'incomplete_scan',
    InvalidTargetError: 'invalid_target',
    OutputDirectoryError: 'output_directory',
    OutputInsideProtectedRootError: 'output_inside_protected_root',
    PluginBootstrapError: 'plugin_bootstrap',
    PluginPythonUnavailableError: 'python_unavailable',
    ScanCostLimitExceededError: 'cost_limit',
    ScanInterruptedError: 'interrupted',
  }
  if (mapping[name]) return mapping[name]
  const message = safeErrorMessage(error).toLocaleLowerCase('en-US')
  if (message.includes('trusted access') || message.includes('forbidden') || message.includes('403')) {
    return 'security_access_required'
  }
  return 'unknown'
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return redactString(error.message).slice(0, 4_096)
  return redactString(String(error)).slice(0, 4_096)
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.constructor.name : ''
}

function artifactRelativePath(kind: SecurityArtifactInput['kind']): string {
  switch (kind) {
    case 'report': return 'report.md'
    case 'sarif': return join('exports', 'results.sarif')
    case 'findings': return 'findings.json'
    case 'coverage': return 'coverage.json'
    case 'manifest': return 'scan-manifest.json'
  }
}

function preparePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') chmodSync(path, 0o700)
}

function findingActionText(finding: SecurityFinding): string {
  const location = finding.locations[0]
  return [
    finding.title,
    finding.summary,
    location ? `Location: ${location.path}:${String(location.startLine)}` : '',
    `Severity: ${finding.severity}`,
    `Remediation: ${finding.remediation}`,
  ].filter(Boolean).join('\n')
}

function runSecurityCli(stateRoot: string, cwd: string, args: string[]): Promise<string> {
  const entry = fileURLToPath(import.meta.resolve('@openai/codex-security'))
  const executable = join(dirname(dirname(entry)), 'bin', 'codex-security.mjs')
  return new Promise((resolvePromise, reject) => {
    execFile(process.execPath, [executable, ...args], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEX_SECURITY_STATE_DIR: stateRoot,
        ELECTRON_RUN_AS_NODE: process.versions.electron ? '1' : undefined,
      },
      maxBuffer: MAX_ARTIFACT_BYTES,
      timeout: 30 * 60 * 1_000,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(redactString(stderr || error.message)))
        return
      }
      resolvePromise(redactString(stdout))
    })
  })
}
