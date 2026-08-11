#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

if (process.argv.includes('--version')) {
  console.log('codex-cli 0.147.0')
  process.exit(0)
}

const cwd = process.cwd()
const permissionRoot = process.env.CODEX_HOME ? resolve(process.env.CODEX_HOME, '..', 'project') : cwd
const logPath = join(process.env.CODEX_HOME ?? cwd, 'fake-lifecycle-requests.jsonl')
const primaryThreadId = '11111111-1111-7111-8111-111111111111'
const secondaryThreadId = '22222222-2222-7222-8222-222222222222'
const forkThreadId = '33333333-3333-7333-8333-333333333333'
const threads = new Map([
  [primaryThreadId, makeThread(primaryThreadId, 'Lifecycle primary', 20)],
  [secondaryThreadId, makeThread(secondaryThreadId, 'Lifecycle secondary', 10)],
])
const archived = new Set()
const goals = new Map()
let permissionRequestSent = false
let account = null

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue
  const message = JSON.parse(line)
  if (message.id === 900 && typeof message.method !== 'string') {
    appendFileSync(logPath, `${JSON.stringify({ method: 'client/permission-response', params: message.result ?? null })}\n`)
    continue
  }
  if (typeof message.method !== 'string') continue
  const loggedParams = message.method === 'account/login/start' && message.params?.type === 'apiKey'
    ? { ...message.params, apiKey: '[REDACTED]' }
    : message.params ?? null
  appendFileSync(logPath, `${JSON.stringify({ method: message.method, params: loggedParams })}\n`)
  if (!Object.hasOwn(message, 'id')) continue
  try {
    respond(message.id, handle(message.method, message.params ?? {}))
  } catch (error) {
    respondError(message.id, error instanceof Error ? error.message : String(error))
  }
}

function handle(method, params) {
  if (method === 'initialize') return { userAgent: 'fake-codex/0.147.0', platformFamily: process.platform, platformOs: process.platform }
  if (method === 'model/list') return { data: [{ id: 'fake-model', displayName: 'Fake Model', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['medium'], inputModalities: ['text'] }] }
  if (method === 'account/read') return { account, requiresOpenaiAuth: true }
  if (method === 'account/login/start' && params.type === 'apiKey') {
    account = { type: 'apiKey' }
    queueMicrotask(() => {
      notify('account/login/completed', { loginId: null, success: true, error: null, onboardingEntrypoint: null })
      notify('account/updated', { authMode: 'apikey', planType: null })
    })
    return { type: 'apiKey' }
  }
  if (method === 'account/logout') {
    account = null
    queueMicrotask(() => notify('account/updated', { authMode: null, planType: null }))
    return {}
  }
  if (method === 'thread/list') return listThreads(params)
  if (method === 'thread/read' || method === 'thread/resume') {
    const thread = requireThread(params.threadId)
    if (method === 'thread/resume' && thread.id === secondaryThreadId && !permissionRequestSent) {
      permissionRequestSent = true
      queueMicrotask(() => requestPermission(thread.id))
    }
    return { thread }
  }
  if (method === 'thread/goal/get') return { goal: goals.get(params.threadId) ?? null }
  if (method === 'thread/goal/set') {
    requireThread(params.threadId)
    const previous = goals.get(params.threadId)
    const now = Math.floor(Date.now() / 1000)
    const goal = {
      threadId: params.threadId,
      objective: String(params.objective),
      status: String(params.status),
      tokenBudget: typeof params.tokenBudget === 'number' ? params.tokenBudget : null,
      tokensUsed: previous?.tokensUsed ?? 0,
      timeUsedSeconds: previous?.timeUsedSeconds ?? 0,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }
    goals.set(params.threadId, goal)
    queueMicrotask(() => notify('thread/goal/updated', { threadId: params.threadId, turnId: null, goal }))
    return { goal }
  }
  if (method === 'thread/goal/clear') {
    requireThread(params.threadId)
    goals.delete(params.threadId)
    queueMicrotask(() => notify('thread/goal/cleared', { threadId: params.threadId }))
    return {}
  }
  if (method === 'thread/name/set') {
    const thread = requireThread(params.threadId)
    thread.name = String(params.name)
    thread.updatedAt += 1
    queueMicrotask(() => notify('thread/name/updated', { threadId: thread.id, threadName: thread.name }))
    return {}
  }
  if (method === 'thread/fork') {
    const source = requireThread(params.threadId)
    const fork = makeThread(forkThreadId, `${source.name ?? source.preview} fork`, 30)
    fork.forkedFromId = source.id
    threads.set(fork.id, fork)
    return { thread: fork, model: 'fake-model', modelProvider: 'openai' }
  }
  if (method === 'thread/archive') {
    requireThread(params.threadId)
    archived.add(params.threadId)
    queueMicrotask(() => notify('thread/archived', { threadId: params.threadId }))
    return {}
  }
  if (method === 'thread/unarchive') {
    const thread = requireThread(params.threadId)
    archived.delete(params.threadId)
    goals.delete(params.threadId)
    queueMicrotask(() => notify('thread/unarchived', { threadId: params.threadId }))
    return { thread }
  }
  if (method === 'thread/delete') {
    requireThread(params.threadId)
    threads.delete(params.threadId)
    archived.delete(params.threadId)
    queueMicrotask(() => notify('thread/deleted', { threadId: params.threadId }))
    return {}
  }
  if (method === 'thread/compact/start') {
    requireThread(params.threadId)
    queueMicrotask(() => notify('thread/compacted', { threadId: params.threadId }))
    return {}
  }
  throw new Error(`Unsupported fake method: ${method}`)
}

