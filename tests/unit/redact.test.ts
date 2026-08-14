import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { JsonlLogger } from '../../src/main/logging/logger.js'
import { CIRCULAR_REFERENCE, REDACTED, redact, redactString } from '../../src/main/logging/redact.js'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('log redaction', () => {
  it('redacts sensitive field names recursively without changing the source', () => {
    const source = {
      apiKey: 'sk-example-openai-key',
      nested: [
        { deepseek_api_key: 'sk-example-deepseek-key', keep: 'diagnostic-value' },
        { credentials: { token: 'nested-token' } },
      ],
      tokenCount: 42,
    }

    const result = redact(source)

    expect(result).toEqual({
      apiKey: REDACTED,
      nested: [
        { deepseek_api_key: REDACTED, keep: 'diagnostic-value' },
        { credentials: REDACTED },
      ],
      tokenCount: 42,
    })
    expect(result).not.toBe(source)
    expect(source.apiKey).toBe('sk-example-openai-key')
    expect(source.nested[0]?.deepseek_api_key).toBe('sk-example-deepseek-key')
  })

  it('redacts authorization headers, bearer tokens, provider keys, JWTs, and URL secrets', () => {
    const input = [
      'Authorization: Bearer visible-bearer-token',
      'secondary bearer another-visible-token',
      'key sk-proj-thisMustNeverReachDisk',
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signaturePart',
      'https://example.test/v1/responses?api_key=url-secret&request_id=req-42&signature=signed-secret',
      'openai_api_key="a secret value with spaces"',
    ].join(' | ')

    const result = redactString(input)

    expect(result).not.toContain('visible-bearer-token')
    expect(result).not.toContain('another-visible-token')
    expect(result).not.toContain('thisMustNeverReachDisk')
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(result).not.toContain('url-secret')
    expect(result).not.toContain('signed-secret')
    expect(result).not.toContain('a secret value with spaces')
    expect(result).toContain('Authorization: Bearer [REDACTED]')
    expect(result).toContain('request_id=req-42')
    expect(result).toContain('api_key=[REDACTED]')
  })

  it('handles cycles and repeated non-cyclic references safely', () => {
    const shared = { password: 'shared-secret', useful: 'context' }
    const source: { self?: unknown; children: unknown[] } = { children: [shared, shared] }
    source.self = source

    const result = redact(source)

    expect(result.self).toBe(CIRCULAR_REFERENCE)
    expect(result.children).toEqual([
      { password: REDACTED, useful: 'context' },
      { password: REDACTED, useful: 'context' },
    ])
    expect(() => JSON.stringify(result)).not.toThrow()
  })

  it('supports caller-defined sensitive fields', () => {
    expect(redact({ workspaceCredential: 'private', keep: true }, {
      sensitiveFields: ['workspaceCredential'],
    })).toEqual({ workspaceCredential: REDACTED, keep: true })
  })

  it('does not invoke accessors or fail on hostile objects while creating a safe copy', () => {
    const source = Object.defineProperty({ keep: 'context' }, 'password', {
      enumerable: true,
      get: () => {
        throw new Error('getter should never run')
      },
    })
    const hostile = new Proxy({}, {
      ownKeys: () => {
        throw new Error('proxy should not escape redaction')
      },
    })

    expect(redact(source)).toEqual({ keep: 'context', password: REDACTED })
    expect(redact(hostile)).toBe('[Unserializable]')
  })
})

describe('JsonlLogger', () => {
  it('writes structured, serialized JSONL with redaction applied to message and data', async () => {
    const root = mkdtempSync(join(tmpdir(), 'norevinq-log-test-'))
    temporaryPaths.push(root)
    const filePath = join(root, 'logs', 'main.jsonl')
    const logger = new JsonlLogger({
      clock: () => '2026-08-10T08:00:00.000Z',
      component: 'app-server',
      filePath,
    })

    await Promise.all([
      logger.info('request Bearer message-secret', {
        apiKey: 'sk-data-secret-value',
        requestId: 'req-42',
      }),
      logger.error('failed safely', { url: 'https://api.test/path?token=query-secret&trace=abc' }),
    ])
    await logger.close()

    const raw = readFileSync(filePath, 'utf8')
    const lines = raw.trimEnd().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({
      component: 'app-server',
      data: { apiKey: REDACTED, requestId: 'req-42' },
      level: 'info',
      message: `request Bearer ${REDACTED}`,
      time: '2026-08-10T08:00:00.000Z',
    })
    expect(lines[1]?.data).toEqual({
      url: `https://api.test/path?token=${REDACTED}&trace=abc`,
    })
    expect(raw).not.toContain('message-secret')
    expect(raw).not.toContain('data-secret-value')
    expect(raw).not.toContain('query-secret')
  })

  it('exposes file size information to a rotation strategy', async () => {
    const root = mkdtempSync(join(tmpdir(), 'norevinq-log-rotation-test-'))
    temporaryPaths.push(root)
    const contexts: { currentBytes: number; incomingBytes: number }[] = []
    const logger = new JsonlLogger({
      clock: () => '2026-08-10T08:00:00.000Z',
      component: 'runtime',
      filePath: join(root, 'runtime.jsonl'),
      rotation: {
        beforeWrite: (context) => {
          contexts.push({ currentBytes: context.currentBytes, incomingBytes: context.incomingBytes })
        },
      },
    })

    await logger.info('first')
    await logger.info('second')

    expect(contexts[0]?.currentBytes).toBe(0)
    expect(contexts[0]?.incomingBytes).toBeGreaterThan(0)
    expect(contexts[1]?.currentBytes).toBeGreaterThan(0)
  })
})
