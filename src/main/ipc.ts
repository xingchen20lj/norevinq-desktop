import { app, dialog, ipcMain, type WebContents } from 'electron'
import { z } from 'zod'
import { IPC_CHANNELS, type BootstrapState } from '../shared/contracts.js'
import type {
  ConversationSnapshot,
  ConversationSubscription,
  InterruptTurnInput,
  ResolveApprovalInput,
  StartConversationInput,
  StartTurnInput,
  SteerTurnInput,
} from '../shared/conversation.js'
import type { CodexRuntimeSnapshot, RuntimeSubscription } from '../shared/runtime.js'
import type { StateDatabase } from './state/database.js'
import type { ProviderStatus, SaveDeepSeekCredentialInput } from '../shared/providers.js'
import type { GitRepositorySnapshot } from '../shared/git.js'

const removeProjectSchema = z.object({
  projectId: z.uuid(),
})

export type RuntimeController = {
  getSnapshot: () => CodexRuntimeSnapshot
  restart: () => Promise<CodexRuntimeSnapshot>
  subscribe: (subscription: RuntimeSubscription) => () => void
}

export type AgentController = {
  subscribe: (subscription: ConversationSubscription) => () => void
  loadProject: (projectId: string) => Promise<ConversationSnapshot>
  selectThread: (threadId: string) => Promise<ConversationSnapshot>
  startConversation: (input: StartConversationInput) => Promise<ConversationSnapshot>
  startTurn: (input: StartTurnInput) => Promise<ConversationSnapshot>
  steerTurn: (input: SteerTurnInput) => Promise<ConversationSnapshot>
  interruptTurn: (input: InterruptTurnInput) => Promise<ConversationSnapshot>
  resolveApproval: (input: ResolveApprovalInput) => ConversationSnapshot
}

export type ProviderController = {
  getStatus: () => ProviderStatus
  saveDeepSeekCredential: (apiKey: string) => Promise<unknown>
  deleteDeepSeekCredential: () => Promise<unknown>
}

export type GitController = {
  getStatus: (input: { projectId: string }) => Promise<GitRepositorySnapshot>
  initialize: (input: { projectId: string }) => Promise<GitRepositorySnapshot>
  stage: (input: { projectId: string; paths: string[] }) => Promise<GitRepositorySnapshot>
  unstage: (input: { projectId: string; paths: string[] }) => Promise<GitRepositorySnapshot>
  commit: (input: { projectId: string; message: string }) => Promise<GitRepositorySnapshot>
  push: (input: { projectId: string; remote?: string; branch?: string; setUpstream?: boolean }) => Promise<GitRepositorySnapshot>
}

