import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StateDatabase } from '../../src/main/state/database.js'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('StateDatabase', () => {
  it('persists and deduplicates recent projects', () => {
    const root = mkdtempSync(join(tmpdir(), 'aster-db-test-'))
    temporaryPaths.push(root)
    const projectPath = mkdtempSync(join(root, 'project-'))
    const databasePath = join(root, 'state.sqlite3')

    const database = new StateDatabase(databasePath)
    const first = database.upsertProject(projectPath)
    const second = database.upsertProject(projectPath)

    expect(second.id).toBe(first.id)
    expect(database.listProjects()).toHaveLength(1)
    database.close()

    const reopened = new StateDatabase(databasePath)
    expect(reopened.listProjects()[0]?.path).toBe(realpathSync(projectPath))
    reopened.removeProject(first.id)
    expect(reopened.listProjects()).toEqual([])
    reopened.close()
  })
})
