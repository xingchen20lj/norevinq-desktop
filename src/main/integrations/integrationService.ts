import { randomUUID } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import type {
  EffectiveConfigSummary,
  IntegrationJson,
  IntegrationSnapshot,
  IntegrationSubscription,
  McpResourceReadInput,
  McpResourceReadResult,
  McpServerInput,
  McpServerSummary,
  McpToolCallInput,
  McpToolCallResult,
  PendingIntegrationRequest,
  ResolveIntegrationRequestInput,
  SafeConfigKey,
  SkillLoadError,
  SkillSummary,
  WriteSafeConfigInput,
} from '../../shared/integrations.js'
import type {
  JsonRpcRequestHandler,
  JsonRpcRequestId,
  JsonValue,
} from '../runtime/jsonlRpc.js'
import type { StateDatabase } from '../state/database.js'

type RuntimePort = {
  start: () => Promise<unknown>
  request: <T extends JsonValue = JsonValue>(
    method: string,
    params?: JsonValue,
    options?: { timeoutMs?: number | null },
  ) => Promise<T>
  onNotification: (
    method: string,
    handler: (method: string, params: JsonValue | undefined) => Promise<void> | void,
  ) => () => void
  registerRequestHandler: (method: string, handler: JsonRpcRequestHandler) => () => void
}

type PendingResolver = {
  kind: 'mcpElicitation' | 'userInput'
  resolve: (result: JsonValue) => void
  allowedQuestionIds?: ReadonlySet<string>
}

const MAX_MCP_PAGES = 10
const MAX_MCP_ITEMS = 500
const MAX_JSON_INPUT_BYTES = 256 * 1024
const MAX_JSON_OUTPUT_BYTES = 2 * 1024 * 1024
const MAX_RESOURCE_BYTES = 1024 * 1024
const MAX_INSTRUCTION_BYTES = 128 * 1024
const SAFE_CONFIG_VALUES: Record<SafeConfigKey, ReadonlySet<string>> = {
  approval_policy: new Set(['untrusted', 'on-failure', 'on-request', 'never']),
  model_reasoning_effort: new Set(['minimal', 'low', 'medium', 'high', 'xhigh']),
  model_verbosity: new Set(['low', 'medium', 'high']),
  sandbox_mode: new Set(['read-only', 'workspace-write', 'danger-full-access']),
  web_search: new Set(['disabled', 'cached', 'live']),
}

export class IntegrationService {
  readonly #runtime: RuntimePort
  readonly #database: StateDatabase
  readonly #subscriptions = new Set<IntegrationSubscription>()
  readonly #pendingResolvers = new Map<string, PendingResolver>()
  readonly #disposers: (() => void)[]
  #threadId: string | undefined
  #snapshot: IntegrationSnapshot = emptySnapshot()
  #refreshPromise: Promise<IntegrationSnapshot> | null = null
  #refreshTimer: NodeJS.Timeout | null = null

