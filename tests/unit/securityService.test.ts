import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ScanOptions, ScanPreflight, ScanResult } from '@openai/codex-security'
import { afterEach, describe, expect, it } from 'vitest'
import { SecurityService } from '../../src/main/security/securityService.js'
import { StateDatabase } from '../../src/main/state/database.js'
import type { SecurityScanRequest } from '../../src/shared/security.js'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('SecurityService', () => {
  it('preflights, streams a real-shaped result, persists history, and reads bounded artifacts', async () => {
    const fixture = createFixture()
    const sdk = createSdk((_repository, options = {}) => {
      options.onAuthentication?.({ method: 'stored_credentials', credentialType: 'chatgpt', verified: false })
      options.onTrustedAccessStatus?.('granted')
      options.onProgress?.({ phase: 'discovery', filesCompleted: 2, filesTotal: 4 })
      options.onActivity?.({ id: 'activity-1', kind: 'reasoning', status: 'running', description: '检查输入边界', paths: [] })
      options.onCost?.({ model: 'gpt-test', inputTokens: 1, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 1, estimatedUsd: 0.02 })
      const output = options.outputDir
      if (!output) throw new Error('Missing test output directory')
      mkdirSync(join(output, 'exports'), { recursive: true })
      writeFileSync(join(output, 'report.md'), '# Security report')
      writeFileSync(join(output, 'findings.json'), '{}')
      writeFileSync(join(output, 'coverage.json'), '{}')
      writeFileSync(join(output, 'scan-manifest.json'), '{}')
      writeFileSync(join(output, 'exports', 'results.sarif'), '{}')
      return Promise.resolve(completedResult(output))
    })
    const service = new SecurityService(fixture.database, fixture.securityRoot, {
      sdkFactory: () => sdk,
      pythonResolver: () => Promise.resolve('/private/python3.12'),
      cliRunner: (_cwd, args) => {
        if (args[0] === 'export') {
          const outputIndex = args.indexOf('--output')
          const output = args[outputIndex + 1]
          if (!output) return Promise.reject(new Error('Missing export output'))
          writeFileSync(output, '{"exported":true}')
        }
        return Promise.resolve('CLI_ACTION_OK')
      },
    })

    const runtime = await service.refreshRuntime()
    expect(runtime.runtime.python).toMatchObject({ status: 'ready' })
    expect(runtime.runtime.account).toEqual({ status: 'authenticated', details: 'Logged in using ChatGPT' })

    const request = scanRequest(fixture.projectId)
    const preflight = await service.preflight(request)
    expect(preflight).toMatchObject({ outputIsolated: true, targetKind: 'repository', model: 'gpt-test' })
    const initial = service.startScan(request)
    expect(initial.activeScanId).not.toBeNull()
    const completed = await waitForScan(service, 'completed')
    const scan = completed.scans[0]
    expect(scan?.progress).toMatchObject({ phase: 'discovery', filesCompleted: 2, costUsd: 0.02 })
    expect(scan?.result?.findings[0]).toMatchObject({ title: '命令注入', severity: 'high' })
    expect(completed.runtime.access).toBe('granted')
    expect(service.readArtifact({ scanId: scan?.id ?? '', kind: 'report' })).toEqual({
      kind: 'report', content: '# Security report', truncated: false,
    })
    expect(await service.runFindingAction({
      scanId: scan?.id ?? '', occurrenceId: 'occurrence-1', action: 'validate', confirmed: true,
    })).toMatchObject({ output: 'CLI_ACTION_OK', truncated: false })
    expect(await service.exportFindings({ scanId: scan?.id ?? '', format: 'json' })).toMatchObject({
      content: '{"exported":true}', format: 'json', truncated: false,
    })
    expect(fixture.database.listSecurityScans()[0]?.status).toBe('completed')
    await service.dispose()
    fixture.database.close()
  })

  it('cancels an active scan without claiming a completed result', async () => {
    const fixture = createFixture()
    const sdk = createSdk((_repository, options = {}) => new Promise<ScanResult>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('stopped')), { once: true })
    }))
    const service = new SecurityService(fixture.database, fixture.securityRoot, {
      sdkFactory: () => sdk,
      pythonResolver: () => Promise.resolve('/private/python3.12'),
    })
    const started = service.startScan(scanRequest(fixture.projectId))
    service.cancelScan(started.activeScanId ?? '')
    const cancelled = await waitForScan(service, 'cancelled')
    expect(cancelled.scans[0]).toMatchObject({ status: 'cancelled', result: null })
    await service.dispose()
    fixture.database.close()
  })

  it('classifies access failures and redacts credential-shaped error text', async () => {
    const fixture = createFixture()
    const sdk = createSdk(() => Promise.reject(
      new Error('403 Trusted Access required for api_key=sk-proj-example123456'),
    ))
    const service = new SecurityService(fixture.database, fixture.securityRoot, { sdkFactory: () => sdk })
    service.startScan(scanRequest(fixture.projectId))
    const failed = await waitForScan(service, 'failed')
    expect(failed.scans[0]?.error?.code).toBe('security_access_required')
    expect(failed.scans[0]?.error?.message).not.toContain('sk-proj-example123456')
    await service.dispose()
    fixture.database.close()
  })
})

