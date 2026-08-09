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
import type { ManagedWorktree } from '../shared/worktree.js'
import type { ApplyDiffHunkInput, DiffMode, DiffSnapshot } from '../shared/diff.js'
import type {
  CreateTerminalInput,
  ResizeTerminalInput,
  TerminalContext,
  TerminalSession,
  TerminalState,
  TerminalSubscription,
  WriteTerminalInput,
} from '../shared/terminal.js'

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

export type WorktreeController = {
  list: (projectId: string) => Promise<ManagedWorktree[]>
  create: (input: { projectId: string; baseRef?: string; branch?: string; copyIncludes?: boolean }) => Promise<ManagedWorktree>
  lock: (input: { worktreeId: string }) => Promise<ManagedWorktree[]>
  unlock: (input: { worktreeId: string }) => Promise<ManagedWorktree[]>
  remove: (input: { worktreeId: string; force?: boolean }) => Promise<ManagedWorktree[]>
}

export type DiffController = {
  getDiff: (projectId: string, mode: DiffMode) => Promise<DiffSnapshot>
  applyHunk: (input: ApplyDiffHunkInput) => Promise<DiffSnapshot>
}

export type TerminalController = {
  getState: () => TerminalState
  subscribe: (subscription: TerminalSubscription) => () => void
  create: (input: CreateTerminalInput) => TerminalSession
  write: (input: WriteTerminalInput) => Promise<void>
  resize: (input: ResizeTerminalInput) => Promise<void>
  terminate: (sessionId: string) => Promise<void>
  close: (sessionId: string) => Promise<TerminalState>
  clear: (sessionId: string) => TerminalSession
  getContext: (sessionId: string) => TerminalContext
}

export function registerIpc(
  database: StateDatabase,
  runtime: RuntimeController,
  agent: AgentController,
  providers: ProviderController,
  git: GitController,
  worktrees: WorktreeController,
  diffs: DiffController,
  terminals: TerminalController,
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
  const unsubscribeTerminal = terminals.subscribe((terminalEvent) => {
    for (const contents of webContents) {
      if (!contents.isDestroyed()) contents.send(IPC_CHANNELS.terminalEvent, terminalEvent)
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
  ipcMain.handle(IPC_CHANNELS.worktreeList, (_event, input: unknown) => {
    const parsed = projectInputSchema.parse(input)
    return worktrees.list(parsed.projectId)
  })
  ipcMain.handle(IPC_CHANNELS.worktreeCreate, (_event, input: unknown) =>
    worktrees.create(worktreeCreateSchema.parse(input) as {
      projectId: string
      baseRef?: string
      branch?: string
      copyIncludes?: boolean
    }))
  ipcMain.handle(IPC_CHANNELS.worktreeLock, (_event, input: unknown) => worktrees.lock(worktreeActionSchema.parse(input)))
  ipcMain.handle(IPC_CHANNELS.worktreeUnlock, (_event, input: unknown) => worktrees.unlock(worktreeActionSchema.parse(input)))
  ipcMain.handle(IPC_CHANNELS.worktreeRemove, (_event, input: unknown) =>
    worktrees.remove(worktreeRemoveSchema.parse(input) as { worktreeId: string; force?: boolean }))
  ipcMain.handle(IPC_CHANNELS.diffGet, (_event, input: unknown) => {
    const parsed = diffGetSchema.parse(input)
    return diffs.getDiff(parsed.projectId, parsed.mode)
  })
  ipcMain.handle(IPC_CHANNELS.diffHunkApply, (_event, input: unknown) =>
    diffs.applyHunk(diffHunkApplySchema.parse(input)))
  ipcMain.handle(IPC_CHANNELS.terminalState, (event) => {
    webContents.add(event.sender)
    event.sender.once('destroyed', () => webContents.delete(event.sender))
    return terminals.getState()
  })
  ipcMain.handle(IPC_CHANNELS.terminalCreate, (_event, input: unknown) =>
    terminals.create(terminalCreateSchema.parse(input) as CreateTerminalInput))
  ipcMain.handle(IPC_CHANNELS.terminalWrite, (_event, input: unknown) =>
    terminals.write(terminalWriteSchema.parse(input)))
  ipcMain.handle(IPC_CHANNELS.terminalResize, (_event, input: unknown) =>
    terminals.resize(terminalResizeSchema.parse(input)))
  ipcMain.handle(IPC_CHANNELS.terminalTerminate, (_event, input: unknown) =>
    terminals.terminate(terminalSessionSchema.parse(input).sessionId))
  ipcMain.handle(IPC_CHANNELS.terminalClose, (_event, input: unknown) =>
    terminals.close(terminalSessionSchema.parse(input).sessionId))
  ipcMain.handle(IPC_CHANNELS.terminalClear, (_event, input: unknown) =>
    terminals.clear(terminalSessionSchema.parse(input).sessionId))
  ipcMain.handle(IPC_CHANNELS.terminalContext, (_event, input: unknown) =>
    terminals.getContext(terminalSessionSchema.parse(input).sessionId))

  return () => {
    unsubscribeRuntime()
    unsubscribeAgent()
    unsubscribeTerminal()
    webContents.clear()
    for (const channel of Object.values(IPC_CHANNELS)) ipcMain.removeHandler(channel)
  }
}

const projectInputSchema = z.object({ projectId: z.uuid() })
const threadInputSchema = z.object({ threadId: z.string().min(1).max(200) })
const promptSchema = z.string().trim().min(1).max(100_000)
const startConversationSchema = z.object({
  projectId: z.uuid(),
  worktreeId: z.uuid().optional(),
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
const worktreeRefSchema = z.string().regex(/^[A-Za-z0-9._/@{}^~+-]{1,255}$/)
const worktreeCreateSchema = z.object({
  projectId: z.uuid(),
  baseRef: worktreeRefSchema.optional(),
  branch: worktreeRefSchema.optional(),
  copyIncludes: z.boolean().optional(),
})
const worktreeActionSchema = z.object({ worktreeId: z.uuid() })
const worktreeRemoveSchema = z.object({ worktreeId: z.uuid(), force: z.boolean().optional() })
const diffGetSchema = z.object({ projectId: z.uuid(), mode: z.enum(['working', 'staged']) })
const diffHunkApplySchema = z.object({
  projectId: z.uuid(),
  snapshotId: z.uuid(),
  hunkId: z.uuid(),
  action: z.enum(['stage', 'unstage', 'revert']),
})
const terminalSessionSchema = z.object({ sessionId: z.uuid() })
const terminalCreateSchema = z.object({
  projectId: z.uuid(),
  worktreeId: z.uuid().optional(),
  threadId: z.string().min(1).max(200).optional(),
  cols: z.number().int().min(2).max(500).optional(),
  rows: z.number().int().min(2).max(300).optional(),
})
const terminalWriteSchema = terminalSessionSchema.extend({ data: z.string().min(1).max(65_536) })
const terminalResizeSchema = terminalSessionSchema.extend({
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(2).max(300),
})
