import { spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  CodexRuntimeSupervisor,
  createCodexChildEnvironment,
} from '../../src/main/runtime/codexRuntime.js'

const FAKE_APP_SERVER = String.raw`
import readline from 'node:readline'

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n')

lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    send({ id: message.id, result: {
      userAgent: 'fake-codex/0.147.0',
      platformFamily: 'test',
      platformOs: 'test',
    } })
    return
  }
  if (message.method === 'model/list') {
    send({ id: message.id, result: { data: [{
      id: 'fake-model',
      displayName: 'Fake Model',
      isDefault: true,
      supportedReasoningEfforts: ['low'],
      inputModalities: ['text'],
    }] } })
    return
  }
  if (message.method === 'test/crash') {
    process.exit(23)
    return
  }
  if (message.id !== undefined) send({ id: message.id, result: {} })
})
`

function createSupervisor(options: { restartBaseDelayMs?: number } = {}) {
  let spawnCount = 0
  const runtime = new CodexRuntimeSupervisor({
    discover: () => Promise.resolve({
      path: '/fake/codex',
      source: 'explicit',
      version: 'codex-cli 0.147.0-test',
    }),
    spawnProcess: () => {
      spawnCount += 1
      return spawn(process.execPath, ['--input-type=module', '-e', FAKE_APP_SERVER], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    },
    initializeTimeoutMs: 2_000,
    maxAutomaticRestarts: 2,
    restartBaseDelayMs: options.restartBaseDelayMs ?? 10,
  })
  return { runtime, getSpawnCount: () => spawnCount }
}

describe('CodexRuntimeSupervisor recovery', () => {
  it('passes only required runtime variables into the app-server process', () => {
    expect(createCodexChildEnvironment({
      PATH: '/usr/bin',
      HOME: '/home/tester',
      OPENAI_API_KEY: 'explicit-provider-key',
      LC_ALL: 'C',
      NOREVINQ_UNRELATED_SECRET: 'must-not-leak',
      GITHUB_TOKEN: 'must-not-leak',
    })).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/tester',
      OPENAI_API_KEY: 'explicit-provider-key',
      LC_ALL: 'C',
    })
  })

  it('keeps the private Codex home authoritative across provider reconfiguration', async () => {
    const environments: NodeJS.ProcessEnv[] = []
    const runtime = new CodexRuntimeSupervisor({
      discover: () => Promise.resolve({
        path: '/fake/codex', source: 'explicit', version: 'codex-cli 0.147.0-test',
      }),
      fixedChildEnvironment: { CODEX_HOME: '/private/norevinq/agent-home' },
      childEnvironment: { CODEX_HOME: '/shared/official/codex-home' },
      spawnProcess: (_command, _args, options) => {
        environments.push(options.env ?? {})
        return spawn(process.execPath, ['--input-type=module', '-e', FAKE_APP_SERVER], {
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      },
      initializeTimeoutMs: 2_000,
    })
    try {
      await runtime.start()
      expect(environments[0]?.CODEX_HOME).toBe('/private/norevinq/agent-home')
      await runtime.updateLaunchConfiguration({
        childEnvironment: { CODEX_HOME: '/another/shared/home', DEEPSEEK_API_KEY: 'test-key' },
      })
      expect(environments[1]?.CODEX_HOME).toBe('/private/norevinq/agent-home')
      expect(environments[1]?.DEEPSEEK_API_KEY).toBe('test-key')
    } finally {
      await runtime.stop()
    }
  })

  it('restarts an idle crashed app-server without replaying the failed request', async () => {
    const { runtime, getSpawnCount } = createSupervisor()
    try {
      await expect(runtime.start()).resolves.toMatchObject({
        phase: 'ready',
        generation: 1,
        models: [{ id: 'fake-model' }],
      })

      await expect(runtime.request('test/crash', {}, { timeoutMs: 1_000 })).rejects.toThrow(
        /exited|closed|ended|EOF/i,
      )
      await vi.waitFor(() => expect(runtime.getSnapshot()).toMatchObject({
        phase: 'ready',
        generation: 2,
        restartAttempt: 0,
      }), { timeout: 2_000 })
      expect(getSpawnCount()).toBe(2)
    } finally {
      await runtime.stop()
    }
  })

  it('fails closed when the app-server exits during an active turn', async () => {
    const { runtime, getSpawnCount } = createSupervisor({ restartBaseDelayMs: 5 })
    try {
      await runtime.start()
      runtime.markTurnStarted()
      await expect(runtime.request('test/crash', {}, { timeoutMs: 1_000 })).rejects.toThrow(
        /exited|closed|ended|EOF/i,
      )
      await vi.waitFor(() => expect(runtime.getSnapshot()).toMatchObject({
        phase: 'failed',
        generation: 1,
        lastExitCode: 23,
      }), { timeout: 2_000 })
      expect(runtime.getSnapshot().error).toContain('未自动重放任务')
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(getSpawnCount()).toBe(1)
    } finally {
      runtime.markTurnCompleted()
      await runtime.stop()
    }
  })
})
