import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { StateDatabase } from '../../src/main/state/database.js'

const deepSeekKey = process.env.DEEPSEEK_API_KEY?.trim() ?? ''
const openAiAuthPath = join(homedir(), '.codex', 'auth.json')

test.skip(!deepSeekKey || !existsSync(openAiAuthPath), 'Requires DeepSeek API Key and an existing OpenAI login.')

test('switches a real task from DeepSeek to OpenAI and back through the model picker', async () => {
  test.setTimeout(210_000)
  const profile = mkdtempSync(join(tmpdir(), 'norevinq-provider-ui-'))
  const projectPath = join(profile, 'project')
  const agentHome = join(profile, 'agent-home')
  mkdirSync(projectPath)
  mkdirSync(agentHome, { mode: 0o700 })
  copyFileSync(openAiAuthPath, join(agentHome, 'auth.json'))
  chmodSync(join(agentHome, 'auth.json'), 0o600)
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectPath })
  const database = new StateDatabase(join(profile, 'norevinq.sqlite3'))
  database.upsertProject(projectPath)
  database.close()
  writeFileSync(join(projectPath, 'README.md'), '# provider switch\n')

  const application = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, NOREVINQ_AGENT_HOME: agentHome },
  })
  try {
    const window = await application.firstWindow()
    await expect(window.locator('.runtime-pill')).toContainText('Norevinq 已就绪', { timeout: 20_000 })
    await window.getByLabel('模型').selectOption('deepseek-v4-flash')
    await window.getByLabel('任务输入').fill('Reply with exactly NOREVINQ_PROVIDER_DEEPSEEK_START and do not use tools.')
    await window.getByRole('button', { name: '发送任务' }).click()
    await expect(window.locator('.activity-card.agentMessage')
      .filter({ hasText: 'NOREVINQ_PROVIDER_DEEPSEEK_START' })).toBeVisible({ timeout: 90_000 })
    await expect(window.locator('.running-row')).toHaveCount(0, { timeout: 30_000 })

    await window.getByLabel('模型').selectOption('gpt-5.6-sol')
    await window.getByLabel('任务输入').fill('Reply with exactly NOREVINQ_PROVIDER_OPENAI_OK and do not use tools.')
    await window.getByRole('button', { name: '发送任务' }).click()
    await expect(window.locator('.activity-card.agentMessage')
      .filter({ hasText: 'NOREVINQ_PROVIDER_OPENAI_OK' })).toBeVisible({ timeout: 90_000 })
    await expect(window.locator('.running-row')).toHaveCount(0, { timeout: 30_000 })

    await window.getByLabel('模型').selectOption('deepseek-v4-pro')
    await window.getByLabel('任务输入').fill('Reply with exactly NOREVINQ_PROVIDER_DEEPSEEK_RETURN_OK and do not use tools.')
    await window.getByRole('button', { name: '发送任务' }).click()
    await expect(window.locator('.activity-card.agentMessage')
      .filter({ hasText: 'NOREVINQ_PROVIDER_DEEPSEEK_RETURN_OK' })).toBeVisible({ timeout: 90_000 })
    await expect(window.locator('.running-row')).toHaveCount(0, { timeout: 30_000 })
    await expect(window.locator('.activity-card.error')).toHaveCount(0)
    await window.screenshot({ path: 'test-results/norevinq-provider-switch.png' })
  } finally {
    await application.close()
    rmSync(profile, { force: true, recursive: true })
  }
})
