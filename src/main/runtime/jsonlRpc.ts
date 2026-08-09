import { StringDecoder } from 'node:string_decoder'
import type { Readable, Writable } from 'node:stream'

export type JsonPrimitive = boolean | null | number | string
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }
export type JsonRpcRequestId = number | string

export type JsonRpcRequestContext = {
  readonly id: JsonRpcRequestId
  readonly method: string
}

export type JsonRpcRequestHandler = (
  params: JsonValue | undefined,
  context: JsonRpcRequestContext,
) => JsonValue | Promise<JsonValue | undefined> | undefined

export type JsonRpcNotificationHandler = (
  method: string,
  params: JsonValue | undefined,
) => Promise<void> | void

export type JsonlRpcOptions = {
  /** Accept Codex app-server messages, whose wire format omits `jsonrpc`. */
  readonly acceptMissingJsonrpc?: boolean
  readonly defaultTimeoutMs?: number
  readonly maxBufferedWriteBytes?: number
  readonly maxLineBytes?: number
  /** Emit Codex app-server messages without the otherwise-standard `jsonrpc` member. */
  readonly omitJsonrpcHeader?: boolean
}

export type JsonRpcRequestOptions = {
  readonly timeoutMs?: number
}

type PendingRequest = {
  readonly method: string
  readonly reject: (error: Error) => void
  readonly resolve: (value: JsonValue) => void
  readonly timer: NodeJS.Timeout | undefined
}

type OutgoingFrame = {
  readonly bytes: number
  readonly data: string
  readonly reject: (error: Error) => void
  readonly resolve: () => void
}

type JsonRecord = Record<string, unknown>

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_LINE_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_BUFFERED_WRITE_BYTES = 16 * 1024 * 1024

export class JsonRpcError extends Error {
  readonly code: number
  readonly data: JsonValue | undefined

  constructor(code: number, message: string, data?: JsonValue) {
    super(message)
    this.name = 'JsonRpcError'
    this.code = code
    this.data = data
  }
}

export class JsonRpcTimeoutError extends Error {
  readonly method: string
  readonly timeoutMs: number

  constructor(method: string, timeoutMs: number) {
    super(`JSON-RPC request "${method}" timed out after ${String(timeoutMs)} ms`)
    this.name = 'JsonRpcTimeoutError'
    this.method = method
    this.timeoutMs = timeoutMs
  }
}

export class JsonlRpcClosedError extends Error {
  constructor(message = 'JSONL RPC connection is closed') {
    super(message)
    this.name = 'JsonlRpcClosedError'
  }
}

export class JsonlRpcProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JsonlRpcProtocolError'
  }
}

/**
 * A transport-agnostic JSON-RPC 2.0 peer over newline-delimited streams.
 *
 * The peer deliberately owns neither stream. `close()` ends the writable side,
 * while EOF and stream errors only detach the peer and reject outstanding work.
 */
export class JsonlRpcPeer {
  readonly #readable: Readable
  readonly #writable: Writable
  readonly #decoder = new StringDecoder('utf8')
  readonly #acceptMissingJsonrpc: boolean
  readonly #defaultTimeoutMs: number
  readonly #maxBufferedWriteBytes: number
  readonly #maxLineBytes: number
  readonly #omitJsonrpcHeader: boolean
  readonly #pending = new Map<JsonRpcRequestId, PendingRequest>()
  readonly #requestHandlers = new Map<string, JsonRpcRequestHandler>()
  readonly #notificationHandlers = new Set<JsonRpcNotificationHandler>()
  readonly #methodNotificationHandlers = new Map<string, Set<JsonRpcNotificationHandler>>()
  readonly #errorHandlers = new Set<(error: Error) => void>()
  readonly #writeQueue: OutgoingFrame[] = []

  #buffer = ''
  #bufferedWriteBytes = 0
  #closedError: Error | undefined
  #currentWrite: OutgoingFrame | undefined
  #nextRequestId = 1

