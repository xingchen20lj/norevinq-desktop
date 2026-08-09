import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StateDatabase } from '../../src/main/state/database.js'

test('starts with a sandboxed renderer and real project action', async () => {
  test.setTimeout(240_000)
  const profile = mkdtempSync(join(tmpdir(), 'aster-e2e-'))
  const projectPath = mkdtempSync(join(profile, 'project-'))
  const database = new StateDatabase(join(profile, 'aster-code.sqlite3'))
  const project = database.upsertProject(projectPath)
  database.close()
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectPath })
  execFileSync('git', ['config', 'user.name', 'Aster E2E'], { cwd: projectPath })
  execFileSync('git', ['config', 'user.email', 'aster-e2e@example.invalid'], { cwd: projectPath })
  writeFileSync(join(projectPath, 'README.md'), '# E2E\n')
  execFileSync('git', ['add', 'README.md'], { cwd: projectPath })
  execFileSync('git', ['commit', '-m', 'test: baseline'], { cwd: projectPath })
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
    const deepSeekConfigured = typeof process.env.DEEPSEEK_API_KEY === 'string' && process.env.DEEPSEEK_API_KEY.trim().length > 0
    const runtimeModelIds = runtime.models.map((item) => (item as { id?: string }).id)
    expect(runtimeModelIds.includes('deepseek-v4-flash')).toBe(deepSeekConfigured)

    const securityState = await window.evaluate(() => ({
      hasNodeRequire: typeof Reflect.get(globalThis, 'require') !== 'undefined',
      hasProcess: typeof Reflect.get(globalThis, 'process') !== 'undefined',
      hasAsterBridge: typeof Reflect.get(window, 'aster') === 'object',
    }))
    expect(securityState).toEqual({ hasNodeRequire: false, hasProcess: false, hasAsterBridge: true })

    await window.getByRole('button', { name: '设置', exact: true }).click()
    await expect(window.getByRole('dialog', { name: '模型提供商设置' })).toBeVisible()
    await expect(window.getByRole('dialog', { name: '模型提供商设置' })).toContainText(
      deepSeekConfigured ? '由进程环境安全提供' : '添加 API Key 以启用',
    )
    await expect(window.getByRole('dialog', { name: '模型提供商设置' })).toContainText('DeepSeek V4 Pro 暂不可用')
    await window.getByRole('button', { name: '关闭设置' }).click()

    await window.getByLabel('任务输入').fill('Reply with exactly ASTER_RUNTIME_OK and do not use tools.')
    await window.getByRole('button', { name: '发送任务' }).click()
    await expect(window.locator('.activity-card.agentMessage')).toContainText('ASTER_RUNTIME_OK', { timeout: 90_000 })
    await expect(window.locator('.running-row')).toHaveCount(0, { timeout: 30_000 })

    if (deepSeekConfigured) {
      await window.evaluate(async ({ projectId }) => {
        const bridge = Reflect.get(window, 'aster') as {
          startConversation: (input: unknown) => Promise<unknown>
        }
        await bridge.startConversation({
          projectId,
          model: 'deepseek-v4-flash',
          modelProvider: 'deepseek',
          reasoningEffort: 'low',
          text: 'Use apply_patch to create a file named aster-deepseek-proof.txt in the project root containing exactly DEEPSEEK_TOOL_OK followed by a newline. Do not run shell commands. After the file is created, reply with exactly ASTER_DEEPSEEK_OK.',
        })
      }, { projectId: project.id })
      await expect(window.locator('.activity-card.fileChange, .activity-card.command')
        .filter({ hasText: /apply_patch|aster-deepseek-proof/ }).first()).toBeVisible({ timeout: 120_000 })
      await expect(window.locator('.activity-card.agentMessage').filter({ hasText: 'ASTER_DEEPSEEK_OK' })).toBeVisible({ timeout: 120_000 })
      await expect(window.locator('.running-row')).toHaveCount(0, { timeout: 30_000 })
      expect(readFileSync(join(projectPath, 'aster-deepseek-proof.txt'), 'utf8')).toBe('DEEPSEEK_TOOL_OK\n')
    }

    await window.evaluate(async ({ projectId }) => {
      const bridge = Reflect.get(window, 'aster') as {
        startConversation: (input: unknown) => Promise<unknown>
      }
      await bridge.startConversation({
        projectId,
        sandbox: 'read-only',
        text: 'Create a file named aster-approval-proof.txt in the project root containing exactly ASTER_APPROVAL_OK followed by a newline. Use apply_patch only and do not run shell commands.',
      })
    }, { projectId: project.id })
    await expect(window.getByLabel('待审批操作')).toBeVisible({ timeout: 90_000 })
    await expect(window.getByLabel('待审批操作')).toContainText('允许修改文件？')
    await window.getByRole('button', { name: '允许', exact: true }).click()
    await expect(window.locator('.running-row')).toHaveCount(0, { timeout: 90_000 })
    expect(existsSync(join(projectPath, 'aster-approval-proof.txt'))).toBe(true)
    expect(readFileSync(join(projectPath, 'aster-approval-proof.txt'), 'utf8')).toBe('ASTER_APPROVAL_OK\n')

    await window.getByRole('button', { name: 'Git 状态' }).click()
    await expect(window.getByLabel('Git 工作区')).toBeVisible()
    await window.getByRole('button', { name: '刷新', exact: true }).click()
    await expect(window.getByRole('button', { name: '暂存 aster-approval-proof.txt' })).toBeVisible()
    await window.getByRole('button', { name: '审阅未暂存' }).click()
    await expect(window.getByLabel('代码差异')).toContainText('aster-approval-proof.txt')
    await expect(window.getByLabel('代码差异')).toContainText('ASTER_APPROVAL_OK')
    await window.getByRole('button', { name: '← 返回状态' }).click()
    await window.getByRole('button', { name: '暂存 aster-approval-proof.txt' }).click()
    if (deepSeekConfigured) {
      await window.getByRole('button', { name: '暂存 aster-deepseek-proof.txt' }).click()
    }
    await window.getByLabel('提交说明').fill('test: approval proof')
    await window.getByRole('button', { name: '提交', exact: true }).click()
    await expect(window.getByLabel('Git 工作区')).toContainText('工作区干净')
    await window.getByRole('button', { name: '关闭 Git' }).click()

    await window.getByRole('button', { name: 'Local', exact: true }).click()
    await expect(window.getByRole('complementary', { name: '工作树' })).toBeVisible()
    await window.getByRole('button', { name: '创建', exact: true }).click()
    await expect(window.getByRole('button', { name: /Detached/ })).toBeVisible()
    await window.getByRole('button', { name: '锁定', exact: true }).click()
    await expect(window.getByRole('button', { name: '解锁', exact: true })).toBeVisible()
    await window.getByRole('button', { name: '解锁', exact: true }).click()
    await window.getByRole('button', { name: /Detached/ }).click()
    await expect(window.getByRole('button', { name: 'Worktree', exact: true })).toBeVisible()

    await window.getByRole('button', { name: /新任务/ }).click()
    await window.getByLabel('任务输入').fill('Run the shell command sleep 8, then reply with FIRST. Do not perform any other action.')
    await window.getByRole('button', { name: '发送任务' }).click()
    await expect(window.locator('.activity-card.command')).toBeVisible({ timeout: 90_000 })
    await window.getByLabel('任务输入').fill('After the sleep, reply with exactly ASTER_STEER_OK instead.')
    await window.getByLabel('任务输入').press('Enter')
    await expect(window.locator('.activity-card.agentMessage').filter({ hasText: 'ASTER_STEER_OK' })).toBeVisible({ timeout: 90_000 })
    await expect(window.locator('.running-row')).toHaveCount(0, { timeout: 30_000 })

    await window.getByRole('button', { name: /新任务/ }).click()
    await window.getByLabel('任务输入').fill('Run the shell command sleep 20, then reply INTERRUPT_FAILED.')
    await window.getByRole('button', { name: '发送任务' }).click()
    await expect(window.locator('.activity-card.command')).toBeVisible({ timeout: 90_000 })
    await window.getByRole('button', { name: '停止任务' }).click()
    await expect(window.locator('.running-row')).toHaveCount(0, { timeout: 30_000 })
    await expect(window.locator('.activity-card.agentMessage')).not.toContainText('INTERRUPT_FAILED')
    await window.getByRole('button', { name: 'Worktree', exact: true }).click()
    await window.getByRole('button', { name: '移除', exact: true }).click()
    await expect(window.getByRole('button', { name: 'Local', exact: true })).toBeVisible()
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
