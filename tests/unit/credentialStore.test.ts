import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CredentialStore, type EncryptionAdapter } from '../../src/main/security/credentialStore.js'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, {
    force: true, recursive: true, maxRetries: 5, retryDelay: 100,
  })
})

describe('CredentialStore', () => {
  it('persists only encrypted values in a private atomic file', () => {
    const root = mkdtempSync(join(tmpdir(), 'aster-credentials-'))
    temporaryPaths.push(root)
    const path = join(root, 'private', 'credentials.json')
    const store = new CredentialStore(path, reversingEncryption)

    store.set('provider.deepseek.api-key', 'sk-sensitive-value')

    expect(store.get('provider.deepseek.api-key')).toBe('sk-sensitive-value')
    expect(readFileSync(path, 'utf8')).not.toContain('sk-sensitive-value')
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
    store.delete('provider.deepseek.api-key')
    expect(store.get('provider.deepseek.api-key')).toBeNull()
  })

  it('fails closed when operating-system encryption is unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'aster-credentials-'))
    temporaryPaths.push(root)
    const store = new CredentialStore(join(root, 'credentials.json'), {
      ...reversingEncryption,
      isEncryptionAvailable: () => false,
    })
    expect(() => store.set('secret', 'value')).toThrow('encryption is unavailable')
  })
})

const reversingEncryption: EncryptionAdapter = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from([...Buffer.from(value)].reverse()),
  decryptString: (value) => Buffer.from([...value].reverse()).toString('utf8'),
}
