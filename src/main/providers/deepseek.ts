import type { CodexModelSummary } from '../../shared/runtime.js'

export const DEEPSEEK_ENV_KEY = 'DEEPSEEK_API_KEY'

export const DEEPSEEK_CODEX_CONFIG_OVERRIDES = [
  'model_providers.deepseek.name="DeepSeek"',
  'model_providers.deepseek.base_url="https://api.deepseek.com"',
  `model_providers.deepseek.env_key="${DEEPSEEK_ENV_KEY}"`,
  'model_providers.deepseek.wire_api="responses"',
  'model_providers.deepseek.supports_websockets=false',
] as const

export const DEEPSEEK_CODEX_MODELS: CodexModelSummary[] = [
  {
    id: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash',
    description: 'DeepSeek Responses API；文本、推理、函数工具、apply_patch 与 Web Search。',
    isDefault: false,
    hidden: false,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: ['none', 'low', 'high', 'max'],
    inputModalities: ['text'],
    supportsPersonality: false,
  },
  {
    id: 'deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro（Responses 暂不可用）',
    description: '截至 2026-08-10，DeepSeek Responses 端点对该模型返回 HTTP 400。',
    isDefault: false,
    hidden: true,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: ['none', 'low', 'high', 'max'],
    inputModalities: ['text'],
    supportsPersonality: false,
  },
]

export function hasDeepSeekEnvironment(environment: NodeJS.ProcessEnv): boolean {
  return getDeepSeekEnvironmentValue(environment) !== null
}

export function getDeepSeekEnvironmentValue(environment: NodeJS.ProcessEnv): string | null {
  const value = environment[DEEPSEEK_ENV_KEY]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}
