import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type {
  ApplyDiffHunkInput,
  DiffFile,
  DiffHunk,
  DiffLine,
  DiffMode,
  DiffSnapshot,
} from '../../shared/diff.js'
import type { StateDatabase } from '../state/database.js'
import { GitService } from './gitService.js'

const execFileAsync = promisify(execFile)
const MAX_FILES = 200
const MAX_FILE_PATCH = 2 * 1024 * 1024
const MAX_TOTAL_PATCH = 16 * 1024 * 1024
const SNAPSHOT_TTL_MS = 5 * 60_000
const MAX_SNAPSHOTS = 64
const APPLY_OUTPUT_LIMIT = 64 * 1024

type CachedHunk = {
  patch: string
  filePath: string
  untracked: boolean
}

type CachedSnapshot = {
  projectId: string
  mode: DiffMode
  cwd: string
  expiresAt: number
  hunks: Map<string, CachedHunk>
}

export class DiffService {
  readonly #database: StateDatabase
  readonly #git: GitService
  readonly #snapshots = new Map<string, CachedSnapshot>()

  constructor(database: StateDatabase, git: GitService) {
    this.#database = database
    this.#git = git
  }

  async getDiff(projectId: string, mode: DiffMode): Promise<DiffSnapshot> {
    this.#pruneSnapshots()
    const project = this.#database.getProject(projectId)
    if (!project) throw new Error('Project not found.')
    const status = await this.#git.getStatus({ projectId })
    if (!status.initialized || !status.root) throw new Error('Project is not a Git repository.')
    const snapshotId = randomUUID()
    const cached: CachedSnapshot = {
      projectId,
      mode,
      cwd: status.root,
      expiresAt: Date.now() + SNAPSHOT_TTL_MS,
      hunks: new Map(),
    }
    const candidates = status.files.filter((file) => mode === 'staged'
      ? file.indexStatus !== '.' && file.indexStatus !== '?'
      : file.worktreeStatus !== '.' || file.kind === 'untracked')
    let totalBytes = 0
    let truncated = candidates.length > MAX_FILES
    const files: DiffFile[] = []
    for (const candidate of candidates.slice(0, MAX_FILES)) {
      let file = candidate.kind === 'untracked' && mode === 'working'
        ? untrackedDiff(status.root, candidate.path)
        : await trackedDiff(status.root, candidate.path, candidate.originalPath, candidate.indexStatus + candidate.worktreeStatus, mode)
      totalBytes += Buffer.byteLength(file.patch)
      if (totalBytes > MAX_TOTAL_PATCH) {
        file = { ...file, patch: '', truncated: true, hunks: [] }
        truncated = true
      } else if (!file.binary && !file.truncated) {
        const parsed = parseHunks(file.patch)
        file = { ...file, hunks: parsed.map(({ hunk }) => hunk) }
        for (const item of parsed) {
          cached.hunks.set(item.hunk.id, {
            patch: item.patch,
            filePath: candidate.path,
            untracked: candidate.kind === 'untracked',
          })
        }
      }
      files.push(file)
    }
    this.#snapshots.set(snapshotId, cached)
    return {
      id: snapshotId,
      projectId,
      mode,
      files,
      totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
      totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0),
      truncated,
    }
  }

  async applyHunk(input: ApplyDiffHunkInput): Promise<DiffSnapshot> {
    this.#pruneSnapshots()
    const snapshot = this.#snapshots.get(input.snapshotId)
    if (snapshot?.projectId !== input.projectId) throw new Error('Diff snapshot expired; refresh and try again.')
    const hunk = snapshot.hunks.get(input.hunkId)
    if (!hunk) throw new Error('Diff hunk is unavailable or was truncated.')
    if (input.action === 'stage' && snapshot.mode !== 'working') throw new Error('Only working-tree hunks can be staged.')
    if (input.action === 'unstage' && snapshot.mode !== 'staged') throw new Error('Only staged hunks can be unstaged.')
    if (input.action === 'revert' && snapshot.mode !== 'working') throw new Error('Only working-tree hunks can be reverted.')
    if (input.action === 'revert' && hunk.untracked) {
      throw new Error('Untracked files must be removed through a recoverable file workflow, not hunk revert.')
    }

    const args = ['apply', '--whitespace=nowarn', '--recount']
    if (input.action === 'stage' || input.action === 'unstage') args.push('--cached')
    if (input.action === 'unstage' || input.action === 'revert') args.push('--reverse')
    await runGitWithInput(snapshot.cwd, [...args, '--check'], hunk.patch)
    await runGitWithInput(snapshot.cwd, args, hunk.patch)
    this.#snapshots.delete(input.snapshotId)
    return this.getDiff(input.projectId, snapshot.mode)
  }

  #pruneSnapshots(): void {
    const now = Date.now()
    for (const [id, snapshot] of this.#snapshots) {
      if (snapshot.expiresAt <= now) this.#snapshots.delete(id)
    }
    while (this.#snapshots.size >= MAX_SNAPSHOTS) {
      const oldest = this.#snapshots.keys().next().value
      if (!oldest) break
      this.#snapshots.delete(oldest)
    }
  }
}

