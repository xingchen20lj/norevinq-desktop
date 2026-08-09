import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { DiffFile, DiffMode, DiffSnapshot } from '../../shared/diff.js'
import type { StateDatabase } from '../state/database.js'
import { GitService } from './gitService.js'

const execFileAsync = promisify(execFile)
const MAX_FILES = 200
const MAX_FILE_PATCH = 2 * 1024 * 1024
const MAX_TOTAL_PATCH = 16 * 1024 * 1024

export class DiffService {
  readonly #database: StateDatabase
  readonly #git: GitService

  constructor(database: StateDatabase, git: GitService) {
    this.#database = database
    this.#git = git
  }

  async getDiff(projectId: string, mode: DiffMode): Promise<DiffSnapshot> {
    const project = this.#database.getProject(projectId)
    if (!project) throw new Error('Project not found.')
    const status = await this.#git.getStatus({ projectId })
    if (!status.initialized) throw new Error('Project is not a Git repository.')
    const candidates = status.files.filter((file) => mode === 'staged'
      ? file.indexStatus !== '.' && file.indexStatus !== '?'
      : file.worktreeStatus !== '.' || file.kind === 'untracked')
    let totalBytes = 0
    let truncated = candidates.length > MAX_FILES
    const files: DiffFile[] = []
    for (const candidate of candidates.slice(0, MAX_FILES)) {
      let file = candidate.kind === 'untracked' && mode === 'working'
        ? untrackedDiff(project.path, candidate.path)
        : await trackedDiff(project.path, candidate.path, candidate.originalPath, candidate.indexStatus + candidate.worktreeStatus, mode)
      totalBytes += Buffer.byteLength(file.patch)
      if (totalBytes > MAX_TOTAL_PATCH) {
        file = { ...file, patch: '', truncated: true }
        truncated = true
      }
      files.push(file)
    }
    return {
      projectId,
      mode,
      files,
      totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
      totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0),
      truncated,
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
  const args = ['diff', '--no-ext-diff', '--no-color', '--unified=3']
  if (mode === 'staged') args.push('--cached')
  args.push('--', path)
  const result = await execFileAsync('git', args, {
    cwd, encoding: 'utf8', maxBuffer: MAX_FILE_PATCH * 2, timeout: 30_000, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  })
  return finalizeDiff(path, oldPath, status, result.stdout)
}

function untrackedDiff(root: string, path: string): DiffFile {
  const content = readFileSync(join(root, path))
  if (content.includes(0)) return { path, oldPath: null, status: '??', additions: 0, deletions: 0, binary: true, patch: '', truncated: false }
  const text = content.toString('utf8')
  const patch = `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${String(text.split('\n').length - (text.endsWith('\n') ? 1 : 0))} @@\n${text.split('\n').map((line, index, lines) => index === lines.length - 1 && line === '' ? '' : `+${line}`).filter(Boolean).join('\n')}\n`
  return finalizeDiff(path, null, '??', patch)
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
  return { path, oldPath, status, additions, deletions, binary, patch, truncated: bytes > MAX_FILE_PATCH }
}
