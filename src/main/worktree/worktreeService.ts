import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
} from 'node:fs'
import { dirname, isAbsolute, join, matchesGlob, normalize, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type {
  CreateWorktreeInput,
  ManagedWorktree,
  MoveWorktreeChangesInput,
  MoveWorktreeChangesResult,
  RemoveWorktreeInput,
  WorktreeHandoffRecovery,
  WorktreeHandoffRecoverySummary,
  WorktreeActionInput,
  WorktreeBase,
  WorktreeBaseCatalog,
} from '../../shared/worktree.js'
import type { StateDatabase } from '../state/database.js'

const execFileAsync = promisify(execFile)
const MAX_INCLUDE_FILE_BYTES = 10 * 1024 * 1024
const MAX_INCLUDE_TOTAL_BYTES = 100 * 1024 * 1024
const MAX_BASE_REFS = 500

type HandoffFailurePoint = 'stashCreated' | 'recoverySecured' | 'targetApplied' | 'targetRecorded'
type WorktreeServiceOptions = { afterHandoffStep?: (step: HandoffFailurePoint) => void }

export class WorktreeService {
  readonly #database: StateDatabase
  readonly #managedRoot: string
  readonly #afterHandoffStep: WorktreeServiceOptions['afterHandoffStep']
  #handoffInProgress = false

  constructor(database: StateDatabase, managedRoot: string, options: WorktreeServiceOptions = {}) {
    this.#database = database
    mkdirSync(managedRoot, { mode: 0o700, recursive: true })
    this.#managedRoot = realpathSync(managedRoot)
    this.#afterHandoffStep = options.afterHandoffStep
  }

  async list(projectId: string): Promise<ManagedWorktree[]> {
    const project = this.#requireProject(projectId)
    if (!(await isGitRepository(project.path))) {
      return this.#database.listManagedWorktrees(projectId).map((record) => ({
        ...record,
        headOid: null,
        locked: false,
        missing: true,
      }))
    }
    const actual = await readWorktreeMetadata(project.path)
    return this.#database.listManagedWorktrees(projectId).map((record) => {
      const metadata = actual.get(worktreePathKey(record.path))
      return {
        ...record,
        headOid: metadata?.headOid ?? null,
        locked: metadata?.locked ?? false,
        missing: !existsSync(record.path) || metadata === undefined,
      }
    })
  }

  async create(input: CreateWorktreeInput): Promise<ManagedWorktree> {
    const project = this.#requireProject(input.projectId)
    if (!(await isGitRepository(project.path))) {
      throw new Error('Initialize Git before creating an isolated worktree.')
    }
    const id = randomUUID()
    const baseRef = validateRef(input.baseRef ?? 'HEAD', 'base ref')
    const baseOid = await resolveCommit(project.path, baseRef)
    if (input.expectedBaseOid && input.expectedBaseOid !== baseOid) {
      throw new Error('The selected worktree base moved. Refresh the base list and choose again.')
    }
    const branch = input.branch ? validateRef(input.branch, 'branch') : null
    const repositoryDirectory = join(this.#managedRoot, input.projectId)
    const path = join(repositoryDirectory, id)
    mkdirSync(repositoryDirectory, { mode: 0o700, recursive: true })
    if (existsSync(path)) throw new Error('Managed worktree path already exists.')

    const args = ['worktree', 'add']
    if (branch) args.push('-b', branch)
    else args.push('--detach')
    args.push(path, baseOid)
    await runGit(project.path, args, 120_000)
    let copiedIncludeFiles = 0
    try {
      if (input.copyIncludes !== false) copiedIncludeFiles = await copyWorktreeIncludes(project.path, path)
      const record = { id, projectId: input.projectId, path, baseRef, baseOid, branch, createdAt: new Date().toISOString(), copiedIncludeFiles }
      this.#database.insertManagedWorktree(record)
      const [created] = await this.list(input.projectId)
      const match = created?.id === id ? created : (await this.list(input.projectId)).find((item) => item.id === id)
      if (!match) throw new Error('Created worktree could not be reloaded.')
      return match
    } catch (error) {
      await runGit(project.path, ['worktree', 'remove', '--force', path], 120_000).catch(() => undefined)
      throw error
    }
  }

  async listBases(projectId: string): Promise<WorktreeBaseCatalog> {
    const project = this.#requireProject(projectId)
    if (!(await isGitRepository(project.path))) {
      return { projectId, repositoryInitialized: false, bases: [], truncated: false }
    }
    const headOid = await resolveCommit(project.path, 'HEAD').catch(() => null)
    if (!headOid) return { projectId, repositoryInitialized: true, bases: [], truncated: false }
    const headLabelResult = await runGit(project.path, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => null)
    const symbolicHead = headLabelResult?.stdout.trim()
    const headLabel = symbolicHead && symbolicHead.length > 0 ? symbolicHead : `Detached ${headOid.slice(0, 7)}`
    const result = await runGit(project.path, [
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname)%00%(refname:short)%00%(*objectname)%00%(objectname)%00%(*objecttype)%00%(objecttype)',
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ])
    const bases: WorktreeBase[] = [{ ref: 'HEAD', label: `当前 HEAD · ${headLabel}`, kind: 'current', oid: headOid }]
    const seenRefs = new Set([`current:HEAD`])
    let truncated = false
    for (const line of result.stdout.split(/\r?\n/u)) {
      if (!line) continue
      const [fullRef, shortRef, peeledOid, objectOid, peeledType, objectType] = line.split('\0')
      if (!fullRef || !shortRef) continue
      if (fullRef.startsWith('refs/remotes/') && shortRef.endsWith('/HEAD')) continue
      const oid = peeledOid && peeledOid.length > 0 ? peeledOid : objectOid
      const type = peeledType && peeledType.length > 0 ? peeledType : objectType
      if (type !== 'commit' || !oid || !/^[0-9a-f]{40,64}$/u.test(oid)) continue
      const kind = worktreeBaseKind(fullRef)
      if (!kind) continue
      const key = fullRef
      if (seenRefs.has(key)) continue
      seenRefs.add(key)
      if (bases.length >= MAX_BASE_REFS) { truncated = true; break }
      bases.push({ ref: fullRef, label: shortRef, kind, oid })
    }
    return { projectId, repositoryInitialized: true, bases, truncated }
  }

  async lock(input: WorktreeActionInput): Promise<ManagedWorktree[]> {
    const { project, worktree } = this.#requireManaged(input.worktreeId)
    await runGit(project.path, ['worktree', 'lock', worktree.path])
    return this.list(project.id)
  }

  async unlock(input: WorktreeActionInput): Promise<ManagedWorktree[]> {
    const { project, worktree } = this.#requireManaged(input.worktreeId)
    await runGit(project.path, ['worktree', 'unlock', worktree.path])
    return this.list(project.id)
  }

  async remove(input: RemoveWorktreeInput): Promise<ManagedWorktree[]> {
    const { project, worktree } = this.#requireManaged(input.worktreeId)
    const associatedThreads = this.#database.countThreadsForWorktree(worktree.id)
    if (associatedThreads > 0) {
      throw new Error(`Hand off ${String(associatedThreads)} conversation${associatedThreads === 1 ? '' : 's'} before removing this worktree.`)
    }
    const recoveries = this.#database.countWorktreeHandoffsForWorktree(worktree.id)
    if (recoveries > 0) {
      throw new Error(`Resolve ${String(recoveries)} pending handoff recover${recoveries === 1 ? 'y' : 'ies'} before removing this worktree.`)
    }
    const args = ['worktree', 'remove']
    if (input.force) args.push('--force')
    args.push(worktree.path)
    if (existsSync(worktree.path)) await runGit(project.path, args, 120_000)
    this.#database.deleteManagedWorktree(worktree.id)
    return this.list(project.id)
  }

  async moveChanges(input: MoveWorktreeChangesInput): Promise<MoveWorktreeChangesResult> {
    if (this.#handoffInProgress) throw new Error('Another worktree handoff is already running.')
    if (input.sourceWorktreeId === input.targetWorktreeId) return { moved: false, operationId: null }
    const project = this.#requireProject(input.projectId)
    if (this.#database.listWorktreeHandoffs(project.id).length > 0) {
      throw new Error('Resolve the pending worktree handoff recovery before starting another handoff in this project.')
    }
    const context = this.#database.getThreadProjectContext(input.threadId)
    if (context?.projectId !== project.id || context.worktreeId !== input.sourceWorktreeId) {
      throw new Error('The conversation context changed before its worktree handoff started.')
    }
    const source = this.#contextPath(project.id, project.path, input.sourceWorktreeId)
    const target = this.#contextPath(project.id, project.path, input.targetWorktreeId)
    this.#handoffInProgress = true
    try {
      if (!(await hasChanges(source))) return { moved: false, operationId: null }
      if (await hasUnmergedChanges(source)) throw new Error('Resolve source merge conflicts before handing off changes.')
      if (await hasChanges(target)) throw new Error('The handoff target must be clean before receiving changes.')

      const id = randomUUID()
      const marker = `aster-handoff-v2:${id}`
      const recoveryRef = `refs/aster/handoffs/${id}`
      const sourceHeadOid = await resolveCommit(source, 'HEAD')
      const sourceTreeOid = await snapshotWorkingTree(source)
      const sourceIndexOid = await snapshotIndex(source)
      const targetHeadOid = await resolveCommit(target, 'HEAD')
      const targetCleanTreeOid = await resolveTree(target, targetHeadOid)
      const now = new Date().toISOString()
      const operation: WorktreeHandoffRecovery = {
        id,
        projectId: project.id,
        threadId: input.threadId,
        sourceWorktreeId: input.sourceWorktreeId,
        targetWorktreeId: input.targetWorktreeId,
        recoveryRef,
        stashOid: null,
        sourceHeadOid,
        sourceTreeOid,
        sourceIndexOid,
        targetHeadOid,
        targetCleanTreeOid,
        targetTreeOid: null,
        targetIndexOid: null,
        phase: 'preparing',
        createdAt: now,
        updatedAt: now,
        error: null,
      }
      this.#database.insertWorktreeHandoff(operation)
      await runGit(source, ['stash', 'push', '--include-untracked', '--message', marker, '--'], 120_000)
      this.#afterHandoffStep?.('stashCreated')
      const stashOid = (await runGit(source, ['rev-parse', '--verify', 'refs/stash'])).stdout.trim()
      if (!stashOid || await hasChanges(source)) {
        throw new Error('Git could not create a clean handoff recovery stash.')
      }
      await runGit(source, ['update-ref', recoveryRef, stashOid])
      this.#database.updateWorktreeHandoff(id, { phase: 'stashed', stashOid, error: null })
      await dropStashByOid(source, stashOid)
      this.#afterHandoffStep?.('recoverySecured')

      try {
        this.#database.updateWorktreeHandoff(id, { phase: 'applying' })
        await runGit(target, ['stash', 'apply', '--index', recoveryRef], 120_000)
      } catch (applyError) {
        try {
          await this.#rollbackHandoff(operation.id, true)
        } catch (rollbackError) {
          throw new AggregateError(
            [applyError, rollbackError],
            'Changes could not be applied to the target and automatic source recovery needs attention.',
            { cause: rollbackError },
          )
        }
        throw new Error('Changes could not be applied to the target; the source was restored.', { cause: applyError })
      }
      this.#afterHandoffStep?.('targetApplied')

      if (!(await hasChanges(target))) throw new Error('Git applied the handoff without producing target changes.')
      const targetTreeOid = await snapshotWorkingTree(target)
      const targetIndexOid = await snapshotIndex(target)
      this.#database.updateWorktreeHandoff(id, {
        phase: 'applied', targetTreeOid, targetIndexOid, error: null,
      })
      this.#afterHandoffStep?.('targetRecorded')
      return { moved: true, operationId: id }
    } finally {
      this.#handoffInProgress = false
    }
  }

  listRecoveries(projectId: string): WorktreeHandoffRecoverySummary[] {
    this.#requireProject(projectId)
    return this.#database.listWorktreeHandoffs(projectId).map(toRecoverySummary)
  }

  async completeHandoff(operationId: string): Promise<void> {
    const operation = this.#requireHandoff(operationId)
    const context = this.#database.getThreadProjectContext(operation.threadId)
    if (context?.projectId !== operation.projectId || context.worktreeId !== operation.targetWorktreeId) {
      throw new Error('The conversation context does not match the completed worktree handoff target.')
    }
    try {
      await this.#cleanupHandoff(operation)
    } catch (error) {
      this.#markHandoffNeedsAttention(operation.id, error)
    }
  }

  async rollbackHandoff(operationId: string): Promise<void> {
    const operation = this.#requireHandoff(operationId)
    await this.#rollbackHandoff(operation.id)
  }

  async retryRecovery(operationId: string): Promise<WorktreeHandoffRecoverySummary[]> {
    const operation = this.#requireHandoff(operationId)
    await this.#recoverHandoff(operation)
    return this.#database.listWorktreeHandoffs(operation.projectId).map(toRecoverySummary)
  }

  async recoverInterruptedHandoffs(): Promise<WorktreeHandoffRecovery[]> {
    for (const operation of this.#database.listWorktreeHandoffs()) {
      try {
        await this.#recoverHandoff(operation)
      } catch (error) {
        this.#markHandoffNeedsAttention(operation.id, error)
      }
    }
    return this.#database.listWorktreeHandoffs()
  }

  async #recoverHandoff(operation: WorktreeHandoffRecovery): Promise<void> {
    const project = this.#requireProject(operation.projectId)
    const source = this.#contextPath(project.id, project.path, operation.sourceWorktreeId)
    const target = this.#contextPath(project.id, project.path, operation.targetWorktreeId)
    const context = this.#database.getThreadProjectContext(operation.threadId)
    if (context?.projectId !== operation.projectId) {
      throw new Error('The handoff conversation association is missing or belongs to another project.')
    }
    const stashOid = operation.stashOid
      ?? await resolveOptionalRef(source, operation.recoveryRef)
      ?? await findStashByMarker(source, `aster-handoff-v2:${operation.id}`)

    if (!stashOid) {
      if (context.worktreeId === operation.targetWorktreeId) {
        this.#database.deleteWorktreeHandoff(operation.id)
        return
      }
      if (context.worktreeId !== operation.sourceWorktreeId) {
        throw new Error('The handoff conversation is associated with neither its source nor target.')
      }
      if (await hasChanges(source) && !(await hasChanges(target))) {
        this.#database.deleteWorktreeHandoff(operation.id)
        return
      }
      throw new Error('The handoff recovery snapshot is missing while the source is clean.')
    }
    validateObjectId(stashOid)
    if (await resolveCommit(source, 'HEAD') !== operation.sourceHeadOid) {
      throw new Error('The handoff source HEAD changed after the interruption; automatic recovery is unsafe.')
    }
    if (await resolveCommit(target, 'HEAD') !== operation.targetHeadOid) {
      throw new Error('The handoff target HEAD changed after the interruption; automatic recovery is unsafe.')
    }
    await runGit(source, ['update-ref', operation.recoveryRef, stashOid])
    await dropStashByOid(source, stashOid)
    operation = this.#database.updateWorktreeHandoff(operation.id, {
      phase: operation.phase === 'preparing' ? 'stashed' : operation.phase,
      stashOid,
      error: null,
    })

    if (context.worktreeId === operation.targetWorktreeId) {
      await this.#cleanupHandoff(operation)
      return
    }
    if (context.worktreeId !== operation.sourceWorktreeId) {
      throw new Error('The handoff conversation is associated with neither its source nor target.')
    }

    const sourceTreeOid = await snapshotWorkingTree(source)
    const targetTreeOid = await snapshotWorkingTree(target)
    const sourceIndexOid = await snapshotIndex(source)
    const targetIndexOid = await snapshotIndex(target)
    const targetCleanTreeOid = operation.targetCleanTreeOid
    if (sourceTreeOid === operation.sourceTreeOid && sourceIndexOid === operation.sourceIndexOid) {
      if (targetTreeOid !== targetCleanTreeOid || targetIndexOid !== targetCleanTreeOid) {
        throw new Error('Both handoff source and target contain changes; automatic recovery is unsafe.')
      }
      await this.#cleanupHandoff(operation)
      return
    }
    const cleanSourceTreeOid = await resolveTree(source, operation.sourceHeadOid)
    if (sourceTreeOid !== cleanSourceTreeOid) {
      throw new Error('The handoff source contains changes that do not match its recovery snapshot.')
    }
    if (operation.targetTreeOid && operation.targetIndexOid
      && (targetTreeOid !== operation.targetTreeOid || targetIndexOid !== operation.targetIndexOid)
      && (targetTreeOid !== targetCleanTreeOid || targetIndexOid !== targetCleanTreeOid)) {
      throw new Error('The handoff target contains changes made after the interruption; automatic recovery is unsafe.')
    }
    await this.#rollbackHandoff(operation.id)
  }

  async #rollbackHandoff(operationId: string, allowPartialApply = false): Promise<void> {
    let operation = this.#requireHandoff(operationId)
    if (!operation.stashOid) throw new Error('The handoff recovery snapshot has not been secured.')
    const project = this.#requireProject(operation.projectId)
    const source = this.#contextPath(project.id, project.path, operation.sourceWorktreeId)
    const target = this.#contextPath(project.id, project.path, operation.targetWorktreeId)
    operation = this.#database.updateWorktreeHandoff(operation.id, { phase: 'rollingBack', error: null })
    try {
      if (allowPartialApply) {
        await runGit(target, ['reset', '--hard', 'HEAD'], 120_000)
        await runGit(target, ['clean', '-fd'], 120_000)
      }
      const sourceTreeOid = await snapshotWorkingTree(source)
      const sourceIndexOid = await snapshotIndex(source)
      const cleanSourceTreeOid = await resolveTree(source, operation.sourceHeadOid)
      if ((sourceTreeOid !== cleanSourceTreeOid || sourceIndexOid !== cleanSourceTreeOid)
        && (sourceTreeOid !== operation.sourceTreeOid || sourceIndexOid !== operation.sourceIndexOid)) {
        throw new Error('The handoff source contains unrelated changes; automatic rollback is unsafe.')
      }
      const targetTreeOid = await snapshotWorkingTree(target)
      const targetIndexOid = await snapshotIndex(target)
      const cleanTargetTreeOid = operation.targetCleanTreeOid
      if (targetTreeOid !== cleanTargetTreeOid || targetIndexOid !== cleanTargetTreeOid) {
        if (!operation.targetTreeOid || !operation.targetIndexOid
          || targetTreeOid !== operation.targetTreeOid || targetIndexOid !== operation.targetIndexOid) {
          throw new Error('The handoff target contains unrelated changes; automatic rollback is unsafe.')
        }
        await runGit(target, ['reset', '--hard', 'HEAD'], 120_000)
        await runGit(target, ['clean', '-fd'], 120_000)
      }
      if (sourceTreeOid === cleanSourceTreeOid && sourceIndexOid === cleanSourceTreeOid) {
        await runGit(source, ['stash', 'apply', '--index', operation.recoveryRef], 120_000)
      }
      if (await snapshotWorkingTree(source) !== operation.sourceTreeOid
        || await snapshotIndex(source) !== operation.sourceIndexOid) {
        throw new Error('The handoff source was not restored to its original content tree.')
      }
      await this.#cleanupHandoff(operation)
    } catch (error) {
      this.#markHandoffNeedsAttention(operation.id, error)
      throw error
    }
  }

  async #cleanupHandoff(operation: WorktreeHandoffRecovery): Promise<void> {
    const project = this.#requireProject(operation.projectId)
    const source = this.#contextPath(project.id, project.path, operation.sourceWorktreeId)
    if (operation.stashOid) await dropStashByOid(source, operation.stashOid)
    await runGit(source, ['update-ref', '-d', operation.recoveryRef])
    this.#database.deleteWorktreeHandoff(operation.id)
  }

  #requireHandoff(operationId: string): WorktreeHandoffRecovery {
    const operation = this.#database.getWorktreeHandoff(operationId)
    if (!operation) throw new Error('Worktree handoff recovery record not found.')
    if (operation.recoveryRef !== `refs/aster/handoffs/${operation.id}`) {
      throw new Error('Worktree handoff recovery ref failed its ownership check.')
    }
    return operation
  }

  #markHandoffNeedsAttention(operationId: string, error: unknown): void {
    if (!this.#database.getWorktreeHandoff(operationId)) return
    this.#database.updateWorktreeHandoff(operationId, {
      phase: 'needsAttention',
      error: errorMessage(error).slice(0, 2_000),
    })
  }

  #requireProject(projectId: string) {
    const project = this.#database.getProject(projectId)
    if (!project) throw new Error('Project not found.')
    return project
  }

  #requireManaged(worktreeId: string) {
    const worktree = this.#database.getManagedWorktree(worktreeId)
    if (!worktree) throw new Error('Managed worktree not found.')
    const project = this.#requireProject(worktree.projectId)
    const expectedPrefix = join(this.#managedRoot, worktree.projectId) + sep
    if (!worktree.path.startsWith(expectedPrefix)) throw new Error('Managed worktree path failed its ownership check.')
    return { project, worktree }
  }

  #contextPath(projectId: string, projectPath: string, worktreeId: string | null): string {
    if (!worktreeId) return projectPath
    const worktree = this.#database.getManagedWorktree(worktreeId)
    if (worktree?.projectId !== projectId) throw new Error('Managed worktree not found for this project.')
    if (!existsSync(worktree.path)) throw new Error('Managed worktree is missing.')
    return worktree.path
  }
}

