import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileLogSink } from '../../src/main/logging/logger.js'
import { SizeLimitedRotation } from '../../src/main/logging/sizeRotation.js'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('SizeLimitedRotation', () => {
  it('rotates bounded log files before the next write', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aster-log-test-'))
    temporaryPaths.push(directory)
    mkdirSync(directory, { recursive: true })
    const path = join(directory, 'runtime.jsonl')
    writeFileSync(path, 'a'.repeat(1024))
    const sink = new FileLogSink(path, { rotation: new SizeLimitedRotation(1024, 2) })

    await sink.write('next\n')

    expect(readFileSync(`${path}.1`, 'utf8')).toHaveLength(1024)
    expect(readFileSync(path, 'utf8')).toBe('next\n')
  })
})
