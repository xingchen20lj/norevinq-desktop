import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitService } from '../../src/main/git/gitService.js'
import { StateDatabase } from '../../src/main/state/database.js'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) {
    rmSync(path, { force: true, maxRetries: process.platform === 'win32' ? 5 : 0, recursive: true, retryDelay: 100 })
  }
})

describe('GitService', () => {
  it('runs init, status, stage, unstage, commit, remote and push in a real isolated repository', async () => {
    const root = mkdtempSync(join(tmpdir(), 'norevinq-git-'))
    temporaryPaths.push(root)
    const projectPath = mkdtempSync(join(root, 'project-'))
    const remotePath = join(root, 'remote.git')
    execFileSync('git', ['init', '--bare', remotePath])
    const database = new StateDatabase(join(root, 'state.sqlite3'))
    const project = database.upsertProject(projectPath)
    const service = new GitService(database)

    expect((await service.getStatus({ projectId: project.id })).initialized).toBe(false)
    await service.initialize({ projectId: project.id })
    configureTestRepository(projectPath)
    writeFileSync(join(projectPath, 'file with spaces.txt'), 'one\n')

    const untracked = await service.getStatus({ projectId: project.id })
    expect(untracked.files).toContainEqual(expect.objectContaining({ path: 'file with spaces.txt', kind: 'untracked' }))
    const staged = await service.stage({ projectId: project.id, paths: ['file with spaces.txt'] })
    expect(staged.files).toContainEqual(expect.objectContaining({ path: 'file with spaces.txt', indexStatus: 'A' }))
    const committed = await service.commit({ projectId: project.id, message: 'test: initial' })
    expect(committed.files).toEqual([])
    expect(committed.branch).toBe('main')

    writeFileSync(join(projectPath, 'file with spaces.txt'), 'two\n')
    await service.stage({ projectId: project.id, paths: ['file with spaces.txt'] })
    const unstaged = await service.unstage({ projectId: project.id, paths: ['file with spaces.txt'] })
    expect(unstaged.files).toContainEqual(expect.objectContaining({ indexStatus: '.', worktreeStatus: 'M' }))
    await service.stage({ projectId: project.id, paths: ['file with spaces.txt'] })
    await service.commit({ projectId: project.id, message: 'test: update' })
    runGit(projectPath, ['remote', 'add', 'origin', remotePath])
    const pushed = await service.push({ projectId: project.id, remote: 'origin', branch: 'main', setUpstream: true })
    expect(pushed.upstream).toBe('origin/main')
    expect(pushed.remotes).toContainEqual({ name: 'origin', fetchUrl: remotePath, pushUrl: remotePath })

    database.close()
  }, 30_000)

  it('rejects absolute, escaping, and option-like paths before running Git', async () => {
    const root = mkdtempSync(join(tmpdir(), 'norevinq-git-'))
    temporaryPaths.push(root)
    const projectPath = mkdtempSync(join(root, 'project-'))
    const database = new StateDatabase(join(root, 'state.sqlite3'))
    const project = database.upsertProject(projectPath)
    const service = new GitService(database)
    await service.initialize({ projectId: project.id })
    configureTestRepository(projectPath)

    await expect(service.stage({ projectId: project.id, paths: ['/etc/passwd'] })).rejects.toThrow('project-relative')
    await expect(service.stage({ projectId: project.id, paths: ['../escape'] })).rejects.toThrow('escapes')
    database.close()
  })

  it('removes embedded credentials and query data from remote URLs before returning renderer state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'norevinq-git-'))
    temporaryPaths.push(root)
    const projectPath = mkdtempSync(join(root, 'project-'))
    const database = new StateDatabase(join(root, 'state.sqlite3'))
    const project = database.upsertProject(projectPath)
    const service = new GitService(database)
    await service.initialize({ projectId: project.id })
    configureTestRepository(projectPath)
    runGit(projectPath, ['remote', 'add', 'origin', 'https://user:ghp_secret_value@github.com/owner/repository.git?token=also-secret#fragment'])

    const status = await service.getStatus({ projectId: project.id })
    expect(status.remotes).toEqual([{
      name: 'origin',
      fetchUrl: 'https://github.com/owner/repository.git',
      pushUrl: 'https://github.com/owner/repository.git',
    }])
    expect(JSON.stringify(status)).not.toContain('secret')
    database.close()
  })

  it('discards and restores a whole file without losing staged or unstaged content', async () => {
    const root = mkdtempSync(join(tmpdir(), 'norevinq-git-discard-'))
    temporaryPaths.push(root)
    const projectPath = mkdtempSync(join(root, 'project-'))
    const database = new StateDatabase(join(root, 'state.sqlite3'))
    const project = database.upsertProject(projectPath)
    const service = new GitService(database)
    await service.initialize({ projectId: project.id })
    configureTestRepository(projectPath)
    writeFileSync(join(projectPath, 'proof.txt'), 'baseline\n')
    runGit(projectPath, ['add', 'proof.txt'])
    runGit(projectPath, ['commit', '-m', 'test: baseline'])

    writeFileSync(join(projectPath, 'proof.txt'), 'staged\n')
    await service.stage({ projectId: project.id, paths: ['proof.txt'] })
    writeFileSync(join(projectPath, 'proof.txt'), 'staged\nunstaged\n')
    const discarded = await service.discardFile({ projectId: project.id, path: 'proof.txt' })

    expect(discarded.files).toEqual([])
    expect(readFileSync(join(projectPath, 'proof.txt'), 'utf8')).toBe('baseline\n')
    expect(discarded.discards).toHaveLength(1)
    expect(discarded.discards[0]).toMatchObject({ path: 'proof.txt' })
    expect(runGitOutput(projectPath, ['stash', 'list'])).toBe('')

    const discardId = discarded.discards[0]?.id
    if (!discardId) throw new Error('Expected a recoverable discard id.')
    const restored = await service.restoreDiscard({ projectId: project.id, discardId })
    expect(readFileSync(join(projectPath, 'proof.txt'), 'utf8')).toBe('staged\nunstaged\n')
    expect(runGitOutput(projectPath, ['show', ':proof.txt'])).toBe('staged\n')
    expect(restored.files).toContainEqual(expect.objectContaining({ path: 'proof.txt', indexStatus: 'M', worktreeStatus: 'M' }))
    expect(restored.discards).toEqual([])
    database.close()
  }, 30_000)

  it('recovers untracked files and keeps the recovery point when a target is occupied', async () => {
    const root = mkdtempSync(join(tmpdir(), 'norevinq-git-discard-'))
    temporaryPaths.push(root)
    const projectPath = mkdtempSync(join(root, 'project-'))
    const database = new StateDatabase(join(root, 'state.sqlite3'))
    const project = database.upsertProject(projectPath)
    const service = new GitService(database)
    await service.initialize({ projectId: project.id })
    configureTestRepository(projectPath)
    writeFileSync(join(projectPath, 'README.md'), 'baseline\n')
    runGit(projectPath, ['add', 'README.md'])
    runGit(projectPath, ['commit', '-m', 'test: baseline'])
    writeFileSync(join(projectPath, 'untracked.txt'), 'recover me\n')

    const discarded = await service.discardFile({ projectId: project.id, path: 'untracked.txt' })
    const discardId = discarded.discards[0]?.id
    if (!discardId) throw new Error('Expected a recoverable discard id.')
    expect(existsSync(join(projectPath, 'untracked.txt'))).toBe(false)
    writeFileSync(join(projectPath, 'untracked.txt'), 'new occupant\n')

    await expect(service.restoreDiscard({ projectId: project.id, discardId })).rejects.toThrow(/new changes|occupied/u)
    expect(readFileSync(join(projectPath, 'untracked.txt'), 'utf8')).toBe('new occupant\n')
    expect((await service.getStatus({ projectId: project.id })).discards).toContainEqual(expect.objectContaining({ id: discardId }))
    rmSync(join(projectPath, 'untracked.txt'))
    const restored = await service.restoreDiscard({ projectId: project.id, discardId })
    expect(readFileSync(join(projectPath, 'untracked.txt'), 'utf8')).toBe('recover me\n')
    expect(restored.discards).toEqual([])
    database.close()
  }, 30_000)

  it('preserves an existing user stash while discarding and restoring a renamed file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'norevinq-git-discard-'))
    temporaryPaths.push(root)
    const projectPath = mkdtempSync(join(root, 'project-'))
    const database = new StateDatabase(join(root, 'state.sqlite3'))
    const project = database.upsertProject(projectPath)
    const service = new GitService(database)
    await service.initialize({ projectId: project.id })
    configureTestRepository(projectPath)
    writeFileSync(join(projectPath, 'old.txt'), 'baseline\n')
    writeFileSync(join(projectPath, 'unrelated.txt'), 'baseline\n')
    runGit(projectPath, ['add', '.'])
    runGit(projectPath, ['commit', '-m', 'test: baseline'])

    writeFileSync(join(projectPath, 'unrelated.txt'), 'user stash content\n')
    runGit(projectPath, ['stash', 'push', '--message', 'user-owned-stash', '--', 'unrelated.txt'])
    runGit(projectPath, ['mv', 'old.txt', 'new.txt'])
    writeFileSync(join(projectPath, 'new.txt'), 'renamed staged\nrenamed unstaged\n')

    const discarded = await service.discardFile({ projectId: project.id, path: 'new.txt' })
    expect(readFileSync(join(projectPath, 'old.txt'), 'utf8')).toBe('baseline\n')
    expect(existsSync(join(projectPath, 'new.txt'))).toBe(false)
    expect(runGitOutput(projectPath, ['stash', 'list'])).toContain('user-owned-stash')
    expect(runGitOutput(projectPath, ['stash', 'list'])).not.toContain('norevinq-discard-v1')

    const discardId = discarded.discards[0]?.id
    if (!discardId) throw new Error('Expected a recoverable discard id.')
    const restored = await service.restoreDiscard({ projectId: project.id, discardId })
    expect(existsSync(join(projectPath, 'old.txt'))).toBe(false)
    expect(readFileSync(join(projectPath, 'new.txt'), 'utf8')).toBe('renamed staged\nrenamed unstaged\n')
    expect(restored.files).toContainEqual(expect.objectContaining({ path: 'new.txt', originalPath: 'old.txt' }))
    expect(runGitOutput(projectPath, ['stash', 'list'])).toContain('user-owned-stash')
    database.close()
  }, 30_000)
})

function runGit(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, env: { ...process.env, LC_ALL: 'C' } })
}

function configureTestRepository(cwd: string): void {
  runGit(cwd, ['config', 'core.autocrlf', 'false'])
  runGit(cwd, ['config', 'user.name', 'Norevinq Test'])
  runGit(cwd, ['config', 'user.email', 'norevinq@example.invalid'])
}

function runGitOutput(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' })
}
