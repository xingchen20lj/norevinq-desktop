import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, test } from 'vitest'
import { DEEPSEEK_CODEX_CONFIG_OVERRIDES } from '../../src/main/providers/deepseek.js'
import { JsonlRpcPeer, type JsonValue } from '../../src/main/runtime/jsonlRpc.js'

const deepSeekKey = process.env.DEEPSEEK_API_KEY?.trim() ?? ''
const providerTest = deepSeekKey ? test : test.skip

providerTest('official Codex keeps one thread while switching between DeepSeek and OpenAI providers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aster-provider-switch-'))
  const codexHome = join(root, 'codex-home')
  const projectPath = join(root, 'project')
  await Promise.all([mkdir(codexHome), mkdir(projectPath)])
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
      clientInfo: { name: 'aster-provider-switch-test', version: '0.1.0' },
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
    const threadId = requireString(asRecord(started.thread).id)
    await peer.request('thread/inject_items', {
      threadId,
      items: [{
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Aster provider switch seed' }],
      }],
    })
    await peer.request('thread/unsubscribe', { threadId })

    const openai = asRecord(await peer.request('thread/resume', {
      threadId,
      model: 'gpt-5.6-sol',
      modelProvider: 'openai',
    }))
    expect(openai).toMatchObject({ model: 'gpt-5.6-sol', modelProvider: 'openai' })
    expect(requireString(asRecord(openai.thread).id)).toBe(threadId)

    await peer.request('thread/unsubscribe', { threadId })
    const deepseek = asRecord(await peer.request('thread/resume', {
      threadId,
      model: 'deepseek-v4-pro',
      modelProvider: 'deepseek',
    }))
    expect(deepseek).toMatchObject({ model: 'deepseek-v4-pro', modelProvider: 'deepseek' })
    expect(requireString(asRecord(deepseek.thread).id)).toBe(threadId)
    await peer.request('thread/delete', { threadId })
  } finally {
    peer.close()
    child.stdin.end()
    const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()))
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await Promise.race([exited, delay(2_000)])
    await rm(root, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 })
  }
}, 30_000)

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
