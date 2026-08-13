import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, protocol, safeStorage, screen, shell } from 'electron'
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
import { GitHubService } from './git/githubService.js'
import { WorktreeService } from './worktree/worktreeService.js'
import { DiffService } from './git/diffService.js'
import { TerminalService } from './terminal/terminalService.js'
import { IntegrationService } from './integrations/integrationService.js'
import { SecurityService } from './security/securityService.js'
import { SchedulerService } from './scheduler/schedulerService.js'
import type { ScheduledTask } from '../shared/scheduler.js'
import type { ConversationSnapshot } from '../shared/conversation.js'
import { FileService } from './files/fileService.js'
import { serveFilePreview } from './files/fileProtocol.js'
import { BrowserService } from './browser/browserService.js'
import { extractAsterDeepLinks, parseAsterDeepLink } from './app/deepLinks.js'
import { IPC_CHANNELS } from '../shared/contracts.js'
import { UpdateService } from './update/updateService.js'
import { createElectronUpdateDriver } from './update/electronUpdateDriver.js'
import { DiagnosticsService } from './diagnostics/diagnosticsService.js'
import { AccountService } from './account/accountService.js'
import { prepareAsterCodexHome } from './runtime/codexHome.js'

protocol.registerSchemesAsPrivileged([{
  scheme: 'aster-file',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}])

const isDevelopment = !app.isPackaged
let mainWindow: BrowserWindow | null = null
let database: StateDatabase | null = null
let unregisterIpc: (() => void) | null = null
let runtime: CodexRuntimeSupervisor | null = null
let runtimeLogger: JsonlLogger | null = null
let agentService: AgentService | null = null
let providerService: ProviderService | null = null
let accountService: AccountService | null = null
let gitService: GitService | null = null
let githubService: GitHubService | null = null
let worktreeService: WorktreeService | null = null
let diffService: DiffService | null = null
let terminalService: TerminalService | null = null
let integrationService: IntegrationService | null = null
let securityService: SecurityService | null = null
let schedulerService: SchedulerService | null = null
let fileService: FileService | null = null
let browserService: BrowserService | null = null
let updateService: UpdateService | null = null
let diagnosticsService: DiagnosticsService | null = null
let rendererReady = false
const pendingDeepLinks = extractAsterDeepLinks(process.argv)

process.on('uncaughtExceptionMonitor', (error, origin) => {
  recordCrashSafely({
    process: 'main',
    reason: origin,
    message: `${error.name}: ${error.message}`,
  })
})

app.on('render-process-gone', (_event, _contents, details) => {
  if (details.reason === 'clean-exit') return
  recordCrashSafely({
    process: 'renderer',
    reason: details.reason,
    exitCode: details.exitCode,
  })
})

app.on('child-process-gone', (_event, details) => {
  if (details.reason === 'clean-exit') return
  recordCrashSafely({
    process: 'utility',
    reason: details.reason,
    exitCode: details.exitCode,
    processType: details.type,
  })
})

function recordCrashSafely(input: Parameters<DiagnosticsService['recordCrash']>[0]): void {
  try {
    diagnosticsService?.recordCrash(input)
  } catch {
    // Crash telemetry is local best-effort and must never create a second failure.
  }
}

type PersistedWindowState = {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
  fullScreen: boolean
}

function createMainWindow(): BrowserWindow {
  const stored = database?.getAppSetting('window.state') ?? null
  const restored = validWindowState(stored) ? stored : null
  const restoredBounds = restored && windowIntersectsDisplay(restored)
    ? { x: restored.x, y: restored.y, width: restored.width, height: restored.height }
    : null
  const window = new BrowserWindow({
    width: restoredBounds?.width ?? 1320,
    height: restoredBounds?.height ?? 840,
    ...(restoredBounds ? { x: restoredBounds.x, y: restoredBounds.y } : {}),
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
  window.once('ready-to-show', () => {
    if (restored?.maximized) window.maximize()
    if (restored?.fullScreen) window.setFullScreen(true)
    window.show()
  })
  window.webContents.on('did-finish-load', () => {
    rendererReady = true
    flushDeepLinks()
  })
  window.on('closed', () => { rendererReady = false })
  window.on('close', () => {
    const bounds = window.getNormalBounds()
    database?.setAppSetting('window.state', {
      ...bounds,
      maximized: window.isMaximized(),
      fullScreen: window.isFullScreen(),
    } satisfies PersistedWindowState)
    browserService?.close()
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (isDevelopment && rendererUrl) void window.loadURL(rendererUrl)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))

  return window
}

function validWindowState(value: unknown): value is PersistedWindowState {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<PersistedWindowState>
  return [record.x, record.y, record.width, record.height].every((item) => typeof item === 'number' && Number.isFinite(item))
    && typeof record.width === 'number' && record.width >= 960 && record.width <= 10_000
    && typeof record.height === 'number' && record.height >= 640 && record.height <= 10_000
    && typeof record.maximized === 'boolean' && typeof record.fullScreen === 'boolean'
}

function windowIntersectsDisplay(value: PersistedWindowState): boolean {
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapWidth = Math.min(value.x + value.width, workArea.x + workArea.width) - Math.max(value.x, workArea.x)
    const overlapHeight = Math.min(value.y + value.height, workArea.y + workArea.height) - Math.max(value.y, workArea.y)
    return overlapWidth >= 100 && overlapHeight >= 100
  })
}

