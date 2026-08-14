import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { StateDatabase } from '../../src/main/state/database.js'

test.skip(process.platform === 'win32', 'The deterministic Codex fixture wrapper uses a POSIX launcher; Git service coverage is cross-platform.')

test('discards and restores a whole file across an app restart', async () => {
  test.setTimeout(60_000)
  const profile = mkdtempSync(join(tmpdir(), 'norevinq-git-discard-e2e-'))
  const projectPath = join(profile, 'project')
  const codexHome = join(profile, 'agent-home')
  const wrapper = join(profile, 'fake-codex')
  mkdirSync(projectPath)
  mkdirSync(codexHome)
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectPath })
  execFileSync('git', ['config', 'user.name', 'Norevinq Git E2E'], { cwd: projectPath })
  execFileSync('git', ['config', 'user.email', 'norevinq-git-e2e@example.invalid'], { cwd: projectPath })
  writeFileSync(join(projectPath, 'proof.txt'), 'baseline\n')
  execFileSync('git', ['add', 'proof.txt'], { cwd: projectPath })
  execFileSync('git', ['commit', '-m', 'test: baseline'], { cwd: projectPath })
  const database = new StateDatabase(join(profile, 'norevinq.sqlite3'))
  database.upsertProject(projectPath)
  database.close()
  const helper = resolve('tests/helpers/fakeCodexLifecycle.mjs')
  writeFileSync(wrapper, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(helper)} "$@"\n`)
  chmodSync(wrapper, 0o755)
  const launch = () => electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, NOREVINQ_AGENT_HOME: codexHome, CODEX_BINARY: wrapper },
  })

  let application = await launch()
  try {
    let window = await application.firstWindow()
    await expect(window.locator('.runtime-pill')).toContainText('Norevinq 已就绪', { timeout: 20_000 })
    writeFileSync(join(projectPath, 'proof.txt'), 'recoverable\n')
    await window.getByRole('button', { name: 'Git 状态' }).click()
    await window.getByRole('button', { name: '刷新', exact: true }).click()
    window.once('dialog', async (dialog) => { await dialog.accept() })
    await window.getByRole('button', { name: '可恢复丢弃 proof.txt' }).click()
    await expect(window.getByRole('complementary', { name: 'Git 工作区' })).toContainText('可恢复的丢弃')
    expect(readFileSync(join(projectPath, 'proof.txt'), 'utf8')).toBe('baseline\n')
    await application.close()

    application = await launch()
    window = await application.firstWindow()
    await expect(window.locator('.runtime-pill')).toContainText('Norevinq 已就绪', { timeout: 20_000 })
    await window.getByRole('button', { name: 'Git 状态' }).click()
    const recovery = window.getByLabel('可恢复的丢弃')
    await expect(recovery).toContainText('proof.txt')
    window.once('dialog', async (dialog) => { await dialog.accept() })
    await recovery.getByRole('button', { name: '恢复' }).click()
    await expect(window.getByRole('button', { name: '可恢复丢弃 proof.txt' })).toBeVisible()
    await expect(recovery).toHaveCount(0)
    expect(readFileSync(join(projectPath, 'proof.txt'), 'utf8')).toBe('recoverable\n')
    await window.screenshot({ path: 'test-results/norevinq-git-discard-restored.png' })
  } finally {
    await application.close()
    rmSync(profile, { force: true, recursive: true })
  }
})

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
