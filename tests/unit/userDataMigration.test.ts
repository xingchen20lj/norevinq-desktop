import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareNorevinqUserData } from '../../src/main/app/userDataMigration.js'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('Norevinq product data migration', () => {
  it('moves the legacy product directory and database into the new identity', () => {
    const parent = mkdtempSync(join(tmpdir(), 'norevinq-product-data-'))
    const legacy = join(parent, 'aster-code')
    const current = join(parent, 'norevinq')
    mkdirSync(legacy)
    writeFileSync(join(legacy, 'aster-code.sqlite3'), 'database')
    writeFileSync(join(legacy, 'history.json'), '{"preserved":true}\n')
    temporaryPaths.push(parent)

    expect(prepareNorevinqUserData(current)).toBe(current)
    expect(existsSync(legacy)).toBe(false)
    expect(existsSync(join(current, 'norevinq.sqlite3'))).toBe(true)
    expect(existsSync(join(current, 'history.json'))).toBe(true)
  })

  it('does not merge into populated data or follow a legacy symlink', () => {
    const parent = mkdtempSync(join(tmpdir(), 'norevinq-product-data-'))
    const external = mkdtempSync(join(tmpdir(), 'norevinq-product-external-'))
    const legacy = join(parent, 'aster-code')
    const current = join(parent, 'norevinq')
    symlinkSync(external, legacy, 'dir')
    mkdirSync(current)
    writeFileSync(join(current, 'current.json'), '{}')
    temporaryPaths.push(parent, external)

    expect(prepareNorevinqUserData(current)).toBe(current)
    expect(existsSync(join(current, 'current.json'))).toBe(true)
    expect(existsSync(legacy)).toBe(true)
  })
})
