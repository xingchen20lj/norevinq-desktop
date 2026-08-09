import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitService } from '../../src/main/git/gitService.js'
import { StateDatabase } from '../../src/main/state/database.js'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('GitService', () => {
  it('runs init, status, stage, unstage, commit, remote and push in a real isolated repository', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aster-git-'))
    temporaryPaths.push(root)
    const projectPath = mkdtempSync(join(root, 'project-'))
    const remotePath = join(root, 'remote.git')
    execFileSync('git', ['init', '--bare', remotePath])
    const database = new StateDatabase(join(root, 'state.sqlite3'))
    const project = database.upsertProject(projectPath)
    const service = new GitService(database)

    expect((await service.getStatus({ projectId: project.id })).initialized).toBe(false)
    await service.initialize({ projectId: project.id })
    runGit(projectPath, ['config', 'user.name', 'Aster Test'])
    runGit(projectPath, ['config', 'user.email', 'aster@example.invalid'])
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
    const root = mkdtempSync(join(tmpdir(), 'aster-git-'))
    temporaryPaths.push(root)
    const projectPath = mkdtempSync(join(root, 'project-'))
    const database = new StateDatabase(join(root, 'state.sqlite3'))
    const project = database.upsertProject(projectPath)
    const service = new GitService(database)
    await service.initialize({ projectId: project.id })

    await expect(service.stage({ projectId: project.id, paths: ['/etc/passwd'] })).rejects.toThrow('project-relative')
    await expect(service.stage({ projectId: project.id, paths: ['../escape'] })).rejects.toThrow('escapes')
    database.close()
  })
})

function runGit(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, env: { ...process.env, LC_ALL: 'C' } })
}