function toRecoverySummary(operation: WorktreeHandoffRecovery): WorktreeHandoffRecoverySummary {
  return {
    id: operation.id,
    projectId: operation.projectId,
    threadId: operation.threadId,
    sourceWorktreeId: operation.sourceWorktreeId,
    targetWorktreeId: operation.targetWorktreeId,
    phase: operation.phase,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    error: operation.error,
  }
}

async function hasChanges(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  return result.stdout.length > 0
}

async function isGitRepository(cwd: string): Promise<boolean> {
  try {
    const result = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'])
    return result.stdout.trim() === 'true'
  } catch {
    return false
  }
}

async function hasUnmergedChanges(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ['diff', '--name-only', '--diff-filter=U', '-z'])
  return result.stdout.length > 0
}

async function dropStashByOid(cwd: string, expectedOid: string): Promise<void> {
  const result = await runGit(cwd, ['stash', 'list', '--format=%gd%x00%H'])
  const match = result.stdout.split(/\r?\n/u).map((line) => line.split('\0'))
    .find(([, oid]) => oid === expectedOid)
  if (match?.[0]) await runGit(cwd, ['stash', 'drop', match[0]])
}

async function findStashByMarker(cwd: string, marker: string): Promise<string | null> {
  const result = await runGit(cwd, ['stash', 'list', '--format=%H%x00%gs'])
  for (const line of result.stdout.split(/\r?\n/u)) {
    const [oid, subject] = line.split('\0')
    if (oid && subject?.endsWith(marker)) return oid
  }
  return null
}

