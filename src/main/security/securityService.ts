import { randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
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
  SecuritySaveExportInput,
  SecuritySaveExportResult,
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
const MAX_FAILURE_MANIFEST_BYTES = 64 * 1024
const MAX_MCP_MANIFEST_BYTES = 64 * 1024
const MAX_MCP_PREFLIGHT_OUTPUT_BYTES = 2 * 1024 * 1024
const SECURITY_PLUGIN_RUNTIME_REVISION = 2
const MCP_RUNTIME_CHUNK_PREFIX = 'server.mjs.br.part-'
const ARTIFACT_MCP_ENV_MARKER = `        env: {
          CODEX_SECURITY_ARTIFACT_ROOT: assigned.root,`
const ARTIFACT_MCP_ENV_REPLACEMENT = `        env: {
          ...process.env.ELECTRON_RUN_AS_NODE ? { ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE } : {},
          CODEX_SECURITY_ARTIFACT_ROOT: assigned.root,`

function securityScanPrompt(language: 'zh-CN' | 'en'): string {
  if (language === 'en') {
    return 'Write all human-readable finding titles, summaries, evidence explanations, remediation guidance, and report prose in English. Preserve source code, identifiers, file paths, commands, CWE identifiers, and machine-schema enum values exactly.'
  }
  return '请使用简体中文撰写所有面向用户的漏洞标题、摘要、证据说明、修复建议和报告正文。源代码、标识符、文件路径、命令、CWE 编号及机器结构中的枚举值必须保持原样。'
}

type SecuritySdk = Pick<CodexSecurity, 'metadata' | 'preflight' | 'run' | 'account' | 'close'>
type SecuritySdkFactory = (config?: CodexSecurityConfig) => SecuritySdk

export type SecurityServiceOptions = {
  sdkFactory?: SecuritySdkFactory
  pluginPath?: string
  deepSeekCredential?: () => string | null
  codexBinary?: () => string | null
  environment?: NodeJS.ProcessEnv
  exchangeRateResolver?: () => Promise<UsdCnyQuote>
  pythonResolver?: () => Promise<string>
  now?: () => Date
  platform?: NodeJS.Platform
  cliRunner?: (cwd: string, args: string[]) => Promise<string>
  nodeRuntimeExecutable?: string
  electronNodeRuntime?: boolean
}

export class SecurityService {
  readonly #database: StateDatabase
  readonly #outputRoot: string
  readonly #stateRoot: string
  readonly #sdk: SecuritySdk
  readonly #sdkFactory: SecuritySdkFactory
  readonly #pluginPath: string | undefined
  readonly #deepSeekCredential: () => string | null
  readonly #codexBinary: () => string | null
  readonly #requireCodexBinary: boolean
  readonly #environment: NodeJS.ProcessEnv
  readonly #exchangeRateResolver: () => Promise<UsdCnyQuote>
  readonly #pythonResolver: () => Promise<string>
  readonly #now: () => Date
  readonly #platform: NodeJS.Platform
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
    this.#platform = options.platform ?? process.platform
    preparePrivateDirectory(securityRoot)
    preparePrivateDirectory(this.#outputRoot)
    preparePrivateDirectory(this.#stateRoot)
    process.env.CODEX_SECURITY_STATE_DIR = this.#stateRoot
    this.#sdkFactory = options.sdkFactory ?? ((config) => new CodexSecurity(config))
    this.#pluginPath = options.pluginPath
      ? prepareSecurityPluginRuntime(
        this.#stateRoot,
        options.pluginPath,
        options.nodeRuntimeExecutable ?? process.execPath,
        options.electronNodeRuntime ?? Boolean(process.versions.electron),
      )
      : undefined
    this.#sdk = this.#sdkFactory(this.#pluginPath ? { pluginPath: this.#pluginPath } : undefined)
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

  exportFindings(input: SecurityExportInput): Promise<SecurityExportResult> {
    const canonicalOutput = this.#prepareExportFile(input)
    const size = statSync(canonicalOutput).size
    return Promise.resolve({
      format: input.format,
      content: readFileSync(canonicalOutput).subarray(0, MAX_ARTIFACT_BYTES).toString('utf8'),
      truncated: size > MAX_ARTIFACT_BYTES,
    })
  }

  saveExport(input: SecuritySaveExportInput, destinationPath: string): Promise<SecuritySaveExportResult> {
    if (!isAbsolute(destinationPath)) throw new Error('导出目标必须是绝对路径。')
    const sourcePath = input.format === 'report'
      ? this.#resolveArtifactPath(input.scanId, 'report')
      : this.#prepareExportFile({ scanId: input.scanId, format: input.format })
    mkdirSync(dirname(destinationPath), { recursive: true, mode: 0o700 })
    copyFileSync(sourcePath, destinationPath)
    chmodSync(destinationPath, 0o600)
    return Promise.resolve({
      exported: true,
      fileName: basename(destinationPath),
      bytes: statSync(destinationPath).size,
    })
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
      if (initial.request.mode === 'deep' && this.#pluginPath) {
        this.#updateProgress(initial.id, { activity: '正在验证深度扫描本地协调器' })
        await assertDeepScanMcpAvailable(this.#pluginPath, this.#stateRoot, this.#environment, controller.signal)
      }
      const usageAccumulator = await this.#usageAccumulator(initial.request)
      if (controller.signal.aborted) throw controller.signal.reason
      if (initial.request.mode === 'deep' && this.#platform === 'darwin') {
        this.#updateProgress(initial.id, {
          activity: 'macOS 深扫描使用官方外层安全沙箱兼容模式',
        })
      }
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
      const failure = cancelled ? error : resolveSecurityFailure(error, outputDir)
      this.#replaceScan(initial.id, {
        status: cancelled ? 'cancelled' : 'failed',
        error: { code: classifySecurityError(failure), message: safeErrorMessage(failure) },
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
      scanPrompt: securityScanPrompt(request.reportLanguage ?? 'zh-CN'),
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

  #prepareExportFile(input: SecurityExportInput): string {
    const scan = this.#requireCompletedScan(input.scanId)
    const scanDir = join(this.#outputRoot, scan.id)
    if (input.format === 'json') return this.#resolveArtifactPath(scan.id, 'findings')
    if (input.format === 'sarif') return this.#resolveArtifactPath(scan.id, 'sarif')

    const outputPath = join(scanDir, 'exports', `norevinq-findings.${input.format}`)
    mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 })
    const temporaryPath = join(dirname(outputPath), `.${basename(outputPath)}.${randomUUID()}.tmp`)
    try {
      writeFileSync(temporaryPath, findingsCsv(scan.result.findings), {
        encoding: 'utf8', mode: 0o600, flag: 'wx',
      })
      if (existsSync(outputPath)) {
        if (lstatSync(outputPath).isDirectory()) throw new Error('CSV 导出目标不是普通文件。')
        rmSync(outputPath, { force: true })
      }
      renameSync(temporaryPath, outputPath)
    } catch (error) {
      rmSync(temporaryPath, { force: true })
      throw error
    }
    if (this.#platform !== 'win32') chmodSync(outputPath, 0o600)
    return this.#requireContainedFile(scanDir, outputPath, '导出路径越界。')
  }

  #resolveArtifactPath(scanId: string, kind: SecurityArtifactInput['kind']): string {
    const scan = this.#requireCompletedScan(scanId)
    const scanRoot = join(this.#outputRoot, scan.id)
    const candidate = resolve(scanRoot, artifactRelativePath(kind))
    if (!existsSync(candidate) || !statSync(candidate).isFile()) throw new Error('请求的扫描产物不存在。')
    return this.#requireContainedFile(scanRoot, candidate, '扫描产物路径越界。')
  }

  #requireContainedFile(root: string, candidate: string, message: string): string {
    const canonicalRoot = realpathSync(root)
    const canonicalFile = realpathSync(candidate)
    const fromRoot = relative(canonicalRoot, canonicalFile)
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new Error(message)
    return canonicalFile
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
      throw new Error('Norevinq 智能体运行时尚未就绪；请等待状态变为已就绪后重试安全扫描。')
    }
    const effectiveCodexBinary = request.mode === 'deep' && codexBinary
      ? prepareMacDeepScanCodexWrapper(this.#stateRoot, codexBinary, this.#platform)
      : codexBinary
    const config = createDeepSeekSecurityConfig(
      model,
      credential,
      this.#stateRoot,
      this.#environment,
      effectiveCodexBinary,
    )
    const sdk = this.#sdkFactory(this.#pluginPath ? { ...config, pluginPath: this.#pluginPath } : config)
    this.#ephemeralSdks.add(sdk)
    return { sdk, ephemeral: true }
  }

  #validateProviderRequest(request: SecurityScanRequest): void {
    if ((request.provider ?? 'openai') !== 'deepseek') return
    if (!this.#deepSeekCredential()) throw new Error('尚未配置 DeepSeek API Key；请先前往设置保存凭据。')
    if (!request.model || !isDeepSeekSecurityModel(request.model)) throw new Error('请选择有效的 DeepSeek 安全扫描模型。')
    if (request.maxCostUsd !== undefined) {
      throw new Error('Norevinq 安全引擎尚无 DeepSeek 官方计价器，不能为该扫描提供可靠的美元硬上限。')
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
      integration: 'norevinq-sdk-extension',
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
  if (message.includes('深度扫描本地协调器') || message.includes('深度扫描协调工具')) {
    return 'deep_mcp_unavailable'
  }
  if (message.includes('deep scan stopped') || message.includes('deep security scan terminally failed')) {
    return message.includes('operation not permitted')
      ? 'deep_worker_sandbox'
      : 'deep_discovery_failed'
  }
  if (message.includes('did not create required draft artifacts')) return 'scan_artifacts_missing'
  if (message.includes('trusted access') || message.includes('forbidden') || message.includes('403')) {
    return 'security_access_required'
  }
  return 'unknown'
}

type DeepFailureManifest = {
  status?: unknown
  failure?: { message?: unknown } | null
}

function resolveSecurityFailure(error: unknown, outputDir: string): unknown {
  const secondary = safeErrorMessage(error).toLocaleLowerCase('en-US')
  if (!secondary.includes('only a running scan can be completed')
    && !secondary.includes('could not save the codex security scan')) return error
  const manifestPath = join(outputDir, 'artifacts', 'deep_discovery', 'coordinator-manifest.json')
  try {
    const metadata = lstatSync(manifestPath)
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_FAILURE_MANIFEST_BYTES) return error
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as DeepFailureManifest
    const message = manifest.status === 'failed' && typeof manifest.failure?.message === 'string'
      ? manifest.failure.message.trim()
      : ''
    return message ? new Error(`Deep Scan discovery failed: ${message}`) : error
  } catch {
    return error
  }
}

export function prepareMacDeepScanCodexWrapper(
  stateRoot: string,
  codexBinary: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'darwin') return codexBinary
  assertSafeRuntimePath(codexBinary)
  const canonicalBinary = realpathSync(codexBinary)
  assertSafeRuntimePath(canonicalBinary)
  const binaryMetadata = lstatSync(canonicalBinary)
  if (!binaryMetadata.isFile() || binaryMetadata.isSymbolicLink() || (binaryMetadata.mode & 0o111) === 0) {
    throw new Error('Norevinq 智能体运行时不是可执行的普通文件。')
  }
  const wrapperRoot = join(stateRoot, 'deep-worker-runtime')
  preparePrivateDirectory(wrapperRoot)
  const wrapperPath = join(wrapperRoot, 'codex')
  const binaryPathFile = join(wrapperRoot, 'real-codex-path')
  const nonce = randomUUID()
  const temporaryWrapper = `${wrapperPath}.${nonce}.tmp`
  const temporaryPathFile = `${binaryPathFile}.${nonce}.tmp`
  writeFileSync(temporaryPathFile, `${canonicalBinary}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  writeFileSync(temporaryWrapper, MAC_DEEP_SCAN_WRAPPER, { encoding: 'utf8', mode: 0o700, flag: 'wx' })
  renameSync(temporaryPathFile, binaryPathFile)
  renameSync(temporaryWrapper, wrapperPath)
  if (process.platform !== 'win32') {
    chmodSync(binaryPathFile, 0o600)
    chmodSync(wrapperPath, 0o700)
  }
  return wrapperPath
}

type PluginMcpServer = {
  command?: unknown
  args?: unknown
  cwd?: unknown
  env?: unknown
  env_vars?: unknown
}

type PluginMcpManifest = {
  mcpServers?: Record<string, PluginMcpServer>
}

export function prepareSecurityPluginRuntime(
  stateRoot: string,
  pluginPath: string,
  nodeRuntimeExecutable: string = process.execPath,
  electronNodeRuntime = Boolean(process.versions.electron),
): string {
  const canonicalPlugin = realpathSync(pluginPath)
  const pluginMetadata = lstatSync(canonicalPlugin)
  if (!pluginMetadata.isDirectory() || pluginMetadata.isSymbolicLink()) {
    throw new Error('Norevinq 安全插件必须是普通目录。')
  }
  assertSafeRuntimePath(nodeRuntimeExecutable)
  const canonicalNodeRuntime = realpathSync(nodeRuntimeExecutable)
  assertSafeRuntimePath(canonicalNodeRuntime)
  const runtimeMetadata = lstatSync(canonicalNodeRuntime)
  const executableModeMissing = process.platform !== 'win32' && (runtimeMetadata.mode & 0o111) === 0
  if (!runtimeMetadata.isFile() || runtimeMetadata.isSymbolicLink() || executableModeMissing) {
    throw new Error('Norevinq 内置 Node 运行时不可执行。')
  }

  const runtimeParent = join(stateRoot, 'plugin-runtime')
  preparePrivateDirectory(runtimeParent)
  const runtimeRoot = join(runtimeParent, 'codex-security')
  const temporaryRoot = join(runtimeParent, `codex-security.${randomUUID()}.tmp`)
  try {
    cpSync(canonicalPlugin, temporaryRoot, {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: false,
    })
    const manifestPath = join(temporaryRoot, '.mcp.json')
    const manifestMetadata = lstatSync(manifestPath)
    if (!manifestMetadata.isFile() || manifestMetadata.isSymbolicLink()
      || manifestMetadata.size > MAX_MCP_MANIFEST_BYTES) {
      throw new Error('Norevinq 安全插件 MCP 清单无效。')
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PluginMcpManifest
    const server = manifest.mcpServers?.['codex-security']
    if (!server || !Array.isArray(server.args) || !server.args.every((argument) => typeof argument === 'string')) {
      throw new Error('Norevinq 安全插件未声明有效的本地协调器。')
    }
    server.command = canonicalNodeRuntime
    const forwardedEnvironment = isStringArray(server.env_vars) ? server.env_vars : []
    server.env_vars = [...new Set([...forwardedEnvironment, 'DEEPSEEK_API_KEY'])]
    if (electronNodeRuntime) {
      server.env = {
        ...(isStringRecord(server.env) ? server.env : {}),
        ELECTRON_RUN_AS_NODE: '1',
      }
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    patchArtifactWriterNodeMode(temporaryRoot)
    const pluginManifestPath = join(temporaryRoot, '.codex-plugin', 'plugin.json')
    const pluginManifestMetadata = lstatSync(pluginManifestPath)
    if (!pluginManifestMetadata.isFile() || pluginManifestMetadata.isSymbolicLink()
      || pluginManifestMetadata.size > MAX_MCP_MANIFEST_BYTES) {
      throw new Error('Norevinq 安全插件元数据无效。')
    }
    const pluginManifest = JSON.parse(readFileSync(pluginManifestPath, 'utf8')) as Record<string, unknown>
    if (typeof pluginManifest.version !== 'string' || !pluginManifest.version.trim()) {
      throw new Error('Norevinq 安全插件版本无效。')
    }
    pluginManifest.version = `${pluginManifest.version.replace(/-norevinq\.\d+$/u, '')}-norevinq.${String(SECURITY_PLUGIN_RUNTIME_REVISION)}`
    writeFileSync(pluginManifestPath, `${JSON.stringify(pluginManifest, null, 2)}\n`, {
      encoding: 'utf8', mode: 0o600,
    })
    rmSync(runtimeRoot, { recursive: true, force: true })
    renameSync(temporaryRoot, runtimeRoot)
    if (process.platform !== 'win32') chmodSync(runtimeRoot, 0o700)
    return runtimeRoot
  } catch (error) {
    rmSync(temporaryRoot, { recursive: true, force: true })
    throw error
  }
}

function patchArtifactWriterNodeMode(pluginRoot: string): void {
  const mcpRoot = join(pluginRoot, 'mcp')
  const chunkNames = readdirSync(mcpRoot)
    .filter((name) => name.startsWith(MCP_RUNTIME_CHUNK_PREFIX))
    .sort()
  // Lightweight unit-test plugins do not carry the official compressed runtime.
  if (chunkNames.length === 0) return

  const compressed = Buffer.concat(chunkNames.map((name) => readFileSync(join(mcpRoot, name))))
  const source = brotliDecompressSync(compressed).toString('utf8')
  if (!source.includes(ARTIFACT_MCP_ENV_MARKER)
    || source.indexOf(ARTIFACT_MCP_ENV_MARKER) !== source.lastIndexOf(ARTIFACT_MCP_ENV_MARKER)) {
    throw new Error('Norevinq 安全插件 worker 运行时与当前适配不兼容。')
  }
  const patched = source.replace(ARTIFACT_MCP_ENV_MARKER, ARTIFACT_MCP_ENV_REPLACEMENT)
  const patchedChunk = brotliCompressSync(Buffer.from(patched, 'utf8'))
  const firstChunkPath = join(mcpRoot, `${MCP_RUNTIME_CHUNK_PREFIX}000`)
  writeFileSync(firstChunkPath, patchedChunk, { mode: 0o600 })
  for (const name of chunkNames) {
    const path = join(mcpRoot, name)
    if (path !== firstChunkPath) rmSync(path, { force: true })
  }
}

export async function assertDeepScanMcpAvailable(
  pluginPath: string,
  stateRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
  timeoutMs = 15_000,
): Promise<void> {
  const manifestPath = join(pluginPath, '.mcp.json')
  const manifestMetadata = lstatSync(manifestPath)
  if (!manifestMetadata.isFile() || manifestMetadata.isSymbolicLink()
    || manifestMetadata.size > MAX_MCP_MANIFEST_BYTES) {
    throw new Error('深度扫描本地协调器清单无效；扫描未启动，也未产生模型费用。')
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PluginMcpManifest
  const server = manifest.mcpServers?.['codex-security']
  if (!server || typeof server.command !== 'string' || !isStringArray(server.args)) {
    throw new Error('深度扫描本地协调器配置缺失；扫描未启动，也未产生模型费用。')
  }
  const configuredCwd = typeof server.cwd === 'string' ? server.cwd : '.'
  const cwd = resolve(pluginPath, configuredCwd)
  const fromPlugin = relative(realpathSync(pluginPath), realpathSync(cwd))
  if (fromPlugin.startsWith('..') || isAbsolute(fromPlugin)) {
    throw new Error('深度扫描本地协调器工作目录越界；扫描未启动，也未产生模型费用。')
  }
  const preflightHome = join(stateRoot, 'mcp-preflight-home')
  preparePrivateDirectory(preflightHome)

  await new Promise<void>((resolvePromise, reject) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    const child = spawn(server.command as string, server.args as string[], {
      cwd,
      env: {
        ...environment,
        ...(isStringRecord(server.env) ? server.env : {}),
        CODEX_HOME: preflightHome,
        CODEX_SECURITY_STATE_DIR: stateRoot,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      let completed = false
      const complete = (): void => {
        if (completed) return
        completed = true
        clearTimeout(closeTimer)
        if (error) reject(error)
        else resolvePromise()
      }
      const closeTimer = setTimeout(complete, 2_000)
      closeTimer.unref()
      if (child.exitCode !== null || child.signalCode !== null) {
        complete()
        return
      }
      child.once('close', complete)
      child.kill()
    }
    const abort = (): void => finish(signal?.reason instanceof Error ? signal.reason : new Error('扫描已取消。'))
    const timer = setTimeout(() => finish(new Error(
      '深度扫描本地协调器启动超时；扫描未启动，也未产生模型费用。',
    )), timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    child.once('error', (error) => finish(new Error(
      `深度扫描本地协调器无法启动；扫描未启动，也未产生模型费用。${safeErrorMessage(error)}`,
    )))
    child.once('exit', (code) => {
      if (!settled) finish(new Error(
        `深度扫描本地协调器意外退出（${String(code ?? 'unknown')}）；扫描未启动，也未产生模型费用。${safeErrorMessage(stderr)}`,
      ))
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-MAX_MCP_PREFLIGHT_OUTPUT_BYTES)
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (Buffer.byteLength(stdout) > MAX_MCP_PREFLIGHT_OUTPUT_BYTES) {
        finish(new Error('深度扫描本地协调器输出异常；扫描未启动，也未产生模型费用。'))
        return
      }
      const lines = stdout.split('\n')
      stdout = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const response = JSON.parse(line) as {
            id?: unknown
            result?: { tools?: { name?: unknown }[] }
            error?: unknown
          }
          if (response.id !== 2) continue
          const available = response.result?.tools?.some(({ name }) => name === 'start_codex_security_deep_scan') === true
          finish(available ? undefined : new Error(
            '深度扫描协调工具未加载；扫描未启动，也未产生模型费用。',
          ))
          return
        } catch {
          // Ignore non-protocol stdout until the bounded response arrives.
        }
      }
    })
    child.stdin.on('error', (error) => finish(new Error(
      `深度扫描本地协调器通信失败；扫描未启动，也未产生模型费用。${safeErrorMessage(error)}`,
    )))
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2025-06-18', capabilities: {},
        clientInfo: { name: 'norevinq-security-preflight', version: '0.1.0' },
      },
    })}\n`)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`)
  })
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === 'string')
}

function assertSafeRuntimePath(path: string): void {
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) throw new Error('Norevinq 智能体运行时路径包含不安全字符。')
  }
}

const MAC_DEEP_SCAN_WRAPPER = `#!/bin/bash
set -eu
wrapper_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
IFS= read -r real_codex < "$wrapper_dir/real-codex-path"
if [[ ! -x "$real_codex" ]]; then
  echo "Norevinq Deep Scan runtime is unavailable." >&2
  exit 126
fi
args=("$@")
if [[ -n "\${CODEX_SECURITY_SCAN_ID:-}" && "\${args[0]:-}" == "exec" && "\${args[1]:-}" == "--experimental-json" ]]; then
  for ((index=0; index + 1 < \${#args[@]}; index++)); do
    if [[ "\${args[index]}" == "--sandbox" && "\${args[index + 1]}" == "read-only" ]]; then
      args[index + 1]="danger-full-access"
    fi
  done
fi
exec "$real_codex" "\${args[@]}"
`

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

function findingsCsv(findings: readonly SecurityFinding[]): string {
  const header = [
    'occurrence_id',
    'finding_id',
    'rule_id',
    'title',
    'severity',
    'confidence',
    'category',
    'cwe',
    'locations',
    'summary',
    'root_cause',
    'remediation',
  ]
  const rows = findings.map((finding) => [
    finding.occurrenceId,
    finding.findingId,
    finding.ruleId,
    finding.title,
    finding.severity,
    finding.confidence,
    finding.category,
    finding.cwe.join('; '),
    finding.locations.map((location) => {
      const endLine = location.endLine === undefined || location.endLine === location.startLine
        ? ''
        : `-${String(location.endLine)}`
      return `${location.path}:${String(location.startLine)}${endLine}`
    }).join('; '),
    finding.summary,
    finding.rootCause ?? '',
    finding.remediation,
  ])
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
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
