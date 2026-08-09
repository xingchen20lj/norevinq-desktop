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
