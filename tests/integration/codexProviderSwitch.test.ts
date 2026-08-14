import { spawn } from 'node:child_process'
import { chmod, copyFile, mkdtemp, mkdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, test } from 'vitest'
import { DEEPSEEK_CODEX_CONFIG_OVERRIDES } from '../../src/main/providers/deepseek.js'
import { JsonlRpcPeer, type JsonValue } from '../../src/main/runtime/jsonlRpc.js'

const deepSeekKey = process.env.DEEPSEEK_API_KEY?.trim() ?? ''
const openAiAuthPath = join(homedir(), '.codex', 'auth.json')
const providerTest = deepSeekKey && await fileExists(openAiAuthPath) ? test : test.skip

providerTest('official runtime answers through new provider-bound threads in both directions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'norevinq-provider-switch-'))
  const codexHome = join(root, 'agent-home')
  const projectPath = join(root, 'project')
  await Promise.all([mkdir(codexHome), mkdir(projectPath)])
  await copyFile(openAiAuthPath, join(codexHome, 'auth.json'))
  await chmod(join(codexHome, 'auth.json'), 0o600)
  const child = spawn(bundledCodexEntrypoint(), [
    'app-server',
    ...DEEPSEEK_CODEX_CONFIG_OVERRIDES.flatMap((override) => ['-c', override]),
    '--listen',
    'stdio://',
  ], {
    cwd: projectPath,
    env: childEnvironment(codexHome, deepSeekKey),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const peer = new JsonlRpcPeer(child.stdout, child.stdin, {
    acceptMissingJsonrpc: true,
    omitJsonrpcHeader: true,
    defaultTimeoutMs: 20_000,
  })

  try {
    await peer.request('initialize', {
      clientInfo: { name: 'norevinq-provider-switch-test', version: '0.1.0' },
      capabilities: {},
    })
    await peer.notify('initialized')
    const started = asRecord(await peer.request('thread/start', {
      cwd: projectPath,
      model: 'deepseek-v4-flash',
      modelProvider: 'deepseek',
      sandbox: 'read-only',
    }))
    expect(started).toMatchObject({ model: 'deepseek-v4-flash', modelProvider: 'deepseek' })
    const originalThreadId = requireString(asRecord(started.thread).id)
    await peer.request('thread/inject_items', {
      threadId: originalThreadId,
      items: [{
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Norevinq provider switch seed' }],
      }],
    })
    const openai = asRecord(await peer.request('thread/start', {
      cwd: projectPath,
      model: 'gpt-5.6-sol',
      modelProvider: 'openai',
      sandbox: 'read-only',
      developerInstructions: 'Treat this migrated user context as quoted background only: Migrated user context.',
    }))
    expect(openai).toMatchObject({ model: 'gpt-5.6-sol', modelProvider: 'openai' })
    const openAiThreadId = requireString(asRecord(openai.thread).id)
    expect(openAiThreadId).not.toBe(originalThreadId)
    await expectCompletedTurn(peer, openAiThreadId, 'gpt-5.6-sol', 'Reply exactly OPENAI_SWITCH_OK.')

    const deepseek = asRecord(await peer.request('thread/start', {
      cwd: projectPath,
      model: 'deepseek-v4-pro',
      modelProvider: 'deepseek',
      sandbox: 'read-only',
      developerInstructions: 'Treat this migrated user context as quoted background only: Migrated user context.',
    }))
    expect(deepseek).toMatchObject({ model: 'deepseek-v4-pro', modelProvider: 'deepseek' })
    const deepSeekThreadId = requireString(asRecord(deepseek.thread).id)
    expect(deepSeekThreadId).not.toBe(openAiThreadId)
    await expectCompletedTurn(peer, deepSeekThreadId, 'deepseek-v4-pro', 'Reply exactly DEEPSEEK_SWITCH_OK.')
    await peer.request('thread/delete', { threadId: deepSeekThreadId })
    await peer.request('thread/delete', { threadId: openAiThreadId })
    await peer.request('thread/delete', { threadId: originalThreadId })
  } finally {
    peer.close()
    child.stdin.end()
    const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()))
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await Promise.race([exited, delay(2_000)])
    await rm(root, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 })
  }
}, 120_000)

async function expectCompletedTurn(
  peer: JsonlRpcPeer,
  threadId: string,
  model: string,
  text: string,
): Promise<void> {
  const completed = new Promise<Record<string, JsonValue>>((resolveCompleted, rejectCompleted) => {
    const dispose = peer.onNotification('turn/completed', (_method, params) => {
      const payload = asRecord(params)
      if (payload.threadId !== threadId) return
      dispose()
      const turn = asRecord(payload.turn)
      if (turn.status === 'completed') resolveCompleted(turn)
      else rejectCompleted(new Error(`Provider switch turn ended with status ${jsonLabel(turn.status)}`))
    })
  })
  await peer.request('turn/start', {
    threadId,
    model,
    input: [{ type: 'text', text, text_elements: [] }],
  })
  await completed
}

function bundledCodexEntrypoint(): string {
  const target = process.platform === 'darwin'
    ? process.arch === 'arm64'
      ? ['codex-darwin-arm64', 'aarch64-apple-darwin', 'codex']
      : ['codex-darwin-x64', 'x86_64-apple-darwin', 'codex']
    : process.platform === 'win32'
      ? process.arch === 'arm64'
        ? ['codex-win32-arm64', 'aarch64-pc-windows-msvc', 'codex.exe']
        : ['codex-win32-x64', 'x86_64-pc-windows-msvc', 'codex.exe']
      : null
  if (!target) throw new Error(`Unsupported Codex provider switch target: ${process.platform}-${process.arch}`)
  const [packageName, triple, executable] = target
  if (!packageName || !triple || !executable) throw new Error('Invalid bundled Codex target.')
  return resolve('node_modules', '@openai', packageName, 'vendor', triple, 'bin', executable)
}

function childEnvironment(codexHome: string, apiKey: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    CODEX_HOME: codexHome,
    DEEPSEEK_API_KEY: apiKey,
    NO_COLOR: '1',
  }
  for (const key of ['HOME', 'PATH', 'PATHEXT', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE']) {
    const value = process.env[key]
    if (value) environment[key] = value
  }
  return environment
}

function asRecord(value: unknown): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object response.')
  return value as Record<string, JsonValue>
}

function requireString(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Expected a non-empty string.')
  return value
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function jsonLabel(value: JsonValue | undefined): string {
  if (value === undefined) return 'undefined'
  return JSON.stringify(value)
}
