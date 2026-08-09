/** The stable marker used in persisted logs in place of secret material. */
export const REDACTED = '[REDACTED]'

export const CIRCULAR_REFERENCE = '[Circular]'

export type RedactionOptions = {
  /** Prevents hostile or accidental values from exhausting the call stack. */
  maxDepth?: number
  /** Additional field names to redact, compared case-insensitively. */
  sensitiveFields?: readonly string[]
}

const DEFAULT_MAX_DEPTH = 32

const SENSITIVE_FIELD_NAMES = new Set([
  'accesstoken',
  'apikey',
  'authorization',
  'authtoken',
  'clientsecret',
  'cookie',
  'csrftoken',
  'credentials',
  'deepseekapikey',
  'encryptionkey',
  'githubtoken',
  'idtoken',
  'openaiapikey',
  'password',
  'passwd',
  'passphrase',
  'privatekey',
  'proxyauthorization',
  'pwd',
  'refreshtoken',
  'secret',
  'secretkey',
  'sessionid',
  'sessiontoken',
  'setcookie',
  'signingkey',
  'token',
])

// These are deliberately key-name based. Ordinary query parameters are retained so
// a failed request can still be diagnosed without retaining its credentials.
const SECRET_QUERY_PARAMETER =
  /([?&](?:access[_-]?token|api[_-]?key|authorization|auth[_-]?token|client[_-]?secret|code[_-]?verifier|id[_-]?token|key|password|refresh[_-]?token|secret|session[_-]?token|signature|sig|token|x-amz-credential|x-amz-security-token|x-amz-signature)=)([^&#\s]*)/giu

const INLINE_QUOTED_SECRET =
  /(\b(?:access[_-]?token|api[_-]?key|auth[_-]?token|client[_-]?secret|deepseek[_-]?api[_-]?key|id[_-]?token|openai[_-]?api[_-]?key|password|passwd|refresh[_-]?token|secret|session[_-]?token)\b\s*[:=]\s*)(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/giu

const INLINE_SECRET =
  /(\b(?:access[_-]?token|api[_-]?key|auth[_-]?token|client[_-]?secret|deepseek[_-]?api[_-]?key|id[_-]?token|openai[_-]?api[_-]?key|password|passwd|refresh[_-]?token|secret|session[_-]?token)\b\s*[:=]\s*)(["']?)([^"'\s,;&}]+)(["']?)/giu

/**
 * Redacts secrets embedded in free-form output while keeping useful context such
 * as header names, URL paths, query parameter names, and authentication schemes.
 */
export function redactString(value: string): string {
  return value
    .replace(
      /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/gu,
      '-----BEGIN $1-----\n[REDACTED]\n-----END $1-----',
    )
    .replace(
      /(\b(?:proxy-)?authorization\s*[:=]\s*)((?:bearer|basic)\s+)?([^\s,;"']+)/giu,
      (_match, header: string, scheme: string | undefined) =>
        `${header}${scheme ?? ''}${REDACTED}`,
    )
    .replace(/(\bbearer\s+)([A-Za-z0-9._~+/-]+=*)/giu, `$1${REDACTED}`)
    .replace(
      /\beyJ[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\b/gu,
      REDACTED,
    )
    .replace(/\bsk-(?:(?:proj|svcacct)-)?[A-Za-z0-9_-]{8,}\b/gu, REDACTED)
    .replace(SECRET_QUERY_PARAMETER, `$1${REDACTED}`)
    .replace(
      INLINE_QUOTED_SECRET,
      (_match, prefix: string, doubleQuoted: string | undefined) =>
        `${prefix}${doubleQuoted === undefined ? "'" : '"'}${REDACTED}${doubleQuoted === undefined ? "'" : '"'}`,
    )
    .replace(INLINE_SECRET, `$1$2${REDACTED}$4`)
    .replace(
      /(\b(?:cookie|set-cookie)\s*:\s*)([^\r\n]+)/giu,
      `$1${REDACTED}`,
    )
}

/**
 * Produces a detached, log-safe copy of a value. The source is never mutated.
 * Cycles are represented by a stable marker rather than throwing during JSON
 * serialization.
 */
export function redact<T>(value: T, options: RedactionOptions = {}): T {
  const maxDepth = Math.max(0, options.maxDepth ?? DEFAULT_MAX_DEPTH)
  const additionalFields = new Set(
    (options.sensitiveFields ?? []).map((field) => normalizeFieldName(field)),
  )

  return redactValue(value, {
    additionalFields,
    ancestors: new WeakSet<object>(),
    depth: 0,
    maxDepth,
  }) as T
}

/** More explicit alias for call sites that prefer describing the operation. */
export const redactSecrets = redact

type RedactionContext = {
  additionalFields: ReadonlySet<string>
  ancestors: WeakSet<object>
  depth: number
  maxDepth: number
}

function redactValue(value: unknown, context: RedactionContext): unknown {
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'bigint') return value.toString()
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'undefined'
  ) {
    return value
  }
  if (typeof value === 'symbol') return value.description ?? value.toString()
  if (typeof value === 'function') return `[Function${value.name ? `: ${value.name}` : ''}]`

  if (context.depth >= context.maxDepth) return '[MaxDepth]'
  if (context.ancestors.has(value)) return CIRCULAR_REFERENCE

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
  }
  if (value instanceof RegExp) return value.toString()
  if (value instanceof Error) return redactError(value, context)
  if (ArrayBuffer.isView(value)) {
    return `[${value.constructor.name}: ${String(value.byteLength)} bytes]`
  }
  if (value instanceof ArrayBuffer) return `[ArrayBuffer: ${String(value.byteLength)} bytes]`

  context.ancestors.add(value)
  const childContext: RedactionContext = { ...context, depth: context.depth + 1 }
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, childContext))
    }

    if (value instanceof Map) {
      return Array.from(value.entries(), ([key, entryValue]) => [
        redactValue(key, childContext),
        redactValue(entryValue, childContext),
      ])
    }
    if (value instanceof Set) {
      return Array.from(value, (item) => redactValue(item, childContext))
    }

    return redactObject(value, childContext)
  } catch {
    // Logging must not turn a Proxy trap or exotic host object into an application
    // failure. Avoid including the thrown error because it may itself contain data.
    return '[Unserializable]'
  } finally {
    context.ancestors.delete(value)
  }
}

