import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DiffService } from '../../src/main/git/diffService.js'
import { GitService } from '../../src/main/git/gitService.js'
import { StateDatabase } from '../../src/main/state/database.js'

const temporaryPaths: string[] = []
afterEach(() => { for (const path of temporaryPaths.splice(0)) rmSync(path, { force: true, recursive: true }) })

describe('DiffService', () => {
  it('returns bounded working and staged patches including untracked text and binary markers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aster-diff-'))
    temporaryPaths.push(root)
    const projectPath = mkdtempSync(join(root, 'project-'))
    runGit(projectPath, ['init', '-b', 'main'])
    runGit(projectPath, ['config', 'user.name', 'Aster Test'])
    runGit(projectPath, ['config', 'user.email', 'aster@example.invalid'])
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
      expect.objectContaining({ path: 'binary.bin', binary: true, patch: '' }),
    ]))
    await git.stage({ projectId: project.id, paths: ['tracked.txt', 'new file.txt'] })
    const staged = await diffs.getDiff(project.id, 'staged')
    expect(staged.files.map(({ path }) => path).sort()).toEqual(['new file.txt', 'tracked.txt'])
    expect(staged.totalAdditions).toBeGreaterThanOrEqual(3)
    database.close()
  }, 30_000)
})

function runGit(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, env: { ...process.env, LC_ALL: 'C' } })
}
