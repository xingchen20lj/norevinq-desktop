import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  JsonlRpcClosedError,
  JsonlRpcPeer,
  JsonlRpcProtocolError,
  JsonRpcError,
  JsonRpcTimeoutError,
  type JsonValue,
} from '../../src/main/runtime/jsonlRpc.js'

type Harness = {
  readonly input: PassThrough
  readonly messages: Record<string, unknown>[]
  readonly output: PassThrough
  readonly peer: JsonlRpcPeer
}

function createHarness(options?: ConstructorParameters<typeof JsonlRpcPeer>[2]): Harness {
  const input = new PassThrough()
  const output = new PassThrough()
  const messages: Record<string, unknown>[] = []
  let outputBuffer = ''
  output.setEncoding('utf8')
  output.on('data', (chunk: string) => {
    outputBuffer += chunk
    let newline = outputBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = outputBuffer.slice(0, newline)
      outputBuffer = outputBuffer.slice(newline + 1)
      messages.push(JSON.parse(line) as Record<string, unknown>)
      newline = outputBuffer.indexOf('\n')
    }
  })
  return { input, messages, output, peer: new JsonlRpcPeer(input, output, options) }
}

function send(input: PassThrough, message: Readonly<Record<string, JsonValue>>): void {
  input.write(`${JSON.stringify(message)}\n`)
}

async function waitForMessages(messages: Record<string, unknown>[], count: number): Promise<void> {
  await vi.waitFor(() => expect(messages).toHaveLength(count))
}

