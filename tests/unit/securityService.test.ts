import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodexSecurity, type CodexSecurityConfig, type ScanOptions, type ScanPreflight, type ScanResult } from '@openai/codex-security'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareMacDeepScanCodexWrapper, SecurityService } from '../../src/main/security/securityService.js'
import { createDeepSeekSecurityConfig } from '../../src/main/providers/deepseek.js'
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

  it('preserves the primary Deep Scan coordinator failure instead of the secondary completion error', async () => {
    const fixture = createFixture()
    const sdk = createSdk((_repository, options = {}) => {
      const output = options.outputDir ?? ''
      mkdirSync(join(output, 'artifacts', 'deep_discovery'), { recursive: true })
      writeFileSync(join(output, 'artifacts', 'deep_discovery', 'coordinator-manifest.json'), JSON.stringify({
        status: 'failed',
        failure: {
          message: 'Deep Scan stopped after 3 workers: failed to initialize in-process app-server client: Operation not permitted',
        },
      }))
      return Promise.reject(new Error('Could not save the Codex Security scan: Only a running scan can be completed.'))
    })
    const service = new SecurityService(fixture.database, fixture.securityRoot, { sdkFactory: () => sdk })
    service.startScan({ ...scanRequest(fixture.projectId), mode: 'deep' })
    const failed = await waitForScan(service, 'failed')
    expect(failed.scans[0]?.error).toMatchObject({ code: 'deep_worker_sandbox' })
    expect(failed.scans[0]?.error?.message).toContain('Deep Scan stopped after 3 workers')
    expect(failed.scans[0]?.error?.message).not.toContain('Only a running scan')
    await service.dispose()
    fixture.database.close()
  })

  it('creates an isolated DeepSeek SDK per scan without exposing its credential in public config', async () => {
    const fixture = createFixture()
    const configs: CodexSecurityConfig[] = []
    const sdk = createSdk((_repository, options = {}) => {
      options.onUsage?.({
        inputTokens: 1_000, cachedInputTokens: 400, cacheWriteInputTokens: 0,
        outputTokens: 100, reasoningOutputTokens: 50, totalTokens: 1_100,
      })
      return Promise.reject(new Error('stop after usage test'))
    })
    const service = new SecurityService(fixture.database, fixture.securityRoot, {
      sdkFactory: (config) => {
        if (config) configs.push(config)
        return sdk
      },
      deepSeekCredential: () => 'sk-deepseek-isolated-test-secret',
      codexBinary: () => '/opt/aster/codex-0.147.0',
      environment: {
        PATH: '/usr/bin',
        GITHUB_TOKEN: 'must-not-propagate',
        OPENAI_API_KEY: 'must-not-propagate',
        CODEX_API_KEY: 'must-not-propagate',
      },
      exchangeRateResolver: () => Promise.resolve({ rate: 7, date: '2026-08-14', source: 'frankfurter-ecb' }),
    })
    service.startScan({
      projectId: fixture.projectId,
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      mode: 'standard',
      target: { kind: 'repository' },
      auth: 'auto',
    })
    const failed = await waitForScan(service, 'failed')
    const config = configs[0]
    expect(config?.codexOverrides).toMatchObject({ model: 'deepseek-v4-pro', model_provider: 'deepseek' })
    expect(config?.environment).toMatchObject({ PATH: '/usr/bin', DEEPSEEK_API_KEY: 'sk-deepseek-isolated-test-secret' })
    expect(config?.environment).toHaveProperty('CODEX_CLI_PATH', '/opt/aster/codex-0.147.0')
    expect(config?.environment).not.toHaveProperty('GITHUB_TOKEN')
    expect(config?.environment).not.toHaveProperty('OPENAI_API_KEY')
    expect(config?.environment).not.toHaveProperty('CODEX_API_KEY')
    expect(failed.scans[0]?.progress?.deepseekUsage).toMatchObject({
      inputTokens: 1_000, cachedInputTokens: 400, uncachedInputTokens: 600,
    })
    expect(failed.scans[0]?.progress?.deepseekUsage?.estimatedCny).toBeGreaterThan(0)
    await service.dispose()
    fixture.database.close()
  })

  it('pins the real packaged plugin path into both base and DeepSeek SDK instances', async () => {
    const fixture = createFixture()
    const configs: (CodexSecurityConfig | undefined)[] = []
    const sdk = createSdk(() => Promise.reject(new Error('expected fixture stop')))
    const pluginPath = '/Applications/Aster Code.app/Contents/Resources/app.asar.unpacked/node_modules/@openai/codex-security/_bundled_plugin'
    const service = new SecurityService(fixture.database, fixture.securityRoot, {
      sdkFactory: (config) => {
        configs.push(config)
        return sdk
      },
      pluginPath,
      deepSeekCredential: () => 'configured-for-test',
      exchangeRateResolver: () => Promise.resolve({ rate: 7, date: '2026-08-14', source: 'fallback' }),
    })
    service.startScan({
      projectId: fixture.projectId,
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      mode: 'standard',
      target: { kind: 'repository' },
      auth: 'api-key',
    })
    await waitForScan(service, 'failed')
    expect(configs).toHaveLength(2)
    expect(configs[0]?.pluginPath).toBe(pluginPath)
    expect(configs[1]?.pluginPath).toBe(pluginPath)
    await service.dispose()
    fixture.database.close()
  })

  it('uses the patched public SDK preflight with DeepSeek credentials and no OpenAI login', async () => {
    const fixture = createFixture()
    const sdk = new CodexSecurity(createDeepSeekSecurityConfig(
      'deepseek-v4-flash',
      'sk-deepseek-preflight-only-test',
      fixture.securityRoot,
      { PATH: process.env.PATH, HOME: process.env.HOME },
    ))
    const result = await sdk.preflight(fixture.database.getProject(fixture.projectId)?.path ?? '', {
      auth: 'api-key',
      outputDir: join(fixture.securityRoot, 'preflight-output'),
      target: 'repository',
    })
    expect(result).toMatchObject({
      model: 'deepseek-v4-flash',
      modelProvider: 'deepseek',
      authentication: { method: 'api_key', source: 'DEEPSEEK_API_KEY' },
    })
    expect(JSON.stringify(sdk.config)).not.toContain('sk-deepseek-preflight-only-test')
    await sdk.close()
    fixture.database.close()
  })

  it('accepts DeepSeek Flash after the serialized 0.147.0 sealed contract passed', async () => {
    const fixture = createFixture()
    const configs: CodexSecurityConfig[] = []
    const service = new SecurityService(fixture.database, fixture.securityRoot, {
      sdkFactory: (config) => {
        if (config) configs.push(config)
        return createSdk(() => Promise.reject(new Error('expected fixture stop')))
      },
      deepSeekCredential: () => 'configured-for-test',
      exchangeRateResolver: () => Promise.resolve({ rate: 7, date: '2026-08-14', source: 'fallback' }),
    })
    service.startScan({
      projectId: fixture.projectId,
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      mode: 'standard',
      target: { kind: 'repository' },
      auth: 'api-key',
    })
    await waitForScan(service, 'failed')
    expect(configs[0]?.codexOverrides).toMatchObject({
      model: 'deepseek-v4-flash',
      features: { multi_agent_v2: { max_concurrent_threads_per_session: 1 } },
    })
    await service.dispose()
    fixture.database.close()
  })

  it.skipIf(process.platform === 'win32')('uses a private macOS Deep Scan wrapper that only relaxes the redundant worker sandbox', () => {
    const root = mkdtempSync(join(tmpdir(), 'aster-security-wrapper-test-'))
    temporaryPaths.push(root)
    const realCodex = join(root, 'real-codex')
    const argsOutput = join(root, 'args.txt')
    writeFileSync(realCodex, '#!/bin/bash\nprintf "%s\\n" "$@" > "$ASTER_TEST_ARGS_OUTPUT"\n', { mode: 0o700 })
    chmodSync(realCodex, 0o700)
    const wrapper = prepareMacDeepScanCodexWrapper(join(root, 'state'), realCodex, 'darwin')
    expect(statSync(wrapper).mode & 0o777).toBe(0o700)

    execFileSync(wrapper, ['exec', '--experimental-json', '--sandbox', 'read-only', '--skip-git-repo-check'], {
      env: { ...process.env, CODEX_SECURITY_SCAN_ID: 'scan-test', ASTER_TEST_ARGS_OUTPUT: argsOutput },
    })
    expect(readFileSync(argsOutput, 'utf8')).toContain('danger-full-access')
    expect(readFileSync(argsOutput, 'utf8')).not.toContain('read-only')

    execFileSync(wrapper, ['exec', '--experimental-json', '--sandbox', 'read-only'], {
      env: { ...process.env, ASTER_TEST_ARGS_OUTPUT: argsOutput },
    })
    expect(readFileSync(argsOutput, 'utf8')).toContain('read-only')
  })

  it('rejects control characters in a macOS Deep Scan runtime path', () => {
    expect(() => prepareMacDeepScanCodexWrapper('/tmp/state', '/tmp/codex\nruntime', 'darwin'))
      .toThrow('路径包含不安全字符')
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
  execFileSync('git', ['init', '--quiet', projectPath])
  const securityRoot = join(root, 'private-security')
  mkdirSync(securityRoot)
  const database = new StateDatabase(join(root, 'state.sqlite3'))
  const project = database.upsertProject(projectPath)
  return { database, projectId: project.id, securityRoot }
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
