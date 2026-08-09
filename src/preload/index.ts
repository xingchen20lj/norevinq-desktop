import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type AsterDesktopApi, type RemoveProjectInput } from '../shared/contracts.js'
import type { CodexRuntimeSnapshot, RuntimeSubscription } from '../shared/runtime.js'

const api: AsterDesktopApi = {
  getBootstrapState: () => ipcRenderer.invoke(IPC_CHANNELS.bootstrap),
  selectProject: () => ipcRenderer.invoke(IPC_CHANNELS.selectProject),
  removeProject: (input: RemoveProjectInput) => ipcRenderer.invoke(IPC_CHANNELS.removeProject, input),
  getRuntimeStatus: () => ipcRenderer.invoke(IPC_CHANNELS.runtimeStatus),
  restartRuntime: () => ipcRenderer.invoke(IPC_CHANNELS.runtimeRestart),
  onRuntimeStatus: (subscription: RuntimeSubscription) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: CodexRuntimeSnapshot): void => subscription(snapshot)
    ipcRenderer.on(IPC_CHANNELS.runtimeStatusChanged, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.runtimeStatusChanged, listener)
  },
}

contextBridge.exposeInMainWorld('aster', Object.freeze(api))
