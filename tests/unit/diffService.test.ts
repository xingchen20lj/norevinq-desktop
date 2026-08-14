import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DiffService } from '../../src/main/git/diffService.js'
import { GitService } from '../../src/main/git/gitService.js'
import { StateDatabase } from '../../src/main/state/database.js'

const temporaryPaths: string[] = []
afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, {
    force: true, recursive: true, maxRetries: 5, retryDelay: 100,
  })
})

describe('DiffService', () => {
  it('returns bounded working and staged patches including untracked text and binary markers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'norevinq-diff-'))
    temporaryPaths.push(root)
    const projectPath = mkdtempSync(join(root, 'project-'))
    runGit(projectPath, ['init', '-b', 'main'])
    runGit(projectPath, ['config', 'core.autocrlf', 'false'])
    runGit(projectPath, ['config', 'user.name', 'Norevinq Test'])
    runGit(projectPath, ['config', 'user.email', 'norevinq@example.invalid'])
    writeFileSync(join(projectPath, 'tracked.txt'), 'before\n')
    runGit(projectPath, ['add', 'tracked.txt'])
    runGit(projectPath, ['commit', '-m', 'baseline'])
    writeFileSync(join(projectPath, 'tracked.txt'), 'after\nplus\n')
    writeFileSync(join(projectPath, 'new file.txt'), 'hello\n')
    writeFileSync(join(projectPath, 'binary.bin'), Buffer.from([0, 1, 2]))
    const database = new StateDatabase(join(root, 'state.sqlite3'))
    const project = database.upsertProject(projectPath)
    const git = new GitService(database)
    const diffs = new DiffService(database, git)

    const working = await diffs.getDiff(project.id, 'working')
    expect(working.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'tracked.txt', additions: 2, deletions: 1, binary: false }),
      expect.objectContaining({ path: 'new file.txt', additions: 1, binary: false }),
      expect.objectContaining({ path: 'binary.bin', binary: true, patch: '', hunks: [] }),
    ]))
    expect(working.files.find(({ path }) => path === 'tracked.txt')?.hunks.length).toBeGreaterThan(0)
    expect(working.files.find(({ path }) => path === 'new file.txt')?.hunks.length).toBeGreaterThan(0)
    expect(working.id).toMatch(/^[0-9a-f-]{36}$/)
    await git.stage({ projectId: project.id, paths: ['tracked.txt', 'new file.txt'] })
    const staged = await diffs.getDiff(project.id, 'staged')
    expect(staged.files.map(({ path }) => path).sort()).toEqual(['new file.txt', 'tracked.txt'])
    expect(staged.totalAdditions).toBeGreaterThanOrEqual(3)
    database.close()
  }, 30_000)

  it('stages, unstages, and explicitly reverts only server-cached hunks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'norevinq-diff-actions-'))
    temporaryPaths.push(root)
    const projectPath = mkdtempSync(join(root, 'project-'))
    runGit(projectPath, ['init', '-b', 'main'])
    runGit(projectPath, ['config', 'core.autocrlf', 'false'])
    runGit(projectPath, ['config', 'user.name', 'Norevinq Test'])
    runGit(projectPath, ['config', 'user.email', 'norevinq@example.invalid'])
    const baseline = Array.from({ length: 24 }, (_, index) => `line-${String(index + 1)}`)
    writeFileSync(join(projectPath, 'tracked.txt'), `${baseline.join('\n')}\n`)
    runGit(projectPath, ['add', 'tracked.txt'])
    runGit(projectPath, ['commit', '-m', 'baseline'])
    const changed = [...baseline]
    changed[1] = 'line-2 changed'
    changed[21] = 'line-22 changed'
    writeFileSync(join(projectPath, 'tracked.txt'), `${changed.join('\n')}\n`)
    const database = new StateDatabase(join(root, 'state.sqlite3'))
    const project = database.upsertProject(projectPath)
    const git = new GitService(database)
    const diffs = new DiffService(database, git)

    const working = await diffs.getDiff(project.id, 'working')
    const tracked = working.files.find(({ path }) => path === 'tracked.txt')
    expect(tracked?.hunks).toHaveLength(2)
    const firstHunk = tracked?.hunks[0]
    expect(firstHunk?.lines.some(({ kind, newLine }) => kind === 'addition' && newLine === 2)).toBe(true)
    if (!firstHunk) throw new Error('Missing first hunk')
    await diffs.applyHunk({ projectId: project.id, snapshotId: working.id, hunkId: firstHunk.id, action: 'stage' })
    expect(runGit(projectPath, ['diff', '--cached', '--', 'tracked.txt'])).toContain('line-2 changed')
    expect(runGit(projectPath, ['diff', '--cached', '--', 'tracked.txt'])).not.toContain('line-22 changed')

    await expect(diffs.applyHunk({
      projectId: project.id,
      snapshotId: working.id,
      hunkId: firstHunk.id,
      action: 'stage',
    })).rejects.toThrow(/expired/i)

    const staged = await diffs.getDiff(project.id, 'staged')
    const stagedHunk = staged.files[0]?.hunks[0]
    if (!stagedHunk) throw new Error('Missing staged hunk')
    await diffs.applyHunk({ projectId: project.id, snapshotId: staged.id, hunkId: stagedHunk.id, action: 'unstage' })
    expect(runGit(projectPath, ['diff', '--cached'])).toBe('')

    const refreshed = await diffs.getDiff(project.id, 'working')
    const secondHunk = refreshed.files[0]?.hunks.find((hunk) => hunk.lines.some(({ newLine }) => newLine === 22))
    if (!secondHunk) throw new Error('Missing second hunk')
    await diffs.applyHunk({ projectId: project.id, snapshotId: refreshed.id, hunkId: secondHunk.id, action: 'revert' })
    const reverted = readFileSync(join(projectPath, 'tracked.txt'), 'utf8').replace(/\r\n?/gu, '\n')
    expect(reverted).toContain('line-2 changed')
    expect(reverted).toContain('line-22\n')
    database.close()
  }, 30_000)

  it('stages an untracked file with spaces and refuses destructive untracked revert', async () => {
    const root = mkdtempSync(join(tmpdir(), 'norevinq-diff-untracked-'))
    temporaryPaths.push(root)
    const projectPath = mkdtempSync(join(root, 'project-'))
    runGit(projectPath, ['init', '-b', 'main'])
    runGit(projectPath, ['config', 'core.autocrlf', 'false'])
    writeFileSync(join(projectPath, 'new file.txt'), 'safe')
    symlinkSync(join(root, 'outside.txt'), join(projectPath, 'external-link'))
    const database = new StateDatabase(join(root, 'state.sqlite3'))
    const project = database.upsertProject(projectPath)
    const git = new GitService(database)
    const diffs = new DiffService(database, git)

    const first = await diffs.getDiff(project.id, 'working')
    const link = first.files.find(({ path }) => path === 'external-link')
    expect(link).toMatchObject({ binary: true, patch: '', hunks: [] })
    const file = first.files.find(({ path }) => path === 'new file.txt')
    const hunk = file?.hunks[0]
    if (!hunk) throw new Error('Missing untracked hunk')
    await expect(diffs.applyHunk({ projectId: project.id, snapshotId: first.id, hunkId: hunk.id, action: 'revert' }))
      .rejects.toThrow(/recoverable/i)
    const refreshed = await diffs.getDiff(project.id, 'working')
    const refreshedFile = refreshed.files.find(({ path }) => path === 'new file.txt')
    const refreshedHunk = refreshedFile?.hunks[0]
    if (!refreshedHunk) throw new Error('Missing refreshed untracked hunk')
    await diffs.applyHunk({ projectId: project.id, snapshotId: refreshed.id, hunkId: refreshedHunk.id, action: 'stage' })
    expect(runGit(projectPath, ['show', ':new file.txt'])).toBe('safe')
    database.close()
  }, 30_000)
})

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })
}