  readonly #onData = (chunk: unknown): void => {
    if (this.#closedError !== undefined) return

    let text: string
    if (typeof chunk === 'string') text = chunk
    else if (Buffer.isBuffer(chunk)) text = this.#decoder.write(chunk)
    else if (chunk instanceof Uint8Array) text = this.#decoder.write(Buffer.from(chunk))
    else {
      this.#fail(new JsonlRpcProtocolError('Readable stream emitted a non-text chunk'))
      return
    }

    this.#buffer += text
    this.#consumeLines()
  }

  readonly #onEnd = (): void => {
    if (this.#closedError !== undefined) return
    this.#buffer += this.#decoder.end()
    if (this.#buffer.trim().length > 0) this.#handleLine(this.#buffer.replace(/\r$/, ''))
    this.#buffer = ''
    this.#fail(new JsonlRpcClosedError('JSONL RPC readable stream reached EOF'))
  }

  readonly #onReadableClose = (): void => {
    this.#fail(new JsonlRpcClosedError('JSONL RPC readable stream closed'))
  }

  readonly #onWritableClose = (): void => {
    this.#fail(new JsonlRpcClosedError('JSONL RPC writable stream closed'))
  }

  readonly #onStreamError = (error: Error): void => {
    this.#fail(error)
  }

  constructor(readable: Readable, writable: Writable, options: JsonlRpcOptions = {}) {
    this.#readable = readable
    this.#writable = writable
    this.#acceptMissingJsonrpc = options.acceptMissingJsonrpc ?? false
    this.#omitJsonrpcHeader = options.omitJsonrpcHeader ?? false
    this.#defaultTimeoutMs = validatePositiveInteger(
      options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      'defaultTimeoutMs',
    )
    this.#maxLineBytes = validatePositiveInteger(
      options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES,
      'maxLineBytes',
    )
    this.#maxBufferedWriteBytes = validatePositiveInteger(
      options.maxBufferedWriteBytes ?? DEFAULT_MAX_BUFFERED_WRITE_BYTES,
      'maxBufferedWriteBytes',
    )

    readable.on('data', this.#onData)
    readable.once('end', this.#onEnd)
    readable.once('close', this.#onReadableClose)
    readable.on('error', this.#onStreamError)
    writable.once('close', this.#onWritableClose)
    writable.on('error', this.#onStreamError)
  }

  get closed(): boolean {
    return this.#closedError !== undefined
  }

  get pendingRequestCount(): number {
    return this.#pending.size
  }

  request<T extends JsonValue = JsonValue>(
    method: string,
    params?: JsonValue,
    options: JsonRpcRequestOptions = {},
  ): Promise<T> {
    assertMethod(method)
    if (this.#closedError !== undefined) return Promise.reject(this.#closedError)

    const timeoutMs = validatePositiveInteger(
      options.timeoutMs ?? this.#defaultTimeoutMs,
      'timeoutMs',
    )
    const id = this.#allocateRequestId()
    const message = this.#createMessage({ id, method })
    if (params !== undefined) message.params = params

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.#pending.delete(id)) return
        reject(new JsonRpcTimeoutError(method, timeoutMs))
      }, timeoutMs)

      this.#pending.set(id, {
        method,
        reject,
        resolve: (value) => resolve(value as T),
        timer,
      })

      void this.#enqueue(message).catch((error: unknown) => {
        const pending = this.#pending.get(id)
        if (pending === undefined) return
        this.#pending.delete(id)
        clearTimeout(pending.timer)
        reject(asError(error))
      })
    })
  }

  notify(method: string, params?: JsonValue): Promise<void> {
    assertMethod(method)
    const message = this.#createMessage({ method })
    if (params !== undefined) message.params = params
    return this.#enqueue(message)
  }

  registerRequestHandler(method: string, handler: JsonRpcRequestHandler): () => void {
    assertMethod(method)
    if (this.#requestHandlers.has(method)) {
      throw new Error(`A JSON-RPC request handler is already registered for "${method}"`)
    }
    this.#requestHandlers.set(method, handler)
    return () => {
      if (this.#requestHandlers.get(method) === handler) this.#requestHandlers.delete(method)
    }
  }

  onNotification(handler: JsonRpcNotificationHandler): () => void
  onNotification(method: string, handler: JsonRpcNotificationHandler): () => void
  onNotification(
    methodOrHandler: JsonRpcNotificationHandler | string,
    possibleHandler?: JsonRpcNotificationHandler,
  ): () => void {
    if (typeof methodOrHandler === 'function') {
      this.#notificationHandlers.add(methodOrHandler)
      return () => this.#notificationHandlers.delete(methodOrHandler)
    }

    assertMethod(methodOrHandler)
    if (possibleHandler === undefined) throw new Error('Notification handler is required')
    const handlers = this.#methodNotificationHandlers.get(methodOrHandler) ?? new Set()
    handlers.add(possibleHandler)
    this.#methodNotificationHandlers.set(methodOrHandler, handlers)
    return () => {
      handlers.delete(possibleHandler)
      if (handlers.size === 0) this.#methodNotificationHandlers.delete(methodOrHandler)
    }
  }

  onError(handler: (error: Error) => void): () => void {
    this.#errorHandlers.add(handler)
    return () => this.#errorHandlers.delete(handler)
  }

  close(reason: Error = new JsonlRpcClosedError()): void {
    if (this.#closedError !== undefined) return
    this.#fail(reason)
    if (!this.#writable.destroyed && !this.#writable.writableEnded) this.#writable.end()
  }

  #allocateRequestId(): number {
    const start = this.#nextRequestId
    do {
      const candidate = this.#nextRequestId
      this.#nextRequestId = candidate >= Number.MAX_SAFE_INTEGER ? 1 : candidate + 1
      if (!this.#pending.has(candidate)) return candidate
    } while (this.#nextRequestId !== start)
    throw new Error('No JSON-RPC request IDs are available')
  }

  #consumeLines(): void {
    let newlineIndex = this.#buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      let line = this.#buffer.slice(0, newlineIndex)
      this.#buffer = this.#buffer.slice(newlineIndex + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (Buffer.byteLength(line, 'utf8') > this.#maxLineBytes) {
        this.#fail(
          new JsonlRpcProtocolError(
            `JSONL RPC line exceeds the ${String(this.#maxLineBytes)} byte limit`,
          ),
        )
        return
      }
      if (line.trim().length > 0) this.#handleLine(line)
      if (this.#closedError !== undefined) return
      newlineIndex = this.#buffer.indexOf('\n')
    }

    if (Buffer.byteLength(this.#buffer, 'utf8') > this.#maxLineBytes) {
      this.#fail(
        new JsonlRpcProtocolError(
          `JSONL RPC line exceeds the ${String(this.#maxLineBytes)} byte limit`,
        ),
      )
    }
  }

  #handleLine(line: string): void {
    let value: unknown
    try {
      value = JSON.parse(line) as unknown
    } catch (error: unknown) {
      const protocolError = new JsonlRpcProtocolError(`Invalid JSONL RPC JSON: ${asError(error).message}`)
      this.#emitError(protocolError)
      this.#sendErrorResponse(null, -32700, 'Parse error')
      return
    }

    if (
      !isRecord(value) ||
      (value.jsonrpc !== '2.0' && !(this.#acceptMissingJsonrpc && value.jsonrpc === undefined))
    ) {
      this.#invalidRequest(value)
      return
    }

    if (typeof value.method === 'string') {
      if ('id' in value) this.#handleIncomingRequest(value)
      else this.#handleNotification(value.method, value.params)
      return
    }

    if ('id' in value) {
      this.#handleResponse(value)
      return
    }

    this.#invalidRequest(value)
  }

  #invalidRequest(value: unknown): void {
    const error = new JsonlRpcProtocolError('Received an invalid JSON-RPC 2.0 message')
    this.#emitError(error)
    const id = isRecord(value) && isRequestId(value.id) ? value.id : null
    this.#sendErrorResponse(id, -32600, 'Invalid Request')
  }

  #handleNotification(method: string, rawParams: unknown): void {
    const params = rawParams === undefined ? undefined : toJsonValue(rawParams)
    if (rawParams !== undefined && params === undefined) {
      this.#invalidRequest({ jsonrpc: '2.0', method, params: rawParams })
      return
    }

    const handlers = [
      ...this.#notificationHandlers,
      ...(this.#methodNotificationHandlers.get(method) ?? []),
    ]
    for (const handler of handlers) {
      try {
        void Promise.resolve(handler(method, params)).catch((error: unknown) => {
          this.#emitError(asError(error))
        })
      } catch (error: unknown) {
        this.#emitError(asError(error))
      }
    }
  }

  #handleIncomingRequest(message: JsonRecord): void {
    if (!isRequestId(message.id) || typeof message.method !== 'string') {
      this.#invalidRequest(message)
      return
    }
    const params = message.params === undefined ? undefined : toJsonValue(message.params)
    if (message.params !== undefined && params === undefined) {
      this.#sendErrorResponse(message.id, -32602, 'Invalid params')
      return
    }

    const handler = this.#requestHandlers.get(message.method)
    if (handler === undefined) {
      this.#sendErrorResponse(message.id, -32601, 'Method not found')
      return
    }

    const context = { id: message.id, method: message.method }
    void this.#runRequestHandler(handler, params, context)
  }

  async #runRequestHandler(
    handler: JsonRpcRequestHandler,
    params: JsonValue | undefined,
    context: JsonRpcRequestContext,
  ): Promise<void> {
    try {
      const result = await handler(params, context)
      await this.#enqueue(this.#createMessage({ id: context.id, result: result ?? null }))
    } catch (error: unknown) {
      if (error instanceof JsonRpcError) {
        this.#sendErrorResponse(context.id, error.code, error.message, error.data)
      } else {
        this.#emitError(asError(error))
        this.#sendErrorResponse(context.id, -32603, 'Internal error')
      }
    }
  }

  #handleResponse(message: JsonRecord): void {
    if (!isRequestId(message.id)) {
      this.#emitError(new JsonlRpcProtocolError('Received a JSON-RPC response with an invalid ID'))
      return
    }
    const pending = this.#pending.get(message.id)
    if (pending === undefined) {
      this.#emitError(
        new JsonlRpcProtocolError(`Received a response for unknown request ID ${String(message.id)}`),
      )
      return
    }

    const hasResult = 'result' in message
    const hasError = 'error' in message
    if (hasResult === hasError) {
      this.#emitError(new JsonlRpcProtocolError('JSON-RPC response must contain result or error'))
      return
    }

    if (hasError) {
      if (!isRecord(message.error) || typeof message.error.code !== 'number' || typeof message.error.message !== 'string') {
        this.#emitError(new JsonlRpcProtocolError('Received a malformed JSON-RPC error response'))
        return
      }
      const data = message.error.data === undefined ? undefined : toJsonValue(message.error.data)
      if (message.error.data !== undefined && data === undefined) {
        this.#emitError(new JsonlRpcProtocolError('JSON-RPC error data is not a JSON value'))
        return
      }
      this.#settlePending(message.id)
      pending.reject(new JsonRpcError(message.error.code, message.error.message, data))
      return
    }

    const result = toJsonValue(message.result)
    if (result === undefined) {
      this.#emitError(new JsonlRpcProtocolError('JSON-RPC result is not a JSON value'))
      return
    }
    this.#settlePending(message.id)
    pending.resolve(result)
  }

  #settlePending(id: JsonRpcRequestId): void {
    const pending = this.#pending.get(id)
    if (pending === undefined) return
    this.#pending.delete(id)
    if (pending.timer !== undefined) clearTimeout(pending.timer)
  }

  #sendErrorResponse(
    id: JsonRpcRequestId | null,
    code: number,
    message: string,
    data?: JsonValue,
  ): void {
    const error: Record<string, JsonValue> = { code, message }
    if (data !== undefined) error.data = data
    void this.#enqueue(this.#createMessage({ error, id })).catch((writeError: unknown) => {
      this.#emitError(asError(writeError))
    })
  }

  #enqueue(message: Readonly<Record<string, JsonValue>>): Promise<void> {
    if (this.#closedError !== undefined) return Promise.reject(this.#closedError)

    let data: string
    try {
      data = `${JSON.stringify(message)}\n`
    } catch (error: unknown) {
      return Promise.reject(asError(error))
    }
    const bytes = Buffer.byteLength(data, 'utf8')
    if (bytes > this.#maxLineBytes) {
      return Promise.reject(
        new JsonlRpcProtocolError(
          `Outgoing JSONL RPC line exceeds the ${String(this.#maxLineBytes)} byte limit`,
        ),
      )
    }
    if (this.#bufferedWriteBytes + bytes > this.#maxBufferedWriteBytes) {
      return Promise.reject(
        new JsonlRpcProtocolError(
          `JSONL RPC write queue exceeds the ${String(this.#maxBufferedWriteBytes)} byte limit`,
        ),
      )
    }

    return new Promise<void>((resolve, reject) => {
      const frame = { bytes, data, reject, resolve }
      this.#bufferedWriteBytes += bytes
      this.#writeQueue.push(frame)
      this.#pumpWrites()
    })
  }

  #createMessage(fields: Readonly<Record<string, JsonValue>>): Record<string, JsonValue> {
    return this.#omitJsonrpcHeader ? { ...fields } : { ...fields, jsonrpc: '2.0' }
  }

  #pumpWrites(): void {
    if (this.#currentWrite !== undefined || this.#closedError !== undefined) return
    const frame = this.#writeQueue.shift()
    if (frame === undefined) return
    this.#currentWrite = frame

    try {
      // Waiting for the callback before dequeuing the next frame provides a
      // deterministic backpressure boundary even when write() returns false.
      this.#writable.write(frame.data, 'utf8', (error?: Error | null) => {
        if (this.#currentWrite !== frame) return
        this.#currentWrite = undefined
        this.#bufferedWriteBytes -= frame.bytes
        if (error !== undefined && error !== null) frame.reject(error)
        else frame.resolve()
        this.#pumpWrites()
      })
    } catch (error: unknown) {
      this.#currentWrite = undefined
      this.#bufferedWriteBytes -= frame.bytes
      frame.reject(asError(error))
      this.#fail(asError(error))
    }
  }

  #fail(error: Error): void {
    if (this.#closedError !== undefined) return
    this.#closedError = error
    this.#buffer = ''

    this.#readable.off('data', this.#onData)
    this.#readable.off('end', this.#onEnd)
    this.#readable.off('close', this.#onReadableClose)
    this.#readable.off('error', this.#onStreamError)
    this.#writable.off('close', this.#onWritableClose)
    this.#writable.off('error', this.#onStreamError)

    for (const pending of this.#pending.values()) {
      if (pending.timer !== undefined) clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()

    if (this.#currentWrite !== undefined) this.#currentWrite.reject(error)
    for (const frame of this.#writeQueue) frame.reject(error)
    this.#currentWrite = undefined
    this.#writeQueue.length = 0
    this.#bufferedWriteBytes = 0
    this.#emitError(error)
  }

  #emitError(error: Error): void {
    for (const handler of this.#errorHandlers) {
      try {
        handler(error)
      } catch {
        // Observer failures must not destabilize the transport.
      }
    }
  }
}

function assertMethod(method: string): void {
  if (method.length === 0) throw new TypeError('JSON-RPC method must not be empty')
}

function validatePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`)
  }
  return value
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRequestId(value: unknown): value is JsonRpcRequestId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (Array.isArray(value)) {
    const result: JsonValue[] = []
    for (const item of value) {
      const converted = toJsonValue(item)
      if (converted === undefined) return undefined
      result.push(converted)
    }
    return result
  }
  if (!isRecord(value)) return undefined
  const result: Record<string, JsonValue> = {}
  for (const [key, item] of Object.entries(value)) {
    const converted = toJsonValue(item)
    if (converted === undefined) return undefined
    result[key] = converted
  }
  return result
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
