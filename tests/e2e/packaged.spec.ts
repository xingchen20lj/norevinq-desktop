import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StateDatabase } from '../../src/main/state/database.js'

test('starts the packaged app with its bundled Codex runtime', async () => {
  const executablePath = packagedExecutablePath()
  expect(existsSync(executablePath)).toBe(true)
  const profile = mkdtempSync(join(tmpdir(), 'norevinq-packaged-e2e-'))
  const repository = join(profile, 'repository')
  mkdirSync(repository)
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', repository])
  writeFileSync(join(repository, 'safe.ts'), 'export const safe = true\n')
  execFileSync('git', ['-C', repository, 'add', '.'])
  execFileSync('git', ['-C', repository, '-c', 'user.name=Norevinq Test', '-c', 'user.email=norevinq@example.invalid', 'commit', '--quiet', '-m', 'fixture'])
  const database = new StateDatabase(join(profile, 'norevinq.sqlite3'))
  const project = database.upsertProject(repository)
  database.close()
  const updateMetadataPresent = existsSync(packagedUpdateMetadataPath())
  const application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${profile}`],
    env: { ...process.env, DEEPSEEK_API_KEY: 'sk-packaged-preflight-only-test' },
  })
  try {
    const window = await application.firstWindow()
    await expect(window).toHaveTitle('Norevinq')
    await expect.poll(() => window.evaluate(async () => {
      const bridge = Reflect.get(window, 'norevinq') as {
        getRuntimeStatus: () => Promise<{ phase: string }>
      }
      return (await bridge.getRuntimeStatus()).phase
    }), { timeout: 30_000 }).toBe('ready')

    const runtime = await window.evaluate(async () => {
      const bridge = Reflect.get(window, 'norevinq') as {
        getRuntimeStatus: () => Promise<{ version: string | null; binaryPath: string | null; models: unknown[] }>
      }
      return bridge.getRuntimeStatus()
    })
    expect(runtime.version).toMatch(/^codex(?:-cli)?\s+0\.147\.0$/iu)
    expect(runtime.binaryPath).toContain('app.asar.unpacked')
    expect(runtime.models.length).toBeGreaterThan(0)
    const preflight = await window.evaluate(async (projectId) => {
      const bridge = Reflect.get(window, 'norevinq') as {
        preflightSecurityScan: (input: unknown) => Promise<{
          model: string
          modelProvider?: string
          outputIsolated: boolean
        }>
      }
      return bridge.preflightSecurityScan({
        projectId,
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        mode: 'standard',
        target: { kind: 'repository' },
        auth: 'api-key',
      })
    }, project.id)
    expect(preflight).toMatchObject({
      model: 'deepseek-v4-flash',
      modelProvider: 'deepseek',
      outputIsolated: true,
    })
    const agentHome = join(profile, 'agent-home')
    expect(lstatSync(agentHome).isDirectory()).toBe(true)
    expect(lstatSync(agentHome).isSymbolicLink()).toBe(false)
    if (process.platform !== 'win32') expect(lstatSync(agentHome).mode & 0o777).toBe(0o700)
    const updates = await window.evaluate(async () => {
      const bridge = Reflect.get(window, 'norevinq') as {
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
  if (process.env.NOREVINQ_PACKAGED_EXECUTABLE) return process.env.NOREVINQ_PACKAGED_EXECUTABLE
  if (process.platform === 'darwin') {
    return join(process.cwd(), 'release', 'mac', 'Norevinq.app', 'Contents', 'MacOS', 'Norevinq')
  }
  if (process.platform === 'win32') return join(process.cwd(), 'release', 'win-unpacked', 'Norevinq.exe')
  throw new Error(`Packaged desktop smoke is not configured for ${process.platform}.`)
}

function packagedUpdateMetadataPath(): string {
  if (process.platform === 'darwin') {
    return join(process.cwd(), 'release', 'mac', 'Norevinq.app', 'Contents', 'Resources', 'app-update.yml')
  }
  if (process.platform === 'win32') {
    return join(process.cwd(), 'release', 'win-unpacked', 'resources', 'app-update.yml')
  }
  throw new Error(`Packaged desktop update metadata is not configured for ${process.platform}.`)
}
