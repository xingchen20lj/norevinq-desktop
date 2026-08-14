import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { preparePackageOutput } from '../../scripts/prepare-package-output.mjs'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, {
    force: true, recursive: true, maxRetries: 3, retryDelay: 100,
  })
})

describe('package output preparation', () => {
  it('disables repository-derived update metadata for local packages', () => {
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      build?: { publish?: unknown }
    }

    expect(packageJson.build?.publish).toBeNull()
  })

  it('removes stale updater metadata before recreating an empty output directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'norevinq-package-output-'))
    temporaryPaths.push(root)
    const stalePath = join(root, 'release', 'mac', 'Norevinq.app', 'Contents', 'Resources', 'app-update.yml')
    mkdirSync(dirname(stalePath), { recursive: true })
    writeFileSync(stalePath, 'provider: stale\n')

    const outputRoot = await preparePackageOutput(root)

    expect(outputRoot).toBe(join(root, 'release'))
    expect(lstatSync(outputRoot).isDirectory()).toBe(true)
    expect(existsSync(stalePath)).toBe(false)
  })

  it('replaces an output symlink without touching its target', async () => {
    const root = mkdtempSync(join(tmpdir(), 'norevinq-package-symlink-'))
    const target = mkdtempSync(join(tmpdir(), 'norevinq-package-target-'))
    temporaryPaths.push(root, target)
    writeFileSync(join(target, 'keep.txt'), 'keep\n')
    symlinkSync(target, join(root, 'release'), 'dir')

    await preparePackageOutput(root)

    expect(lstatSync(join(root, 'release')).isDirectory()).toBe(true)
    expect(lstatSync(join(root, 'release')).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('keep\n')
  })
})