function redactObject(value: object, context: RedactionContext): Record<string, unknown> {
  const clone: Record<string, unknown> = {}
  const descriptors = Object.getOwnPropertyDescriptors(value)

  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable) continue

    const redactedValue = isSensitiveField(key, context.additionalFields)
      ? REDACTED
      : 'value' in descriptor
        ? redactValue(descriptor.value, context)
        : '[Accessor]'

    // defineProperty safely handles hostile keys such as "__proto__".
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: true,
      value: redactedValue,
      writable: true,
    })
  }

  return clone
}

function redactError(error: Error, context: RedactionContext): Record<string, unknown> {
  if (context.ancestors.has(error)) return { error: CIRCULAR_REFERENCE }

  context.ancestors.add(error)
  const childContext: RedactionContext = { ...context, depth: context.depth + 1 }
  try {
    const output: Record<string, unknown> = {
      message: redactString(error.message),
      name: error.name,
    }
    if (error.stack) output.stack = redactString(error.stack)
    if (error.cause !== undefined) output.cause = redactValue(error.cause, childContext)

    const enumerableFields = redactObject(error, childContext)
    for (const [key, fieldValue] of Object.entries(enumerableFields)) output[key] = fieldValue
    return output
  } finally {
    context.ancestors.delete(error)
  }
}

function isSensitiveField(fieldName: string, additionalFields: ReadonlySet<string>): boolean {
  const normalized = normalizeFieldName(fieldName)
  return (
    SENSITIVE_FIELD_NAMES.has(normalized) ||
    additionalFields.has(normalized) ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('password') ||
    normalized.endsWith('privatekey') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('secretkey') ||
    normalized.endsWith('credentials') ||
    normalized.endsWith('refreshtoken') ||
    normalized.endsWith('accesstoken') ||
    normalized.endsWith('authtoken') ||
    normalized.endsWith('sessiontoken')
  )
}

function normalizeFieldName(fieldName: string): string {
  return fieldName.toLocaleLowerCase('en-US').replace(/[^a-z0-9]/gu, '')
}
