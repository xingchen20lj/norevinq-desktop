import { _electron as electron, expect, test } from '@playwright/test'

test('starts with a sandboxed renderer and real project action', async () => {
  const application = await electron.launch({ args: ['.'] })
  try {
    const window = await application.firstWindow()
    await expect(window).toHaveTitle('Aster Code')
    await expect(window.getByRole('heading', { name: '把复杂开发工作交给智能体' })).toBeVisible()
    await expect(window.getByRole('button', { name: '打开本地项目', exact: true })).toBeEnabled()

    const securityState = await window.evaluate(() => ({
      hasNodeRequire: typeof Reflect.get(globalThis, 'require') !== 'undefined',
      hasProcess: typeof Reflect.get(globalThis, 'process') !== 'undefined',
      hasAsterBridge: typeof Reflect.get(window, 'aster') === 'object',
    }))
    expect(securityState).toEqual({ hasNodeRequire: false, hasProcess: false, hasAsterBridge: true })
    await window.screenshot({ path: 'test-results/aster-shell.png' })

    const originalTheme = await window.locator('html').getAttribute('data-theme')
    await window.getByRole('button', { name: '切换主题' }).click()
    await expect(window.locator('html')).not.toHaveAttribute('data-theme', originalTheme ?? '')

    await window.setViewportSize({ width: 960, height: 640 })
    await expect(window.getByLabel('任务输入')).toBeVisible()
    await expect(window.getByRole('button', { name: '打开本地项目', exact: true })).toBeVisible()
    await window.screenshot({ path: 'test-results/aster-shell-compact.png' })
  } finally {
    await application.close()
  }
})
