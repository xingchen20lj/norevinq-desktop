import { _electron as electron, expect, test } from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { StateDatabase } from '../../src/main/state/database.js'

test.skip(process.platform === 'win32', 'The deterministic Codex fixture wrapper uses a POSIX launcher; WorktreeService has cross-platform unit coverage.')

test('opens a plain non-Git project without a worktree fatal error', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'aster-non-git-e2e-'))
  const projectPath = join(profile, '0811')
  const codexHome = join(profile, 'agent-home')
  const wrapper = join(profile, 'fake-codex')
  mkdirSync(projectPath)
  mkdirSync(codexHome)
  writeFileSync(join(projectPath, 'notes.txt'), 'plain project\n')
  const database = new StateDatabase(join(profile, 'aster-code.sqlite3'))
  const project = database.upsertProject(projectPath)
  database.close()
  const helper = resolve('tests/helpers/fakeCodexLifecycle.mjs')
  writeFileSync(wrapper, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(helper)} "$@"\n`)
  chmodSync(wrapper, 0o755)

  const application = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, ASTER_AGENT_HOME: codexHome, CODEX_BINARY: wrapper },
  })
  try {
    const window = await application.firstWindow()
    await expect(window.locator('.runtime-pill')).toContainText('Aster 已就绪', { timeout: 20_000 })
    await expect(window.getByRole('heading', { name: `开始处理 ${project.name}` })).toBeVisible()
    await expect(window.getByRole('alert')).toHaveCount(0)
    await window.getByRole('button', { name: 'Local', exact: true }).click()
    const panel = window.getByRole('complementary', { name: '工作树' })
    await expect(panel).toContainText('此文件夹还不是 Git 仓库')
    await expect(panel).toContainText('普通 Aster 任务仍可使用')
    await expect(panel.getByRole('button', { name: '创建', exact: true })).toHaveCount(0)
    await window.screenshot({ path: 'test-results/aster-non-git-project.png' })
  } finally {
    await application.close()
    rmSync(profile, { force: true, recursive: true })
  }
})

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
