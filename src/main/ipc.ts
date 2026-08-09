import { app, dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { IPC_CHANNELS, type BootstrapState } from '../shared/contracts.js'
import type { StateDatabase } from './state/database.js'

const removeProjectSchema = z.object({
  projectId: z.uuid(),
})

export function registerIpc(database: StateDatabase): () => void {
  ipcMain.handle(IPC_CHANNELS.bootstrap, (): BootstrapState => ({
    appVersion: app.getVersion(),
    platform: process.platform,
    projects: database.listProjects(),
  }))

  ipcMain.handle(IPC_CHANNELS.selectProject, async () => {
    const result = await dialog.showOpenDialog({
      title: '打开项目',
      buttonLabel: '打开项目',
      properties: ['openDirectory', 'createDirectory'],
    })
    const selectedPath = result.filePaths[0]
    if (result.canceled || selectedPath === undefined) return null
    return database.upsertProject(selectedPath)
  })

  ipcMain.handle(IPC_CHANNELS.removeProject, (_event, input: unknown) => {
    const parsed = removeProjectSchema.parse(input)
    database.removeProject(parsed.projectId)
  })

  return () => {
    for (const channel of Object.values(IPC_CHANNELS)) ipcMain.removeHandler(channel)
  }
}
