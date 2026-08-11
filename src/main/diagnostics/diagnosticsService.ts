import {
  appendFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { chmod, lstat, open, rename, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { redact, redactString } from '../logging/redact.js'
import type {
  CrashRecord,
  CrashRecordInput,
  DiagnosticsExportResult,
  DiagnosticsSnapshot,
} from '../../shared/diagnostics.js'

const MAX_CRASH_FILE_BYTES = 256 * 1024
const MAX_CRASH_RECORDS = 100
const MAX_EVENT_TEXT = 2_048
const MAX_RUNTIME_LOG_BYTES = 1024 * 1024

export type DiagnosticsServiceOptions = {
  crashFilePath: string
  runtimeLogPath: string
  appVersion: string
  platform: NodeJS.Platform
  arch: string
  isPackaged: boolean
  versions: Readonly<Record<string, string | undefined>>
  redactionRoots?: readonly string[]
  clock?: () => Date
}

export class DiagnosticsService {
  readonly #options: DiagnosticsServiceOptions
  readonly #clock: () => Date
  readonly #roots: readonly string[]
  #records: CrashRecord[]

  constructor(options: DiagnosticsServiceOptions) {
    if (!isAbsolute(options.crashFilePath) || !isAbsolute(options.runtimeLogPath)) {
      throw new Error('Diagnostic storage paths must be absolute.')
    }
    this.#options = options
    this.#clock = options.clock ?? (() => new Date())
    this.#roots = [...new Set((options.redactionRoots ?? [])
      .filter((root) => isAbsolute(root))
      .map((root) => resolve(root)))]
      .sort((left, right) => right.length - left.length)
    this.#records = this.#loadCrashRecords()
  }

  getSnapshot(): DiagnosticsSnapshot {
    return {
      retainedCrashCount: this.#records.length,
      latestCrashAt: this.#records.at(-1)?.occurredAt ?? null,
      runtimeLogAvailable: isBoundedRegularFile(this.#options.runtimeLogPath, 4 * 1024 * 1024),
      automaticUpload: false,
    }
  }

  recordCrash(input: CrashRecordInput): CrashRecord {
    const record: CrashRecord = {
      id: randomUUID(),
      occurredAt: this.#clock().toISOString(),
      process: input.process,
      reason: this.#sanitizeText(input.reason) || 'unknown',
      message: input.message ? this.#sanitizeText(input.message) : null,
      exitCode: Number.isSafeInteger(input.exitCode) ? input.exitCode ?? null : null,
      processType: input.processType ? this.#sanitizeText(input.processType) : null,
    }
    const line = `${JSON.stringify(record)}\n`
    this.#rotateCrashFileIfNeeded(Buffer.byteLength(line, 'utf8'))
    const directory = dirname(this.#options.crashFilePath)
    mkdirSync(directory, { mode: 0o700, recursive: true })
    const directoryMetadata = lstatSync(directory)
    if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
      throw new Error('Diagnostic crash directory must be a real directory.')
    }
    chmodSync(directory, 0o700)
    if (existsSync(this.#options.crashFilePath)) {
      const target = lstatSync(this.#options.crashFilePath)
      if (!target.isFile() || target.isSymbolicLink()) {
        throw new Error('Diagnostic crash target must be a regular file.')
      }
    }
    appendFileSync(this.#options.crashFilePath, line, { encoding: 'utf8', mode: 0o600 })
    chmodSync(this.#options.crashFilePath, 0o600)
    this.#records = [...this.#records, record].slice(-MAX_CRASH_RECORDS)
    return structuredClone(record)
  }

  async exportBundle(destinationPath: string): Promise<DiagnosticsExportResult> {
    if (!isAbsolute(destinationPath) || extname(destinationPath).toLowerCase() !== '.zip') {
      throw new Error('Diagnostic exports require an absolute .zip destination.')
    }
    await requireSafeDestination(destinationPath)

    const crashes = `${JSON.stringify(this.#records.map((record) => this.#sanitizeCrashRecord(record)), null, 2)}\n`
    const runtimeLog = await this.#readSanitizedRuntimeLog()
    const manifest = {
      schemaVersion: 1,
      generatedAt: this.#clock().toISOString(),
      product: 'Aster Code',
      appVersion: this.#options.appVersion,
      platform: this.#options.platform,
      arch: this.#options.arch,
      packaged: this.#options.isPackaged,
      runtimeVersions: sanitizeVersionMap(this.#options.versions),
      privacy: {
        automaticUpload: false,
        conversationsIncluded: false,
        projectFilesIncluded: false,
        credentialsIncluded: false,
        absolutePathsRedacted: true,
      },
      files: {
        'crashes.json': { bytes: Buffer.byteLength(crashes), sha256: sha256(crashes) },
        'runtime-log.jsonl': { bytes: Buffer.byteLength(runtimeLog), sha256: sha256(runtimeLog) },
      },
    }
    const archive = zipSync({
      'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
      'crashes.json': strToU8(crashes),
      'runtime-log.jsonl': strToU8(runtimeLog),
    }, { level: 6 })
    await writeAtomic(destinationPath, archive)
    return { exported: true, fileName: basename(destinationPath), bytes: archive.byteLength }
  }

  #loadCrashRecords(): CrashRecord[] {
    const records: CrashRecord[] = []
    for (const path of [`${this.#options.crashFilePath}.1`, this.#options.crashFilePath]) {
      if (!isBoundedRegularFile(path, MAX_CRASH_FILE_BYTES)) continue
      for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
        if (!line) continue
        try {
          const parsed = JSON.parse(line) as unknown
          if (isCrashRecord(parsed)) records.push(this.#sanitizeCrashRecord(parsed))
        } catch {
          // A partial final line after a crash is ignored rather than blocking startup.
        }
      }
    }
    return records.slice(-MAX_CRASH_RECORDS)
  }

  #rotateCrashFileIfNeeded(incomingBytes: number): void {
    let currentBytes: number
    try {
      const metadata = lstatSync(this.#options.crashFilePath)
      if (!metadata.isFile() || metadata.isSymbolicLink()) return
      currentBytes = metadata.size
    } catch {
      return
    }
    if (currentBytes + incomingBytes <= MAX_CRASH_FILE_BYTES) return
    rmSync(`${this.#options.crashFilePath}.1`, { force: true })
    renameSync(this.#options.crashFilePath, `${this.#options.crashFilePath}.1`)
  }

  async #readSanitizedRuntimeLog(): Promise<string> {
    const path = this.#options.runtimeLogPath
    const metadata = await lstat(path).catch(() => null)
    if (!metadata?.isFile() || metadata.isSymbolicLink()) return ''
    const descriptor = await open(path, 'r')
    try {
      const file = await descriptor.stat()
      if (!file.isFile()) return ''
      const length = Math.min(file.size, MAX_RUNTIME_LOG_BYTES)
      const buffer = Buffer.alloc(length)
      await descriptor.read(buffer, 0, length, Math.max(0, file.size - length))
      return buffer.toString('utf8').split(/\r?\n/u).filter(Boolean).map((line) => {
        try {
          return JSON.stringify(sanitizeValue(redact(JSON.parse(line) as unknown), this.#roots))
        } catch {
          return this.#sanitizeText(line)
        }
      }).join('\n') + (length > 0 ? '\n' : '')
    } finally {
      await descriptor.close()
    }
  }

  #sanitizeText(value: string): string {
    return sanitizeText(value, this.#roots).slice(0, MAX_EVENT_TEXT)
  }

  #sanitizeCrashRecord(record: CrashRecord): CrashRecord {
    return {
      id: record.id.slice(0, 128),
      occurredAt: record.occurredAt.slice(0, 100),
      process: record.process,
      reason: this.#sanitizeText(record.reason) || 'unknown',
      message: record.message ? this.#sanitizeText(record.message) : null,
      exitCode: Number.isSafeInteger(record.exitCode) ? record.exitCode : null,
      processType: record.processType ? this.#sanitizeText(record.processType) : null,
    }
  }
}

async function requireSafeDestination(path: string): Promise<void> {
  const parent = await lstat(dirname(path)).catch(() => null)
  if (!parent?.isDirectory()) throw new Error('Diagnostic export directory does not exist.')
  const existing = await lstat(path).catch(() => null)
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
    throw new Error('Diagnostic export destination must be a regular file.')
  }
}

async function writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
  const temporary = join(dirname(path), `.aster-diagnostics-${String(process.pid)}-${randomUUID()}.tmp`)
  const descriptor = await open(temporary, 'wx', 0o600)
  try {
    await descriptor.writeFile(bytes)
    await descriptor.sync()
  } catch (error) {
    await descriptor.close().catch(() => undefined)
    await rm(temporary, { force: true })
    throw error
  }
  await descriptor.close()
  try {
    await rename(temporary, path)
  } catch (error) {
    if (process.platform !== 'win32' || !isReplaceError(error)) {
      await rm(temporary, { force: true })
      throw error
    }
    await rm(path, { force: true })
    await rename(temporary, path)
  }
  await chmod(path, 0o600)
}

function sanitizeValue(value: unknown, roots: readonly string[]): unknown {
  if (typeof value === 'string') return sanitizeText(value, roots)
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, roots))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item, roots)]))
}

