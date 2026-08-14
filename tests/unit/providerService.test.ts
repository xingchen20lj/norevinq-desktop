import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProviderService } from '../../src/main/providers/providerService.js'
import { CredentialStore } from '../../src/main/security/credentialStore.js'
import type { CodexRuntimeSnapshot } from '../../src/shared/runtime.js'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('ProviderService', () => {
  it('stores a DeepSeek key in the OS vault adapter and restarts with process-only configuration', async () => {
    const root = mkdtempSync(join(tmpdir(), 'norevinq-provider-'))
    temporaryPaths.push(root)
    const credentials = new CredentialStore(join(root, 'credentials.json'), {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value).subarray().reverse(),
      decryptString: (value) => Buffer.from(value).reverse().toString('utf8'),
    })
    const configurations: LaunchConfiguration[] = []
    const updateLaunchConfiguration = (options: LaunchConfiguration): Promise<CodexRuntimeSnapshot> => {
      configurations.push(options)
      return Promise.resolve(runtimeSnapshot)
    }
    const service = new ProviderService({ updateLaunchConfiguration }, credentials, null)

    const result = await service.saveDeepSeekCredential('sk-deepseek-test-secret')

    expect(result.providers.deepseek).toMatchObject({ configured: true, credentialSource: 'os-vault' })
    expect(result.providers.deepseek.responsesModels).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
    expect(configurations[0]?.childEnvironment).toEqual({ DEEPSEEK_API_KEY: 'sk-deepseek-test-secret' })
    expect(configurations[0]?.extraModels?.some(({ id }) => id === 'deepseek-v4-flash')).toBe(true)
    expect(configurations[0]?.extraModels?.some(({ id }) => id === 'deepseek-v4-pro')).toBe(true)

    await service.deleteDeepSeekCredential()
    expect(service.getStatus().deepseek.configured).toBe(false)
    expect(configurations.at(-1)).toEqual({})
  })

  it('keeps an environment credential authoritative over the saved vault value', async () => {
    const root = mkdtempSync(join(tmpdir(), 'norevinq-provider-'))
    temporaryPaths.push(root)
    const credentials = new CredentialStore(join(root, 'credentials.json'), {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString('utf8'),
    })
    const configurations: LaunchConfiguration[] = []
    const updateLaunchConfiguration = (options: LaunchConfiguration): Promise<CodexRuntimeSnapshot> => {
      configurations.push(options)
      return Promise.resolve(runtimeSnapshot)
    }
    const service = new ProviderService({ updateLaunchConfiguration }, credentials, 'sk-environment-authoritative')
    await service.saveDeepSeekCredential('sk-vault-secondary-value')
    expect(service.getStatus().deepseek.credentialSource).toBe('environment')
    expect(configurations[0]?.childEnvironment).toEqual({
      DEEPSEEK_API_KEY: 'sk-environment-authoritative',
    })
  })
})

const runtimeSnapshot: CodexRuntimeSnapshot = {
  phase: 'ready', generation: 1, binaryPath: '/codex', version: '0.147.0', userAgent: 'test',
  platformFamily: 'unix', platformOs: 'macos', startedAt: null, readyAt: null,
  lastExitCode: null, lastSignal: null, restartAttempt: 0, error: null, models: [],
}

type LaunchConfiguration = {
  configOverrides?: readonly string[]
  childEnvironment?: Readonly<Record<string, string>>
  extraModels?: readonly import('../../src/shared/runtime.js').CodexModelSummary[]
}
