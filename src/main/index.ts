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

const isDevelopment = !app.isPackaged
let mainWindow: BrowserWindow | null = null
let database: StateDatabase | null = null
let unregisterIpc: (() => void) | null = null
let runtime: CodexRuntimeSupervisor | null = null
let runtimeLogger: JsonlLogger | null = null
let agentService: AgentService | null = null
let providerService: ProviderService | null = null

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
    agentService = new AgentService(runtime, database)
    unregisterIpc = registerIpc(database, runtime, agentService, providerService)
    mainWindow = createMainWindow()
    void runtime.start()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  unregisterIpc?.()
  unregisterIpc = null
  database?.close()
  database = null
  agentService?.dispose()
  agentService = null
  providerService = null
  void runtime?.stop()
  runtime = null
  void runtimeLogger?.close()
  runtimeLogger = null
})

function readStoredDeepSeekKey(credentials: CredentialStore): string | null {
  try {
    return credentials.get('provider.deepseek.api-key')
  } catch {
    return null
  }
}
