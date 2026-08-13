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
    await window.getByRole('button', { name: '应用', exact: true }).click()
    await expect(window.getByText('开发构建不会连接发布更新源。')).toBeVisible()
    await expect(window.getByText('不会自动上传。', { exact: false })).toBeVisible()
    await expect(window.getByRole('button', { name: '导出诊断包' })).toBeVisible()
    await window.screenshot({ path: 'test-results/aster-update-settings.png' })
    await window.getByRole('button', { name: '关闭设置' }).click()
    await window.getByRole('button', { name: '安全', exact: true }).click()
    const securityWorkbench = window.getByRole('dialog', { name: '安全工作台' })
    await expect(securityWorkbench.getByRole('heading', { name: '安全工作台' })).toBeVisible()
    await window.getByRole('button', { name: '关闭安全工作台' }).click()
    await window.getByRole('button', { name: '计划任务', exact: true }).click()
    const schedulerWorkbench = window.getByRole('dialog', { name: '计划任务工作台' })
    await expect(schedulerWorkbench.getByRole('heading', { name: '计划任务' })).toBeVisible()
    await window.getByRole('button', { name: '关闭计划任务' }).click()
    await window.setViewportSize({ width: 1_200, height: 760 })
    await window.getByRole('button', { name: '本地网页预览' }).click()
    const browser = window.getByRole('region', { name: '本地网页预览' })
    await expect(browser).toBeVisible()
    await expect.poll(async () => {
      const [composerBounds, browserBounds] = await Promise.all([
        window.locator('.composer-shell').boundingBox(),
        browser.boundingBox(),
      ])
      if (!composerBounds || !browserBounds) return false
      return composerBounds.x + composerBounds.width <= browserBounds.x + 1
    }).toBe(true)
    const separator = browser.getByRole('separator', { name: '调整网页预览宽度' })
    await expect(separator).toHaveAttribute('aria-valuenow', /\d+/u)
    const widthBeforeKeyboardResize = (await browser.boundingBox())?.width ?? 0
    await separator.focus()
    await window.keyboard.press('ArrowRight')
    await expect.poll(async () => (await browser.boundingBox())?.width ?? 0).toBeLessThan(widthBeforeKeyboardResize)
    await window.screenshot({ path: 'test-results/aster-browser-split.png' })
    await window.setViewportSize({ width: 800, height: 640 })
    await expect.poll(async () => {
      const [composerBounds, browserBounds] = await Promise.all([
        window.locator('.composer-shell').boundingBox(),
        browser.boundingBox(),
      ])
      if (!composerBounds || !browserBounds) return false
      return composerBounds.y + composerBounds.height <= browserBounds.y + 1
    }).toBe(true)
    await window.screenshot({ path: 'test-results/aster-browser-bottom.png' })
    await browser.getByRole('button', { name: '关闭网页预览' }).click()
    await expect(browser).toHaveCount(0)
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

    await application.evaluate(({ app, BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]?.webContents
      if (!contents) throw new Error('Main window is missing.')
      const emitter = app as unknown as { emit: (event: string, ...args: unknown[]) => boolean }
      emitter.emit('render-process-gone', {}, contents, { reason: 'crashed', exitCode: 88 })
    })
    const diagnostics = await window.evaluate(async () => {
      const bridge = Reflect.get(window, 'aster') as {
        getDiagnosticsState: () => Promise<{ retainedCrashCount: number; automaticUpload: boolean }>
      }
      return bridge.getDiagnosticsState()
    })
    expect(diagnostics).toMatchObject({ retainedCrashCount: 1, automaticUpload: false })
  } finally {
    await application.close()
    rmSync(profile, { force: true, recursive: true })
  }
})
