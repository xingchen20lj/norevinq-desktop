import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { DiagnosticsService } from '../../src/main/diagnostics/diagnosticsService.js'

const temporaryDirectories: string[] = []
afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, {
    force: true, recursive: true, maxRetries: 5, retryDelay: 100,
  })
})

describe('DiagnosticsService', () => {
  it('persists bounded crash metadata without retaining secrets or absolute roots', () => {
    const fixture = createFixture()
    const service = createService(fixture)
    const record = service.recordCrash({
      process: 'renderer',
      reason: 'crashed',
      message: `Bearer secret-token failed in ${fixture.root}/project/private.ts`,
      exitCode: 23,
      processType: 'Renderer',
    })

    expect(record.message).toContain('[REDACTED]')
    expect(record.message).toContain('[PATH]')
    expect(record.message).not.toContain('secret-token')
    expect(record.message).not.toContain(fixture.root)
    expect(service.getSnapshot()).toMatchObject({
      retainedCrashCount: 1,
      latestCrashAt: '2026-08-11T04:00:00.000Z',
      automaticUpload: false,
    })
    if (process.platform !== 'win32') expect(lstatSync(fixture.crashPath).mode & 0o777).toBe(0o600)
    expect(createService(fixture).getSnapshot().retainedCrashCount).toBe(1)
  })

  it('exports a private ZIP with a manifest and sanitized bounded log', async () => {
    const fixture = createFixture()
    writeFileSync(fixture.logPath, `${JSON.stringify({
      message: 'Codex initialized',
      data: { binaryPath: `${fixture.root}/node_modules/@openai/codex/bin/codex`, token: 'secret-value' },
    })}\n`, { mode: 0o600 })
    const service = createService(fixture)
    service.recordCrash({ process: 'main', reason: 'uncaughtException', message: 'sk-project-secret-value' })
    const destination = join(fixture.root, 'diagnostics.zip')
    const result = await service.exportBundle(destination)
    const files = unzipSync(readFileSync(destination))
    const manifest = JSON.parse(strFromU8(files['manifest.json'] ?? new Uint8Array())) as {
      privacy: { automaticUpload: boolean; projectFilesIncluded: boolean }
      files: Record<string, { sha256: string }>
    }
    const log = strFromU8(files['runtime-log.jsonl'] ?? new Uint8Array())
    const crashes = strFromU8(files['crashes.json'] ?? new Uint8Array())

    expect(result).toMatchObject({ exported: true, fileName: 'diagnostics.zip' })
    expect(result.bytes).toBeGreaterThan(0)
    expect(manifest.privacy).toEqual(expect.objectContaining({ automaticUpload: false, projectFilesIncluded: false }))
    expect(manifest.files['runtime-log.jsonl']?.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(log).toContain('[PATH]')
    expect(log).toContain('[REDACTED]')
    expect(log).not.toContain(fixture.root)
    expect(log).not.toContain('secret-value')
    expect(crashes).not.toContain('sk-project-secret-value')
    if (process.platform !== 'win32') expect(lstatSync(destination).mode & 0o777).toBe(0o600)
  })

  it('rejects symlink destinations and ignores symlinked logs', async () => {
    const fixture = createFixture()
    const outside = join(fixture.root, 'outside.txt')
    writeFileSync(outside, 'do not replace')
    symlinkSync(outside, fixture.logPath)
    const service = createService(fixture)
    expect(service.getSnapshot().runtimeLogAvailable).toBe(false)

    const destination = join(fixture.root, 'diagnostics.zip')
    symlinkSync(outside, destination)
    await expect(service.exportBundle(destination)).rejects.toThrow('regular file')
    expect(readFileSync(outside, 'utf8')).toBe('do not replace')
  })

  it('never follows a symlink used as the crash journal', () => {
    const fixture = createFixture()
    const outside = join(fixture.root, 'outside-crash.txt')
    writeFileSync(outside, 'preserve me')
    symlinkSync(outside, fixture.crashPath)
    const service = createService(fixture)
    expect(() => service.recordCrash({ process: 'main', reason: 'crashed' })).toThrow('regular file')
    expect(readFileSync(outside, 'utf8')).toBe('preserve me')
  })

  it('redacts a valid but locally modified historical record again during export', async () => {
    const fixture = createFixture()
    writeFileSync(fixture.crashPath, `${JSON.stringify({
      id: '00000000-0000-4000-8000-000000000000',
      occurredAt: '2026-08-11T03:00:00.000Z',
      process: 'main',
      reason: 'uncaughtException',
      message: `Authorization: Bearer tampered-secret at ${fixture.root}/private/file.ts`,
      exitCode: null,
      processType: null,
    })}\n`, { mode: 0o600 })
    const service = createService(fixture)
    const destination = join(fixture.root, 'historical.zip')
    await service.exportBundle(destination)
    const files = unzipSync(readFileSync(destination))
    const crashes = strFromU8(files['crashes.json'] ?? new Uint8Array())
    expect(crashes).toContain('[REDACTED]')
    expect(crashes).toContain('[PATH]')
    expect(crashes).not.toContain('tampered-secret')
    expect(crashes).not.toContain(fixture.root)
  })
})

function createFixture(): { root: string; crashPath: string; logPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'aster-diagnostics-'))
  temporaryDirectories.push(root)
  const diagnostics = join(root, 'diagnostics')
  const logs = join(root, 'logs')
  mkdirSync(diagnostics, { recursive: true })
  mkdirSync(logs, { recursive: true })
  chmodSync(diagnostics, 0o700)
  return {
    root,
    crashPath: join(diagnostics, 'crashes.jsonl'),
    logPath: join(logs, 'runtime.jsonl'),
  }
}

function createService(fixture: ReturnType<typeof createFixture>): DiagnosticsService {
  return new DiagnosticsService({
    appVersion: '0.1.0',
    arch: 'x64',
    crashFilePath: fixture.crashPath,
    isPackaged: true,
    platform: 'darwin',
    redactionRoots: [fixture.root],
    runtimeLogPath: fixture.logPath,
    versions: { chrome: '151.0.0', electron: '43.3.0', node: '24.14.0' },
    clock: () => new Date('2026-08-11T04:00:00.000Z'),
  })
}