function listThreads(params) {
  const wantsArchived = params.archived === true
  const search = typeof params.searchTerm === 'string' ? params.searchTerm.toLocaleLowerCase() : ''
  const matches = [...threads.values()]
    .filter((thread) => archived.has(thread.id) === wantsArchived)
    .filter((thread) => !search || `${thread.name ?? ''} ${thread.preview}`.toLocaleLowerCase().includes(search))
    .sort((left, right) => right.updatedAt - left.updatedAt)
  if (search || wantsArchived || matches.length < 2) return { data: matches, nextCursor: null, backwardsCursor: null }
  if (params.cursor === 'page-2') return { data: matches.slice(1), nextCursor: null, backwardsCursor: 'back-2' }
  return { data: matches.slice(0, 1), nextCursor: 'page-2', backwardsCursor: null }
}

function requestPermission(threadId) {
  process.stdout.write(`${JSON.stringify({
    id: 900,
    method: 'item/permissions/requestApproval',
    params: {
      threadId,
      turnId: 'turn-permission',
      itemId: 'permission-item',
      environmentId: 'local',
      startedAtMs: Date.now(),
      cwd,
      reason: 'Allow a scoped package operation',
      permissions: {
        network: { enabled: true },
        fileSystem: {
          read: [`${permissionRoot}/shared-read`],
          write: null,
          entries: [{ path: { type: 'glob_pattern', pattern: `${permissionRoot}/generated/**` }, access: 'write' }],
        },
      },
    },
  })}\n`)
}

function makeThread(id, name, updatedAt) {
  return {
    id,
    sessionId: `session-${id}`,
    forkedFromId: null,
    parentThreadId: null,
    preview: name,
    ephemeral: false,
    modelProvider: 'openai',
    createdAt: 1,
    updatedAt,
    status: { type: 'idle' },
    cwd,
    cliVersion: '0.147.0',
    name,
    turns: [],
  }
}

function requireThread(id) {
  const thread = threads.get(id)
  if (!thread) throw new Error('Thread not found')
  return thread
}

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ id, result })}\n`)
}

function respondError(id, message) {
  process.stdout.write(`${JSON.stringify({ id, error: { code: -32000, message } })}\n`)
}

function notify(method, params) {
  process.stdout.write(`${JSON.stringify({ method, params })}\n`)
}
