import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('starts the packaged app with its bundled Codex runtime', async () => {
  const executablePath = packagedExecutablePath()
  expect(existsSync(executablePath)).toBe(true)
  const profile = mkdtempSync(join(tmpdir(), 'aster-packaged-e2e-'))
  const application = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`] })
  try {
    const window = await application.firstWindow()
    await expect(window).toHaveTitle('Aster Code')
    await expect.poll(() => window.evaluate(async () => {
      const bridge = Reflect.get(window, 'aster') as {
        getRuntimeStatus: () => Promise<{ phase: string }>
      }
      return (await bridge.getRuntimeStatus()).phase
    }), { timeout: 30_000 }).toBe('ready')

    const runtime = await window.evaluate(async () => {
      const bridge = Reflect.get(window, 'aster') as {
        getRuntimeStatus: () => Promise<{ version: string | null; binaryPath: string | null; models: unknown[] }>
      }
      return bridge.getRuntimeStatus()
    })
    expect(runtime.version).toMatch(/^codex(?:-cli)?\s+0\.147\.0$/iu)
    expect(runtime.binaryPath).toContain('app.asar.unpacked')
    expect(runtime.models.length).toBeGreaterThan(0)
  } finally {
    await application.close()
    rmSync(profile, { force: true, recursive: true })
  }
})

function packagedExecutablePath(): string {
  if (process.env.ASTER_PACKAGED_EXECUTABLE) return process.env.ASTER_PACKAGED_EXECUTABLE
  if (process.platform === 'darwin') {
    return join(process.cwd(), 'release', 'mac', 'Aster Code.app', 'Contents', 'MacOS', 'Aster Code')
  }
  if (process.platform === 'win32') return join(process.cwd(), 'release', 'win-unpacked', 'Aster Code.exe')
  throw new Error(`Packaged desktop smoke is not configured for ${process.platform}.`)
}
