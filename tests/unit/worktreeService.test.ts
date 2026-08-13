import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StateDatabase } from '../../src/main/state/database.js'
import { WorktreeService } from '../../src/main/worktree/worktreeService.js'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, {
    force: true, recursive: true, maxRetries: 5, retryDelay: 100,
  })
})

describe('WorktreeService', () => {
  it('treats a plain project folder as Local-only instead of surfacing a Git fatal error', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aster-worktree-plain-'))
    temporaryPaths.push(root)
    const projectPath = mkdtempSync(join(root, 'project-'))
    const database = new StateDatabase(join(root, 'state.sqlite3'))
    const project = database.upsertProject(projectPath)
    try {
      const service = new WorktreeService(database, join(root, 'managed'))
      await expect(service.list(project.id)).resolves.toEqual([])
      await expect(service.listBases(project.id)).resolves.toEqual({
        projectId: project.id,
        repositoryInitialized: false,
        bases: [],
        truncated: false,
      })
      await expect(service.create({ projectId: project.id })).rejects.toThrow('Initialize Git')
    } finally {
      database.close()
    }
  })

  it('lists typed bases and creates from the selected immutable commit', async () => {
    const setup = createRepository()
    try {
      const baselineOid = runGit(setup.projectPath, ['rev-parse', 'HEAD']).trim()
      runGit(setup.projectPath, ['branch', 'release/old', baselineOid])
      runGit(setup.projectPath, ['tag', 'v0.1-base', baselineOid])
      writeFileSync(join(setup.projectPath, 'README.md'), '# current\n')
      runGit(setup.projectPath, ['add', 'README.md'])
      runGit(setup.projectPath, ['commit', '-m', 'test: current head'])
      const currentOid = runGit(setup.projectPath, ['rev-parse', 'HEAD']).trim()
      const service = new WorktreeService(setup.database, setup.managedRoot)

      const catalog = await service.listBases(setup.projectId)
      expect(catalog.repositoryInitialized).toBe(true)
      expect(catalog.bases).toEqual(expect.arrayContaining([
        expect.objectContaining({ ref: 'HEAD', kind: 'current', oid: currentOid }),
        expect.objectContaining({ ref: 'refs/heads/release/old', kind: 'localBranch', oid: baselineOid }),
        expect.objectContaining({ ref: 'refs/tags/v0.1-base', kind: 'tag', oid: baselineOid }),
      ]))

      const created = await service.create({
        projectId: setup.projectId,
        baseRef: 'refs/heads/release/old',
        expectedBaseOid: baselineOid,
      })
      expect(created).toMatchObject({ baseRef: 'refs/heads/release/old', baseOid: baselineOid, headOid: baselineOid })
      expect(readFileSync(join(created.path, 'README.md'), 'utf8').replace(/\r\n?/gu, '\n')).toBe('# worktree\n')
      await service.remove({ worktreeId: created.id })

      runGit(setup.projectPath, ['branch', '-f', 'release/old', currentOid])
      await expect(service.create({
        projectId: setup.projectId,
        baseRef: 'refs/heads/release/old',
        expectedBaseOid: baselineOid,
      })).rejects.toThrow('base moved')
    } finally {
      setup.database.close()
    }
  }, 30_000)

  it('creates, persists, locks, unlocks, and removes a detached managed worktree', async () => {
    const setup = createRepository()
    try {
      const service = new WorktreeService(setup.database, setup.managedRoot)

      const created = await service.create({ projectId: setup.projectId })
      expect(created).toMatchObject({ projectId: setup.projectId, baseRef: 'HEAD', branch: null, locked: false, missing: false })
      expect(created.baseOid).toMatch(/^[0-9a-f]{40}$/u)
      expect(created.path.startsWith(join(realpathSync(setup.managedRoot), setup.projectId))).toBe(true)
      expect(readFileSync(join(created.path, 'README.md'), 'utf8').replace(/\r\n?/gu, '\n')).toBe('# worktree\n')
      expect(runGit(created.path, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('HEAD')

      expect((await service.lock({ worktreeId: created.id }))[0]?.locked).toBe(true)
      expect((await service.unlock({ worktreeId: created.id }))[0]?.locked).toBe(false)
      const reloaded = new WorktreeService(setup.database, setup.managedRoot)
      expect((await reloaded.list(setup.projectId))[0]?.id).toBe(created.id)
      expect(await service.remove({ worktreeId: created.id })).toEqual([])
      expect(existsSync(created.path)).toBe(false)
    } finally {
      setup.database.close()
    }
  }, 30_000)

  it('creates an explicit branch and copies only ignored .worktreeinclude matches', async () => {
    const setup = createRepository()
    try {
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
    } finally {
      setup.database.close()
    }
  }, 30_000)

  it('moves staged, unstaged, and untracked changes between Local and a managed worktree', async () => {
    const setup = createRepository()
    try {
      const service = new WorktreeService(setup.database, setup.managedRoot)
      const target = await service.create({ projectId: setup.projectId })
      writeFileSync(join(setup.projectPath, 'README.md'), '# staged\n')
      runGit(setup.projectPath, ['add', 'README.md'])
      writeFileSync(join(setup.projectPath, 'README.md'), '# staged\nunstaged\n')
      writeFileSync(join(setup.projectPath, 'new file.txt'), 'untracked\n')

      await expect(service.moveChanges({
        projectId: setup.projectId,
        sourceWorktreeId: null,
        targetWorktreeId: target.id,
      })).resolves.toEqual({ moved: true, recoveryStash: null })
      expect(runGit(setup.projectPath, ['status', '--porcelain'])).toBe('')
      expect(readFileSync(join(target.path, 'README.md'), 'utf8').replace(/\r\n?/gu, '\n')).toBe('# staged\nunstaged\n')
      expect(readFileSync(join(target.path, 'new file.txt'), 'utf8')).toBe('untracked\n')
      expect(runGit(target.path, ['status', '--porcelain'])).toContain('MM README.md')

      await service.moveChanges({
        projectId: setup.projectId,
        sourceWorktreeId: target.id,
        targetWorktreeId: null,
      })
      expect(runGit(target.path, ['status', '--porcelain'])).toBe('')
      expect(readFileSync(join(setup.projectPath, 'new file.txt'), 'utf8')).toBe('untracked\n')
      await service.remove({ worktreeId: target.id })
    } finally {
      setup.database.close()
    }
  }, 30_000)

  it('restores the source and target when a handoff patch conflicts', async () => {
    const setup = createRepository()
    try {
      const service = new WorktreeService(setup.database, setup.managedRoot)
      const target = await service.create({ projectId: setup.projectId })
      writeFileSync(join(target.path, 'README.md'), '# target commit\n')
      runGit(target.path, ['add', 'README.md'])
      runGit(target.path, ['commit', '-m', 'target divergence'])
      writeFileSync(join(setup.projectPath, 'README.md'), '# source changes\n')

      await expect(service.moveChanges({
        projectId: setup.projectId,
        sourceWorktreeId: null,
        targetWorktreeId: target.id,
      })).rejects.toThrow('source was restored')
      expect(readFileSync(join(setup.projectPath, 'README.md'), 'utf8').replace(/\r\n?/gu, '\n')).toBe('# source changes\n')
      expect(readFileSync(join(target.path, 'README.md'), 'utf8').replace(/\r\n?/gu, '\n')).toBe('# target commit\n')
      expect(runGit(target.path, ['status', '--porcelain'])).toBe('')
      await service.remove({ worktreeId: target.id })
    } finally {
      setup.database.close()
    }
  }, 30_000)

  it('refuses to remove a worktree still associated with a conversation', async () => {
    const setup = createRepository()
    try {
      const service = new WorktreeService(setup.database, setup.managedRoot)
      const target = await service.create({ projectId: setup.projectId })
      setup.database.associateThread(setup.projectId, 'thread-1', false, target.id)

      await expect(service.remove({ worktreeId: target.id })).rejects.toThrow('Hand off 1 conversation')
      expect(existsSync(target.path)).toBe(true)

      setup.database.setThreadWorktree(setup.projectId, 'thread-1', null)
      await expect(service.remove({ worktreeId: target.id })).resolves.toEqual([])
    } finally {
      setup.database.close()
    }
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
  runGit(projectPath, ['config', 'core.autocrlf', 'false'])
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
