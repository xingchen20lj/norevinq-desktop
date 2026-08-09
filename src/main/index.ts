import { join } from 'node:path'
import { app, BrowserWindow, safeStorage, shell } from 'electron'
import { registerIpc } from './ipc.js'
import { createLogger, type JsonlLogger } from './logging/logger.js'
import { SizeLimitedRotation } from './logging/sizeRotation.js'
import { CodexRuntimeSupervisor } from './runtime/codexRuntime.js'
import { StateDatabase } from './state/database.js'
import { AgentService } from './agent/agentService.js'
import {
  DEEPSEEK_CODEX_CONFIG_OVERRIDES,
  DEEPSEEK_CODEX_MODELS,
  DEEPSEEK_ENV_KEY,
  getDeepSeekEnvironmentValue,
} from './providers/deepseek.js'
import { ProviderService } from './providers/providerService.js'
import { CredentialStore } from './security/credentialStore.js'
import { GitService } from './git/gitService.js'
import { WorktreeService } from './worktree/worktreeService.js'
import { DiffService } from './git/diffService.js'
import { TerminalService } from './terminal/terminalService.js'
import { IntegrationService } from './integrations/integrationService.js'
import { SecurityService } from './security/securityService.js'
import { SchedulerService } from './scheduler/schedulerService.js'
import type { ScheduledTask } from '../shared/scheduler.js'
import type { ConversationSnapshot } from '../shared/conversation.js'

const isDevelopment = !app.isPackaged
let mainWindow: BrowserWindow | null = null
let database: StateDatabase | null = null
let unregisterIpc: (() => void) | null = null
let runtime: CodexRuntimeSupervisor | null = null
let runtimeLogger: JsonlLogger | null = null
let agentService: AgentService | null = null
let providerService: ProviderService | null = null
let gitService: GitService | null = null
let worktreeService: WorktreeService | null = null
let diffService: DiffService | null = null
let terminalService: TerminalService | null = null
let integrationService: IntegrationService | null = null
let securityService: SecurityService | null = null
let schedulerService: SchedulerService | null = null

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const currentUrl = window.webContents.getURL()
    if (url !== currentUrl) event.preventDefault()
  })
  window.once('ready-to-show', () => window.show())

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (isDevelopment && rendererUrl) void window.loadURL(rendererUrl)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))

  return window
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(() => {
    const userData = app.getPath('userData')
    database = new StateDatabase(join(userData, 'aster-code.sqlite3'))
    const credentialStore = new CredentialStore(join(userData, 'credentials.json'), {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (value) => safeStorage.encryptString(value),
      decryptString: (value) => safeStorage.decryptString(value),
    })
    runtimeLogger = createLogger({
      component: 'codex-runtime',
      filePath: join(userData, 'logs', 'runtime.jsonl'),
      rotation: new SizeLimitedRotation(),
    })
    const environmentDeepSeekKey = getDeepSeekEnvironmentValue(process.env)
    const vaultDeepSeekKey = readStoredDeepSeekKey(credentialStore)
    const deepSeekKey = environmentDeepSeekKey ?? vaultDeepSeekKey
    runtime = new CodexRuntimeSupervisor({
      logger: runtimeLogger,
      ...(deepSeekKey ? {
        childEnvironment: { [DEEPSEEK_ENV_KEY]: deepSeekKey },
        configOverrides: DEEPSEEK_CODEX_CONFIG_OVERRIDES,
        extraModels: DEEPSEEK_CODEX_MODELS,
      } : {}),
    })
    providerService = new ProviderService(runtime, credentialStore, environmentDeepSeekKey)
    gitService = new GitService(database)
    const createdWorktreeService = new WorktreeService(database, join(userData, 'worktrees'))
    worktreeService = createdWorktreeService
    diffService = new DiffService(database, gitService)
    terminalService = new TerminalService(runtime, database)
    const createdAgentService = new AgentService(runtime, database)
    agentService = createdAgentService
    integrationService = new IntegrationService(runtime, database)
    securityService = new SecurityService(database, join(userData, 'security'))
    schedulerService = new SchedulerService(database, (task, projectId, signal) =>
      executeScheduledTask(createdAgentService, createdWorktreeService, task, projectId, signal))
    unregisterIpc = registerIpc(
      database,
      runtime,
      agentService,
      providerService,
      gitService,
      worktreeService,
      diffService,
      terminalService,
      integrationService,
      securityService,
      schedulerService,
    )
    mainWindow = createMainWindow()
    void runtime.start().then(() => schedulerService?.start())

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  schedulerService?.stop()
  schedulerService = null
  unregisterIpc?.()
  unregisterIpc = null
  agentService?.dispose()
  agentService = null
  providerService = null
  gitService = null
  worktreeService = null
  diffService = null
  terminalService?.dispose()
  terminalService = null
  integrationService?.dispose()
  integrationService = null
  void securityService?.dispose()
  securityService = null
  void runtime?.stop()
  runtime = null
  void runtimeLogger?.close()
  runtimeLogger = null
  database?.close()
  database = null
})