const gotLock = app.requestSingleInstanceLock()
if (app.isPackaged) app.setAsDefaultProtocolClient('aster-code')
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    for (const url of extractAsterDeepLinks(commandLine)) routeDeepLink(url)
  })

  void app.whenReady().then(() => {
    const userData = app.getPath('userData')
    const codexHome = prepareAsterCodexHome(userData, process.env.ASTER_CODEX_HOME)
    process.env.CODEX_HOME = codexHome
    database = new StateDatabase(join(userData, 'aster-code.sqlite3'))
    const createdFileService = new FileService(database, { openPath: (path) => shell.openPath(path) })
    fileService = createdFileService
    protocol.handle('aster-file', (request) => serveFilePreview(request, createdFileService))
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
    diagnosticsService = new DiagnosticsService({
      appVersion: app.getVersion(),
      arch: process.arch,
      crashFilePath: join(userData, 'diagnostics', 'crashes.jsonl'),
      isPackaged: app.isPackaged,
      platform: process.platform,
      redactionRoots: [userData, app.getAppPath(), app.getPath('home'), app.getPath('temp')],
      runtimeLogPath: join(userData, 'logs', 'runtime.jsonl'),
      versions: process.versions,
    })
    const environmentDeepSeekKey = getDeepSeekEnvironmentValue(process.env)
    const vaultDeepSeekKey = readStoredDeepSeekKey(credentialStore)
    const deepSeekKey = environmentDeepSeekKey ?? vaultDeepSeekKey
    runtime = new CodexRuntimeSupervisor({
      logger: runtimeLogger,
      fixedChildEnvironment: { CODEX_HOME: codexHome },
      ...(deepSeekKey ? {
        childEnvironment: { [DEEPSEEK_ENV_KEY]: deepSeekKey },
        configOverrides: DEEPSEEK_CODEX_CONFIG_OVERRIDES,
        extraModels: DEEPSEEK_CODEX_MODELS,
      } : {}),
    })
    providerService = new ProviderService(runtime, credentialStore, environmentDeepSeekKey)
    accountService = new AccountService(runtime, { openExternal: (url) => shell.openExternal(url) })
    gitService = new GitService(database)
    githubService = new GitHubService(database, gitService)
    const createdWorktreeService = new WorktreeService(database, join(userData, 'worktrees'))
    worktreeService = createdWorktreeService
    diffService = new DiffService(database, gitService)
    terminalService = new TerminalService(runtime, database)
    const createdAgentService = new AgentService(runtime, database, {
      moveWorktreeChanges: (input) => createdWorktreeService.moveChanges(input),
    })
    agentService = createdAgentService
    integrationService = new IntegrationService(runtime, database)
    securityService = new SecurityService(database, join(userData, 'security'))
    schedulerService = new SchedulerService(database, (task, projectId, signal) =>
      executeScheduledTask(createdAgentService, createdWorktreeService, task, projectId, signal))
    browserService = new BrowserService(() => mainWindow, (url) => shell.openExternal(url))
    const updateConfigured = app.isPackaged && hasPackagedUpdateConfiguration(process.resourcesPath)
    updateService = new UpdateService({
      configured: updateConfigured,
      currentVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      platform: process.platform,
      ...(updateConfigured ? { driver: createElectronUpdateDriver() } : {}),
    })
    unregisterIpc = registerIpc(
      database,
      runtime,
      agentService,
      providerService,
      accountService,
      gitService,
      githubService,
      worktreeService,
      diffService,
      terminalService,
      integrationService,
      securityService,
      schedulerService,
      createdFileService,
      browserService,
      updateService,
      diagnosticsService,
      (event) => {
        const window = mainWindow
        return window !== null
          && !window.isDestroyed()
          && event.sender === window.webContents
          && event.senderFrame === window.webContents.mainFrame
      },
    )
    mainWindow = createMainWindow()
    updateService.startAutomaticChecks()
    void runtime.start().then(() => schedulerService?.start())

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
    })
  })
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  routeDeepLink(url)
})

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
  accountService?.dispose()
  accountService = null
  gitService = null
  githubService = null
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
  browserService?.dispose()
  browserService = null
  updateService?.dispose()
  updateService = null
  diagnosticsService = null
  fileService?.clear()
  fileService = null
})

app.on('will-quit', () => {
  database?.close()
  database = null
})

function hasPackagedUpdateConfiguration(resourcesPath: string): boolean {
  try {
    const metadata = lstatSync(join(resourcesPath, 'app-update.yml'))
    return metadata.isFile() && !metadata.isSymbolicLink() && metadata.size > 0 && metadata.size <= 64 * 1024
  } catch {
    return false
  }
}

function readStoredDeepSeekKey(credentials: CredentialStore): string | null {
  try {
    return credentials.get('provider.deepseek.api-key')
  } catch {
    return null
  }
}

function routeDeepLink(url: string): void {
  if (!url.toLowerCase().startsWith('aster-code:')) return
  if (!database || !mainWindow || !rendererReady) {
    if (pendingDeepLinks.length < 8 && !pendingDeepLinks.includes(url)) pendingDeepLinks.push(url)
    return
  }
  const target = parseAsterDeepLink(url, database)
  if (target) mainWindow.webContents.send(IPC_CHANNELS.deepLinkOpened, target)
}

function flushDeepLinks(): void {
  for (const url of pendingDeepLinks.splice(0)) routeDeepLink(url)
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
