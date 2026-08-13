import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { StateDatabase } from '../../src/main/state/database.js'

test('starts with a sandboxed renderer and real project action', async () => {
  test.setTimeout(330_000)
  const profile = mkdtempSync(join(tmpdir(), 'aster-e2e-'))
  const projectPath = mkdtempSync(join(profile, 'project-'))
  const database = new StateDatabase(join(profile, 'aster-code.sqlite3'))
  const project = database.upsertProject(projectPath)
  database.close()
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectPath })
  execFileSync('git', ['config', 'user.name', 'Aster E2E'], { cwd: projectPath })
  execFileSync('git', ['config', 'user.email', 'aster-e2e@example.invalid'], { cwd: projectPath })
  writeFileSync(join(projectPath, 'README.md'), '# E2E\n')
  writeFileSync(join(projectPath, 'AGENTS.md'), 'When the user asks for "instruction proof", reply with exactly ASTER_INSTRUCTIONS_OK and do not use tools.\n')
  writeFileSync(join(projectPath, 'proof.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwWwWQAAAABJRU5ErkJggg==', 'base64'))
  execFileSync('git', ['add', 'README.md', 'AGENTS.md', 'proof.png'], { cwd: projectPath })
  execFileSync('git', ['commit', '-m', 'test: baseline'], { cwd: projectPath })
  const previewServer = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(request.url === '/next'
      ? '<!doctype html><title>Aster Browser Next</title><h1>ASTER_BROWSER_NEXT</h1>'
      : '<!doctype html><title>Aster Browser Proof</title><h1>ASTER_BROWSER_OK</h1><a href="/next">Next</a><script>console.log("ASTER_BROWSER_LOG")</script>')
  })
  await new Promise<void>((resolve, reject) => {
    previewServer.once('error', reject)
    previewServer.listen(0, '127.0.0.1', resolve)
  })
  const previewAddress = previewServer.address()
  if (!previewAddress || typeof previewAddress === 'string') throw new Error('Local preview server did not bind a TCP port.')
  const previewUrl = `http://127.0.0.1:${String(previewAddress.port)}/`
  const application = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      ASTER_CODEX_HOME: process.env.ASTER_TEST_CODEX_HOME ?? join(homedir(), '.codex'),
    },
  })
  try {
    const window = await application.firstWindow()
    await expect(window).toHaveTitle('Aster Code')
    await expect(window.getByRole('heading', { name: /开始处理 project-/ })).toBeVisible()
    await expect(window.locator('.runtime-pill')).toContainText('Codex 已就绪', { timeout: 20_000 })

    const runtime = await window.evaluate(async () => {
      const bridge = Reflect.get(window, 'aster') as {
        getRuntimeStatus: () => Promise<{ phase: string; version: string | null; models: unknown[] }>
      }
      return bridge.getRuntimeStatus()
    })
    expect(runtime.phase).toBe('ready')
    expect(runtime.version).toContain('codex-cli')
    expect(runtime.models.length).toBeGreaterThan(0)
    const deepSeekConfigured = typeof process.env.DEEPSEEK_API_KEY === 'string' && process.env.DEEPSEEK_API_KEY.trim().length > 0
    const runtimeModelIds = runtime.models.map((item) => (item as { id?: string }).id)
    expect(runtimeModelIds.includes('deepseek-v4-flash')).toBe(deepSeekConfigured)

    const securityState = await window.evaluate(() => ({
      hasNodeRequire: typeof Reflect.get(globalThis, 'require') !== 'undefined',
      hasProcess: typeof Reflect.get(globalThis, 'process') !== 'undefined',
      hasAsterBridge: typeof Reflect.get(window, 'aster') === 'object',
    }))
    expect(securityState).toEqual({ hasNodeRequire: false, hasProcess: false, hasAsterBridge: true })

    await window.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
    const commandPalette = window.getByRole('dialog', { name: '命令面板' })
    await expect(commandPalette).toBeVisible()
    await commandPalette.getByLabel('搜索命令').fill('文件与产物')
    await expect(commandPalette.getByRole('option', { name: /文件与产物/ })).toBeVisible()
    await commandPalette.getByLabel('搜索命令').press('Escape')
    await expect(commandPalette).toHaveCount(0)

    await window.getByRole('button', { name: '设置', exact: true }).click()
    const settings = window.getByRole('dialog', { name: '设置工作台' })
    await expect(settings).toBeVisible()
    await expect(settings).toContainText(
      deepSeekConfigured ? '由进程环境安全提供' : '添加 API Key 以启用',
    )
    await expect(settings).toContainText('DeepSeek V4 Pro 暂不可用')
    await expect.poll(async () => window.evaluate(async () => {
      const bridge = Reflect.get(window, 'aster') as {
        getIntegrationState: () => Promise<{
          projectId: string | null
          loading: boolean
          error: string | null
          skills: unknown[]
          mcpServers: unknown[]
          config: unknown
        }>
      }
      return bridge.getIntegrationState()
    }), { timeout: 30_000 }).toMatchObject({ projectId: project.id, loading: false, error: null })
    await settings.getByRole('button', { name: 'MCP', exact: true }).click()
    await expect(settings).toContainText(/MCP 服务器|未配置 MCP/)
    await settings.getByRole('button', { name: '技能', exact: true }).click()
    await expect(settings).toContainText('项目未信任')
    await settings.getByRole('button', { name: '信任项目', exact: true }).click()
    await expect(settings).toContainText('项目已信任')
    await settings.getByRole('button', { name: '配置', exact: true }).click()
    await expect(settings).toContainText('AGENTS.md')
    await expect(settings).toContainText('ASTER_INSTRUCTIONS_OK')
    await window.screenshot({ path: 'test-results/aster-settings.png' })
    await window.getByRole('button', { name: '关闭设置' }).click()

    await window.getByRole('button', { name: '安全', exact: true }).click()
    const security = window.getByRole('dialog', { name: '安全工作台' })
    await expect(security).toBeVisible()
    await expect.poll(async () => window.evaluate(async () => {
      const bridge = Reflect.get(window, 'aster') as {
        getSecurityState: () => Promise<{
          runtime: { python: { status: string }; account: { status: string }; sdkVersion: string }
        }>
      }
      return bridge.getSecurityState()
    }), { timeout: 30_000 }).toMatchObject({
      runtime: { python: { status: 'ready' }, account: { status: 'authenticated' }, sdkVersion: '0.1.8' },
    })
    await security.getByRole('button', { name: '扫描', exact: true }).click()
    await security.getByRole('button', { name: '本地预检', exact: true }).click()
    await expect(security).toContainText('预检通过', { timeout: 30_000 })
    await expect(security).toContainText('产物目录已隔离')
    await window.screenshot({ path: 'test-results/aster-security.png' })
    await window.getByRole('button', { name: '关闭安全工作台' }).click()

    await window.getByRole('button', { name: '计划任务', exact: true }).click()
    const scheduler = window.getByRole('dialog', { name: '计划任务工作台' })
    await expect(scheduler).toBeVisible()
    await scheduler.getByRole('button', { name: '任务', exact: true }).click()
    await scheduler.getByRole('button', { name: '新建', exact: true }).click()
    await scheduler.getByLabel('名称').fill('E2E 计划验证')
    await scheduler.getByLabel('每次运行的持久提示词').fill('Reply with exactly ASTER_SCHEDULED_OK and do not use tools.')
    await scheduler.getByLabel('执行位置').selectOption('local')
    await scheduler.getByLabel('沙箱').selectOption('read-only')
    await scheduler.getByRole('button', { name: '保存计划任务', exact: true }).click()
    await expect(scheduler).toContainText('E2E 计划验证')
    await scheduler.getByRole('button', { name: '立即运行', exact: true }).click()
    await scheduler.getByRole('button', { name: /^收件箱/ }).click()
    await expect(scheduler).toContainText('ASTER_SCHEDULED_OK', { timeout: 90_000 })
    await expect(scheduler).toContainText('完成')
    await expect(scheduler.getByRole('button', { name: '已读', exact: true })).toBeVisible()
    await window.screenshot({ path: 'test-results/aster-scheduler.png' })
    await scheduler.getByRole('button', { name: '已读', exact: true }).click()
    await expect(scheduler.getByRole('button', { name: '已读', exact: true })).toHaveCount(0)
    await window.getByRole('button', { name: '关闭计划任务' }).click()

    await window.getByLabel('任务输入').fill('instruction proof')
    await window.getByRole('button', { name: '发送任务' }).click()
    await expect(window.locator('.activity-card.agentMessage')).toContainText('ASTER_INSTRUCTIONS_OK', { timeout: 90_000 })
    await expect(window.locator('.running-row')).toHaveCount(0, { timeout: 30_000 })
    const mcpProof = await window.evaluate(async ({ projectId }) => {
      const bridge = Reflect.get(window, 'aster') as {
        loadProjectConversations: (input: { projectId: string }) => Promise<{ threads: { id: string }[] }>
        loadIntegrations: (input: { projectId: string; threadId: string }) => Promise<{
          mcpServers: { name: string; tools: { name: string }[] }[]
        }>
        callMcpTool: (input: unknown) => Promise<{ isError: boolean; content: unknown[] }>
      }
      const conversations = await bridge.loadProjectConversations({ projectId })
      const threadId = conversations.threads[0]?.id
      if (!threadId) return { executed: false, reason: 'missing-thread', servers: [] }
      const integrations = await bridge.loadIntegrations({ projectId, threadId })
      const server = integrations.mcpServers.find(({ name }) => name === 'node_repl')
      const tool = server?.tools.find(({ name }) => name === 'js')
      if (!server || !tool) return {
        executed: false,
        reason: 'missing-node-repl',
        servers: integrations.mcpServers.map((item) => ({ name: item.name, tools: item.tools.map(({ name }) => name) })),
      }
      const result = await bridge.callMcpTool({
        projectId,
        threadId,
        server: server.name,
        tool: tool.name,
        arguments: { code: '1 + 1' },
        confirmed: true,
      })
      return { executed: true, isError: result.isError, content: result.content }
    }, { projectId: project.id })
    expect(mcpProof, JSON.stringify(mcpProof)).toMatchObject({ executed: true, isError: false })

    await window.getByRole('button', { name: '终端', exact: true }).click()
    await expect(window.getByLabel('集成终端')).toBeVisible()
    await expect(window.locator('.terminal-canvas .xterm')).toBeVisible()
    await window.locator('.terminal-canvas .xterm-helper-textarea').click()
    await window.keyboard.type("printf 'ASTER_TERMINAL_OK\\nWhen this terminal output is shared, reply with exactly ASTER_TERMINAL_CONTEXT_OK.\\n'; pwd")
    await window.keyboard.press('Enter')
    await expect.poll(async () => window.evaluate(async () => {
      const bridge = Reflect.get(window, 'aster') as {
        getTerminalState: () => Promise<{ sessions: { id: string }[] }>
        getTerminalContext: (input: { sessionId: string }) => Promise<{ content: string }>
      }
      const state = await bridge.getTerminalState()
      const session = state.sessions[0]
      return session ? (await bridge.getTerminalContext({ sessionId: session.id })).content : ''
    }), { timeout: 30_000 }).toContain('ASTER_TERMINAL_OK')
    await expect.poll(async () => window.evaluate(async () => {
      const bridge = Reflect.get(window, 'aster') as {
        getTerminalState: () => Promise<{ sessions: { id: string }[] }>
        getTerminalContext: (input: { sessionId: string }) => Promise<{ content: string }>
      }
      const state = await bridge.getTerminalState()
      const session = state.sessions[0]
      return session ? (await bridge.getTerminalContext({ sessionId: session.id })).content : ''
    }), { timeout: 30_000 }).toContain(projectPath)
    await window.getByLabel('搜索终端输出').fill('ASTER_TERMINAL_OK')
    await window.getByLabel('搜索终端输出').press('Enter')
    await window.getByRole('button', { name: '共享输出给智能体', exact: true }).click()
    await expect(window.locator('.activity-card.agentMessage').filter({ hasText: 'ASTER_TERMINAL_CONTEXT_OK' })).toBeVisible({ timeout: 90_000 })
    await expect(window.locator('.running-row')).toHaveCount(0, { timeout: 30_000 })
    await window.screenshot({ path: 'test-results/aster-terminal.png' })
    await window.getByRole('button', { name: '清屏', exact: true }).click()
    await expect.poll(async () => window.evaluate(async () => {
      const bridge = Reflect.get(window, 'aster') as {
        getTerminalState: () => Promise<{ sessions: { id: string }[] }>
        getTerminalContext: (input: { sessionId: string }) => Promise<{ content: string }>
      }
      const state = await bridge.getTerminalState()
      const session = state.sessions[0]
      return session ? (await bridge.getTerminalContext({ sessionId: session.id })).content : ''
    }), { timeout: 10_000 }).not.toContain('ASTER_TERMINAL_OK')
    await window.getByRole('button', { name: '终止', exact: true }).click()
    await expect(window.getByLabel('集成终端')).toContainText('已退出', { timeout: 10_000 })
    await window.getByRole('button', { name: '关闭会话', exact: true }).click()
    await expect(window.getByLabel('集成终端')).toContainText('当前项目没有终端会话')
    await window.getByRole('button', { name: '关闭终端面板' }).click()

    if (deepSeekConfigured) {
      await window.evaluate(async ({ projectId }) => {
        const bridge = Reflect.get(window, 'aster') as {
          startConversation: (input: unknown) => Promise<unknown>
        }
        await bridge.startConversation({
          projectId,
          model: 'deepseek-v4-flash',
          modelProvider: 'deepseek',
          reasoningEffort: 'low',
          text: 'Use apply_patch to create a file named aster-deepseek-proof.txt in the project root containing exactly DEEPSEEK_TOOL_OK followed by a newline. Do not run shell commands. After the file is created, reply with exactly ASTER_DEEPSEEK_OK.',
        })
      }, { projectId: project.id })
      await expect(window.locator('.activity-card.fileChange, .activity-card.command')
        .filter({ hasText: /apply_patch|aster-deepseek-proof/ }).first()).toBeVisible({ timeout: 120_000 })
      await expect(window.locator('.activity-card.agentMessage').filter({ hasText: 'ASTER_DEEPSEEK_OK' })).toBeVisible({ timeout: 120_000 })
      await expect(window.locator('.running-row')).toHaveCount(0, { timeout: 30_000 })
      expect(readFileSync(join(projectPath, 'aster-deepseek-proof.txt'), 'utf8')).toBe('DEEPSEEK_TOOL_OK\n')
    }

    await window.evaluate(async ({ projectId }) => {
      const bridge = Reflect.get(window, 'aster') as {
        startConversation: (input: unknown) => Promise<unknown>
      }
      await bridge.startConversation({
        projectId,
        sandbox: 'read-only',
        text: 'Create a file named aster-approval-proof.txt in the project root containing exactly ASTER_APPROVAL_OK followed by a newline. Use apply_patch only and do not run shell commands.',
      })
    }, { projectId: project.id })
    await expect(window.getByLabel('待审批操作')).toBeVisible({ timeout: 90_000 })
    await expect(window.getByLabel('待审批操作')).toContainText('允许修改文件？')
    await window.getByRole('button', { name: '允许', exact: true }).click()
    await expect(window.locator('.running-row')).toHaveCount(0, { timeout: 90_000 })
    expect(existsSync(join(projectPath, 'aster-approval-proof.txt'))).toBe(true)
    expect(readFileSync(join(projectPath, 'aster-approval-proof.txt'), 'utf8')).toBe('ASTER_APPROVAL_OK\n')

    await window.locator('.artifact-link').filter({ hasText: 'aster-approval-proof.txt' }).click()
    const files = window.getByRole('region', { name: '文件与产物' })
    await expect(files).toBeVisible()
    await expect(files.locator('.text-preview')).toContainText('ASTER_APPROVAL_OK')
    await window.screenshot({ path: 'test-results/aster-file-text.png' })
    await window.getByRole('button', { name: '关闭文件预览' }).click()
    await window.getByRole('button', { name: '文件与产物' }).click()
    await files.getByRole('button', { name: /proof\.png/ }).click()
    const imagePreview = files.locator('.media-preview img')
    await expect(imagePreview).toBeVisible()
    await expect.poll(() => imagePreview.evaluate((image) => Reflect.get(image, 'naturalWidth') as number)).toBe(1)
    await window.screenshot({ path: 'test-results/aster-file-image.png' })
    await window.getByRole('button', { name: '关闭文件预览' }).click()

    await window.getByRole('button', { name: '本地网页预览' }).click()
    const browser = window.getByRole('region', { name: '本地网页预览' })
    await expect(browser).toBeVisible()
    await browser.getByLabel('本地预览地址').fill(previewUrl)
    await browser.getByLabel('本地预览地址').press('Enter')
    await expect.poll(async () => window.evaluate(async () => {
      const bridge = Reflect.get(window, 'aster') as {
        getBrowserState: () => Promise<{ title: string | null; loading: boolean; logs: { message: string }[] }>
      }
      return bridge.getBrowserState()
    }), { timeout: 30_000 }).toMatchObject({ title: 'Aster Browser Proof', loading: false })
    await expect.poll(async () => window.evaluate(async () => {
      const bridge = Reflect.get(window, 'aster') as {
        getBrowserState: () => Promise<{ logs: { message: string }[] }>
      }
      return (await bridge.getBrowserState()).logs.map(({ message }) => message)
    })).toContain('ASTER_BROWSER_LOG')
    await expect(browser).toContainText('ASTER_BROWSER_LOG')
    await window.evaluate(async ({ url }) => {
      const bridge = Reflect.get(window, 'aster') as { navigateBrowser: (input: { url: string }) => Promise<unknown> }
      await bridge.navigateBrowser({ url: `${url}next` })
    }, { url: previewUrl })
    await expect.poll(async () => window.evaluate(async () => {
      const bridge = Reflect.get(window, 'aster') as { getBrowserState: () => Promise<{ title: string | null }> }
      return (await bridge.getBrowserState()).title
    })).toBe('Aster Browser Next')
    await browser.getByRole('button', { name: '后退' }).click()
    await expect.poll(async () => window.evaluate(async () => {
      const bridge = Reflect.get(window, 'aster') as { getBrowserState: () => Promise<{ title: string | null }> }
      return (await bridge.getBrowserState()).title
    })).toBe('Aster Browser Proof')
    const publicNavigation = await window.evaluate(async () => {
      const bridge = Reflect.get(window, 'aster') as { navigateBrowser: (input: { url: string }) => Promise<unknown> }
      try { await bridge.navigateBrowser({ url: 'https://example.com/' }); return 'unexpected-success' }
      catch (error) { return error instanceof Error ? error.message : String(error) }
    })
    expect(publicNavigation).toContain('localhost')
    await window.screenshot({ path: 'test-results/aster-browser.png' })
    await browser.getByRole('button', { name: '关闭网页预览' }).click()
    await expect.poll(async () => window.evaluate(async () => {
      const bridge = Reflect.get(window, 'aster') as { getBrowserState: () => Promise<{ open: boolean }> }
      return (await bridge.getBrowserState()).open
    })).toBe(false)

    await window.getByRole('button', { name: 'Git 状态' }).click()
    await expect(window.getByLabel('Git 工作区')).toBeVisible()
    await window.getByRole('button', { name: '刷新', exact: true }).click()
    await expect(window.getByRole('button', { name: '暂存 aster-approval-proof.txt' })).toBeVisible()
    await window.getByRole('button', { name: '审阅未暂存' }).click()
    await expect(window.getByLabel('代码差异')).toContainText('aster-approval-proof.txt')
    await expect(window.getByLabel('代码差异')).toContainText('ASTER_APPROVAL_OK')
    await window.getByRole('button', { name: '分栏', exact: true }).click()
    const approvalDiff = window.locator('.diff-file').filter({ hasText: 'aster-approval-proof.txt' })
    await expect(approvalDiff.locator('.diff-split')).toBeVisible()
    await window.screenshot({ path: 'test-results/aster-diff-split.png' })
    await approvalDiff.locator('.diff-split-cell').filter({ hasText: 'ASTER_APPROVAL_OK' }).click()
    const reviewComment = approvalDiff.getByLabel(/评论 aster-approval-proof\.txt/)
    await expect(reviewComment).toBeVisible()
    await reviewComment.fill('无需修改；请只回复 ASTER_REVIEW_OK。')
    await approvalDiff.getByRole('button', { name: '追加给智能体', exact: true }).click()
    await expect(approvalDiff).toContainText('已追加到当前任务。')
    await expect(window.locator('.activity-card.agentMessage').filter({ hasText: 'ASTER_REVIEW_OK' })).toBeVisible({ timeout: 90_000 })
    await expect(window.locator('.running-row')).toHaveCount(0, { timeout: 30_000 })
    await approvalDiff.getByRole('button', { name: '暂存区块', exact: true }).click()
    await window.getByRole('button', { name: '← 返回状态' }).click()
    if (deepSeekConfigured) {
      await window.getByRole('button', { name: '暂存 aster-deepseek-proof.txt' }).click()
    }
    await window.getByLabel('提交说明').fill('test: approval proof')
    await window.getByRole('button', { name: '提交', exact: true }).click()
    await expect(window.getByLabel('Git 工作区')).toContainText('工作区干净')
    await window.getByRole('button', { name: '关闭 Git' }).click()

    await window.getByRole('button', { name: 'Local', exact: true }).click()
    await expect(window.getByRole('complementary', { name: '工作树' })).toBeVisible()
    await window.getByRole('button', { name: '创建', exact: true }).click()
    await expect(window.getByRole('button', { name: /Detached/ })).toBeVisible()
    await window.getByRole('button', { name: '锁定', exact: true }).click()
    await expect(window.getByRole('button', { name: '解锁', exact: true })).toBeVisible()
    await window.getByRole('button', { name: '解锁', exact: true }).click()
    window.once('dialog', async (dialog) => { await dialog.accept() })
    await window.getByRole('button', { name: /Detached/ }).click()
    await expect(window.getByRole('button', { name: 'Worktree', exact: true })).toBeVisible()

    await window.getByRole('button', { name: /新任务/ }).click()
    await window.getByLabel('任务输入').fill('Run the shell command sleep 8, then reply with FIRST. Do not perform any other action.')
    await window.getByRole('button', { name: '发送任务' }).click()
    await expect(window.locator('.activity-card.command')).toBeVisible({ timeout: 90_000 })
    await window.getByLabel('任务输入').fill('After the sleep, reply with exactly ASTER_STEER_OK instead.')
    await window.getByLabel('任务输入').press('Enter')
    await expect(window.locator('.activity-card.agentMessage').filter({ hasText: 'ASTER_STEER_OK' })).toBeVisible({ timeout: 90_000 })
    await expect(window.locator('.running-row')).toHaveCount(0, { timeout: 30_000 })

    await window.getByRole('button', { name: /新任务/ }).click()
    await window.getByLabel('任务输入').fill('Run the shell command sleep 20, then reply INTERRUPT_FAILED.')
    await window.getByRole('button', { name: '发送任务' }).click()
    await expect(window.locator('.activity-card.command')).toBeVisible({ timeout: 90_000 })
    await window.getByRole('button', { name: '停止任务' }).click()
    await expect(window.locator('.running-row')).toHaveCount(0, { timeout: 30_000 })
    await expect(window.locator('.activity-card.agentMessage')).not.toContainText('INTERRUPT_FAILED')
    await window.getByRole('button', { name: 'Worktree', exact: true }).click()
    window.once('dialog', async (dialog) => { await dialog.accept() })
    await window.getByRole('button', { name: '移除', exact: true }).click()
    await expect(window.getByRole('button', { name: 'Local', exact: true })).toBeVisible()
    await window.screenshot({ path: 'test-results/aster-shell.png' })

    const originalTheme = await window.locator('html').getAttribute('data-theme')
    await window.getByRole('button', { name: '切换主题' }).click()
    await expect(window.locator('html')).not.toHaveAttribute('data-theme', originalTheme ?? '')

    await window.setViewportSize({ width: 960, height: 640 })
    await expect(window.getByLabel('任务输入')).toBeVisible()
    await expect(window.locator('.activity-timeline')).toBeVisible()
    await window.getByRole('button', { name: '折叠侧栏' }).click()
    await expect(window.locator('.app-shell')).toHaveClass(/sidebar-collapsed/u)
    await expect(window.getByRole('button', { name: '展开侧栏' })).toBeVisible()
    await window.screenshot({ path: 'test-results/aster-shell-compact.png' })
    await window.getByRole('button', { name: '展开侧栏' }).click()
    const persistedTheme = await window.evaluate(() => window.localStorage.getItem('aster-theme'))
    await window.reload()
    await expect(window).toHaveTitle('Aster Code')
    await expect(window.locator('html')).toHaveAttribute('data-theme', persistedTheme === 'dark' ? 'dark' : 'light')
  } finally {
    await application.close()
    await new Promise<void>((resolve) => previewServer.close(() => resolve()))
    const persisted = new StateDatabase(join(profile, 'aster-code.sqlite3'))
    const windowState = persisted.getAppSetting('window.state') as { width?: number; height?: number } | null
    expect(windowState?.width).toBeGreaterThanOrEqual(960)
    expect(windowState?.height).toBeGreaterThanOrEqual(640)
    persisted.close()
    rmSync(profile, { force: true, recursive: true })
  }
})