function readStoredDeepSeekKey(credentials: CredentialStore): string | null {
  try {
    return credentials.get('provider.deepseek.api-key')
  } catch {
    return null
  }
}

async function executeScheduledTask(
  agent: AgentService,
  worktrees: WorktreeService,
  task: ScheduledTask,
  projectId: string,
  signal: AbortSignal,
): Promise<{ threadId: string; worktreeId?: string; summary: string }> {
  const worktree = task.executionTarget === 'worktree'
    ? await worktrees.create({ projectId, copyIncludes: true })
    : null
  if (signal.aborted) throw signal.reason
  const existingThreadId = task.conversationMode === 'continue' ? task.threadIds[projectId] : undefined
  const started = await agent.startScheduledConversation({
    projectId,
    ...(worktree ? { worktreeId: worktree.id } : {}),
    text: task.prompt,
    ...(task.model ? { model: task.model } : {}),
    ...(task.model?.startsWith('deepseek-') ? { modelProvider: 'deepseek' } : {}),
    ...(task.reasoningEffort ? { reasoningEffort: task.reasoningEffort } : {}),
    approvalPolicy: 'never',
    sandbox: task.sandbox,
  }, existingThreadId)
  const summary = await waitForScheduledTurn(agent, started.threadId, started.turnId, signal)
  return {
    threadId: started.threadId,
    ...(worktree ? { worktreeId: worktree.id } : {}),
    summary,
  }
}

function waitForScheduledTurn(
  agent: AgentService,
  threadId: string,
  turnId: string | null,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => finish(new Error('计划任务超过 6 小时运行上限。')), 6 * 60 * 60 * 1_000)
    let unsubscribe = (): void => undefined
    const subscribed = agent.subscribe((snapshot) => inspect(snapshot))
    installSubscription(subscribed)
    const abort = (): void => {
      if (settled) return
      const state = agent.getSnapshot().threadStates[threadId]
      const activeTurnId = state?.turnId ?? turnId
      if (activeTurnId) void agent.interruptTurn({ threadId, turnId: activeTurnId }).catch(() => undefined)
      else finish(signal.reason instanceof Error ? signal.reason : new Error('计划任务已取消。'))
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()

    function inspect(snapshot: ConversationSnapshot): void {
      const state = snapshot.threadStates[threadId]
      if (!state || (turnId && state.turnId !== turnId)) return
      if (state.turnStatus === 'inProgress' || state.turnStatus === 'idle' || state.turnStatus === 'unknown') return
      if (state.turnStatus === 'completed') {
        const message = [...state.activities].reverse().find((activity) => activity.type === 'agentMessage')
        finish(null, message?.type === 'agentMessage' ? message.text : '计划任务已完成。')
      } else {
        finish(new Error(state.lastError?.message ?? `计划任务以 ${state.turnStatus} 结束。`))
      }
    }

    function finish(error: Error | null, summary = ''): void {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      unsubscribe()
      if (error) reject(error)
      else resolve(summary)
    }

    function installSubscription(dispose: () => void): void {
      unsubscribe = dispose
      if (settled) unsubscribe()
    }
  })
}
