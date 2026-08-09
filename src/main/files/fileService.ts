import { randomUUID } from 'node:crypto'
import {
  closeSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
} from 'node:fs'
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import type {
  FileContextInput,
  FileOpenInput,
  FilePathInput,
  FilePreviewKind,
  ProjectDirectory,
  ProjectFileEntry,
  ProjectFilePreview,
} from '../../shared/files.js'
import type { StateDatabase } from '../state/database.js'

const MAX_DIRECTORY_ENTRIES = 500
const MAX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_BYTES = 50 * 1024 * 1024
const MAX_PDF_BYTES = 100 * 1024 * 1024
const TOKEN_TTL_MS = 15 * 60 * 1_000
const MAX_TOKENS = 128

type PreviewToken = { path: string; mimeType: string; size: number; expiresAt: number }
type FileServiceOptions = { now?: () => number; openPath?: (path: string) => Promise<string> }

export class FileService {
  readonly #database: StateDatabase
  readonly #now: () => number
  readonly #openPath: (path: string) => Promise<string>
  readonly #tokens = new Map<string, PreviewToken>()

  constructor(database: StateDatabase, options: FileServiceOptions = {}) {
    this.#database = database
    this.#now = options.now ?? Date.now
    this.#openPath = options.openPath ?? (() => Promise.reject(new Error('External file opening is unavailable.')))
  }

  listDirectory(input: FilePathInput): ProjectDirectory {
    const root = this.#root(input)
    const { absolute, relativePath } = this.#resolve(root, input.path, true)
    const metadata = lstatSync(absolute)
    if (!metadata.isDirectory()) throw new Error('The requested path is not a directory.')
    const all = readdirSync(absolute, { withFileTypes: true })
      .filter(({ name }) => name !== '.git')
      .sort((left, right) => {
        const directoryOrder = Number(right.isDirectory()) - Number(left.isDirectory())
        return directoryOrder || left.name.localeCompare(right.name, undefined, { numeric: true })
      })
    const entries = all.slice(0, MAX_DIRECTORY_ENTRIES).map((entry): ProjectFileEntry => {
      const childRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name
      const childPath = join(absolute, entry.name)
      const child = lstatSync(childPath)
      const kind = child.isSymbolicLink() ? 'symlink' : child.isDirectory() ? 'directory' : 'file'
      return {
        name: entry.name,
        path: childRelativePath,
        kind,
        size: kind === 'file' ? child.size : null,
        modifiedAt: child.mtime.toISOString(),
        previewKind: kind === 'file' ? previewKindFromName(entry.name, child.size) : null,
      }
    })
    return { ...input, path: relativePath, entries, truncated: all.length > MAX_DIRECTORY_ENTRIES }
  }

  readPreview(input: FilePathInput): ProjectFilePreview {
    const root = this.#root(input)
    const { absolute, relativePath } = this.#resolve(root, input.path, false)
    const metadata = lstatSync(absolute)
    if (!metadata.isFile()) throw new Error('Only regular files can be previewed.')
    const mimeType = mimeTypeFromName(relativePath)
    const detected = detectPreviewKind(absolute, relativePath, metadata.size)
    if (detected === 'text') {
      const { content, truncated } = readBoundedText(absolute, metadata.size)
      return preview(input, relativePath, metadata.size, metadata.mtime, mimeType, 'text', content, null, truncated)
    }
    if (detected === 'too-large' || detected === 'binary') {
      return preview(input, relativePath, metadata.size, metadata.mtime, mimeType, detected, null, null, false)
    }
    const token = this.#issueToken(absolute, mimeType, metadata.size)
    return preview(input, relativePath, metadata.size, metadata.mtime, mimeType, detected, null, `aster-file://preview/${token}`, false)
  }

  async openExternal(input: FileOpenInput): Promise<void> {
    const root = this.#root(input)
    const { absolute, relativePath } = this.#resolve(root, input.path, false)
    const metadata = lstatSync(absolute)
    if (!metadata.isFile()) throw new Error('Only regular files can be opened externally.')
    if (metadata.mode & 0o111 || DANGEROUS_EXTENSIONS.has(extname(relativePath).toLowerCase())) {
      throw new Error('Executable and script-like files cannot be launched from the previewer.')
    }
    const error = await this.#openPath(absolute)
    if (error) throw new Error(error)
  }

  resolvePreviewToken(token: string): PreviewToken | null {
    this.#expireTokens()
    const value = this.#tokens.get(token)
    if (!value) return null
    try {
      const metadata = lstatSync(value.path)
      if (!metadata.isFile() || metadata.isSymbolicLink()) return null
      return { ...value, size: metadata.size }
    } catch {
      return null
    }
  }

  clear(): void {
    this.#tokens.clear()
  }

