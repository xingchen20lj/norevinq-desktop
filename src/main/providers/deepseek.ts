import type { CodexModelSummary } from '../../shared/runtime.js'
import type { CodexSecurityConfig } from '@openai/codex-security'

export const DEEPSEEK_ENV_KEY = 'DEEPSEEK_API_KEY'

export type DeepSeekSecurityModel = 'deepseek-v4-flash' | 'deepseek-v4-pro'
export const DEEPSEEK_SECURITY_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'] as const satisfies readonly DeepSeekSecurityModel[]

const SECURITY_ENVIRONMENT_ALLOWLIST = new Set([
  'ALL_PROXY', 'APPDATA', 'ComSpec', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'HTTPS_PROXY', 'HTTP_PROXY', 'LANG', 'LANGUAGE',
  'LOCALAPPDATA', 'LOGNAME', 'NODE_EXTRA_CA_CERTS', 'NO_PROXY', 'PATH', 'PATHEXT', 'PROGRAMDATA',
  'Path', 'SHELL', 'SSL_CERT_DIR', 'SSL_CERT_FILE', 'SystemRoot', 'TEMP', 'TERM', 'TMP', 'TMPDIR', 'TZ',
  'USER', 'USERNAME', 'USERPROFILE', 'WINDIR', 'all_proxy', 'https_proxy', 'http_proxy', 'no_proxy',
])

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
    displayName: 'DeepSeek V4 Pro',
    description: 'DeepSeek Responses API；文本、推理、函数工具、apply_patch 与 Web Search。',
    isDefault: false,
    hidden: false,
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

export function isDeepSeekSecurityModel(value: string): value is DeepSeekSecurityModel {
  return DEEPSEEK_SECURITY_MODELS.some((model) => model === value)
}

export function createDeepSeekSecurityConfig(
  model: DeepSeekSecurityModel,
  apiKey: string,
  stateDirectory: string,
  environment: NodeJS.ProcessEnv = process.env,
  codexCliPath?: string | null,
): CodexSecurityConfig {
  const isolatedEnvironment = Object.fromEntries(Object.entries(environment).filter(([name, value]) =>
    value !== undefined && (SECURITY_ENVIRONMENT_ALLOWLIST.has(name) || name.startsWith('LC_'))))
  isolatedEnvironment[DEEPSEEK_ENV_KEY] = apiKey
  isolatedEnvironment.CODEX_SECURITY_STATE_DIR = stateDirectory
  if (codexCliPath) isolatedEnvironment.CODEX_CLI_PATH = codexCliPath
  return {
    environment: isolatedEnvironment,
    codexOverrides: {
      model,
      model_provider: 'deepseek',
      model_reasoning_effort: 'high',
      features: {
        multi_agent_v2: {
          enabled: true,
          // Flash diagnostics use a single thread to rule out post-seal worker races.
          // Pro keeps bounded parallelism after completing the online sealed contract.
          max_concurrent_threads_per_session: model === 'deepseek-v4-flash' ? 1 : 4,
        },
      },
      model_providers: {
        deepseek: {
          name: 'DeepSeek',
          base_url: 'https://api.deepseek.com',
          env_key: DEEPSEEK_ENV_KEY,
          wire_api: 'responses',
          supports_websockets: false,
        },
      },
    },
  }
}
