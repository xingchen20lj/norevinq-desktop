import { randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  opendirSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs'
import type { Dirent } from 'node:fs'
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import type {
  FileContextInput,
  FileOpenInput,
  FilePathInput,
  FilePreviewKind,
  AgentImagePreview,
  AgentImagePreviewInput,
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

type PreviewToken = {
  path: string
  mimeType: string
  size: number
  device: number
  inode: number
  expiresAt: number
}
type FileServiceOptions = {
  now?: () => number
  openPath?: (path: string) => Promise<string>
  trustedArtifactRoots?: string[]
}

export class FileService {
  readonly #database: StateDatabase
  readonly #now: () => number
  readonly #openPath: (path: string) => Promise<string>
  readonly #trustedArtifactRoots: string[]
  readonly #tokens = new Map<string, PreviewToken>()

  constructor(database: StateDatabase, options: FileServiceOptions = {}) {
    this.#database = database
    this.#now = options.now ?? Date.now
    this.#openPath = options.openPath ?? (() => Promise.reject(new Error('External file opening is unavailable.')))
    this.#trustedArtifactRoots = (options.trustedArtifactRoots ?? []).map((path) => resolve(path))
  }

  listDirectory(input: FilePathInput): ProjectDirectory {
    const root = this.#root(input)
    const { absolute, relativePath } = this.#resolve(root, input.path, true)
    const metadata = lstatSync(absolute)
    if (!metadata.isDirectory()) throw new Error('The requested path is not a directory.')
    const all: Dirent[] = []
    const directory = opendirSync(absolute)
    let truncated = false
    try {
      for (;;) {
        const entry = directory.readSync()
        if (!entry) break
        if (entry.name === '.git') continue
        if (all.length >= MAX_DIRECTORY_ENTRIES) {
          truncated = true
          break
        }
        all.push(entry)
      }
    } finally {
      directory.closeSync()
    }
    all.sort((left, right) => {
        const directoryOrder = Number(right.isDirectory()) - Number(left.isDirectory())
        return directoryOrder || left.name.localeCompare(right.name, undefined, { numeric: true })
      })
    const entries = all.map((entry): ProjectFileEntry => {
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
    return { ...input, path: relativePath, entries, truncated }
  }

  readPreview(input: FilePathInput): ProjectFilePreview {
    const root = this.#root(input)
    const { absolute, relativePath } = this.#resolve(root, input.path, false)
    const metadata = lstatSync(absolute)
    if (!metadata.isFile()) throw new Error('Only regular files can be previewed.')
    const descriptor = openRegularFileWithoutFollowingLinks(absolute, metadata.dev, metadata.ino)
    try {
      const opened = fstatSync(descriptor)
      const mimeType = mimeTypeFromName(relativePath)
      const detected = detectPreviewKind(descriptor, relativePath, opened.size)
      if (detected === 'text') {
        const { content, truncated } = readBoundedText(descriptor, opened.size)
        return preview(input, relativePath, opened.size, opened.mtime, mimeType, 'text', content, null, truncated)
      }
      if (detected === 'too-large' || detected === 'binary') {
        return preview(input, relativePath, opened.size, opened.mtime, mimeType, detected, null, null, false)
      }
      const token = this.#issueToken(absolute, mimeType, opened.size, opened.dev, opened.ino)
      return preview(input, relativePath, opened.size, opened.mtime, mimeType, detected, null, `norevinq-file://preview/${token}`, false)
    } finally {
      closeSync(descriptor)
    }
  }

  readAgentImage(input: AgentImagePreviewInput): AgentImagePreview {
    const roots = [this.#root(input), ...this.#trustedArtifactRoots]
    const absolute = this.#resolveTrustedAbsolute(roots, input.path)
    const metadata = lstatSync(absolute)
    if (!metadata.isFile()) throw new Error('Only regular image files can be previewed.')
    const mimeType = mimeTypeFromName(absolute)
    if (!SAFE_INLINE_IMAGE_MIMES.has(mimeType)) throw new Error('This image format cannot be displayed inline.')
    if (metadata.size > MAX_IMAGE_BYTES) throw new Error('The image exceeds the safe preview limit.')
    const token = this.#issueToken(absolute, mimeType, metadata.size, metadata.dev, metadata.ino)
    return {
      name: absolute.split(sep).at(-1) ?? 'image',
      size: metadata.size,
      mimeType,
      url: `norevinq-file://preview/${token}`,
    }
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
      if (metadata.dev !== value.device || metadata.ino !== value.inode) return null
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

  #resolveTrustedAbsolute(roots: string[], inputPath: string): string {
    if (inputPath.includes('\0') || !isAbsolute(inputPath)) throw new Error('An absolute image path is required.')
    const candidate = resolve(inputPath)
    for (const configuredRoot of roots) {
      try {
        if (lstatSync(configuredRoot).isSymbolicLink()) continue
        const lexicalRelative = relative(configuredRoot, candidate)
        if (lexicalRelative && lexicalRelative !== '..' && !lexicalRelative.startsWith(`..${sep}`) && !isAbsolute(lexicalRelative)) {
          let lexicalCurrent = configuredRoot
          for (const segment of lexicalRelative.split(sep)) {
            lexicalCurrent = join(lexicalCurrent, segment)
            if (lstatSync(lexicalCurrent).isSymbolicLink()) throw new Error('Symbolic links cannot be traversed by the previewer.')
          }
        }
        const canonicalRoot = realpathSync(configuredRoot)
        const canonicalCandidate = realpathSync(candidate)
        const relativePath = relative(canonicalRoot, canonicalCandidate)
        if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) continue
        let current = canonicalRoot
        for (const segment of relativePath.split(sep)) {
          current = join(current, segment)
          if (lstatSync(current).isSymbolicLink()) throw new Error('Symbolic links cannot be traversed by the previewer.')
        }
        const canonical = realpathSync(current)
        if (canonical.startsWith(`${canonicalRoot}${sep}`)) return canonical
      } catch (error) {
        if (error instanceof Error && error.message.includes('Symbolic links')) throw error
      }
    }
    throw new Error('The image is outside the active project and Norevinq artifact directory.')
  }

  #issueToken(path: string, mimeType: string, size: number, device: number, inode: number): string {
    this.#expireTokens()
    while (this.#tokens.size >= MAX_TOKENS) {
      const oldest = this.#tokens.keys().next().value
      if (!oldest) break
      this.#tokens.delete(oldest)
    }
    const token = randomUUID()
    this.#tokens.set(token, { path, mimeType, size, device, inode, expiresAt: this.#now() + TOKEN_TTL_MS })
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

function detectPreviewKind(descriptor: number, name: string, size: number): FilePreviewKind {
  const kind = previewKindFromName(name, size)
  if (kind !== 'binary') return kind
  const length = Math.min(size, 8_192)
  const sample = Buffer.allocUnsafe(length)
  const read = readSync(descriptor, sample, 0, length, 0)
  return sample.subarray(0, read).includes(0) ? 'binary' : 'text'
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

function readBoundedText(descriptor: number, size: number): { content: string; truncated: boolean } {
  const length = Math.min(size, MAX_TEXT_BYTES + 1)
  const bytes = Buffer.allocUnsafe(length)
  const read = readSync(descriptor, bytes, 0, length, 0)
  const truncated = size > MAX_TEXT_BYTES
  return { content: new TextDecoder('utf-8').decode(bytes.subarray(0, truncated ? Math.min(read, MAX_TEXT_BYTES) : read)), truncated }
}

function openRegularFileWithoutFollowingLinks(path: string, expectedDevice: number, expectedInode: number): number {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const metadata = fstatSync(descriptor)
    if (!metadata.isFile() || metadata.dev !== expectedDevice || metadata.ino !== expectedInode) {
      throw new Error('The file changed while it was being opened. Refresh and try again.')
    }
    return descriptor
  } catch (error) {
    closeSync(descriptor)
    throw error
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

const SAFE_INLINE_IMAGE_MIMES = new Set([
  'image/avif', 'image/bmp', 'image/gif', 'image/x-icon', 'image/jpeg', 'image/png', 'image/webp',
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
