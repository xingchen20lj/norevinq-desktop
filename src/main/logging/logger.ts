import { appendFile, mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { redact, redactString } from './redact.js'

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export type StructuredLogEntry = {
  time: string
  level: LogLevel
  component: string
  message: string
  data: unknown
}

export type LogRotationContext = {
  filePath: string
  currentBytes: number
  incomingBytes: number
}

/**
 * Rotation is kept outside the logger so desktop packaging can choose rename,
 * compression, and retention policies without weakening the redaction boundary.
 */
export type LogRotationStrategy = {
  beforeWrite(context: LogRotationContext): void | Promise<void>
}

export type LogSink = {
  write(line: string): void | Promise<void>
  close?(): void | Promise<void>
}

export type FileLogSinkOptions = {
  rotation?: LogRotationStrategy
}

export class FileLogSink implements LogSink {
  readonly #filePath: string
  readonly #rotation: LogRotationStrategy | undefined

  constructor(filePath: string, options: FileLogSinkOptions = {}) {
    this.#filePath = filePath
    this.#rotation = options.rotation
  }

  async write(line: string): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true })
    if (this.#rotation) {
      const file = await stat(this.#filePath).catch((error: unknown) => {
        if (isMissingFileError(error)) return undefined
        throw error
      })
      await this.#rotation.beforeWrite({
        currentBytes: file?.size ?? 0,
        filePath: this.#filePath,
        incomingBytes: Buffer.byteLength(line, 'utf8'),
      })
    }
    await appendFile(this.#filePath, line, { encoding: 'utf8', mode: 0o600 })
  }
}

export type JsonlLoggerOptions = {
  component: string
  filePath?: string
  sink?: LogSink
  minimumLevel?: LogLevel
  clock?: () => Date | string
  rotation?: LogRotationStrategy
}

export class JsonlLogger {
  readonly #clock: () => Date | string
  readonly #component: string
  readonly #minimumLevel: LogLevel
  readonly #sink: LogSink
  #pending: Promise<void> = Promise.resolve()

  constructor(options: JsonlLoggerOptions) {
    if (!options.component.trim()) throw new Error('A logger component is required.')
    if (options.filePath && options.sink) {
      throw new Error('Configure either filePath or sink, not both.')
    }
    if (!options.filePath && !options.sink) {
      throw new Error('A logger filePath or sink is required.')
    }

    this.#clock = options.clock ?? (() => new Date())
    this.#component = redactString(options.component)
    this.#minimumLevel = options.minimumLevel ?? 'info'
    if (options.sink) {
      this.#sink = options.sink
    } else if (options.filePath) {
      this.#sink = new FileLogSink(
        options.filePath,
        options.rotation ? { rotation: options.rotation } : {},
      )
    } else {
      // The public validation above makes this unreachable and this branch keeps
      // the invariant explicit to TypeScript without a non-null assertion.
      throw new Error('A logger filePath or sink is required.')
    }
  }

  debug(message: string, data?: unknown): Promise<void> {
    return this.log('debug', message, data)
  }

  info(message: string, data?: unknown): Promise<void> {
    return this.log('info', message, data)
  }

  warn(message: string, data?: unknown): Promise<void> {
    return this.log('warn', message, data)
  }

  error(message: string, data?: unknown): Promise<void> {
    return this.log('error', message, data)
  }

  log(level: LogLevel, message: string, data?: unknown): Promise<void> {
    if (levelRank(level) < levelRank(this.#minimumLevel)) return Promise.resolve()

    const now = this.#clock()
    const entry: StructuredLogEntry = {
      time: typeof now === 'string' ? redactString(now) : now.toISOString(),
      level,
      component: this.#component,
      message: redactString(message),
      data: redact(data ?? null),
    }
    const line = `${JSON.stringify(entry)}\n`
    const write = this.#pending.then(async () => this.#sink.write(line))

    // A failed write is still returned to its caller, while this recovery keeps one
    // disk error from permanently poisoning all later log attempts.
    this.#pending = write.catch(() => undefined)
    return write
  }

  async flush(): Promise<void> {
    await this.#pending
  }

  async close(): Promise<void> {
    await this.flush()
    await this.#sink.close?.()
  }
}

export function createLogger(options: JsonlLoggerOptions): JsonlLogger {
  return new JsonlLogger(options)
}

function levelRank(level: LogLevel): number {
  return LOG_LEVELS.indexOf(level)
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}
