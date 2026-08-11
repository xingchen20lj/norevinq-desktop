import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, test } from 'vitest'

const execute = promisify(execFile)
const generatorPath = fileURLToPath(new URL('../../scripts/generate-third-party-notices.mjs', import.meta.url))
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {
    force: true, recursive: true, maxRetries: 5, retryDelay: 100,
  })))
})

describe('third-party notice generator', () => {
  test('uses the pinned package-manager entrypoint and accepts only HTTP(S) project links', async () => {
    const root = await createFixture([
      { name: 'safe-package', homepage: 'https://example.com/project' },
      { name: 'unsafe-package', homepage: 'javascript:alert(1)' },
    ])

    await runGenerator(root)

    const notices = await readFile(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
    expect(notices).toContain('[link](https://example.com/project)')
    expect(notices).not.toContain('javascript:')
    expect(notices).toContain('| unsafe-package | 1.0.0 | MIT |  |')
  })

  test.skipIf(process.platform === 'win32')('refuses to follow a notice-file symbolic link', async () => {
    const root = await createFixture([{ name: 'safe-package', homepage: 'https://example.com' }])
    const victim = join(root, 'victim.txt')
    await writeFile(victim, 'UNCHANGED', 'utf8')
    await symlink(victim, join(root, 'THIRD_PARTY_NOTICES.md'))

    await expect(runGenerator(root)).rejects.toThrow(/must be a regular file/u)
    await expect(readFile(victim, 'utf8')).resolves.toBe('UNCHANGED')
  })
})

async function createFixture(packages: { name: string; homepage: string }[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'aster-notices-'))
  temporaryRoots.push(root)
  const manager = join(root, 'fake-pnpm.mjs')
  const report = {
    MIT: packages.map((entry) => ({
      ...entry,
      versions: ['1.0.0'],
      license: 'MIT',
    })),
  }
  await writeFile(manager, `process.stdout.write(${JSON.stringify(JSON.stringify(report))})\n`, 'utf8')
  return root
}

async function runGenerator(root: string): Promise<void> {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'npm_execpath'),
  )
  await execute(process.execPath, [generatorPath], {
    cwd: root,
    env: {
      ...environment,
      npm_execpath: join(root, 'fake-pnpm.mjs'),
    },
    timeout: 10_000,
    windowsHide: true,
  })
}