  constructor(runtime: RuntimePort, database: StateDatabase) {
    this.#runtime = runtime
    this.#database = database
    this.#disposers = [
      runtime.onNotification('skills/changed', () => this.#scheduleRefresh()),
      runtime.onNotification('mcpServer/startupStatus/updated', () => this.#scheduleRefresh()),
      runtime.onNotification('mcpServer/oauthLogin/completed', (_method, params) => {
        const value = asRecord(params)
        this.#update({
          lastOAuthCompletion: {
            name: asString(value.name, 'unknown'),
            success: value.success === true,
            error: typeof value.error === 'string' ? value.error : null,
          },
        })
        this.#scheduleRefresh()
      }),
      runtime.registerRequestHandler(
        'mcpServer/elicitation/request',
        (params, context) => this.#requestMcpElicitation(params, context.id),
      ),
      runtime.registerRequestHandler(
        'item/tool/requestUserInput',
        (params, context) => this.#requestUserInput(params, context.id),
      ),
    ]
  }

  getSnapshot(): IntegrationSnapshot {
    return this.#snapshot
  }

  subscribe(subscription: IntegrationSubscription): () => void {
    this.#subscriptions.add(subscription)
    subscription(this.#snapshot)
    return () => this.#subscriptions.delete(subscription)
  }

  async load(projectId: string, threadId?: string, forceReload = false): Promise<IntegrationSnapshot> {
    const project = this.#requireProject(projectId)
    this.#threadId = threadId
    this.#update({ projectId, cwd: project.path, trusted: project.trusted, loading: true, error: null })
    try {
      await this.#runtime.start()
      const [mcpServers, skillData, config, requirements] = await Promise.all([
        this.#listMcpServers(threadId),
        this.#runtime.request('skills/list', { cwds: [project.path], forceReload }),
        this.#runtime.request('config/read', { cwd: project.path, includeLayers: true }),
        this.#runtime.request('configRequirements/read'),
      ])
      const { skills, errors } = parseSkills(skillData, project.path)
      this.#update({
        loading: false,
        mcpServers,
        skills,
        skillErrors: errors,
        config: parseConfig(config, requirements),
        instructions: discoverProjectInstructions(project.path),
        error: null,
      })
    } catch (error: unknown) {
      this.#update({ loading: false, error: toErrorMessage(error) })
    }
    return this.#snapshot
  }

  refresh(forceReload = true): Promise<IntegrationSnapshot> {
    if (!this.#snapshot.projectId) return Promise.resolve(this.#snapshot)
    if (this.#refreshPromise) return this.#refreshPromise
    this.#refreshPromise = this.load(this.#snapshot.projectId, this.#threadId, forceReload)
      .finally(() => { this.#refreshPromise = null })
    return this.#refreshPromise
  }

  setProjectTrust(projectId: string, trusted: boolean): IntegrationSnapshot {
    const project = this.#database.setProjectTrust(projectId, trusted)
    if (this.#snapshot.projectId === projectId) this.#update({ trusted: project.trusted })
    return this.#snapshot
  }

  async setSkillEnabled(projectId: string, path: string, enabled: boolean): Promise<IntegrationSnapshot> {
    this.#assertLoadedProject(projectId)
    const skill = this.#snapshot.skills.find((candidate) => candidate.path === path)
    if (!skill) throw new Error('Skill is not part of the current project inventory.')
    await this.#runtime.request('skills/config/write', { path, enabled })
    return this.refresh(true)
  }

  async addExtraSkillRoot(projectId: string, path: string): Promise<IntegrationSnapshot> {
    this.#assertTrustedProject(projectId)
    const canonicalPath = canonicalDirectory(path)
    const roots = [...new Set([...this.#snapshot.extraSkillRoots, canonicalPath])]
    if (roots.length > 8) throw new Error('At most 8 extra skill roots may be active.')
    await this.#runtime.request('skills/extraRoots/set', { extraRoots: roots })
    this.#update({ extraSkillRoots: roots })
    return this.refresh(true)
  }

  async removeExtraSkillRoot(projectId: string, path: string): Promise<IntegrationSnapshot> {
    this.#assertTrustedProject(projectId)
    const roots = this.#snapshot.extraSkillRoots.filter((root) => root !== path)
    await this.#runtime.request('skills/extraRoots/set', { extraRoots: roots })
    this.#update({ extraSkillRoots: roots })
    return this.refresh(true)
  }

  async reloadMcp(projectId: string): Promise<IntegrationSnapshot> {
    this.#assertLoadedProject(projectId)
    await this.#runtime.request('config/mcpServer/reload')
    return this.refresh(false)
  }

  async startMcpOAuth(input: McpServerInput): Promise<{ authorizationUrl: string }> {
    this.#assertLoadedProject(input.projectId)
    if (input.threadId) this.#assertProjectThread(input.projectId, input.threadId)
    this.#requireMcpServer(input.name)
    const result = asRecord(await this.#runtime.request('mcpServer/oauth/login', {
      name: input.name,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      timeoutSecs: 300,
    }, { timeoutMs: 15_000 }))
    const authorizationUrl = asString(result.authorizationUrl)
    if (!safeHttpUrl(authorizationUrl)) {
      throw new Error('MCP OAuth returned an unsupported authorization URL.')
    }
    return { authorizationUrl }
  }

  async readMcpResource(input: McpResourceReadInput): Promise<McpResourceReadResult> {
    this.#assertLoadedProject(input.projectId)
    if (input.threadId) this.#assertProjectThread(input.projectId, input.threadId)
    const server = this.#requireMcpServer(input.name)
    if (!server.resources.some(({ uri }) => uri === input.uri)) {
      throw new Error('Resource is not part of the current MCP inventory.')
    }
    const result = asRecord(await this.#runtime.request('mcpServer/resource/read', {
      server: input.name,
      uri: input.uri,
      ...(input.threadId ? { threadId: input.threadId } : {}),
    }, { timeoutMs: 30_000 }))
    let remaining = MAX_RESOURCE_BYTES
    let truncated = false
    const contents = asArray(result.contents).slice(0, 32).map((item) => {
      const content = asRecord(item)
      const textValue = typeof content.text === 'string' ? content.text : null
      const blobValue = typeof content.blob === 'string' ? content.blob : null
      const selected = textValue ?? blobValue ?? ''
      const limited = truncateUtf8(selected, remaining)
      remaining -= Buffer.byteLength(limited.value)
      truncated ||= limited.truncated
      return {
        uri: asString(content.uri, input.uri),
        mimeType: typeof content.mimeType === 'string' ? content.mimeType : null,
        text: textValue === null ? null : limited.value,
        blobBase64: blobValue === null ? null : limited.value,
        truncated: limited.truncated,
      }
    })
    if (asArray(result.contents).length > contents.length) truncated = true
    return { contents, truncated }
  }

  async callMcpTool(input: McpToolCallInput): Promise<McpToolCallResult> {
    this.#assertLoadedProject(input.projectId)
    this.#assertProjectThread(input.projectId, input.threadId)
    if (!input.confirmed) throw new Error('Direct MCP tool calls require explicit confirmation.')
    const server = this.#requireMcpServer(input.server)
    if (!server.tools.some(({ name }) => name === input.tool)) {
      throw new Error('Tool is not part of the current MCP inventory.')
    }
    assertJsonSize(input.arguments, MAX_JSON_INPUT_BYTES, 'MCP tool arguments')
    const raw = asRecord(await this.#runtime.request('mcpServer/tool/call', {
      threadId: input.threadId,
      server: input.server,
      tool: input.tool,
      arguments: input.arguments,
    }, { timeoutMs: 120_000 }))
    const normalized = normalizeJson(raw, MAX_JSON_OUTPUT_BYTES)
    if (normalized.truncated) {
      return {
        content: [normalized.value],
        structuredContent: null,
        isError: raw.isError === true,
        truncated: true,
      }
    }
    const result = asRecord(normalized.value)
    return {
      content: asArray(result.content).map((entry) => toIntegrationJson(entry)),
      structuredContent: result.structuredContent === undefined
        ? null
        : toIntegrationJson(result.structuredContent),
      isError: result.isError === true,
      truncated: normalized.truncated,
    }
  }

  async writeSafeConfig(input: WriteSafeConfigInput): Promise<IntegrationSnapshot> {
    this.#assertLoadedProject(input.projectId)
    if (input.value !== null && !SAFE_CONFIG_VALUES[input.key].has(input.value)) {
      throw new Error(`Unsupported value for ${input.key}.`)
    }
    await this.#runtime.request('config/value/write', {
      keyPath: input.key,
      value: input.value,
      mergeStrategy: 'replace',
    })
    return this.refresh(false)
  }

  resolveRequest(input: ResolveIntegrationRequestInput): IntegrationSnapshot {
    const pending = this.#pendingResolvers.get(input.requestId)
    if (!pending) throw new Error('Integration request is no longer pending.')
    this.#pendingResolvers.delete(input.requestId)
    if (pending.kind === 'mcpElicitation') {
      const content = input.action === 'accept' ? (input.content ?? null) : null
      assertJsonSize(content, MAX_JSON_INPUT_BYTES, 'MCP elicitation response')
      pending.resolve({ action: input.action, content, _meta: null })
    } else {
      const answers = input.action === 'accept'
        ? Object.fromEntries(Object.entries(input.answers ?? {})
          .filter(([id]) => pending.allowedQuestionIds?.has(id) === true)
          .map(([id, values]) => [id, { answers: values }]))
        : {}
      assertJsonSize(answers, MAX_JSON_INPUT_BYTES, 'tool input response')
      pending.resolve({ answers })
    }
    this.#update({
      pendingRequests: this.#snapshot.pendingRequests.filter(({ id }) => id !== input.requestId),
    })
    return this.#snapshot
  }

  dispose(): void {
    for (const dispose of this.#disposers) dispose()
    if (this.#refreshTimer) clearTimeout(this.#refreshTimer)
    this.#refreshTimer = null
    for (const pending of this.#pendingResolvers.values()) {
      if (pending.kind === 'mcpElicitation') pending.resolve({ action: 'cancel', content: null, _meta: null })
      else pending.resolve({ answers: {} })
    }
    this.#pendingResolvers.clear()
    this.#subscriptions.clear()
  }

  async #listMcpServers(threadId?: string): Promise<McpServerSummary[]> {
    const servers: McpServerSummary[] = []
    let cursor: string | null = null
    for (let page = 0; page < MAX_MCP_PAGES && servers.length < MAX_MCP_ITEMS; page += 1) {
      const result = asRecord(await this.#runtime.request('mcpServerStatus/list', {
        cursor,
        limit: 100,
        detail: 'full',
        ...(threadId ? { threadId } : {}),
      }))
      servers.push(...asArray(result.data).map(parseMcpServer))
      cursor = typeof result.nextCursor === 'string' ? result.nextCursor : null
      if (!cursor) break
    }
    return servers.slice(0, MAX_MCP_ITEMS).sort((a, b) => a.name.localeCompare(b.name))
  }

  #requestMcpElicitation(params: JsonValue | undefined, requestId: JsonRpcRequestId): Promise<JsonValue> {
    const value = asRecord(params)
    const mode = value.mode === 'form' || value.mode === 'openai/form' || value.mode === 'url'
      ? value.mode
      : 'form'
    const id = requestKey(requestId)
    const request: PendingIntegrationRequest = {
      id,
      kind: 'mcpElicitation',
      serverName: asString(value.serverName, 'unknown'),
      threadId: asString(value.threadId, ''),
      turnId: typeof value.turnId === 'string' ? value.turnId : null,
      mode,
      message: asString(value.message, 'MCP server requests input.'),
      schema: mode === 'url' ? null : toIntegrationJson(value.requestedSchema ?? null),
      url: mode === 'url' && typeof value.url === 'string' ? safeHttpUrl(value.url) : null,
    }
    return this.#enqueueRequest(id, request, 'mcpElicitation')
  }

  #requestUserInput(params: JsonValue | undefined, requestId: JsonRpcRequestId): Promise<JsonValue> {
    const value = asRecord(params)
    const id = requestKey(requestId)
    const questions = asArray(value.questions).slice(0, 3).map((item) => {
      const question = asRecord(item)
      return {
        id: asString(question.id, randomUUID()),
        header: asString(question.header, 'Question').slice(0, 80),
        question: asString(question.question, '').slice(0, 2_000),
        options: asArray(question.options).slice(0, 20).map((optionValue) => {
          const option = asRecord(optionValue)
          return {
            label: asString(option.label, '').slice(0, 200),
            description: asString(option.description, '').slice(0, 1_000),
          }
        }),
        allowOther: question.isOther === true,
        secret: question.isSecret === true,
      }
    })
    const request: PendingIntegrationRequest = {
      id,
      kind: 'userInput',
      threadId: asString(value.threadId, ''),
      turnId: asString(value.turnId, ''),
      itemId: asString(value.itemId, ''),
      blocking: value.isBlocking === true,
      questions,
    }
    return this.#enqueueRequest(id, request, 'userInput', new Set(questions.map(({ id: questionId }) => questionId)))
  }

  #enqueueRequest(
    id: string,
    request: PendingIntegrationRequest,
    kind: PendingResolver['kind'],
    allowedQuestionIds?: ReadonlySet<string>,
  ): Promise<JsonValue> {
    return new Promise((resolveRequest) => {
      this.#pendingResolvers.set(id, {
        kind,
        resolve: resolveRequest,
        ...(allowedQuestionIds ? { allowedQuestionIds } : {}),
      })
      this.#update({ pendingRequests: [...this.#snapshot.pendingRequests, request] })
    })
  }

  #scheduleRefresh(): void {
    if (!this.#snapshot.projectId) return
    if (this.#refreshTimer) clearTimeout(this.#refreshTimer)
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = null
      void this.refresh(false)
    }, 100)
  }

  #requireProject(projectId: string): NonNullable<ReturnType<StateDatabase['getProject']>> {
    const project = this.#database.getProject(projectId)
    if (!project) throw new Error('Project not found.')
    return project
  }

  #assertLoadedProject(projectId: string): void {
    if (this.#snapshot.projectId !== projectId) throw new Error('Project integrations are not loaded.')
    this.#requireProject(projectId)
  }

  #assertTrustedProject(projectId: string): void {
    this.#assertLoadedProject(projectId)
    if (!this.#snapshot.trusted) throw new Error('Trust this project before adding external skill roots.')
  }

  #assertProjectThread(projectId: string, threadId: string): void {
    if (!this.#database.listProjectThreadIds(projectId).includes(threadId)) {
      throw new Error('Thread is not associated with the current project.')
    }
  }

  #requireMcpServer(name: string): McpServerSummary {
    const server = this.#snapshot.mcpServers.find((candidate) => candidate.name === name)
    if (!server) throw new Error('MCP server is not part of the current inventory.')
    return server
  }

  #update(patch: Partial<IntegrationSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const subscription of this.#subscriptions) subscription(this.#snapshot)
  }
}

