import { _electron as electron, expect, test, type Locator } from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { StateDatabase } from '../../src/main/state/database.js'

test.skip(process.platform === 'win32', 'The deterministic fixture wrapper uses a POSIX launcher; protocol coverage remains cross-platform.')

test('searches, paginates, renames, forks, compacts, archives, restores, and deletes tasks', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'aster-lifecycle-e2e-'))
  const projectPath = join(profile, 'project')
  const codexHome = join(profile, 'codex-home')
  const wrapper = join(profile, 'fake-codex')
  const helper = resolve('tests/helpers/fakeCodexLifecycle.mjs')
  mkdirSync(projectPath)
  mkdirSync(codexHome)
  const database = new StateDatabase(join(profile, 'aster-code.sqlite3'))
  const project = database.upsertProject(projectPath)
  database.close()
  writeFileSync(wrapper, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(helper)} "$@"\n`)
  chmodSync(wrapper, 0o755)
  const application = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, CODEX_BINARY: wrapper, CODEX_HOME: codexHome },
  })
  try {
    const window = await application.firstWindow()
    const taskRow = (name: string): Locator =>
      window.locator('.thread-row').filter({ hasText: name })
    await expect(window.locator('.runtime-pill')).toContainText('Codex 已就绪', { timeout: 20_000 })
    await window.getByRole('button', { name: `固定项目 ${project.name}` }).click()
    await expect(window.getByRole('button', { name: `取消固定项目 ${project.name}` })).toBeVisible()
    await expect(taskRow('Lifecycle primary')).toBeVisible()
    await window.getByRole('button', { name: '加载更多' }).click()
    await expect(taskRow('Lifecycle secondary')).toBeVisible()
    await window.getByRole('button', { name: '固定任务 Lifecycle secondary' }).click()
    await expect(window.locator('.thread-row').first()).toContainText('Lifecycle secondary')

    await window.reload()
    await expect(window.locator('.runtime-pill')).toContainText('Codex 已就绪', { timeout: 20_000 })
    await expect(window.getByRole('button', { name: `取消固定项目 ${project.name}` })).toBeVisible()
    await expect(window.locator('.thread-row').first()).toContainText('Lifecycle secondary')
    await window.getByRole('button', { name: '取消固定任务 Lifecycle secondary' }).click()
    await expect(window.locator('.thread-row').first()).toContainText('Lifecycle primary')

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
    ]))
    expect(requests.some(({ method, params }) => method === 'thread/list' && params?.cursor === 'page-2')).toBe(true)
    expect(requests.some(({ method, params }) => method === 'thread/list' && params?.searchTerm === 'secondary')).toBe(true)
  } finally {
    await application.close()
    rmSync(profile, { force: true, recursive: true })
  }
})

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
