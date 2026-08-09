import type { CodexRuntimeSnapshot, RuntimeSubscription } from './runtime.js'

export const IPC_CHANNELS = {
  bootstrap: 'app:bootstrap',
  selectProject: 'project:select',
  removeProject: 'project:remove',
  runtimeStatus: 'runtime:status',
  runtimeRestart: 'runtime:restart',
  runtimeStatusChanged: 'runtime:status-changed',
} as const

export type ProjectSummary = {
  id: string
  name: string
  path: string
  trusted: boolean
  lastOpenedAt: string
}

export type BootstrapState = {
  appVersion: string
  platform: string
  projects: ProjectSummary[]
  runtime: CodexRuntimeSnapshot
}

export type RemoveProjectInput = {
  projectId: string
}

export type AsterDesktopApi = {
  getBootstrapState: () => Promise<BootstrapState>
  selectProject: () => Promise<ProjectSummary | null>
  removeProject: (input: RemoveProjectInput) => Promise<void>
  getRuntimeStatus: () => Promise<CodexRuntimeSnapshot>
  restartRuntime: () => Promise<CodexRuntimeSnapshot>
  onRuntimeStatus: (subscription: RuntimeSubscription) => () => void
}
