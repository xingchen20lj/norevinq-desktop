import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, expect, test } from 'vitest'
import { JsonlRpcPeer, type JsonValue } from '../../src/main/runtime/jsonlRpc.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {
    force: true, recursive: true, maxRetries: 5, retryDelay: 100,
  })))
})

test('official Codex app-server exposes account state, permission profiles, and the thread lifecycle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aster-codex-lifecycle-'))
  temporaryRoots.push(root)
  const codexHome = join(root, 'codex-home')
  const projectPath = join(root, 'project')
  await Promise.all([mkdir(codexHome), mkdir(projectPath)])
  const entrypoint = bundledCodexEntrypoint()
  expect(existsSync(entrypoint)).toBe(true)

  // Spawn the pinned native binary directly. The JavaScript launcher creates a
  // grandchild process that can keep the temporary repository locked on Windows.
  const child = spawn(entrypoint, ['app-server', '--stdio'], {
    cwd: projectPath,
    env: childEnvironment(codexHome),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const peer = new JsonlRpcPeer(child.stdout, child.stdin, {
    acceptMissingJsonrpc: true,
    omitJsonrpcHeader: true,
    defaultTimeoutMs: 20_000,
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => { stderr += chunk.slice(0, 8_192) })

  try {
    await peer.request('initialize', {
      clientInfo: { name: 'aster-code-integration-test', version: '0.1.0' },
      capabilities: {},
    })
    await peer.notify('initialized')
    const account = asRecord(await peer.request('account/read', { refreshToken: false }))
    expect(typeof account.requiresOpenaiAuth).toBe('boolean')
    expect(account.account === null || typeof account.account === 'object').toBe(true)
    const apiKeyLogin = asRecord(await peer.request('account/login/start', {
      type: 'apiKey',
      apiKey: 'sk-test-aster-not-a-real-key',
    }))
    expect(apiKeyLogin.type).toBe('apiKey')
    const apiKeyAccount = asRecord(await peer.request('account/read', { refreshToken: false }))
    expect(asRecord(apiKeyAccount.account).type).toBe('apiKey')
    await peer.request('account/logout')
    const loggedOutAccount = asRecord(await peer.request('account/read', { refreshToken: false }))
    expect(loggedOutAccount.account).toBeNull()
    const browserLogin = asRecord(await peer.request('account/login/start', { type: 'chatgpt' }))
    const browserLoginId = requireId(browserLogin.loginId)
    const browserLoginUrl = new URL(requireId(browserLogin.authUrl))
    expect(browserLogin.type).toBe('chatgpt')
    expect(browserLoginUrl.protocol).toBe('https:')
    expect(browserLoginUrl.hostname === 'chatgpt.com' || browserLoginUrl.hostname.endsWith('.openai.com')).toBe(true)
    const canceledLogin = asRecord(await peer.request('account/login/cancel', { loginId: browserLoginId }))
    expect(['canceled', 'notFound']).toContain(canceledLogin.status)
    if (process.env.ASTER_TEST_LIVE_AUTH === '1') {
      const deviceLogin = asRecord(await peer.request('account/login/start', { type: 'chatgptDeviceCode' }))
      const deviceLoginId = requireId(deviceLogin.loginId)
      const verificationUrl = new URL(requireId(deviceLogin.verificationUrl))
      expect(deviceLogin.type).toBe('chatgptDeviceCode')
      expect(verificationUrl.protocol).toBe('https:')
      expect(verificationUrl.hostname === 'auth.openai.com' || verificationUrl.hostname.endsWith('.openai.com')).toBe(true)
      expect(requireId(deviceLogin.userCode).length).toBeGreaterThanOrEqual(4)
      const canceledDeviceLogin = asRecord(await peer.request('account/login/cancel', { loginId: deviceLoginId }))
      expect(['canceled', 'notFound']).toContain(canceledDeviceLogin.status)
    }
    const profiles = asRecord(await peer.request('permissionProfile/list', { cwd: projectPath, limit: 100 }))
    const profileRows = asArray(profiles.data)
    expect(profileRows.length).toBeGreaterThan(0)
    expect(profileRows.every((value) => {
      const profile = asRecord(value)
      return typeof profile.id === 'string' && typeof profile.allowed === 'boolean'
    })).toBe(true)
    const started = asRecord(await peer.request('thread/start', {
      approvalPolicy: 'never',
      cwd: projectPath,
      ephemeral: false,
      sandbox: 'read-only',
    }))
    const originalId = requireId(asRecord(started.thread).id)

    await peer.request('thread/inject_items', {
      threadId: originalId,
      items: [{
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Aster lifecycle seed' }],
      }],
    })

    await peer.request('thread/name/set', { threadId: originalId, name: 'Aster lifecycle proof' })
    const named = asRecord(await peer.request('thread/read', { includeTurns: true, threadId: originalId }))
    expect(asRecord(named.thread).name).toBe('Aster lifecycle proof')
    const setGoal = asRecord(await peer.request('thread/goal/set', {
      threadId: originalId,
      objective: 'Prove the official goal lifecycle',
      status: 'active',
      tokenBudget: 10_000,
    }))
    expect(asRecord(setGoal.goal)).toMatchObject({
      threadId: originalId,
      objective: 'Prove the official goal lifecycle',
      status: 'active',
      tokenBudget: 10_000,
    })
    const readGoal = asRecord(await peer.request('thread/goal/get', { threadId: originalId }))
    expect(asRecord(readGoal.goal).objective).toBe('Prove the official goal lifecycle')
    await peer.request('thread/goal/clear', { threadId: originalId })
    const clearedGoal = asRecord(await peer.request('thread/goal/get', { threadId: originalId }))
    expect(clearedGoal.goal).toBeNull()
    const listed = asRecord(await peer.request('thread/list', {
      archived: false,
      cwd: projectPath,
      limit: 10,
      searchTerm: 'lifecycle proof',
    }))
    expect(Array.isArray(listed.data)).toBe(true)

    const forked = asRecord(await peer.request('thread/fork', { threadId: originalId }))
    const forkId = requireId(asRecord(forked.thread).id)
    expect(forkId).not.toBe(originalId)
    expect(asRecord(forked.thread).forkedFromId).toBe(originalId)

    await peer.request('thread/archive', { threadId: forkId })
    const archived = asRecord(await peer.request('thread/list', {
      archived: true,
      cwd: projectPath,
      limit: 10,
    }))
    expect(Array.isArray(archived.data)).toBe(true)
    const restored = asRecord(await peer.request('thread/unarchive', { threadId: forkId }))
    expect(requireId(asRecord(restored.thread).id)).toBe(forkId)

    await peer.request('thread/delete', { threadId: forkId })
    await peer.request('thread/delete', { threadId: originalId })
    const remaining = asRecord(await peer.request('thread/list', {
      archived: false,
      cwd: projectPath,
      limit: 10,
      useStateDbOnly: true,
    }))
    expect(asArray(remaining.data)).toEqual([])
  } catch (error) {
    throw new Error(
      `Codex thread lifecycle failed: ${error instanceof Error ? error.message : String(error)}\n${stderr}`,
      { cause: error },
    )
  } finally {
    peer.close()
    child.stdin.end()
    const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()))
    if (child.exitCode === null && child.signalCode === null) {
      const graceful = await Promise.race([exited.then(() => true), delay(2_000, false)])
      if (!graceful) child.kill()
      await Promise.race([exited, delay(2_000)])
    }
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
  if (!target) throw new Error(`Unsupported Codex integration target: ${process.platform}-${process.arch}`)
  const [packageName, triple, executable] = target
  if (!packageName || !triple || !executable) throw new Error('Invalid bundled Codex target.')
  return resolve('node_modules', '@openai', packageName, 'vendor', triple, 'bin', executable)
}

function childEnvironment(codexHome: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { CODEX_HOME: codexHome, NO_COLOR: '1' }
  for (const key of ['HOME', 'PATH', 'PATHEXT', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE']) {
    const value = process.env[key]
    if (value) environment[key] = value
  }
  return environment
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object response.')
  return value as Record<string, unknown>
}

function asArray(value: unknown): JsonValue[] {
  return Array.isArray(value) ? value as JsonValue[] : []
}

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Expected a thread id.')
  return value
}