function emptySnapshot(): IntegrationSnapshot {
  return {
    projectId: null,
    cwd: null,
    trusted: false,
    loading: false,
    mcpServers: [],
    skills: [],
    skillErrors: [],
    extraSkillRoots: [],
    config: null,
    instructions: [],
    pendingRequests: [],
    lastOAuthCompletion: null,
    error: null,
  }
}

function parseMcpServer(value: unknown): McpServerSummary {
  const record = asRecord(value)
  const serverInfo = asRecord(record.serverInfo)
  const toolsRecord = asRecord(record.tools)
  return {
    name: asString(record.name, 'unknown'),
    title: typeof serverInfo.title === 'string' ? serverInfo.title : null,
    version: typeof serverInfo.version === 'string' ? serverInfo.version : null,
    authStatus: isAuthStatus(record.authStatus) ? record.authStatus : 'unknown',
    tools: Object.values(toolsRecord).slice(0, 500).map((toolValue) => {
      const tool = asRecord(toolValue)
      return {
        name: asString(tool.name),
        title: typeof tool.title === 'string' ? tool.title : null,
        description: typeof tool.description === 'string' ? tool.description : null,
        inputSchema: normalizeJson(tool.inputSchema ?? null, 128 * 1024).value,
        annotations: tool.annotations === undefined
          ? null
          : normalizeJson(tool.annotations, 32 * 1024).value,
      }
    }),
    resources: asArray(record.resources).slice(0, 500).map((resourceValue) => {
      const resource = asRecord(resourceValue)
      return {
        uri: asString(resource.uri),
        name: asString(resource.name),
        title: typeof resource.title === 'string' ? resource.title : null,
        description: typeof resource.description === 'string' ? resource.description : null,
        mimeType: typeof resource.mimeType === 'string' ? resource.mimeType : null,
        size: typeof resource.size === 'number' && Number.isFinite(resource.size) ? resource.size : null,
      }
    }),
    resourceTemplates: asArray(record.resourceTemplates).slice(0, 500).map((templateValue) => {
      const template = asRecord(templateValue)
      return {
        uriTemplate: asString(template.uriTemplate),
        name: asString(template.name),
        title: typeof template.title === 'string' ? template.title : null,
        description: typeof template.description === 'string' ? template.description : null,
        mimeType: typeof template.mimeType === 'string' ? template.mimeType : null,
      }
    }),
  }
}

