import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, lstatSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('starts the packaged app with its bundled Codex runtime', async () => {
  const executablePath = packagedExecutablePath()
  expect(existsSync(executablePath)).toBe(true)
  const profile = mkdtempSync(join(tmpdir(), 'aster-packaged-e2e-'))
  const updateMetadataPresent = existsSync(packagedUpdateMetadataPath())
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
    const codexHome = join(profile, 'codex-home')
    expect(lstatSync(codexHome).isDirectory()).toBe(true)
    expect(lstatSync(codexHome).isSymbolicLink()).toBe(false)
    if (process.platform !== 'win32') expect(lstatSync(codexHome).mode & 0o777).toBe(0o700)
    const updates = await window.evaluate(async () => {
      const bridge = Reflect.get(window, 'aster') as {
        getUpdateState: () => Promise<{ phase: string; configured: boolean; disabledReason: string | null }>
      }
      return bridge.getUpdateState()
    })
    expect(updates).toMatchObject(updateMetadataPresent
      ? { phase: 'idle', configured: true, disabledReason: null }
      : {
          phase: 'disabled',
          configured: false,
          disabledReason: '此发布包没有 app-update.yml；发布者尚未配置更新渠道。',
        })
    await window.getByRole('button', { name: '设置', exact: true }).click()
    await window.getByRole('button', { name: '应用', exact: true }).click()
    await expect(window.getByText(updateMetadataPresent ? '已配置渠道' : '无发布渠道')).toBeVisible()
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

function packagedUpdateMetadataPath(): string {
  if (process.platform === 'darwin') {
    return join(process.cwd(), 'release', 'mac', 'Aster Code.app', 'Contents', 'Resources', 'app-update.yml')
  }
  if (process.platform === 'win32') {
    return join(process.cwd(), 'release', 'win-unpacked', 'resources', 'app-update.yml')
  }
  throw new Error(`Packaged desktop update metadata is not configured for ${process.platform}.`)
}