describe('JsonlRpcPeer', () => {
  it('correlates newline JSON requests and responses by ID', async () => {
    const { input, messages, peer } = createHarness()
    const response = peer.request<{ readonly answer: number }>('compute', { value: 20 })

    await waitForMessages(messages, 1)
    expect(messages[0]).toMatchObject({
      id: 1,
      jsonrpc: '2.0',
      method: 'compute',
      params: { value: 20 },
    })

    send(input, { id: 1, jsonrpc: '2.0', result: { answer: 42 } })
    await expect(response).resolves.toEqual({ answer: 42 })
    expect(peer.pendingRequestCount).toBe(0)
    peer.close()
  })

  it('delivers global and method-specific notifications without responding', async () => {
    const { input, messages, peer } = createHarness()
    const globalHandler = vi.fn()
    const methodHandler = vi.fn()
    peer.onNotification(globalHandler)
    peer.onNotification('task/progress', methodHandler)

    send(input, { jsonrpc: '2.0', method: 'task/progress', params: { percent: 50 } })

    await vi.waitFor(() => expect(methodHandler).toHaveBeenCalledOnce())
    expect(globalHandler).toHaveBeenCalledWith('task/progress', { percent: 50 })
    expect(methodHandler).toHaveBeenCalledWith('task/progress', { percent: 50 })
    expect(messages).toEqual([])
    peer.close()
  })

  it('handles server-to-client requests and serializes success and failure responses', async () => {
    const { input, messages, peer } = createHarness()
    peer.registerRequestHandler('client/read', (params, context) => ({
      method: context.method,
      params: params ?? null,
    }))
    peer.registerRequestHandler('client/deny', () => {
      throw new JsonRpcError(401, 'Denied', { reason: 'policy' })
    })

    send(input, { id: 'server-1', jsonrpc: '2.0', method: 'client/read', params: { path: 'a.ts' } })
    send(input, { id: 'server-2', jsonrpc: '2.0', method: 'client/deny' })

    await waitForMessages(messages, 2)
    const success = messages.find((message) => message.id === 'server-1')
    const failure = messages.find((message) => message.id === 'server-2')
    expect(success).toEqual({
      id: 'server-1',
      jsonrpc: '2.0',
      result: { method: 'client/read', params: { path: 'a.ts' } },
    })
    expect(failure).toEqual({
      error: { code: 401, data: { reason: 'policy' }, message: 'Denied' },
      id: 'server-2',
      jsonrpc: '2.0',
    })
    peer.close()
  })

  it('returns JSON-RPC parse errors and continues processing later frames', async () => {
    const { input, messages, peer } = createHarness()
    const errors: Error[] = []
    peer.onError((error) => errors.push(error))

    input.write('{broken json\n')
    await waitForMessages(messages, 1)
    expect(messages[0]).toEqual({
      error: { code: -32700, message: 'Parse error' },
      id: null,
      jsonrpc: '2.0',
    })
    expect(errors[0]).toBeInstanceOf(JsonlRpcProtocolError)

    const result = peer.request('after-error')
    await waitForMessages(messages, 2)
    send(input, { id: 1, jsonrpc: '2.0', result: 'ok' })
    await expect(result).resolves.toBe('ok')
    peer.close()
  })

  it('rejects remote error responses with their structured error', async () => {
    const { input, messages, peer } = createHarness()
    const result = peer.request('explode')
    await waitForMessages(messages, 1)
    send(input, {
      error: { code: -32000, data: { retryable: false }, message: 'Remote failure' },
      id: 1,
      jsonrpc: '2.0',
    })

    const expected = new JsonRpcError(-32000, 'Remote failure', { retryable: false })
    await expect(result).rejects.toMatchObject(expected)
    peer.close()
  })

  it('times out requests and ignores their late response', async () => {
    vi.useFakeTimers()
    try {
      const { input, peer } = createHarness({ defaultTimeoutMs: 25 })
      const errors: Error[] = []
      peer.onError((error) => errors.push(error))
      const result = peer.request('slow')
      const rejection = expect(result).rejects.toBeInstanceOf(JsonRpcTimeoutError)

      await vi.advanceTimersByTimeAsync(25)
      await rejection
      expect(peer.pendingRequestCount).toBe(0)

      send(input, { id: 1, jsonrpc: '2.0', result: 'too late' })
      expect(errors.some((error) => error.message.includes('unknown request ID'))).toBe(true)
      peer.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('supports explicitly unbounded requests until response or connection close', async () => {
    vi.useFakeTimers()
    try {
      const { input, messages, peer } = createHarness({ defaultTimeoutMs: 25 })
      const result = peer.request('terminal/process', undefined, { timeoutMs: null })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(peer.pendingRequestCount).toBe(1)
      send(input, { id: 1, jsonrpc: '2.0', result: { exitCode: 0 } })
      await expect(result).resolves.toEqual({ exitCode: 0 })
      expect(messages).toHaveLength(1)
      peer.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects all pending requests on EOF and explicit close', async () => {
    const eofHarness = createHarness()
    const eofResult = eofHarness.peer.request('pending')
    eofHarness.input.end()
    await expect(eofResult).rejects.toThrow('reached EOF')
    expect(eofHarness.peer.pendingRequestCount).toBe(0)

    const closeHarness = createHarness()
    const closeResult = closeHarness.peer.request('pending')
    closeHarness.peer.close()
    await expect(closeResult).rejects.toBeInstanceOf(JsonlRpcClosedError)
  })

  it('terminates the peer when an unterminated input line exceeds the configured limit', async () => {
    const { input, peer } = createHarness({ maxLineBytes: 32 })
    const result = peer.request('pending')
    input.write('x'.repeat(33))

    await expect(result).rejects.toThrow('line exceeds the 32 byte limit')
    expect(peer.closed).toBe(true)
  })

  it('bounds queued output while respecting writable backpressure', async () => {
    let releaseWrite: (() => void) | undefined
    const slowWritable = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) {
        releaseWrite = callback
      },
    })
    const input = new PassThrough()
    const peer = new JsonlRpcPeer(input, slowWritable, {
      maxBufferedWriteBytes: 100,
      maxLineBytes: 100,
    })

    const first = peer.notify('one', { payload: 'a'.repeat(30) })
    const second = peer.notify('two', { payload: 'b'.repeat(30) })

    await expect(second).rejects.toThrow('write queue exceeds the 100 byte limit')
    expect(releaseWrite).toBeTypeOf('function')
    releaseWrite?.()
    await expect(first).resolves.toBeUndefined()
    peer.close()
  })

  it('supports the Codex app-server wire dialect without jsonrpc headers', async () => {
    const { input, messages, peer } = createHarness({
      acceptMissingJsonrpc: true,
      omitJsonrpcHeader: true,
    })
    peer.registerRequestHandler('approval', () => ({ decision: 'accept' }))

    const result = peer.request('thread/start', { cwd: '/workspace' })
    await waitForMessages(messages, 1)
    expect(messages[0]).toEqual({ id: 1, method: 'thread/start', params: { cwd: '/workspace' } })
    send(input, { id: 1, result: { threadId: 'thread-1' } })
    await expect(result).resolves.toEqual({ threadId: 'thread-1' })

    send(input, { id: 7, method: 'approval', params: { command: 'git status' } })
    await waitForMessages(messages, 2)
    expect(messages[1]).toEqual({ id: 7, result: { decision: 'accept' } })
    peer.close()
  })
})
