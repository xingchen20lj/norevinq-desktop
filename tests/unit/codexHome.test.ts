import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareNorevinqAgentHome } from '../../src/main/runtime/codexHome.js'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('Norevinq agent home', () => {
  it('creates an isolated private directory under Electron userData', () => {
    const userData = mkdtempSync(join(tmpdir(), 'norevinq-user-data-'))
    temporaryPaths.push(userData)

    const agentHome = prepareNorevinqAgentHome(userData)

    expect(agentHome).toBe(realpathSync(join(userData, 'agent-home')))
    expect(lstatSync(agentHome).isDirectory()).toBe(true)
    if (process.platform !== 'win32') expect(lstatSync(agentHome).mode & 0o777).toBe(0o700)
  })

  it('migrates the legacy private runtime directory without losing state', () => {
    const userData = mkdtempSync(join(tmpdir(), 'norevinq-user-data-'))
    const legacy = join(userData, 'codex-home')
    mkdirSync(legacy)
    writeFileSync(join(legacy, 'state.json'), '{"preserved":true}\n')
    temporaryPaths.push(userData)

    const agentHome = prepareNorevinqAgentHome(userData)

    expect(agentHome).toBe(realpathSync(join(userData, 'agent-home')))
    expect(existsSync(join(agentHome, 'state.json'))).toBe(true)
    expect(existsSync(legacy)).toBe(false)
  })

  it('accepts an explicit absolute test home but rejects relative and symlink homes', () => {
    const userData = mkdtempSync(join(tmpdir(), 'norevinq-user-data-'))
    const external = mkdtempSync(join(tmpdir(), 'norevinq-agent-home-'))
    temporaryPaths.push(userData, external)
    expect(prepareNorevinqAgentHome(userData, external)).toBe(realpathSync(external))
    expect(() => prepareNorevinqAgentHome(userData, 'relative/agent-home')).toThrow('absolute')

    const linked = join(userData, 'linked-agent-home')
    symlinkSync(external, linked, 'dir')
    expect(() => prepareNorevinqAgentHome(userData, linked)).toThrow('symbolic link')
  })
})
