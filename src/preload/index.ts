import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type AsterDesktopApi, type RemoveProjectInput } from '../shared/contracts.js'

const api: AsterDesktopApi = {
  getBootstrapState: () => ipcRenderer.invoke(IPC_CHANNELS.bootstrap),
  selectProject: () => ipcRenderer.invoke(IPC_CHANNELS.selectProject),
  removeProject: (input: RemoveProjectInput) => ipcRenderer.invoke(IPC_CHANNELS.removeProject, input),
}

contextBridge.exposeInMainWorld('aster', Object.freeze(api))
