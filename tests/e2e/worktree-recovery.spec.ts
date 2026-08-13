import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { StateDatabase } from '../../src/main/state/database.js'
import { WorktreeService } from '../../src/main/worktree/worktreeService.js'

test.skip(process.platform === 'win32', 'The deterministic Codex fixture wrapper uses a POSIX launcher; recovery logic has cross-platform unit coverage.')

test('shows a durable handoff recovery without deleting post-crash user changes', async () => {
  test.setTimeout(45_000)
  const profile = mkdtempSync(join(tmpdir(), 'aster-worktree-recovery-e2e-'))
  const projectPath = join(profile, 'project')
  const codexHome = join(profile, 'codex-home')
  const wrapper = join(profile, 'fake-codex')
  mkdirSync(projectPath)
  mkdirSync(codexHome)
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectPath })
  execFileSync('git', ['config', 'user.name', 'Aster Recovery'], { cwd: projectPath })
  execFileSync('git', ['config', 'user.email', 'aster-recovery@example.invalid'], { cwd: projectPath })
  writeFileSync(join(projectPath, 'README.md'), '# recovery\n')
  execFileSync('git', ['add', 'README.md'], { cwd: projectPath })
  execFileSync('git', ['commit', '-m', 'test: recovery baseline'], { cwd: projectPath })

  const database = new StateDatabase(join(profile, 'aster-code.sqlite3'))
  const project = database.upsertProject(projectPath)
  database.associateThread(project.id, '11111111-1111-7111-8111-111111111111')
  const service = new WorktreeService(database, join(profile, 'worktrees'), {
    afterHandoffStep: (step) => { if (step === 'targetRecorded') throw new Error('simulated crash') },
  })
  const target = await service.create({ projectId: project.id })
  writeFileSync(join(projectPath, 'README.md'), '# interrupted handoff\n')
  await expect(service.moveChanges({
    projectId: project.id,
    threadId: '11111111-1111-7111-8111-111111111111',
    sourceWorktreeId: null,
    targetWorktreeId: target.id,
  })).rejects.toThrow('simulated crash')
  const operation = database.listWorktreeHandoffs(project.id)[0]
  if (!operation) throw new Error('Expected interrupted handoff metadata.')
  writeFileSync(join(target.path, 'after-crash.txt'), 'preserve this edit\n')
  database.close()

  const helper = resolve('tests/helpers/fakeCodexLifecycle.mjs')
  writeFileSync(wrapper, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(helper)} "$@"\n`)
  chmodSync(wrapper, 0o755)
  const application = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, ASTER_CODEX_HOME: codexHome, CODEX_BINARY: wrapper },
  })
  try {
    const window = await application.firstWindow()
    await expect(window.locator('.runtime-pill')).toContainText('Codex 已就绪', { timeout: 20_000 })
    await window.getByRole('button', { name: 'Local', exact: true }).click()
    const panel = window.getByRole('complementary', { name: '工作树' })
    const recovery = panel.getByRole('status').filter({ hasText: '工作树交接需要恢复' })
    await expect(recovery).toContainText('Local → Detached')
    await expect(recovery).toContainText('需要安全检查')
    await expect(recovery).toContainText('after the interruption')
    await window.screenshot({ path: 'test-results/aster-worktree-recovery.png' })
    await recovery.getByRole('button', { name: '安全重试' }).click()
    await expect(window.getByRole('alert')).toContainText('after the interruption')
    expect(execFileSync('git', ['show-ref', operation.recoveryRef], { cwd: projectPath, encoding: 'utf8' })).toContain(operation.stashOid)
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: target.path, encoding: 'utf8' })).toContain('after-crash.txt')
  } finally {
    await application.close()
    rmSync(profile, { force: true, recursive: true })
  }
})

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