export function registerIpc(
  database: StateDatabase,
  runtime: RuntimeController,
  agent: AgentController,
  providers: ProviderController,
  git: GitController,
): () => void {
  const webContents = new Set<WebContents>()
  const unsubscribeRuntime = runtime.subscribe((snapshot) => {
    for (const contents of webContents) {
      if (!contents.isDestroyed()) contents.send(IPC_CHANNELS.runtimeStatusChanged, snapshot)
    }
  })
  const unsubscribeAgent = agent.subscribe((snapshot) => {
    for (const contents of webContents) {
      if (!contents.isDestroyed()) contents.send(IPC_CHANNELS.conversationChanged, snapshot)
    }
  })

  ipcMain.handle(IPC_CHANNELS.bootstrap, (): BootstrapState => ({
    appVersion: app.getVersion(),
    platform: process.platform,
    projects: database.listProjects(),
    runtime: runtime.getSnapshot(),
    providers: providers.getStatus(),
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

  ipcMain.handle(IPC_CHANNELS.runtimeStatus, (event) => {
    webContents.add(event.sender)
    event.sender.once('destroyed', () => webContents.delete(event.sender))
    return runtime.getSnapshot()
  })

  ipcMain.handle(IPC_CHANNELS.runtimeRestart, () => runtime.restart())

  ipcMain.handle(IPC_CHANNELS.conversationsLoad, (_event, input: unknown) => {
    const parsed = projectInputSchema.parse(input)
    return agent.loadProject(parsed.projectId)
  })
  ipcMain.handle(IPC_CHANNELS.conversationSelect, (_event, input: unknown) => {
    const parsed = threadInputSchema.parse(input)
    return agent.selectThread(parsed.threadId)
  })
  ipcMain.handle(IPC_CHANNELS.conversationStart, (_event, input: unknown) =>
    agent.startConversation(startConversationSchema.parse(input) as StartConversationInput))
  ipcMain.handle(IPC_CHANNELS.conversationTurnStart, (_event, input: unknown) =>
    agent.startTurn(startTurnSchema.parse(input) as StartTurnInput))
  ipcMain.handle(IPC_CHANNELS.conversationSteer, (_event, input: unknown) =>
    agent.steerTurn(steerTurnSchema.parse(input)))
  ipcMain.handle(IPC_CHANNELS.conversationInterrupt, (_event, input: unknown) =>
    agent.interruptTurn(interruptTurnSchema.parse(input)))
  ipcMain.handle(IPC_CHANNELS.conversationApprovalResolve, (_event, input: unknown) =>
    agent.resolveApproval(resolveApprovalSchema.parse(input)))
  ipcMain.handle(IPC_CHANNELS.providerDeepSeekSave, (_event, input: unknown) => {
    const parsed: SaveDeepSeekCredentialInput = saveDeepSeekCredentialSchema.parse(input)
    return providers.saveDeepSeekCredential(parsed.apiKey)
  })
  ipcMain.handle(IPC_CHANNELS.providerDeepSeekDelete, () => providers.deleteDeepSeekCredential())
  ipcMain.handle(IPC_CHANNELS.gitStatus, (_event, input: unknown) => git.getStatus(projectInputSchema.parse(input)))
  ipcMain.handle(IPC_CHANNELS.gitInitialize, (_event, input: unknown) => git.initialize(projectInputSchema.parse(input)))
  ipcMain.handle(IPC_CHANNELS.gitStage, (_event, input: unknown) => git.stage(gitPathsSchema.parse(input)))
  ipcMain.handle(IPC_CHANNELS.gitUnstage, (_event, input: unknown) => git.unstage(gitPathsSchema.parse(input)))
  ipcMain.handle(IPC_CHANNELS.gitCommit, (_event, input: unknown) => git.commit(gitCommitSchema.parse(input)))
  ipcMain.handle(IPC_CHANNELS.gitPush, (_event, input: unknown) => git.push(gitPushSchema.parse(input) as {
    projectId: string
    remote?: string
    branch?: string
    setUpstream?: boolean
  }))

  return () => {
    unsubscribeRuntime()
    unsubscribeAgent()
    webContents.clear()
    for (const channel of Object.values(IPC_CHANNELS)) ipcMain.removeHandler(channel)
  }
}

const projectInputSchema = z.object({ projectId: z.uuid() })
const threadInputSchema = z.object({ threadId: z.string().min(1).max(200) })
const promptSchema = z.string().trim().min(1).max(100_000)
const startConversationSchema = z.object({
  projectId: z.uuid(),
  text: promptSchema,
  model: z.string().min(1).max(200).optional(),
  modelProvider: z.string().min(1).max(200).optional(),
  reasoningEffort: z.string().min(1).max(40).optional(),
  approvalPolicy: z.enum(['untrusted', 'on-request', 'never']).optional(),
  sandbox: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
})
const startTurnSchema = z.object({
  threadId: z.string().min(1).max(200),
  text: promptSchema,
  reasoningEffort: z.string().min(1).max(40).optional(),
})
const steerTurnSchema = z.object({
  threadId: z.string().min(1).max(200),
  turnId: z.string().min(1).max(200),
  text: promptSchema,
})
const interruptTurnSchema = z.object({
  threadId: z.string().min(1).max(200),
  turnId: z.string().min(1).max(200),
})
const resolveApprovalSchema = z.object({
  requestId: z.string().min(1).max(200),
  decision: z.enum(['accept', 'acceptForSession', 'decline', 'cancel']),
})
const saveDeepSeekCredentialSchema = z.object({ apiKey: z.string().trim().min(16).max(512) })
const gitPathSchema = z.string().min(1).max(4_096).refine((value) => !value.includes('\0'))
const gitPathsSchema = z.object({ projectId: z.uuid(), paths: z.array(gitPathSchema).min(1).max(10_000) })
const gitCommitSchema = z.object({ projectId: z.uuid(), message: z.string().trim().min(1).max(5_000) })
const gitRefSchema = z.string().regex(/^[A-Za-z0-9._/-]{1,255}$/)
const gitPushSchema = z.object({
  projectId: z.uuid(),
  remote: gitRefSchema.optional(),
  branch: gitRefSchema.optional(),
  setUpstream: z.boolean().optional(),
})