function parseSkills(value: unknown, cwd: string): { skills: SkillSummary[]; errors: SkillLoadError[] } {
  const entry = asArray(asRecord(value).data)
    .map(asRecord)
    .find((candidate) => candidate.cwd === cwd) ?? asRecord(asArray(asRecord(value).data)[0])
  const skills = asArray(entry.skills).map((skillValue) => {
    const skill = asRecord(skillValue)
    const interfaceValue = asRecord(skill.interface)
    const dependencies = asArray(asRecord(skill.dependencies).tools).map((dependencyValue) => {
      const dependency = asRecord(dependencyValue)
      return {
        type: asString(dependency.type, 'unknown'),
        value: asString(dependency.value),
        description: typeof dependency.description === 'string' ? dependency.description : null,
        transport: typeof dependency.transport === 'string' ? dependency.transport : null,
        url: typeof dependency.url === 'string' ? dependency.url : null,
      }
    })
    const scope: SkillSummary['scope'] = skill.scope === 'repo' || skill.scope === 'system' || skill.scope === 'admin'
      ? skill.scope
      : 'user'
    return {
      name: asString(skill.name),
      displayName: asString(interfaceValue.displayName, asString(skill.name)),
      description: asString(skill.description),
      shortDescription: typeof interfaceValue.shortDescription === 'string'
        ? interfaceValue.shortDescription
        : typeof skill.shortDescription === 'string' ? skill.shortDescription : null,
      path: asString(skill.path),
      scope,
      enabled: skill.enabled !== false,
      dependencies,
    }
  })
  const errors = asArray(entry.errors).map((errorValue) => {
    const error = asRecord(errorValue)
    return {
      path: typeof error.path === 'string' ? error.path : null,
      message: asString(error.message, 'Unknown skill loading error.'),
    }
  })
  return { skills, errors }
}

