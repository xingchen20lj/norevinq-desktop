import type { ProviderStatus } from '../../shared/providers.js'
import type { CodexRuntimeSnapshot } from '../../shared/runtime.js'
import type { CredentialStore } from '../security/credentialStore.js'
import {
  DEEPSEEK_CODEX_CONFIG_OVERRIDES,
  DEEPSEEK_CODEX_MODELS,
  DEEPSEEK_ENV_KEY,
} from './deepseek.js'

const DEEPSEEK_CREDENTIAL_NAME = 'provider.deepseek.api-key'

type RuntimeLaunchConfigurator = {
  updateLaunchConfiguration: (options: {
    configOverrides?: readonly string[]
    childEnvironment?: Readonly<Record<string, string>>
    extraModels?: readonly import('../../shared/runtime.js').CodexModelSummary[]
  }) => Promise<CodexRuntimeSnapshot>
}

export class ProviderService {
  readonly #runtime: RuntimeLaunchConfigurator
  readonly #credentials: CredentialStore
  readonly #environmentKey: string | null

  constructor(runtime: RuntimeLaunchConfigurator, credentials: CredentialStore, environmentKey: string | null) {
    this.#runtime = runtime
    this.#credentials = credentials
    this.#environmentKey = environmentKey
  }

  getStatus(): ProviderStatus {
    const vaultConfigured = this.#readVaultKey() !== null
    return {
      deepseek: {
        configured: this.#environmentKey !== null || vaultConfigured,
        credentialSource: this.#environmentKey !== null ? 'environment' : vaultConfigured ? 'os-vault' : 'none',
        credentialStorageAvailable: this.#credentials.isAvailable(),
        responsesModel: 'deepseek-v4-flash',
        unavailableModels: [{
          model: 'deepseek-v4-pro',
          reason: 'Responses API 当前返回 HTTP 400；不会静默切换到 Chat Completions。',
        }],
      },
    }
  }

  async saveDeepSeekCredential(apiKey: string): Promise<{ providers: ProviderStatus; runtime: CodexRuntimeSnapshot }> {
    const normalized = apiKey.trim()
    if (normalized.length < 16 || normalized.length > 512) throw new Error('DeepSeek API Key length is invalid.')
    this.#credentials.set(DEEPSEEK_CREDENTIAL_NAME, normalized)
    return this.#applyCurrentCredential()
  }

  async deleteDeepSeekCredential(): Promise<{ providers: ProviderStatus; runtime: CodexRuntimeSnapshot }> {
    this.#credentials.delete(DEEPSEEK_CREDENTIAL_NAME)
    return this.#applyCurrentCredential()
  }

  getVaultKeyForStartup(): string | null {
    return this.#readVaultKey()
  }

  async #applyCurrentCredential(): Promise<{ providers: ProviderStatus; runtime: CodexRuntimeSnapshot }> {
    const credential = this.#environmentKey ?? this.#readVaultKey()
    const runtime = await this.#runtime.updateLaunchConfiguration(credential ? {
      childEnvironment: { [DEEPSEEK_ENV_KEY]: credential },
      configOverrides: DEEPSEEK_CODEX_CONFIG_OVERRIDES,
      extraModels: DEEPSEEK_CODEX_MODELS,
    } : {})
    return { providers: this.getStatus(), runtime }
  }

  #readVaultKey(): string | null {
    try {
      return this.#credentials.get(DEEPSEEK_CREDENTIAL_NAME)
    } catch {
      return null
    }
  }
}