  #root(input: FileContextInput): string {
    const project = this.#database.getProject(input.projectId)
    if (!project) throw new Error('Project not found.')
    if (!input.worktreeId) return realpathSync(project.path)
    const worktree = this.#database.getManagedWorktree(input.worktreeId)
    if (worktree?.projectId !== project.id) throw new Error('Managed worktree not found for this project.')
    return realpathSync(worktree.path)
  }

  #resolve(root: string, inputPath: string, allowRoot: boolean): { absolute: string; relativePath: string } {
    if (inputPath.includes('\0') || isAbsolute(inputPath)) throw new Error('File paths must be project-relative.')
    const portable = inputPath.replaceAll('\\', '/')
    const segments = portable.split('/').filter((part) => part && part !== '.')
    if (segments.some((part) => part === '..')) throw new Error('File path escapes the project root.')
    const normalized = normalize(segments.join(sep))
    if (!allowRoot && (!normalized || normalized === '.')) throw new Error('A file path is required.')
    let current = root
    for (const segment of segments) {
      current = join(current, segment)
      if (lstatSync(current).isSymbolicLink()) throw new Error('Symbolic links cannot be traversed by the previewer.')
    }
    const absolute = resolve(root, normalized || '.')
    const canonical = realpathSync(absolute)
    if (canonical !== root && !canonical.startsWith(`${root}${sep}`)) throw new Error('File path escapes the project root.')
    return { absolute: canonical, relativePath: relative(root, canonical).split(sep).join('/') }
  }

  #issueToken(path: string, mimeType: string, size: number): string {
    this.#expireTokens()
    while (this.#tokens.size >= MAX_TOKENS) {
      const oldest = this.#tokens.keys().next().value
      if (!oldest) break
      this.#tokens.delete(oldest)
    }
    const token = randomUUID()
    this.#tokens.set(token, { path, mimeType, size, expiresAt: this.#now() + TOKEN_TTL_MS })
    return token
  }

  #expireTokens(): void {
    const now = this.#now()
    for (const [token, value] of this.#tokens) if (value.expiresAt <= now) this.#tokens.delete(token)
  }
}

function preview(
  input: FileContextInput,
  path: string,
  size: number,
  modifiedAt: Date,
  mimeType: string,
  kind: FilePreviewKind,
  content: string | null,
  url: string | null,
  truncated: boolean,
): ProjectFilePreview {
  return { ...input, path, name: path.split('/').at(-1) ?? path, size, modifiedAt: modifiedAt.toISOString(), mimeType, kind, content, url, truncated }
}

function detectPreviewKind(path: string, name: string, size: number): FilePreviewKind {
  const kind = previewKindFromName(name, size)
  if (kind !== 'binary') return kind
  const length = Math.min(size, 8_192)
  const sample = Buffer.allocUnsafe(length)
  const descriptor = openSync(path, 'r')
  try {
    const read = readSync(descriptor, sample, 0, length, 0)
    return sample.subarray(0, read).includes(0) ? 'binary' : 'text'
  } finally {
    closeSync(descriptor)
  }
}

function previewKindFromName(name: string, size: number): FilePreviewKind {
  const mime = mimeTypeFromName(name)
  if (mime.startsWith('image/')) return size <= MAX_IMAGE_BYTES ? 'image' : 'too-large'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (mime === 'application/pdf') return size <= MAX_PDF_BYTES ? 'pdf' : 'too-large'
  if (isKnownText(name, mime)) return 'text'
  return 'binary'
}

function readBoundedText(path: string, size: number): { content: string; truncated: boolean } {
  const length = Math.min(size, MAX_TEXT_BYTES + 1)
  const bytes = Buffer.allocUnsafe(length)
  const descriptor = openSync(path, 'r')
  try {
    const read = readSync(descriptor, bytes, 0, length, 0)
    const truncated = size > MAX_TEXT_BYTES
    return { content: new TextDecoder('utf-8').decode(bytes.subarray(0, truncated ? Math.min(read, MAX_TEXT_BYTES) : read)), truncated }
  } finally {
    closeSync(descriptor)
  }
}

function isKnownText(name: string, mime: string): boolean {
  return mime.startsWith('text/') || TEXT_EXTENSIONS.has(extname(name).toLowerCase())
}

function mimeTypeFromName(name: string): string {
  return MIME_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream'
}

const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.csv', '.env', '.go', '.h', '.hpp', '.html', '.ini', '.java', '.js', '.json',
  '.jsx', '.kt', '.lock', '.log', '.md', '.mjs', '.mts', '.php', '.properties', '.py', '.rb', '.rs', '.sh', '.sql',
  '.svg', '.swift', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
])

const DANGEROUS_EXTENSIONS = new Set([
  '.app', '.bat', '.cmd', '.com', '.command', '.exe', '.js', '.lnk', '.msi', '.msp', '.ps1', '.scr', '.sh', '.url', '.vbs',
])

const MIME_TYPES: Record<string, string> = {
  '.aac': 'audio/aac', '.avif': 'image/avif', '.bmp': 'image/bmp', '.css': 'text/css', '.csv': 'text/csv',
  '.flac': 'audio/flac', '.gif': 'image/gif', '.htm': 'text/html', '.html': 'text/html', '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.json': 'application/json', '.md': 'text/markdown', '.m4a': 'audio/mp4',
  '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.oga': 'audio/ogg',
  '.ogg': 'audio/ogg', '.ogv': 'video/ogg', '.pdf': 'application/pdf', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.toml': 'text/plain', '.ts': 'text/plain', '.tsx': 'text/plain', '.txt': 'text/plain', '.wav': 'audio/wav',
  '.webm': 'video/webm', '.webp': 'image/webp', '.xml': 'application/xml', '.yaml': 'text/yaml', '.yml': 'text/yaml',
}
