import { _electron as electron, test, expect } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('allows the main frame and rejects another renderer at the IPC boundary', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'aster-ipc-e2e-'))
  const application = await electron.launch({ args: ['.', `--user-data-dir=${profile}`] })
  try {
    const window = await application.firstWindow()
    await expect(window).toHaveTitle('Aster Code')
    const bootstrap = await window.evaluate(async () => {
      const bridge = Reflect.get(window, 'aster') as {
        getBootstrapState: () => Promise<{ appVersion: string; platform: string }>
      }
      return bridge.getBootstrapState()
    })
    expect(bootstrap.appVersion).toBe('0.1.0')
    expect(bootstrap.platform).toBe(process.platform)

    await window.getByRole('button', { name: '设置', exact: true }).click()
    await expect(window.getByRole('heading', { name: '设置与集成' })).toBeVisible()
    await window.getByRole('button', { name: '关闭设置' }).click()
    await window.getByRole('button', { name: '安全', exact: true }).click()
    await expect(window.getByRole('heading', { name: '安全工作台' })).toBeVisible()
    await window.getByRole('button', { name: '关闭安全工作台' }).click()
    await window.getByRole('button', { name: '计划任务', exact: true }).click()
    await expect(window.getByRole('heading', { name: '计划任务' })).toBeVisible()
    await window.getByRole('button', { name: '关闭计划任务' }).click()
    await window.getByRole('button', { name: '命令面板' }).click()
    await expect(window.getByRole('dialog', { name: '命令面板' })).toBeVisible()
    await window.keyboard.press('Escape')

    if (process.env.ASTER_REQUIRE_CODEX_RUNTIME === '1') {
      await expect.poll(() => window.evaluate(async () => {
        const bridge = Reflect.get(window, 'aster') as {
          getRuntimeStatus: () => Promise<{ phase: string }>
        }
        return (await bridge.getRuntimeStatus()).phase
      }), { timeout: 20_000 }).toBe('ready')
    }

    const unauthorizedResult = await application.evaluate(async ({ BrowserWindow }) => {
      const attacker = new BrowserWindow({
        show: false,
        webPreferences: {
          contextIsolation: false,
          nodeIntegration: true,
          sandbox: false,
        },
      })
      try {
        await attacker.loadURL('data:text/html,<title>Untrusted Renderer</title>')
        return await attacker.webContents.executeJavaScript(`
          require('electron').ipcRenderer.invoke('app:bootstrap')
            .then(() => 'unexpected-success')
            .catch((error) => String(error && error.message ? error.message : error))
        `) as string
      } finally {
        attacker.destroy()
      }
    })
    expect(unauthorizedResult).toContain('Unauthorized IPC sender')
  } finally {
    await application.close()
    rmSync(profile, { force: true, recursive: true })
  }
})
