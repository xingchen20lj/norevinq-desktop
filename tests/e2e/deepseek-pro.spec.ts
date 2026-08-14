import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StateDatabase } from '../../src/main/state/database.js'

const deepSeekConfigured = typeof process.env.DEEPSEEK_API_KEY === 'string'
  && process.env.DEEPSEEK_API_KEY.trim().length > 0

test.skip(!deepSeekConfigured, 'DEEPSEEK_API_KEY is required for the real V4 Pro Responses test.')

test('DeepSeek V4 Pro completes a real Codex apply_patch workflow', async () => {
  test.setTimeout(180_000)
  const profile = mkdtempSync(join(tmpdir(), 'norevinq-deepseek-pro-e2e-'))
  const projectPath = join(profile, 'project')
  mkdirSync(projectPath)
  const database = new StateDatabase(join(profile, 'norevinq.sqlite3'))
  database.upsertProject(projectPath)
  database.close()
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectPath })
  execFileSync('git', ['config', 'user.name', 'Norevinq E2E'], { cwd: projectPath })
  execFileSync('git', ['config', 'user.email', 'norevinq-e2e@example.invalid'], { cwd: projectPath })
  writeFileSync(join(projectPath, 'README.md'), '# DeepSeek V4 Pro E2E\n')
  execFileSync('git', ['add', 'README.md'], { cwd: projectPath })
  execFileSync('git', ['commit', '-m', 'test: baseline'], { cwd: projectPath })

  const application = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      NOREVINQ_AGENT_HOME: join(profile, 'agent-home'),
    },
  })
  try {
    const window = await application.firstWindow()
    await expect(window.locator('.runtime-pill')).toContainText('Norevinq 已就绪', { timeout: 20_000 })
    const models = await window.evaluate(async () => {
      const bridge = Reflect.get(window, 'norevinq') as {
        getRuntimeStatus: () => Promise<{ models: { id: string }[] }>
      }
      return (await bridge.getRuntimeStatus()).models.map(({ id }) => id)
    })
    expect(models).toContain('deepseek-v4-pro')

    await window.getByLabel('模型').selectOption('deepseek-v4-pro')
    await window.getByLabel('推理强度').selectOption('low')
    await window.getByLabel('任务输入').fill('Use apply_patch to create a file named norevinq-deepseek-pro-proof.txt in the project root containing exactly DEEPSEEK_PRO_TOOL_OK followed by a newline. Do not run shell commands. After the file is created, reply with exactly NOREVINQ_DEEPSEEK_PRO_OK.')
    await window.getByRole('button', { name: '发送任务' }).click()

    await expect(window.locator('.activity-card.fileChange, .activity-card.command')
      .filter({ hasText: /apply_patch|norevinq-deepseek-pro-proof/ }).first()).toBeVisible({ timeout: 150_000 })
    await expect(window.locator('.activity-card.agentMessage')
      .filter({ hasText: 'NOREVINQ_DEEPSEEK_PRO_OK' })).toBeVisible({ timeout: 150_000 })
    await expect(window.locator('.running-row')).toHaveCount(0, { timeout: 30_000 })
    expect(readFileSync(join(projectPath, 'norevinq-deepseek-pro-proof.txt'), 'utf8')).toBe('DEEPSEEK_PRO_TOOL_OK\n')
  } finally {
    await application.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
