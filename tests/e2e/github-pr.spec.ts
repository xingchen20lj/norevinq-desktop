import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { StateDatabase } from '../../src/main/state/database.js'

test.skip(process.platform === 'win32', 'The deterministic fixture wrappers use POSIX launchers; service coverage is cross-platform.')

test('preflights GitHub, pushes a real branch, creates one verified Draft PR, and remains idempotent', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'aster-github-pr-e2e-'))
  const projectPath = join(profile, 'project')
  const remotePath = join(profile, 'remote.git')
  const codexHome = join(profile, 'agent-home')
  const ghConfig = join(profile, 'gh-config')
  const binPath = join(profile, 'bin')
  const codexWrapper = join(binPath, 'codex')
  const ghWrapper = join(binPath, 'gh')
  const gitWrapper = join(binPath, 'git')
  const ghState = join(ghConfig, 'fake-gh-state.json')
  mkdirSync(projectPath)
  mkdirSync(codexHome)
  mkdirSync(ghConfig)
  mkdirSync(binPath)
  execFileSync('git', ['init', '--bare', remotePath])
  runGit(projectPath, ['init', '-b', 'main'])
  runGit(projectPath, ['config', 'user.name', 'Aster Test'])
  runGit(projectPath, ['config', 'user.email', 'aster@example.invalid'])
  writeFileSync(join(projectPath, 'README.md'), '# GitHub PR fixture\n')
  runGit(projectPath, ['add', 'README.md'])
  runGit(projectPath, ['commit', '-m', 'test: baseline'])
  runGit(projectPath, ['push', remotePath, 'main'])
  runGit(projectPath, ['checkout', '-b', 'feature/github-pr'])
  writeFileSync(join(projectPath, 'feature.txt'), 'ASTER_GITHUB_PR_OK\n')
  runGit(projectPath, ['add', 'feature.txt'])
  runGit(projectPath, ['commit', '-m', 'feat: GitHub PR proof'])
  runGit(projectPath, ['remote', 'add', 'origin', 'https://github.com/aster-fixture/project.git'])

  const database = new StateDatabase(join(profile, 'aster-code.sqlite3'))
  const project = database.upsertProject(projectPath)
  database.close()
  writeWrapper(codexWrapper, resolve('tests/helpers/fakeCodexLifecycle.mjs'))
  writeWrapper(ghWrapper, resolve('tests/helpers/fakeGh.mjs'))
  writeGitWrapper(gitWrapper, remotePath)

  const application = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      ASTER_UNRELATED_SECRET: 'must-not-reach-gh',
      CODEX_BINARY: codexWrapper,
      ASTER_AGENT_HOME: codexHome,
      GH_CONFIG_DIR: ghConfig,
      PATH: `${binPath}${delimiter}${process.env.PATH ?? ''}`,
    },
  })
  try {
    const window = await application.firstWindow()
    await expect(window.locator('.runtime-pill')).toContainText('Aster 已就绪', { timeout: 20_000 })
    await window.getByRole('button', { name: 'Git 状态' }).click()
    const panel = window.getByLabel('Git 工作区')
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: '检查 GitHub' }).click()
    const pullRequest = panel.getByRole('region', { name: 'GitHub Pull Request' })
    await expect(pullRequest).toContainText('gh 2.97.0')
    await expect(pullRequest).toContainText('已登录 github.com')
    await expect(pullRequest.getByLabel('PR 推送远端')).toHaveValue('origin')
    await expect(pullRequest.getByLabel('PR 目标远端')).toHaveValue('origin')
    await pullRequest.getByLabel('Pull Request 标题').fill('feat: desktop GitHub PR')
    await pullRequest.getByLabel('Pull Request 说明').fill('## 验证\n\n- real local Git push\n- bounded fake GitHub API')
    await expect(pullRequest.getByLabel('Pull Request 目标分支')).toHaveValue('main')
    await window.setViewportSize({ width: 960, height: 640 })
    const createButton = pullRequest.getByRole('button', { name: '推送并创建 Draft PR' })
    await expect(createButton).toBeVisible()
    await createButton.scrollIntoViewIfNeeded()
    await window.screenshot({ path: 'test-results/aster-github-pr-form-compact.png' })
    window.once('dialog', async (dialog) => { await dialog.accept() })
    await createButton.click()
    await expect(pullRequest).toContainText('已创建 PR #42')
    await expect(pullRequest).toContainText('#42 · feat: desktop GitHub PR')
    await expect(pullRequest).toContainText('feature/github-pr → main')
    await window.screenshot({ path: 'test-results/aster-github-pr.png' })

    const repeated = await window.evaluate(async ({ projectId }) => {
      const bridge = Reflect.get(window, 'aster') as {
        createGitHubPullRequest: (input: Record<string, unknown>) => Promise<{ created: boolean; pushed: boolean; pullRequest: { number: number } }>
      }
      return bridge.createGitHubPullRequest({
        projectId,
        title: 'must not duplicate',
        body: '',
        baseBranch: 'main',
        draft: false,
        confirmed: true,
        pushRemote: 'origin',
        baseRemote: 'origin',
      })
    }, { projectId: project.id })
    expect(repeated).toEqual(expect.objectContaining({ created: false, pushed: false, pullRequest: expect.objectContaining({ number: 42 }) }))

    const state = JSON.parse(readFileSync(ghState, 'utf8')) as Record<string, unknown>
    expect(state).toMatchObject({
      title: 'feat: desktop GitHub PR',
      body: '## 验证\n\n- real local Git push\n- bounded fake GitHub API',
      base: 'main',
      head: 'aster-fixture:feature/github-pr',
      draft: true,
      unrelatedSecretPresent: false,
      deepSeekKeyPresent: false,
      openAiKeyPresent: false,
    })
    expect(runGit(remotePath, ['show-ref', '--verify', 'refs/heads/feature/github-pr'])).toContain('refs/heads/feature/github-pr')
  } finally {
    await application.close()
    rmSync(profile, { force: true, recursive: true })
  }
})

function writeWrapper(path: string, helper: string): void {
  writeFileSync(path, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(helper)} "$@"\n`)
  chmodSync(path, 0o755)
}

function writeGitWrapper(path: string, remotePath: string): void {
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
  writeFileSync(path, [
    '#!/bin/sh',
    'if [ "$1" = "push" ]; then',
    `  exec ${shellQuote(realGit)} -c ${shellQuote(`url.${remotePath}/.insteadOf=https://github.com/aster-fixture/project.git`)} "$@"`,
    'fi',
    `exec ${shellQuote(realGit)} "$@"`,
    '',
  ].join('\n'))
  chmodSync(path, 0o755)
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