async function resolveOptionalRef(cwd: string, ref: string): Promise<string | null> {
  const result = await runGit(cwd, ['rev-parse', '--verify', ref]).catch(() => null)
  const oid = result?.stdout.trim()
  return oid && /^[0-9a-f]{40,64}$/u.test(oid) ? oid : null
}

async function snapshotWorkingTree(cwd: string): Promise<string> {
  const temporaryIndex = join(dirname(cwd), `.aster-index-${randomUUID()}`)
  try {
    await runGit(cwd, ['read-tree', 'HEAD'], 30_000, { GIT_INDEX_FILE: temporaryIndex })
    await runGit(cwd, ['add', '-A', '--'], 120_000, { GIT_INDEX_FILE: temporaryIndex })
    const result = await runGit(cwd, ['write-tree'], 30_000, { GIT_INDEX_FILE: temporaryIndex })
    const oid = result.stdout.trim()
    validateObjectId(oid)
    return oid
  } finally {
    rmTemporaryIndex(temporaryIndex)
  }
}

async function snapshotIndex(cwd: string): Promise<string> {
  const result = await runGit(cwd, ['write-tree'])
  const oid = result.stdout.trim()
  validateObjectId(oid)
  return oid
}

async function resolveTree(cwd: string, commitOid: string): Promise<string> {
  const result = await runGit(cwd, ['rev-parse', '--verify', `${commitOid}^{tree}`])
  const oid = result.stdout.trim()
  validateObjectId(oid)
  return oid
}