function createFixture(): {
  database: StateDatabase
  projectId: string
  securityRoot: string
} {
  const root = mkdtempSync(join(tmpdir(), 'aster-security-test-'))
  temporaryPaths.push(root)
  const projectPath = join(root, 'project')
  mkdirSync(projectPath)
  const database = new StateDatabase(join(root, 'state.sqlite3'))
  const project = database.upsertProject(projectPath)
  return { database, projectId: project.id, securityRoot: join(root, 'private-security') }
}

function createSdk(run: (repository: string, options?: ScanOptions) => Promise<ScanResult>) {
  return {
    metadata: {
      sdk: '@openai/codex-sdk' as const,
      sdkVersion: '0.144.6',
      executable: '@openai/codex' as const,
      executableVersion: '0.144.6',
    },
    preflight: (repository: string, options: ScanOptions = {}): Promise<ScanPreflight> => Promise.resolve({
      repository,
      target: { kind: 'repository', paths: [] },
      mode: options.mode ?? 'standard',
      outputDir: options.outputDir ?? null,
      authentication: { method: 'stored_credentials', credentialType: 'chatgpt', verified: false },
      model: 'gpt-test',
      reasoningEffort: 'high',
    }),
    run,
    account: () => Promise.resolve({ authenticated: true, details: 'Logged in using ChatGPT' }),
    close: () => Promise.resolve(),
  }
}

function scanRequest(projectId: string): SecurityScanRequest {
  return { projectId, mode: 'standard', target: { kind: 'repository' }, auth: 'chatgpt', maxCostUsd: 5 }
}

function completedResult(scanDir: string): ScanResult {
  return {
    manifest: { scan: { id: 'sdk-scan-1' } },
    pluginVersion: '0.1.15',
    threadId: 'thread-security',
    sarifPath: join(scanDir, 'exports', 'results.sarif'),
    coverage: {
      mode: 'repository', completeness: 'complete', surfaces: [{ id: 'web' }], deferred: [], openQuestions: [],
    },
    findings: {
      findings: [{
        findingId: 'finding-1', occurrenceId: 'occurrence-1', ruleId: 'CWE-78', title: '命令注入',
        summary: '未验证输入到达命令执行。', severity: { level: 'high', score: 8.1 },
        confidence: { level: 'high', rationale: '路径可达' }, taxonomy: { category: 'injection', cwe: ['CWE-78'] },
        locations: [{ path: 'src/run.ts', startLine: 4 }], remediation: '使用参数数组。',
        provenance: { source: 'codex-security' },
      }],
    },
  } as unknown as ScanResult
}

async function waitForScan(
  service: SecurityService,
  status: 'completed' | 'failed' | 'cancelled',
): Promise<ReturnType<SecurityService['getSnapshot']>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = service.getSnapshot()
    if (snapshot.scans[0]?.status === status) return snapshot
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Timed out waiting for ${status}`)
}
