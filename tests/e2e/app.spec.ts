import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StateDatabase } from '../../src/main/state/database.js'

test('starts with a sandboxed renderer and real project action', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'aster-e2e-'))
  const projectPath = mkdtempSync(join(profile, 'project-'))
  const database = new StateDatabase(join(profile, 'aster-code.sqlite3'))
  database.upsertProject(projectPath)
  database.close()
  const application = await electron.launch({ args: ['.', `--user-data-dir=${profile}`] })
  try {
    const window = await application.firstWindow()
    await expect(window).toHaveTitle('Aster Code')
    await expect(window.getByRole('heading', { name: /开始处理 project-/ })).toBeVisible()
    await expect(window.locator('.runtime-pill')).toContainText('Codex 已就绪', { timeout: 20_000 })

    const runtime = await window.evaluate(async () => {
      const bridge = Reflect.get(window, 'aster') as {
        getRuntimeStatus: () => Promise<{ phase: string; version: string | null; models: unknown[] }>
      }
      return bridge.getRuntimeStatus()
    })
    expect(runtime.phase).toBe('ready')
    expect(runtime.version).toContain('codex-cli')
    expect(runtime.models.length).toBeGreaterThan(0)

    const securityState = await window.evaluate(() => ({
      hasNodeRequire: typeof Reflect.get(globalThis, 'require') !== 'undefined',
      hasProcess: typeof Reflect.get(globalThis, 'process') !== 'undefined',
      hasAsterBridge: typeof Reflect.get(window, 'aster') === 'object',
    }))
    expect(securityState).toEqual({ hasNodeRequire: false, hasProcess: false, hasAsterBridge: true })

    await window.getByLabel('任务输入').fill('Reply with exactly ASTER_RUNTIME_OK and do not use tools.')
    await window.getByRole('button', { name: '发送任务' }).click()
    await expect(window.locator('.activity-card.agentMessage')).toContainText('ASTER_RUNTIME_OK', { timeout: 90_000 })
    await expect(window.locator('.running-row')).toHaveCount(0, { timeout: 30_000 })
    await window.screenshot({ path: 'test-results/aster-shell.png' })

    const originalTheme = await window.locator('html').getAttribute('data-theme')
    await window.getByRole('button', { name: '切换主题' }).click()
    await expect(window.locator('html')).not.toHaveAttribute('data-theme', originalTheme ?? '')

    await window.setViewportSize({ width: 960, height: 640 })
    await expect(window.getByLabel('任务输入')).toBeVisible()
    await expect(window.locator('.activity-timeline')).toBeVisible()
    await window.screenshot({ path: 'test-results/aster-shell-compact.png' })
  } finally {
    await application.close()
    rmSync(profile, { force: true, recursive: true })
  }
})
