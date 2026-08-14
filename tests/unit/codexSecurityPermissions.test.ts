import { describe, expect, it } from 'vitest'
import { scanRuntimeCodexConfig } from '../../node_modules/@openai/codex-security/dist/api.js'

describe('Codex Security runtime permissions', () => {
  it('preserves the official repository-read and scan-workspace-write profile', () => {
    const stateDirectory = '/private/norevinq/security-state'
    const credentialHome = '/private/norevinq/security-credentials'
    const config = scanRuntimeCodexConfig({ sandbox_mode: 'danger-full-access' }, stateDirectory, credentialHome)
    const profiles = config.permissions as Record<string, { filesystem: Record<string, string> }>
    const filesystem = profiles.codex_security_scan?.filesystem

    expect(config.sandbox_mode).toBeUndefined()
    expect(config.allow_login_shell).toBe(false)
    expect(config.default_permissions).toBe('codex_security_scan')
    expect(filesystem).toEqual({
      ':root': 'read',
      ':workspace_roots': 'write',
      [stateDirectory]: 'write',
      [credentialHome]: 'read',
    })
  })
})
