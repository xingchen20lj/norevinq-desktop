export type IntegrationJson =
  | boolean
  | null
  | number
  | string
  | IntegrationJson[]
  | { [key: string]: IntegrationJson }

export type McpAuthStatus = 'unknown' | 'unsupported' | 'notLoggedIn' | 'bearerToken' | 'oAuth'

export type McpToolSummary = {
  name: string
  title: string | null
  description: string | null
  inputSchema: IntegrationJson
  annotations: IntegrationJson | null
}

export type McpResourceSummary = {
  uri: string
  name: string
  title: string | null
  description: string | null
  mimeType: string | null
  size: number | null
}

export type McpResourceTemplateSummary = {
  uriTemplate: string
  name: string
  title: string | null
  description: string | null
  mimeType: string | null
}

export type McpServerSummary = {
  name: string
  title: string | null
  version: string | null
  authStatus: McpAuthStatus
  tools: McpToolSummary[]
  resources: McpResourceSummary[]
  resourceTemplates: McpResourceTemplateSummary[]
}

export type SkillDependencySummary = {
  type: string
  value: string
  description: string | null
  transport: string | null
  url: string | null
}

export type SkillSummary = {
  name: string
  displayName: string
  description: string
  shortDescription: string | null
  path: string
  scope: 'user' | 'repo' | 'system' | 'admin'
  enabled: boolean
  dependencies: SkillDependencySummary[]
}

export type SkillLoadError = {
  path: string | null
  message: string
}

export type ConfigLayerSummary = {
  kind: string
  label: string
  version: string
  disabledReason: string | null
  config: IntegrationJson
}

export type EffectiveConfigSummary = {
  model: string | null
  modelProvider: string | null
  reasoningEffort: string | null
  approvalPolicy: string | null
  sandboxMode: string | null
  webSearch: string | null
  instructions: string | null
  developerInstructions: string | null
  origins: Record<string, { kind: string; label: string; version: string }>
  layers: ConfigLayerSummary[]
  requirements: IntegrationJson | null
}

export type ProjectInstructionSummary = {
  path: string
  kind: 'agents' | 'override'
  bytes: number
  preview: string
  truncated: boolean
}

export type PermissionProfileSummary = {
  id: string
  description: string | null
  allowed: boolean
}

export type PendingIntegrationRequest =
  | {
    id: string
    kind: 'mcpElicitation'
    serverName: string
    threadId: string
    turnId: string | null
    mode: 'form' | 'openai/form' | 'url'
    message: string
    schema: IntegrationJson | null
    url: string | null
  }
  | {
    id: string
    kind: 'userInput'
    threadId: string
    turnId: string
    itemId: string
    blocking: boolean
    questions: {
      id: string
      header: string
      question: string
    options: { label: string; description: string }[]
      allowOther: boolean
      secret: boolean
    }[]
  }

export type IntegrationSnapshot = {
  projectId: string | null
  cwd: string | null
  trusted: boolean
  loading: boolean
  mcpServers: McpServerSummary[]
  skills: SkillSummary[]
  skillErrors: SkillLoadError[]
  extraSkillRoots: string[]
  config: EffectiveConfigSummary | null
  instructions: ProjectInstructionSummary[]
  permissionProfiles: PermissionProfileSummary[]
  pendingRequests: PendingIntegrationRequest[]
  lastOAuthCompletion: { name: string; success: boolean; error: string | null } | null
  error: string | null
}

export type IntegrationSubscription = (snapshot: IntegrationSnapshot) => void

export type IntegrationProjectInput = { projectId: string; threadId?: string }
export type SetProjectTrustInput = { projectId: string; trusted: boolean }
export type SetSkillEnabledInput = { projectId: string; path: string; enabled: boolean }
export type RemoveSkillRootInput = { projectId: string; path: string }
export type McpServerInput = { projectId: string; name: string; threadId?: string }
export type McpResourceReadInput = McpServerInput & { uri: string }
export type McpToolCallInput = {
  projectId: string
  threadId: string
  server: string
  tool: string
  arguments: IntegrationJson
  confirmed: boolean
}

export type McpResourceReadResult = {
  contents: {
    uri: string
    mimeType: string | null
    text: string | null
    blobBase64: string | null
    truncated: boolean
  }[]
  truncated: boolean
}

export type McpToolCallResult = {
  content: IntegrationJson[]
  structuredContent: IntegrationJson | null
  isError: boolean
  truncated: boolean
}

export type SafeConfigKey =
  | 'approval_policy'
  | 'model_reasoning_effort'
  | 'model_verbosity'
  | 'sandbox_mode'
  | 'web_search'

export type WriteSafeConfigInput = {
  projectId: string
  key: SafeConfigKey
  value: string | null
}

export type ResolveIntegrationRequestInput = {
  requestId: string
  action: 'accept' | 'decline' | 'cancel'
  content?: IntegrationJson
  answers?: Record<string, string[]>
}
