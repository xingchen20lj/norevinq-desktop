import { rename, rm } from 'node:fs/promises'
import type { LogRotationContext, LogRotationStrategy } from './logger.js'

export class SizeLimitedRotation implements LogRotationStrategy {
  readonly #maxBytes: number
  readonly #retainedFiles: number

  constructor(maxBytes = 2 * 1024 * 1024, retainedFiles = 3) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024) throw new Error('maxBytes must be an integer of at least 1024.')
    if (!Number.isSafeInteger(retainedFiles) || retainedFiles < 1) throw new Error('retainedFiles must be a positive integer.')
    this.#maxBytes = maxBytes
    this.#retainedFiles = retainedFiles
  }

  async beforeWrite(context: LogRotationContext): Promise<void> {
    if (context.currentBytes + context.incomingBytes <= this.#maxBytes) return

    await rm(`${context.filePath}.${String(this.#retainedFiles)}`, { force: true })
    for (let index = this.#retainedFiles - 1; index >= 1; index -= 1) {
      await renameIfPresent(`${context.filePath}.${String(index)}`, `${context.filePath}.${String(index + 1)}`)
    }
    await renameIfPresent(context.filePath, `${context.filePath}.1`)
  }
}

async function renameIfPresent(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch (error: unknown) {
    if (!isMissingFileError(error)) throw error
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
