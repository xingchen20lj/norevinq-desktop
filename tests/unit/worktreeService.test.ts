import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StateDatabase } from '../../src/main/state/database.js'
import { WorktreeService } from '../../src/main/worktree/worktreeService.js'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('WorktreeService', () => {
  it('creates, persists, locks, unlocks, and removes a detached managed worktree', async () => {
    const setup = createRepository()
    const service = new WorktreeService(setup.database, setup.managedRoot)

    const created = await service.create({ projectId: setup.projectId })
    expect(created).toMatchObject({ projectId: setup.projectId, branch: null, locked: false, missing: false })
    expect(created.path.startsWith(join(realpathSync(setup.managedRoot), setup.projectId))).toBe(true)
    expect(readFileSync(join(created.path, 'README.md'), 'utf8')).toBe('# worktree\n')
    expect(runGit(created.path, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('HEAD')

    expect((await service.lock({ worktreeId: created.id }))[0]?.locked).toBe(true)
    expect((await service.unlock({ worktreeId: created.id }))[0]?.locked).toBe(false)
    const reloaded = new WorktreeService(setup.database, setup.managedRoot)
    expect((await reloaded.list(setup.projectId))[0]?.id).toBe(created.id)
    expect(await service.remove({ worktreeId: created.id })).toEqual([])
    expect(existsSync(created.path)).toBe(false)
    setup.database.close()
  }, 30_000)

  it('creates an explicit branch and copies only ignored .worktreeinclude matches', async () => {
    const setup = createRepository()
    mkdirSync(join(setup.projectPath, 'config'))
    writeFileSync(join(setup.projectPath, '.gitignore'), 'config/\n*.secret\n')
    writeFileSync(join(setup.projectPath, '.worktreeinclude'), 'config/*.txt\n!config/skip.txt\n')
    writeFileSync(join(setup.projectPath, 'config', 'local.txt'), 'copied\n')
    writeFileSync(join(setup.projectPath, 'config', 'skip.txt'), 'skip\n')
    writeFileSync(join(setup.projectPath, 'private.secret'), 'not copied\n')
    const service = new WorktreeService(setup.database, setup.managedRoot)

    const created = await service.create({ projectId: setup.projectId, branch: 'codex/worktree-test' })
    expect(created.branch).toBe('codex/worktree-test')
    expect(created.copiedIncludeFiles).toBe(1)
    expect(readFileSync(join(created.path, 'config', 'local.txt'), 'utf8')).toBe('copied\n')
    expect(existsSync(join(created.path, 'config', 'skip.txt'))).toBe(false)
    expect(existsSync(join(created.path, 'private.secret'))).toBe(false)
    await expect(service.create({ projectId: setup.projectId, branch: 'codex/worktree-test' })).rejects.toThrow()
    await service.remove({ worktreeId: created.id, force: true })
    setup.database.close()
  }, 30_000)
})

function createRepository(): {
  database: StateDatabase
  projectId: string
  projectPath: string
  managedRoot: string
} {
  const root = mkdtempSync(join(tmpdir(), 'aster-worktree-'))
  temporaryPaths.push(root)
  const projectPath = mkdtempSync(join(root, 'project-'))
  const managedRoot = join(root, 'managed')
  runGit(projectPath, ['init', '-b', 'main'])
  runGit(projectPath, ['config', 'user.name', 'Aster Test'])
  runGit(projectPath, ['config', 'user.email', 'aster@example.invalid'])
  writeFileSync(join(projectPath, 'README.md'), '# worktree\n')
  runGit(projectPath, ['add', 'README.md'])
  runGit(projectPath, ['commit', '-m', 'test: baseline'])
  const database = new StateDatabase(join(root, 'state.sqlite3'))
  return { database, projectId: database.upsertProject(projectPath).id, projectPath, managedRoot }
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })
}