async function trackedDiff(
  cwd: string,
  path: string,
  oldPath: string | null,
  status: string,
  mode: DiffMode,
): Promise<DiffFile> {
  const args = ['-c', 'core.fsmonitor=false', 'diff', '--no-ext-diff', '--no-color', '--unified=3']
  if (mode === 'staged') args.push('--cached')
  args.push('--', path)
  const result = await execFileAsync('git', args, {
    cwd, encoding: 'utf8', maxBuffer: MAX_FILE_PATCH * 2, timeout: 30_000, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  })
  return finalizeDiff(path, oldPath, status, result.stdout)
}

function untrackedDiff(root: string, path: string): DiffFile {
  if (/[\0\r\n\t]/.test(path)) return emptyBinaryDiff(path, '??')
  const absolute = safeRepositoryPath(root, path)
  const stats = lstatSync(absolute)
  if (!stats.isFile()) return emptyBinaryDiff(path, '??')
  if (stats.size > MAX_FILE_PATCH) return emptyTruncatedDiff(path, '??')
  const real = realpathSync(absolute)
  if (!isWithinRoot(root, real)) throw new Error('Untracked path resolves outside the repository.')
  const descriptor = openSync(real, constants.O_RDONLY | constants.O_NOFOLLOW)
  let content: Buffer
  try {
    const opened = fstatSync(descriptor)
    if (!opened.isFile() || opened.dev !== stats.dev || opened.ino !== stats.ino) {
      throw new Error('Untracked file changed while its diff was being read.')
    }
    if (opened.size > MAX_FILE_PATCH) return emptyTruncatedDiff(path, '??')
    content = Buffer.allocUnsafe(opened.size)
    const read = readSync(descriptor, content, 0, opened.size, 0)
    content = content.subarray(0, read)
  } finally {
    closeSync(descriptor)
  }
  if (content.includes(0)) return emptyBinaryDiff(path, '??')
  const text = content.toString('utf8')
  const lineCount = text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
  const body = text.split('\n')
    .map((line, index, lines) => index === lines.length - 1 && line === '' ? '' : `+${line}`)
    .filter(Boolean)
    .join('\n')
  const fileMode = (stats.mode & 0o111) === 0 ? '100644' : '100755'
  const noNewlineMarker = text.length > 0 && !text.endsWith('\n') ? '\n\\ No newline at end of file' : ''
  const patch = `diff --git a/${path} b/${path}\nnew file mode ${fileMode}\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${String(lineCount)} @@\n${body}${noNewlineMarker}\n`
  return finalizeDiff(path, null, '??', patch)
}

function safeRepositoryPath(root: string, path: string): string {
  if (!path || path.includes('\0') || isAbsolute(path)) throw new Error('Diff path must be repository-relative.')
  const absolute = resolve(root, path)
  if (!isWithinRoot(root, absolute)) throw new Error('Diff path escapes the repository root.')
  return absolute
}