function parseConfig(configValue: unknown, requirementsValue: unknown): EffectiveConfigSummary {
  const response = asRecord(configValue)
  const config = asRecord(response.config)
  const origins: EffectiveConfigSummary['origins'] = {}
  for (const [key, metadataValue] of Object.entries(asRecord(response.origins))) {
    const metadata = asRecord(metadataValue)
    const source = describeLayerSource(metadata.name)
    origins[key] = { ...source, version: asString(metadata.version) }
  }
  return {
    model: stringOrNull(config.model),
    modelProvider: stringOrNull(config.model_provider),
    reasoningEffort: stringOrNull(config.model_reasoning_effort),
    approvalPolicy: stringOrNull(config.approval_policy),
    sandboxMode: stringOrNull(config.sandbox_mode),
    webSearch: stringOrNull(config.web_search),
    instructions: stringOrNull(config.instructions),
    developerInstructions: stringOrNull(config.developer_instructions),
    origins,
    layers: asArray(response.layers).map((layerValue) => {
      const layer = asRecord(layerValue)
      const source = describeLayerSource(layer.name)
      return {
        ...source,
        version: asString(layer.version),
        disabledReason: stringOrNull(layer.disabledReason),
        config: normalizeJson(layer.config ?? null, 256 * 1024).value,
      }
    }),
    requirements: normalizeJson(asRecord(requirementsValue).requirements ?? null, 256 * 1024).value,
  }
}

