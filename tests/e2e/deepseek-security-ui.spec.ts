import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StateDatabase } from '../../src/main/state/database.js'

test('selects DeepSeek Security and completes an isolated local preflight', async () => {
  test.skip(!process.env.DEEPSEEK_API_KEY?.trim(), 'DEEPSEEK_API_KEY is required for provider preflight.')
  test.setTimeout(90_000)
  const profile = mkdtempSync(join(tmpdir(), 'aster-security-ui-e2e-'))
  const repository = join(profile, 'repository')
  mkdirSync(repository)
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', repository])
  writeFileSync(join(repository, 'safe.ts'), 'export const safe = true\n')
  execFileSync('git', ['-C', repository, 'add', '.'])
  execFileSync('git', ['-C', repository, '-c', 'user.name=Aster Test', '-c', 'user.email=aster@example.invalid', 'commit', '--quiet', '-m', 'fixture'])
  const database = new StateDatabase(join(profile, 'aster-code.sqlite3'))
  const project = database.upsertProject(repository)
  const timestamp = new Date().toISOString()
  database.upsertSecurityScan({
    id: '5c680dad-561c-449b-9790-da39f933ab8d',
    projectId: project.id,
    projectName: project.name,
    projectPath: project.path,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'cancelled',
    request: {
      projectId: project.id,
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      mode: 'standard',
      target: { kind: 'repository' },
      auth: 'api-key',
    },
    progress: {
      phase: 'discovery',
      filesCompleted: 1,
      filesTotal: 1,
      deepseekUsage: {
        inputTokens: 1_200_000,
        cachedInputTokens: 900_000,
        cacheWriteInputTokens: 0,
        uncachedInputTokens: 300_000,
        outputTokens: 50_000,
        reasoningOutputTokens: 35_000,
        totalTokens: 1_250_000,
        estimatedUsd: 0.0565,
        estimatedCny: 0.38103,
        usdCnyRate: 6.743,
        exchangeRateDate: '2026-08-13',
        exchangeRateSource: 'frankfurter-ecb',
        pricingTier: 'current',
        pricingVersion: '2026-08-14',
      },
    },
    result: null,
    error: null,
  })
  database.close()

  const executablePath = process.env.ASTER_E2E_EXECUTABLE?.trim()
  const application = await electron.launch(executablePath
    ? { executablePath, args: [`--user-data-dir=${profile}`] }
    : { args: ['.', `--user-data-dir=${profile}`] })
  try {
    const window = await application.firstWindow()
    await window.getByRole('button', { name: '安全', exact: true }).click()
    const security = window.getByRole('dialog', { name: '安全工作台' })
    await security.getByRole('button', { name: '扫描', exact: true }).click()
    await security.getByLabel('模型提供商').selectOption('deepseek')
    await expect(security.getByLabel('DeepSeek 模型')).toHaveValue('deepseek-v4-pro')
    await expect(security).toContainText('实时显示 token 与人民币估算')
    await expect(security).toContainText('Flash 与 Pro 均已通过')
    await security.getByLabel('DeepSeek 模型').selectOption('deepseek-v4-flash')
    await expect(security.getByLabel('DeepSeek 模型')).toHaveValue('deepseek-v4-flash')
    await security.getByLabel('DeepSeek 模型').selectOption('deepseek-v4-pro')
    await security.getByRole('button', { name: '本地预检', exact: true }).click()
    await expect(security).toContainText('预检通过', { timeout: 30_000 })
    await expect(security).toContainText('deepseek · deepseek-v4-pro')
    await expect(security).toContainText('产物目录已隔离')
    await expect(security.getByLabel('DeepSeek 实时 Token 与费用')).toContainText('1,200,000')
    await expect(security.getByLabel('DeepSeek 实时 Token 与费用')).toContainText('总计 1,250,000')
    await expect(security.getByLabel('DeepSeek 实时 Token 与费用')).toContainText('75.0%')
    await expect(security.getByLabel('DeepSeek 实时 Token 与费用')).toContainText('¥0.381030')
    await window.screenshot({ path: 'test-results/aster-security-deepseek.png' })
  } finally {
    await application.close()
    rmSync(profile, { force: true, recursive: true })
  }
})
