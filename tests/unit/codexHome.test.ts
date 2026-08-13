import { lstatSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareAsterCodexHome } from '../../src/main/runtime/codexHome.js'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('Aster Codex home', () => {
  it('creates an isolated private directory under Electron userData', () => {
    const userData = mkdtempSync(join(tmpdir(), 'aster-user-data-'))
    temporaryPaths.push(userData)

    const codexHome = prepareAsterCodexHome(userData)

    expect(codexHome).toBe(realpathSync(join(userData, 'codex-home')))
    expect(lstatSync(codexHome).isDirectory()).toBe(true)
    if (process.platform !== 'win32') expect(lstatSync(codexHome).mode & 0o777).toBe(0o700)
  })

  it('accepts an explicit absolute test home but rejects relative and symlink homes', () => {
    const userData = mkdtempSync(join(tmpdir(), 'aster-user-data-'))
    const external = mkdtempSync(join(tmpdir(), 'aster-codex-home-'))
    temporaryPaths.push(userData, external)
    expect(prepareAsterCodexHome(userData, external)).toBe(realpathSync(external))
    expect(() => prepareAsterCodexHome(userData, 'relative/codex-home')).toThrow('absolute')

    const linked = join(userData, 'linked-codex-home')
    symlinkSync(external, linked, 'dir')
    expect(() => prepareAsterCodexHome(userData, linked)).toThrow('symbolic link')
  })
})
