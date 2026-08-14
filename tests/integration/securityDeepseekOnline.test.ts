import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { CodexSecurity, type ScanTokenUsage } from '@openai/codex-security'
import { createDeepSeekSecurityConfig } from '../../src/main/providers/deepseek.js'

const enabled = process.env.NOREVINQ_RUN_SECURITY_DEEPSEEK_ONLINE === '1'
  && Boolean(process.env.DEEPSEEK_API_KEY?.trim())
  && Boolean(process.env.NOREVINQ_SECURITY_PYTHON?.trim())
const roots: string[] = []
const selectedModel = process.env.NOREVINQ_SECURITY_DEEPSEEK_MODEL === 'deepseek-v4-flash'
  ? 'deepseek-v4-flash'
  : 'deepseek-v4-pro'
const preserveArtifacts = process.env.NOREVINQ_KEEP_SECURITY_FIXTURE === '1'

afterAll(() => {
  if (!preserveArtifacts) for (const root of roots) rmSync(root, { force: true, recursive: true })
})

describe.skipIf(!enabled)('Codex Security with DeepSeek Responses', () => {
  it('completes and seals a real repository scan without OpenAI credentials', async () => {
    const root = mkdtempSync(join(tmpdir(), 'norevinq-security-deepseek-online-'))
    roots.push(root)
    const repository = join(root, 'repository')
    const output = join(root, 'scan-output')
    const state = join(root, 'security-state')
    mkdirSync(join(repository, 'src'), { recursive: true })
    mkdirSync(state)
    writeFileSync(join(repository, 'src', 'safe.ts'), "export const NOREVINQ_SECURITY_FIXTURE = 'read-only fixture'\n")
    execFileSync('git', ['init', '--quiet', '--initial-branch=main', repository])
    execFileSync('git', ['-C', repository, 'add', '.'])
    execFileSync('git', ['-C', repository, '-c', 'user.name=Norevinq Test', '-c', 'user.email=norevinq@example.invalid', 'commit', '--quiet', '-m', 'fixture'])

    const apiKey = process.env.DEEPSEEK_API_KEY?.trim() ?? ''
    const pythonPath = process.env.NOREVINQ_SECURITY_PYTHON?.trim() ?? ''
    const configuredCodexPath = process.env.NOREVINQ_SECURITY_CODEX_CLI_PATH?.trim()
    const config = createDeepSeekSecurityConfig(
      selectedModel,
      apiKey,
      state,
      process.env,
      configuredCodexPath?.length ? configuredCodexPath : null,
    )
    const security = new CodexSecurity({ ...config, pythonPath })
    const usage: ScanTokenUsage[] = []
    try {
      const result = await security.run(repository, {
        auth: 'api-key',
        mode: 'standard',
        target: ['src/safe.ts'],
        outputDir: output,
        onUsage: (value) => usage.push({ ...value }),
      })
      expect(result.threadId).toBeTruthy()
      expect(result.reportPath).toContain(output)
      expect(result.manifest.scan.id).toBeTruthy()
      expect(result.manifest.scan.status).toBe('completed')
      expect(result.manifest.scan.sealedAt).toBeTruthy()
      expect(usage.at(-1)?.totalTokens).toBeGreaterThan(0)
    } finally {
      await security.close()
    }
  }, 30 * 60 * 1_000)
})