function isWithinRoot(root: string, candidate: string): boolean {
  const result = relative(resolve(root), resolve(candidate))
  return result === '' || (!result.startsWith(`..${sep}`) && result !== '..' && !isAbsolute(result))
}

function emptyBinaryDiff(path: string, status: string): DiffFile {
  return { path, oldPath: null, status, additions: 0, deletions: 0, binary: true, patch: '', truncated: false, hunks: [] }
}

function emptyTruncatedDiff(path: string, status: string): DiffFile {
  return { path, oldPath: null, status, additions: 0, deletions: 0, binary: false, patch: '', truncated: true, hunks: [] }
}

function finalizeDiff(path: string, oldPath: string | null, status: string, rawPatch: string): DiffFile {
  const bytes = Buffer.byteLength(rawPatch)
  const binary = /^(Binary files|GIT binary patch)/m.test(rawPatch)
  const patch = bytes > MAX_FILE_PATCH ? `${Buffer.from(rawPatch).subarray(0, MAX_FILE_PATCH).toString('utf8')}\n… diff truncated …\n` : rawPatch
  let additions = 0
  let deletions = 0
  for (const line of rawPatch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1
  }
  return { path, oldPath, status, additions, deletions, binary, patch, truncated: bytes > MAX_FILE_PATCH, hunks: [] }
}

function parseHunks(patch: string): { hunk: DiffHunk; patch: string }[] {
  const lines = patch.split('\n')
  const firstHunk = lines.findIndex((line) => line.startsWith('@@ '))
  if (firstHunk < 0) return []
  const fileHeader = `${lines.slice(0, firstHunk).join('\n')}\n`
  const result: { hunk: DiffHunk; patch: string }[] = []
  for (let index = firstHunk; index < lines.length;) {
    if (!lines[index]?.startsWith('@@ ')) { index += 1; continue }
    const start = index
    index += 1
    while (index < lines.length && !lines[index]?.startsWith('@@ ')) index += 1
    const hunkLines = lines.slice(start, index)
    while (hunkLines.at(-1) === '') hunkLines.pop()
    const parsed = parseHunk(hunkLines)
    if (!parsed) continue
    result.push({ hunk: parsed, patch: `${fileHeader}${hunkLines.join('\n')}\n` })
  }
  return result
}

function parseHunk(lines: string[]): DiffHunk | null {
  const header = lines[0]
  if (!header) return null
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header)
  if (!match?.[1] || !match[3]) return null
  const oldStart = Number(match[1])
  const oldLines = match[2] === undefined ? 1 : Number(match[2])
  const newStart = Number(match[3])
  const newLines = match[4] === undefined ? 1 : Number(match[4])
  let oldLine = oldStart
  let newLine = newStart
  const mapped: DiffLine[] = []
  for (const line of lines.slice(1)) {
    if (line.startsWith('+')) {
      mapped.push({ kind: 'addition', content: line.slice(1), oldLine: null, newLine })
      newLine += 1
    } else if (line.startsWith('-')) {
      mapped.push({ kind: 'deletion', content: line.slice(1), oldLine, newLine: null })
      oldLine += 1
    } else if (line.startsWith(' ')) {
      mapped.push({ kind: 'context', content: line.slice(1), oldLine, newLine })
      oldLine += 1
      newLine += 1
    } else {
      mapped.push({ kind: 'metadata', content: line, oldLine: null, newLine: null })
    }
  }
  return { id: randomUUID(), header, oldStart, oldLines, newStart, newLines, lines: mapped }
}

async function runGitWithInput(cwd: string, args: string[], input: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('git', ['-c', 'core.fsmonitor=false', ...args], {
      cwd,
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    })
    let stderr = ''
    const timeout = setTimeout(() => child.kill('SIGKILL'), 30_000)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < APPLY_OUTPUT_LIMIT) stderr += chunk.slice(0, APPLY_OUTPUT_LIMIT - stderr.length)
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timeout)
      if (code === 0) resolvePromise()
      else reject(new Error((stderr.trim() || `git apply failed (${signal ?? String(code)}).`).slice(0, 4_000)))
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(input)
  })
}