function describeLayerSource(value: unknown): { kind: string; label: string } {
  const source = asRecord(value)
  const kind = asString(source.type, 'unknown')
  if (typeof source.file === 'string') return { kind, label: source.file }
  if (typeof source.dotCodexFolder === 'string') return { kind, label: source.dotCodexFolder }
  if (typeof source.name === 'string') return { kind, label: source.name }
  if (typeof source.domain === 'string') return { kind, label: `${source.domain}:${asString(source.key)}` }
  return { kind, label: kind }
}

function discoverProjectInstructions(projectPath: string): IntegrationSnapshot['instructions'] {
  const instructions: IntegrationSnapshot['instructions'] = []
  for (const [name, kind] of [['AGENTS.override.md', 'override'], ['AGENTS.md', 'agents']] as const) {
    const candidate = resolve(projectPath, name)
    try {
      const metadata = lstatSync(candidate)
      if (!metadata.isFile() || metadata.isSymbolicLink()) continue
      const canonical = realpathSync(candidate)
      const pathRelative = relative(projectPath, canonical)
      if (pathRelative.startsWith('..') || isAbsolute(pathRelative)) continue
      const source = readFileSync(canonical)
      const limited = truncateUtf8(source.toString('utf8'), MAX_INSTRUCTION_BYTES)
      instructions.push({
        path: canonical,
        kind,
        bytes: source.byteLength,
        preview: limited.value,
        truncated: limited.truncated,
      })
      break
    } catch {
      // Missing or unreadable instruction files remain an explicit empty state.
    }
  }
  return instructions
}

