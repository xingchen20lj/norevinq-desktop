export const IPC_CHANNELS = {
  bootstrap: 'app:bootstrap',
  selectProject: 'project:select',
  removeProject: 'project:remove',
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
}

export type RemoveProjectInput = {
  projectId: string
}

export type AsterDesktopApi = {
  getBootstrapState: () => Promise<BootstrapState>
  selectProject: () => Promise<ProjectSummary | null>
  removeProject: (input: RemoveProjectInput) => Promise<void>
}