function sanitizeText(value: string, roots: readonly string[]): string {
  let output = redactString(value)
  for (const root of roots) output = output.split(root).join('[PATH]')
  return output
    .replace(/(?<![A-Za-z0-9:/.])\/(?:[^/\s"'():]+\/)*[^/\s"'():]+/gu, '[PATH]')
    .replace(/(?<![A-Za-z0-9])[A-Za-z]:\\(?:[^\\\s"'():]+\\)*[^\\\s"'():]+/gu, '[PATH]')
}

function sanitizeVersionMap(versions: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(Object.entries(versions)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([key, value]) => [redactString(key).slice(0, 64), redactString(value).slice(0, 128)]))
}

function isBoundedRegularFile(path: string, maxBytes: number): boolean {
  if (!existsSync(path)) return false
  try {
    const metadata = lstatSync(path)
    return metadata.isFile() && !metadata.isSymbolicLink() && metadata.size <= maxBytes
  } catch {
    return false
  }
}

function isCrashRecord(value: unknown): value is CrashRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<CrashRecord>
  return typeof record.id === 'string'
    && record.id.length <= 128
    && typeof record.occurredAt === 'string'
    && record.occurredAt.length <= 100
    && !Number.isNaN(Date.parse(record.occurredAt))
    && (record.process === 'main' || record.process === 'renderer' || record.process === 'utility')
    && typeof record.reason === 'string'
    && record.reason.length <= MAX_EVENT_TEXT
    && (record.message === null || typeof record.message === 'string')
    && (record.message === null || record.message.length <= MAX_EVENT_TEXT)
    && (record.exitCode === null || Number.isSafeInteger(record.exitCode))
    && (record.processType === null || typeof record.processType === 'string')
    && (record.processType === null || record.processType.length <= MAX_EVENT_TEXT)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isReplaceError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error.code === 'EEXIST' || error.code === 'EPERM')
}