function canonicalDirectory(path: string): string {
  if (!isAbsolute(path)) throw new Error('Extra skill roots must be absolute directories.')
  const canonical = realpathSync(path)
  if (!statSync(canonical).isDirectory()) throw new Error('Extra skill root is not a directory.')
  return canonical
}

function normalizeJson(value: unknown, maxBytes: number): { value: IntegrationJson; truncated: boolean } {
  const json = JSON.stringify(toIntegrationJson(value))
  if (Buffer.byteLength(json) <= maxBytes) return { value: JSON.parse(json) as IntegrationJson, truncated: false }
  return {
    value: { truncated: true, preview: truncateUtf8(json, maxBytes).value },
    truncated: true,
  }
}

function toIntegrationJson(value: unknown, depth = 0): IntegrationJson {
  if (depth > 50) return '[maximum depth]'
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (Array.isArray(value)) return value.map((entry) => toIntegrationJson(entry, depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toIntegrationJson(entry, depth + 1)]))
  }
  return value === undefined ? '[undefined]' : `[unsupported ${typeof value}]`
}

function assertJsonSize(value: unknown, maxBytes: number, label: string): void {
  const bytes = Buffer.byteLength(JSON.stringify(toIntegrationJson(value)))
  if (bytes > maxBytes) throw new Error(`${label} exceeds ${String(maxBytes)} bytes.`)
}

function truncateUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
  if (maxBytes <= 0) return { value: '', truncated: value.length > 0 }
  const bytes = Buffer.from(value)
  if (bytes.byteLength <= maxBytes) return { value, truncated: false }
  return { value: bytes.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD$/, ''), truncated: true }
}

function requestKey(requestId: JsonRpcRequestId): string {
  return `${typeof requestId}:${String(requestId)}:${randomUUID()}`
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    const localHttp = url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    return url.protocol === 'https:' || localHttp ? url.toString() : null
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function isAuthStatus(value: unknown): value is McpServerSummary['authStatus'] {
  return value === 'unknown' || value === 'unsupported' || value === 'notLoggedIn'
    || value === 'bearerToken' || value === 'oAuth'
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