function rmTemporaryIndex(path: string): void {
  for (const suffix of ['', '.lock']) {
    try { unlinkSync(`${path}${suffix}`) } catch { /* Temporary index cleanup is best effort. */ }
  }
}

function validateObjectId(oid: string): void {
  if (!/^[0-9a-f]{40,64}$/u.test(oid)) throw new Error('Worktree handoff recovery object is invalid.')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function copyWorktreeIncludes(sourceRoot: string, targetRoot: string): Promise<number> {
  const includePath = join(sourceRoot, '.worktreeinclude')
  if (!existsSync(includePath)) return 0
  const patterns = readFileSync(includePath, 'utf8').split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  if (patterns.length === 0) return 0
  const result = await runGit(sourceRoot, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'])
  let totalBytes = 0
  let copied = 0
  for (const path of result.stdout.split('\0')) {
    if (!path || !matchesInclude(path, patterns)) continue
    const safePath = validateRelativePath(path)
    const source = join(sourceRoot, safePath)
    const metadata = lstatSync(source)
    if (!metadata.isFile() || metadata.isSymbolicLink()) continue
    if (metadata.size > MAX_INCLUDE_FILE_BYTES) throw new Error(`Included worktree file exceeds 10 MiB: ${safePath}`)
    totalBytes += metadata.size
    if (totalBytes > MAX_INCLUDE_TOTAL_BYTES) throw new Error('Included worktree files exceed the 100 MiB total limit.')
    const destination = join(targetRoot, safePath)
    mkdirSync(dirname(destination), { mode: 0o700, recursive: true })
    copyFileSync(source, destination)
    copied += 1
  }
  return copied
}

function matchesInclude(path: string, patterns: string[]): boolean {
  let included = false
  for (const rawPattern of patterns) {
    const negated = rawPattern.startsWith('!')
    const pattern = negated ? rawPattern.slice(1) : rawPattern
    if (!pattern || isAbsolute(pattern) || pattern.includes('\0') || pattern.split('/').includes('..')) continue
    if (matchesGlob(path, pattern)) included = !negated
  }
  return included
}

function validateRelativePath(path: string): string {
  if (isAbsolute(path) || path.includes('\0')) throw new Error('Worktree include path must be relative.')
  const value = normalize(path)
  if (value === '..' || value.startsWith(`..${sep}`)) throw new Error('Worktree include path escapes the repository.')
  return value
}

function validateRef(value: string, label: string): string {
  if (!/^[A-Za-z0-9._/@{}^~+-]{1,255}$/.test(value) || value.startsWith('-') || value.includes('..')) {
    throw new Error(`Invalid worktree ${label}.`)
  }
  return value
}

async function resolveCommit(cwd: string, ref: string): Promise<string> {
  try {
    const result = await runGit(cwd, ['rev-parse', '--verify', `${ref}^{commit}`])
    const oid = result.stdout.trim()
    if (!/^[0-9a-f]{40,64}$/u.test(oid)) throw new Error('Invalid commit OID.')
    return oid
  } catch (error) {
    throw new Error(`Worktree base does not resolve to a commit: ${ref}`, { cause: error })
  }
}

function worktreeBaseKind(fullRef: string): WorktreeBase['kind'] | null {
  if (fullRef.startsWith('refs/heads/')) return 'localBranch'
  if (fullRef.startsWith('refs/remotes/')) return 'remoteBranch'
  if (fullRef.startsWith('refs/tags/')) return 'tag'
  return null
}

type WorktreeMetadata = { headOid: string | null; locked: boolean }

function worktreePathKey(path: string): string {
  // Git for Windows may report the same directory through its 8.3 short path
  // while Node stores the long path (or vice versa). Resolve both spellings to
  // the operating-system file identity before applying case folding.
  let key: string
  try {
    key = realpathSync.native(path)
  } catch {
    key = resolve(path)
  }
  return process.platform === 'win32' ? key.toLowerCase() : key
}

async function readWorktreeMetadata(repositoryPath: string): Promise<Map<string, WorktreeMetadata>> {
  const result = await runGit(repositoryPath, ['worktree', 'list', '--porcelain'])
  const worktrees = new Map<string, WorktreeMetadata>()
  let path: string | null = null
  let headOid: string | null = null
  let locked = false
  const flush = (): void => {
    if (path) worktrees.set(worktreePathKey(path), { headOid, locked })
    path = null
    headOid = null
    locked = false
  }
  for (const line of `${result.stdout}\n`.split(/\r?\n/u)) {
    if (!line) { flush(); continue }
    if (line.startsWith('worktree ')) path = line.slice(9)
    else if (line.startsWith('HEAD ')) headOid = line.slice(5)
    else if (line === 'locked' || line.startsWith('locked ')) locked = true
  }
  return worktrees
}

async function runGit(
  cwd: string,
  args: string[],
  timeout = 30_000,
  extraEnvironment: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync('git', args, {
      cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout, windowsHide: true,
      env: { ...process.env, ...extraEnvironment, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    })
  } catch (error) {
    const value = error as Error & { stderr?: string; stdout?: string }
    throw new Error((value.stderr ?? value.stdout ?? value.message).trim(), { cause: error })
  }
}
