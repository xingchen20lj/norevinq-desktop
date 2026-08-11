import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, posix, win32 } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  discoverCodexBinary,
  getBundledCodexPath,
  getCodexBinaryCandidates,
  probeCodexVersion,
} from '../../src/main/runtime/codexDiscovery.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true, force: true, maxRetries: 5, retryDelay: 100,
  })))
})

async function executable(name: string, body = '#!/bin/sh\necho codex-cli-test 1.2.3\n'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'aster-codex-discovery-'))
  temporaryDirectories.push(directory)
  const path = join(directory, name)
  await writeFile(path, body, 'utf8')
  await chmod(path, 0o755)
  return path
}

describe('Codex binary discovery', () => {
  it('orders explicit, environment, bundled runtime, PATH, then known macOS bundle candidates', () => {
    const candidates = getCodexBinaryCandidates({
      explicitBinary: '/configured/codex',
      env: { CODEX_BINARY: '/environment/codex', PATH: '/first:/second' },
      platform: 'darwin',
      arch: 'x64',
      resourcesPath: '/Aster Code.app/Contents/Resources',
      knownBundlePaths: ['/Applications/ChatGPT.app/Contents/Resources/codex'],
    })

    expect(candidates).toEqual([
      { path: '/configured/codex', source: 'explicit' },
      { path: '/environment/codex', source: 'environment' },
      { path: '/Aster Code.app/Contents/Resources/app.asar.unpacked/node_modules/@openai/codex-darwin-x64/vendor/x86_64-apple-darwin/bin/codex', source: 'bundled' },
      { path: '/first/codex', source: 'path' },
      { path: '/second/codex', source: 'path' },
      { path: '/Applications/ChatGPT.app/Contents/Resources/codex', source: 'chatgpt-bundle' },
    ])
  })

  it('maps supported packaged targets without guessing unsupported platforms', () => {
    expect(getBundledCodexPath('C:\\resources', 'win32', 'x64')).toBe(
      win32.join('C:\\resources', 'app.asar.unpacked', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'),
    )
    expect(getBundledCodexPath('/resources', 'darwin', 'arm64')).toBe(
      posix.join('/resources', 'app.asar.unpacked', 'node_modules', '@openai', 'codex-darwin-arm64', 'vendor', 'aarch64-apple-darwin', 'bin', 'codex'),
    )
    expect(getBundledCodexPath('/resources', 'linux', 'x64')).toBeNull()
  })

  it('probes candidates in order and falls back when a candidate is not Codex', async () => {
    const broken = await executable('broken-codex')
    const working = await executable('working-codex')
    const probes: string[] = []
    const result = await discoverCodexBinary({
      explicitBinary: broken,
      env: { CODEX_BINARY: working, PATH: '' },
      platform: process.platform,
      probe: (path) => {
        probes.push(path)
        if (path === broken) return Promise.reject(new Error('not Codex'))
        return Promise.resolve('codex-cli 9.8.7')
      },
    })

    expect(probes).toEqual([broken, working])
    expect(result).toEqual({ path: working, source: 'environment', version: 'codex-cli 9.8.7' })
  })

  it('uses an argument array so shell metacharacters in a path are inert', async () => {
    if (process.platform === 'win32') return
    const path = await executable('codex; touch SHOULD_NOT_RUN')
    await expect(probeCodexVersion(path)).resolves.toBe('codex-cli-test 1.2.3')
  })

  it('finds the version line when Codex writes a warning first', async () => {
    if (process.platform === 'win32') return
    const path = await executable(
      'warning-codex',
      '#!/bin/sh\necho "WARNING: alias setup failed" >&2\necho "codex-cli 4.5.6" >&2\n',
    )
    await expect(probeCodexVersion(path)).resolves.toBe('codex-cli 4.5.6')
  })

  it('reports actionable configuration guidance when no candidate works', async () => {
    await expect(discoverCodexBinary({
      env: { PATH: '' },
      platform: 'linux',
    })).rejects.toThrow('CODEX_BINARY')
  })
})
