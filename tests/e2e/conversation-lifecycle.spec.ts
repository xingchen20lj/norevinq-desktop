import { _electron as electron, expect, test, type Locator } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { StateDatabase } from '../../src/main/state/database.js'

test.skip(process.platform === 'win32', 'The deterministic fixture wrapper uses a POSIX launcher; protocol coverage remains cross-platform.')

test('searches, paginates, renames, forks, compacts, archives, restores, and deletes tasks', async () => {
  test.setTimeout(60_000)
  const profile = mkdtempSync(join(tmpdir(), 'aster-lifecycle-e2e-'))
  const projectPath = join(profile, 'project')
  const codexHome = join(profile, 'agent-home')
  const wrapper = join(profile, 'fake-codex')
  const helper = resolve('tests/helpers/fakeCodexLifecycle.mjs')
  mkdirSync(projectPath)
  mkdirSync(codexHome)
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectPath })
  execFileSync('git', ['config', 'user.name', 'Aster Lifecycle'], { cwd: projectPath })
  execFileSync('git', ['config', 'user.email', 'aster-lifecycle@example.invalid'], { cwd: projectPath })
  writeFileSync(join(projectPath, 'README.md'), '# lifecycle\n')
  execFileSync('git', ['add', 'README.md'], { cwd: projectPath })
  execFileSync('git', ['commit', '-m', 'test: lifecycle baseline'], { cwd: projectPath })
  const baselineOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectPath, encoding: 'utf8' }).trim()
  execFileSync('git', ['branch', 'release/base', baselineOid], { cwd: projectPath })
  writeFileSync(join(projectPath, 'current-only.txt'), 'not in selected baseline\n')
  execFileSync('git', ['add', 'current-only.txt'], { cwd: projectPath })
  execFileSync('git', ['commit', '-m', 'test: advance main'], { cwd: projectPath })
  const database = new StateDatabase(join(profile, 'aster-code.sqlite3'))
  const project = database.upsertProject(projectPath)
  database.close()
  writeFileSync(wrapper, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(helper)} "$@"\n`)
  chmodSync(wrapper, 0o755)
  const application = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, ASTER_AGENT_HOME: codexHome, CODEX_BINARY: wrapper },
  })
  try {
    const window = await application.firstWindow()
    const taskRow = (name: string): Locator =>
      window.locator('.thread-row').filter({ hasText: name })
    await expect(window.locator('.runtime-pill')).toContainText('Aster 已就绪', { timeout: 20_000 })
    await window.getByRole('button', { name: '设置', exact: true }).click()
    const settings = window.getByRole('dialog', { name: '设置工作台' })
    await expect(settings).toContainText('未登录')
    await settings.getByLabel('OpenAI API Key').fill('sk-e2e-not-a-real-openai-key')
    await settings.getByRole('button', { name: '使用 API Key' }).click()
    await expect(settings.locator('.provider-state').first()).toContainText('OpenAI API Key')
    await window.screenshot({ path: 'test-results/aster-openai-account.png' })
    await settings.getByRole('button', { name: '退出登录' }).click()
    await expect(settings.locator('.provider-state').first()).toContainText('未登录')
    await settings.getByRole('button', { name: '关闭设置' }).click()
    await window.getByRole('button', { name: `固定项目 ${project.name}` }).click()
    await expect(window.getByRole('button', { name: `取消固定项目 ${project.name}` })).toBeVisible()
    await expect(taskRow('Lifecycle primary')).toBeVisible()
    await window.getByRole('button', { name: '加载更多' }).click()
    await expect(taskRow('Lifecycle secondary')).toBeVisible()
    await window.getByRole('button', { name: '固定任务 Lifecycle secondary' }).click()
    await expect(window.locator('.thread-row').first()).toContainText('Lifecycle secondary')

    await window.reload()
    await expect(window.locator('.runtime-pill')).toContainText('Aster 已就绪', { timeout: 20_000 })
    await expect(window.getByRole('button', { name: `取消固定项目 ${project.name}` })).toBeVisible()
    await expect(window.locator('.thread-row').first()).toContainText('Lifecycle secondary')
    await window.getByRole('button', { name: '取消固定任务 Lifecycle secondary' }).click()
    await expect(window.locator('.thread-row').first()).toContainText('Lifecycle primary')

    const secondaryThreadId = '22222222-2222-7222-8222-222222222222'
    await application.evaluate(({ app }, url) => {
      app.emit('second-instance', { preventDefault: () => undefined }, [url], '', {})
    }, `aster-code://thread/${secondaryThreadId}?project=${project.id}`)
    await expect(window.locator('.topbar-title')).toContainText('Lifecycle secondary')
    const permissionPanel = window.getByRole('region', { name: '待审批操作' })
    await expect(permissionPanel).toContainText('授予额外权限？')
    await expect(permissionPanel).toContainText('网络访问')
    await expect(permissionPanel).toContainText('generated/**')
    await window.screenshot({ path: 'test-results/aster-permission-approval.png' })
    const readPermission = permissionPanel.locator('label').filter({ hasText: '读取' }).getByRole('checkbox')
    await readPermission.uncheck()
    await expect(readPermission).not.toBeChecked()
    await permissionPanel.getByRole('button', { name: '本次会话允许' }).click()
    await expect(permissionPanel).toHaveCount(0)

    await window.getByLabel('搜索任务').fill('secondary')
    await window.getByLabel('搜索任务').press('Enter')
    await expect(taskRow('Lifecycle secondary')).toBeVisible()
    await expect(taskRow('Lifecycle primary')).toHaveCount(0)
    await window.getByLabel('搜索任务').fill('')
    await window.getByLabel('搜索任务').press('Enter')
    await taskRow('Lifecycle primary').click()

    await window.getByRole('button', { name: '长期目标' }).click()
    const goalDialog = window.getByRole('dialog', { name: '长期目标' })
    await goalDialog.getByLabel('目标内容').fill('Ship the durable lifecycle')
    await goalDialog.getByLabel('Token 预算').fill('50000')
    await goalDialog.getByRole('button', { name: '保存目标' }).click()
    await expect(window.getByRole('article', { name: '当前长期目标' })).toContainText('Ship the durable lifecycle')
    await window.getByRole('button', { name: '长期目标' }).click()
    await goalDialog.getByLabel('目标状态').selectOption('paused')
    await goalDialog.getByRole('button', { name: '保存目标' }).click()
    await expect(window.getByRole('article', { name: '当前长期目标' })).toContainText('已暂停')
    await window.screenshot({ path: 'test-results/aster-thread-goal.png' })
    await window.getByRole('button', { name: '长期目标' }).click()
    window.once('dialog', async (dialog) => { await dialog.accept() })
    await goalDialog.getByRole('button', { name: '清除目标' }).click()
    await expect(window.getByRole('article', { name: '当前长期目标' })).toHaveCount(0)

    await window.getByRole('button', { name: 'Local', exact: true }).click()
    const worktreePanel = window.getByRole('complementary', { name: '工作树' })
    await worktreePanel.getByLabel('工作树基线').selectOption('refs/heads/release/base')
    await worktreePanel.getByRole('button', { name: '创建', exact: true }).click()
    await expect(worktreePanel.getByRole('button', { name: /Detached/ })).toBeVisible()
    await window.screenshot({ path: 'test-results/aster-worktree-base.png' })
    const [managedWorktree] = await window.evaluate(async ({ projectId }) => {
      const bridge = Reflect.get(window, 'aster') as {
        listWorktrees: (input: { projectId: string }) => Promise<{ id: string; path: string; baseRef: string; baseOid: string | null; headOid: string | null }[]>
      }
      return bridge.listWorktrees({ projectId })
    }, { projectId: project.id })
    expect(managedWorktree).toBeDefined()
    expect(managedWorktree).toMatchObject({ baseRef: 'refs/heads/release/base', baseOid: baselineOid, headOid: baselineOid })
    expect(existsSync(join(managedWorktree?.path ?? '', 'current-only.txt'))).toBe(false)
    writeFileSync(join(projectPath, 'README.md'), '# staged\n')
    execFileSync('git', ['add', 'README.md'], { cwd: projectPath })
    writeFileSync(join(projectPath, 'README.md'), '# staged\nunstaged\n')
    writeFileSync(join(projectPath, 'handoff.txt'), 'ASTER_HANDOFF_OK\n')

    window.once('dialog', async (dialog) => { await dialog.accept() })
    await worktreePanel.getByRole('button', { name: /Detached/ }).click()
    await expect(window.getByRole('button', { name: 'Worktree', exact: true })).toBeVisible()
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: projectPath, encoding: 'utf8' })).toBe('')
    expect(readFileSync(join(managedWorktree?.path ?? '', 'handoff.txt'), 'utf8')).toBe('ASTER_HANDOFF_OK\n')

    await window.getByRole('button', { name: '重命名任务' }).click()
    const rename = window.getByRole('dialog', { name: '重命名任务' })
    await rename.getByLabel('任务名称').fill('Renamed primary')
    await rename.getByRole('button', { name: '保存名称' }).click()
    await expect(window.locator('.topbar-title')).toContainText('Renamed primary')
    await window.getByRole('button', { name: '分叉任务' }).click()
    await expect(window.locator('.topbar-title')).toContainText('Renamed primary fork')

    window.once('dialog', async (dialog) => { await dialog.accept() })
    await window.getByRole('button', { name: '压缩上下文' }).click()
    await window.getByRole('button', { name: '归档任务', exact: true }).click()
    await expect(window.locator('.topbar-title')).toContainText(project.name)

    await window.getByTitle('显示已归档任务').click()
    await taskRow('Renamed primary fork').click()
    await window.getByRole('button', { name: '恢复任务' }).click()
    await window.getByTitle('显示活动任务').click()
    await taskRow('Renamed primary fork').click()

    window.once('dialog', async (dialog) => { await dialog.accept() })
    await window.getByRole('button', { name: '永久删除任务' }).click()
    await expect(taskRow('Renamed primary fork')).toHaveCount(0)
    await expect(taskRow('Renamed primary')).toBeVisible()
    await window.screenshot({ path: 'test-results/aster-conversation-lifecycle.png' })

    const requests = readFileSync(join(codexHome, 'fake-lifecycle-requests.jsonl'), 'utf8')
      .trim().split('\n').map((line) => JSON.parse(line) as { method: string; params: Record<string, unknown> | null })
    expect(requests.map(({ method }) => method)).toEqual(expect.arrayContaining([
      'thread/name/set',
      'thread/fork',
      'thread/compact/start',
      'thread/archive',
      'thread/unarchive',
      'thread/delete',
      'thread/goal/get',
      'thread/goal/set',
      'thread/goal/clear',
      'account/read',
      'account/login/start',
      'account/logout',
    ]))
    const identityRequests = requests.filter(({ method }) => method === 'thread/resume' || method === 'thread/fork')
    expect(identityRequests.length).toBeGreaterThan(0)
    for (const request of identityRequests) {
      expect(request.params).toMatchObject({
        developerInstructions: expect.stringContaining('refer to yourself as Aster'),
      })
    }
    expect(requests.find(({ method }) => method === 'account/login/start')?.params).toEqual({
      type: 'apiKey',
      apiKey: '[REDACTED]',
    })
    expect(requests.some(({ method, params }) => method === 'thread/list' && params?.cursor === 'page-2')).toBe(true)
    expect(requests.some(({ method, params }) => method === 'thread/list' && params?.searchTerm === 'secondary')).toBe(true)
    expect(requests.find(({ method }) => method === 'client/permission-response')?.params).toEqual({
      permissions: {
        network: { enabled: true },
        fileSystem: {
          read: null,
          write: null,
          entries: [{ path: { type: 'glob_pattern', pattern: `${realpathSync(projectPath)}/generated/**` }, access: 'write' }],
        },
      },
      scope: 'session',
    })
  } finally {
    await application.close()
    rmSync(profile, { force: true, recursive: true })
  }
})

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
