export type ReasoningLevel = 'none' | 'low' | 'high' | 'max'

export type ModelCapabilities = {
  provider: 'openai' | 'deepseek' | 'custom'
  model: string
  responsesApi: boolean
  textInput: boolean
  imageInput: boolean
  fileInput: boolean
  functionTools: boolean
  applyPatchCustomTool: boolean
  reasoning: boolean
  reasoningLevels: readonly ReasoningLevel[]
  reasoningSummary: boolean
  webSearch: boolean
  mcp: boolean
  codeInterpreter: boolean
  computerUse: boolean
  statefulResponses: boolean
  backgroundResponses: boolean
  websocketResponses: boolean
  unavailableReason?: string
}

export const DEEPSEEK_V4_FLASH_CAPABILITIES = {
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  responsesApi: true,
  textInput: true,
  imageInput: false,
  fileInput: false,
  functionTools: true,
  applyPatchCustomTool: true,
  reasoning: true,
  reasoningLevels: ['none', 'low', 'high', 'max'],
  reasoningSummary: false,
  webSearch: true,
  mcp: false,
  codeInterpreter: false,
  computerUse: false,
  statefulResponses: false,
  backgroundResponses: false,
  websocketResponses: false,
} as const satisfies ModelCapabilities

export const DEEPSEEK_V4_PRO_CAPABILITIES = {
  ...DEEPSEEK_V4_FLASH_CAPABILITIES,
  model: 'deepseek-v4-pro',
  responsesApi: false,
  functionTools: false,
  applyPatchCustomTool: false,
  webSearch: false,
  unavailableReason: 'DeepSeek Responses API returned HTTP 400 during the 2026-08-10 capability probe.',
} as const satisfies ModelCapabilities

export function canRunCodex(capabilities: ModelCapabilities): boolean {
  return capabilities.responsesApi && capabilities.textInput && capabilities.functionTools && capabilities.applyPatchCustomTool
}
