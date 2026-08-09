import { describe, expect, it } from 'vitest'
import {
  MAX_ACTIVITY_TEXT_LENGTH,
  type AgentActivity,
  type AgentActivityState,
  type AgentServerEvent,
} from '../../src/shared/agent.js'
import { createAgentActivityState, reduceAgentActivity } from '../../src/main/agent/activityReducer.js'

const ids = { threadId: 'thread-1', turnId: 'turn-1' }

function event(method: string, params: unknown, emittedAtMs = 5000): AgentServerEvent {
  return { method, params, emittedAtMs }
}

function reduceAll(...events: AgentServerEvent[]): AgentActivityState {
  return events.reduce(reduceAgentActivity, createAgentActivityState())
}

function findActivity<T extends AgentActivity['type']>(
  state: AgentActivityState,
  id: string,
  type: T,
): Extract<AgentActivity, { type: T }> {
  const activity = state.activities.find((candidate) => candidate.id === id)
  if (activity?.type !== type) throw new Error(`Missing ${type} activity ${id}`)
  return activity as Extract<AgentActivity, { type: T }>
}

describe('agent activity reducer', () => {
  it('creates an independent empty state', () => {
    const first = createAgentActivityState()
    const second = createAgentActivityState()
    expect(first).toEqual({
      threadId: null,
      turnId: null,
      turnStatus: 'idle',
      activities: [],
      unknownEvents: [],
      lastError: null,
    })
    expect(first.activities).not.toBe(second.activities)
    expect(first.unknownEvents).not.toBe(second.unknownEvents)
  })

  it('normalizes a thread start and preserves stable metadata', () => {
    const state = reduceAll(event('thread/started', {
      thread: {
        id: 'thread-1',
        modelProvider: 'openai',
        cwd: '/work',
        preview: 'Build it',
        createdAt: 12,
        status: { type: 'active', activeFlags: [] },
        turns: [],
      },
    }))
    const activity = findActivity(state, 'thread:thread-1', 'thread')
    expect(state.threadId).toBe('thread-1')
    expect(activity.status).toBe('inProgress')
    expect(activity.startedAtMs).toBe(12000)
    expect(activity).toMatchObject({ modelProvider: 'openai', cwd: '/work', preview: 'Build it' })
  })

  it('updates thread status without requiring a preceding start', () => {
    const state = reduceAll(event('thread/status/changed', {
      threadId: 'thread-1',
      status: { type: 'systemError' },
    }))
    expect(findActivity(state, 'thread:thread-1', 'thread').status).toBe('failed')
    expect(state.threadId).toBe('thread-1')
  })

  it('loads historical turns and their items from thread snapshots', () => {
    const state = reduceAll(event('thread/started', {
      thread: {
        id: 'thread-1', createdAt: 1, status: { type: 'idle' }, turns: [{
          id: 'old-turn', status: 'completed', startedAt: 2, completedAt: 3, durationMs: 1000, error: null,
          items: [{ type: 'agentMessage', id: 'old-message', text: 'done', phase: 'final_answer' }],
        }],
      },
    }))
    expect(findActivity(state, 'turn:old-turn', 'turn').completedAtMs).toBe(3000)
    expect(findActivity(state, 'old-message', 'agentMessage').text).toBe('done')
    expect(state.turnId).toBeNull()
  })

  it('tracks turn lifecycle and millisecond timestamps', () => {
    const started = reduceAll(event('turn/started', {
      threadId: 'thread-1',
      turn: { id: 'turn-1', status: 'inProgress', startedAt: 10, completedAt: null, durationMs: null, error: null, items: [] },
    }))
    const completed = reduceAgentActivity(started, event('turn/completed', {
      threadId: 'thread-1',
      turn: { id: 'turn-1', status: 'completed', startedAt: 10, completedAt: 11, durationMs: 1000, error: null, items: [] },
    }))
    expect(started.turnStatus).toBe('inProgress')
    expect(completed.turnStatus).toBe('completed')
    expect(findActivity(completed, 'turn:turn-1', 'turn')).toMatchObject({ startedAtMs: 10000, completedAtMs: 11000, durationMs: 1000 })
  })

  it('finalizes in-progress items when an interrupted turn omits item completion', () => {
    const state = reduceAll(
      event('turn/started', {
        threadId: 'thread-1',
        turn: { id: 'turn-1', status: 'inProgress', startedAt: 10, completedAt: null, durationMs: null, error: null, items: [] },
      }),
      event('item/started', {
        ...ids,
        item: { type: 'commandExecution', id: 'cmd-interrupted', command: 'sleep 20', status: 'inProgress' },
      }),
      event('turn/completed', {
        threadId: 'thread-1',
        turn: { id: 'turn-1', status: 'interrupted', startedAt: 10, completedAt: 11, durationMs: 1000, error: null, items: [] },
      }),
    )

    expect(state.turnStatus).toBe('interrupted')
    expect(findActivity(state, 'cmd-interrupted', 'command')).toMatchObject({
      status: 'interrupted',
      completedAtMs: 11000,
    })
  })

  it('normalizes all supported user input variants', () => {
    const state = reduceAll(event('item/completed', {
      ...ids,
      completedAtMs: 20,
      item: {
        type: 'userMessage', id: 'user-1', clientId: 'client-1', content: [
          { type: 'text', text: 'hello' },
          { type: 'image', url: 'https://image' },
          { type: 'localAudio', path: '/tmp/a.wav' },
          { type: 'skill', name: 'review', path: '/skill' },
          { type: 'mention', name: 'file', path: '/work/a.ts' },
        ],
      },
    }))
    const activity = findActivity(state, 'user-1', 'userMessage')
    expect(activity.status).toBe('completed')
    expect(activity.clientId).toBe('client-1')
    expect(activity.content).toHaveLength(5)
    expect(activity.content[2]).toEqual({ type: 'audio', url: '/tmp/a.wav', local: true })
  })

  it('streams agent messages and accepts the completed item as a snapshot', () => {
    const state = reduceAll(
      event('item/started', { ...ids, startedAtMs: 10, item: { type: 'agentMessage', id: 'agent-1', text: '', phase: 'commentary' } }),
      event('item/agentMessage/delta', { ...ids, itemId: 'agent-1', delta: 'Hello ' }),
      event('item/agentMessage/delta', { ...ids, itemId: 'agent-1', delta: 'world' }),
      event('item/completed', { ...ids, completedAtMs: 30, item: { type: 'agentMessage', id: 'agent-1', text: 'Hello world!', phase: 'final_answer' } }),
    )
    const activity = findActivity(state, 'agent-1', 'agentMessage')
    expect(activity.text).toBe('Hello world!')
    expect(activity.phase).toBe('final_answer')
    expect(activity.status).toBe('completed')
    expect(activity).toMatchObject({ startedAtMs: 10, completedAtMs: 30 })
  })

  it('creates an agent message placeholder when a delta arrives first', () => {
    const state = reduceAll(event('item/agentMessage/delta', { ...ids, itemId: 'early', delta: 'first' }))
    expect(findActivity(state, 'early', 'agentMessage')).toMatchObject({ text: 'first', status: 'inProgress' })
    expect(state.turnId).toBe('turn-1')
  })

  it('streams indexed reasoning summary and content without collapsing parts', () => {
    const state = reduceAll(
      event('item/reasoning/summaryPartAdded', { ...ids, itemId: 'reason-1', summaryIndex: 1 }),
      event('item/reasoning/summaryTextDelta', { ...ids, itemId: 'reason-1', summaryIndex: 1, delta: 'summary' }),
      event('item/reasoning/textDelta', { ...ids, itemId: 'reason-1', contentIndex: 0, delta: 'private' }),
      event('item/reasoning/textDelta', { ...ids, itemId: 'reason-1', contentIndex: 0, delta: ' thought' }),
    )
    const activity = findActivity(state, 'reason-1', 'reasoning')
    expect(activity.summary).toEqual(['', 'summary'])
    expect(activity.content).toEqual(['private thought'])
    expect(activity.status).toBe('inProgress')
  })

  it('preserves streamed command output when the completion omits aggregation', () => {
    const state = reduceAll(
      event('item/commandExecution/outputDelta', { ...ids, itemId: 'cmd-1', delta: 'line 1\n' }),
      event('item/completed', {
        ...ids, completedAtMs: 40,
        item: {
          type: 'commandExecution', id: 'cmd-1', command: 'pwd', cwd: '/work', processId: '42', source: 'agent',
          status: 'completed', aggregatedOutput: null, exitCode: 0, durationMs: 25, commandActions: [{ type: 'read' }],
        },
      }),
    )
    const activity = findActivity(state, 'cmd-1', 'command')
    expect(activity.output).toBe('line 1\n')
    expect(activity).toMatchObject({ command: 'pwd', cwd: '/work', processId: '42', exitCode: 0, durationMs: 25 })
    expect(activity.commandActions).toEqual([{ type: 'read' }])
  })

  it('normalizes file changes and retains legacy streamed output', () => {
    const state = reduceAll(
      event('item/fileChange/outputDelta', { ...ids, itemId: 'patch-1', delta: 'Done!' }),
      event('item/completed', {
        ...ids,
        item: {
          type: 'fileChange', id: 'patch-1', status: 'completed', changes: [
            { path: '/work/a.ts', kind: { type: 'update', move_path: '/work/b.ts' }, diff: '@@ diff' },
          ],
        },
      }),
    )
    const activity = findActivity(state, 'patch-1', 'fileChange')
    expect(activity.output).toBe('Done!')
    expect(activity.changes).toEqual([{ path: '/work/a.ts', kind: 'update', movePath: '/work/b.ts', diff: '@@ diff' }])
    expect(activity.status).toBe('completed')
  })

  it('exposes turn-level aggregated diffs as file activities', () => {
    const state = reduceAll(event('turn/diff/updated', { ...ids, diff: 'diff --git a/a b/a' }))
    const activity = findActivity(state, 'turn-diff:turn-1', 'fileChange')
    expect(activity.changes[0]).toMatchObject({ kind: 'aggregate', diff: 'diff --git a/a b/a' })
    expect(activity.status).toBe('inProgress')
  })

  it('tracks MCP progress and completion data', () => {
    const state = reduceAll(
      event('item/mcpToolCall/progress', { ...ids, itemId: 'mcp-1', message: 'Connecting' }),
      event('item/mcpToolCall/progress', { ...ids, itemId: 'mcp-1', message: 'Reading' }),
      event('item/completed', {
        ...ids,
        item: {
          type: 'mcpToolCall', id: 'mcp-1', server: 'docs', tool: 'read', status: 'completed', arguments: { uri: 'a' },
          result: { content: [{ type: 'text', text: 'ok' }] }, error: null, durationMs: 15,
        },
      }),
    )
    const activity = findActivity(state, 'mcp-1', 'mcpTool')
    expect(activity.progress).toBe('Connecting\nReading')
    expect(activity).toMatchObject({ server: 'docs', tool: 'read', arguments: { uri: 'a' }, durationMs: 15, status: 'completed' })
    expect(activity.result).toEqual({ content: [{ type: 'text', text: 'ok' }] })
  })

  it('normalizes dynamic tool calls', () => {
    const state = reduceAll(event('item/completed', {
      ...ids,
      item: {
        type: 'dynamicToolCall', id: 'dynamic-1', namespace: 'plugin', tool: 'render', arguments: { size: 2 },
        status: 'completed', contentItems: [{ type: 'inputText', text: 'result' }], success: true, durationMs: 5,
      },
    }))
    const activity = findActivity(state, 'dynamic-1', 'dynamicTool')
    expect(activity).toMatchObject({ namespace: 'plugin', tool: 'render', success: true, durationMs: 5 })
    expect(activity.contentItems).toEqual([{ type: 'inputText', text: 'result' }])
  })

  it('normalizes web search items', () => {
    const state = reduceAll(event('item/completed', {
      ...ids,
      item: {
        type: 'webSearch', id: 'web-1', query: 'Codex', action: { type: 'search', query: 'Codex' },
        results: [{ title: 'OpenAI' }],
      },
    }))
    const activity = findActivity(state, 'web-1', 'webSearch')
    expect(activity.query).toBe('Codex')
    expect(activity.action).toEqual({ type: 'search', query: 'Codex' })
    expect(activity.results).toEqual([{ title: 'OpenAI' }])
  })

  it('normalizes collaboration tool calls', () => {
    const state = reduceAll(event('item/started', {
      ...ids,
      item: {
        type: 'collabAgentToolCall', id: 'collab-1', tool: 'spawnAgent', status: 'inProgress', senderThreadId: 'thread-1',
        receiverThreadIds: ['child-1'], prompt: 'Investigate', model: 'gpt-test', reasoningEffort: 'high',
        agentsStates: { 'child-1': { status: 'running', message: null } },
      },
    }))
    const activity = findActivity(state, 'collab-1', 'collab')
    expect(activity).toMatchObject({ tool: 'spawnAgent', senderThreadId: 'thread-1', prompt: 'Investigate', model: 'gpt-test' })
    expect(activity.receiverThreadIds).toEqual(['child-1'])
    expect(activity.agentsStates).toEqual({ 'child-1': { status: 'running', message: null } })
  })

  it('normalizes subagent activities', () => {
    const state = reduceAll(event('item/completed', {
      ...ids,
      item: { type: 'subAgentActivity', id: 'sub-1', kind: 'interacted', agentThreadId: 'child-1', agentPath: '/root/child' },
    }))
    expect(findActivity(state, 'sub-1', 'subagent')).toMatchObject({
      kind: 'interacted', agentThreadId: 'child-1', agentPath: '/root/child', status: 'completed',
    })
  })

  it('streams plan items and retains text on completion', () => {
    const state = reduceAll(
      event('item/plan/delta', { ...ids, itemId: 'plan-1', delta: 'Step one' }),
      event('item/completed', { ...ids, item: { type: 'plan', id: 'plan-1', text: '' } }),
    )
    const activity = findActivity(state, 'plan-1', 'plan')
    expect(activity.text).toBe('Step one')
    expect(activity.status).toBe('completed')
  })

  it('replaces structured turn plans and infers completion', () => {
    const first = reduceAll(event('turn/plan/updated', {
      ...ids, explanation: 'Approach', plan: [{ step: 'Implement', status: 'inProgress' }],
    }))
    const completed = reduceAgentActivity(first, event('turn/plan/updated', {
      ...ids, explanation: null, plan: [{ step: 'Implement', status: 'completed' }],
    }))
    expect(findActivity(first, 'turn-plan:turn-1', 'plan')).toMatchObject({ explanation: 'Approach', status: 'inProgress' })
    expect(findActivity(completed, 'turn-plan:turn-1', 'plan')).toMatchObject({ explanation: null, status: 'completed' })
  })

  it('records retryable and terminal errors distinctly', () => {
    const retrying = reduceAll(event('error', {
      ...ids, error: { message: 'temporary', additionalDetails: 'retry soon', codexErrorInfo: { type: 'rateLimit' } }, willRetry: true,
    }))
    const terminal = reduceAgentActivity(retrying, event('error', {
      ...ids, error: { message: 'fatal', additionalDetails: null, codexErrorInfo: null }, willRetry: false,
    }))
    expect(retrying.lastError).toMatchObject({ message: 'temporary', willRetry: true, status: 'inProgress' })
    expect(terminal.lastError).toMatchObject({ message: 'fatal', willRetry: false, status: 'failed' })
    expect(terminal.turnStatus).toBe('failed')
    expect(terminal.activities.filter((activity) => activity.type === 'error')).toHaveLength(2)
  })

  it('turn completion surfaces the embedded failure as an error activity', () => {
    const state = reduceAll(event('turn/completed', {
      threadId: 'thread-1',
      turn: {
        id: 'turn-1', status: 'failed', startedAt: 1, completedAt: 2, durationMs: 1000, items: [],
        error: { message: 'tool crashed', additionalDetails: 'exit 1', codexErrorInfo: { type: 'internal' } },
      },
    }))
    expect(state.turnStatus).toBe('failed')
    expect(findActivity(state, 'turn-error:turn-1', 'error')).toMatchObject({ message: 'tool crashed', additionalDetails: 'exit 1' })
    expect(state.lastError?.id).toBe('turn-error:turn-1')
  })

  it('retains unknown item types as explicit activities', () => {
    const rawItem = { type: 'futureWidget', id: 'future-1', nested: { value: 1 } }
    const state = reduceAll(event('item/started', { ...ids, item: rawItem }))
    rawItem.nested.value = 2
    const activity = findActivity(state, 'future-1', 'unknownItem')
    expect(activity.itemType).toBe('futureWidget')
    expect(activity.raw).toEqual({ type: 'futureWidget', id: 'future-1', nested: { value: 1 } })
  })

  it('retains unknown and malformed events instead of dropping them', () => {
    const unknownParams = { feature: { enabled: true } }
    const state = reduceAll(
      event('future/event', unknownParams, 70),
      event('item/started', { threadId: 'thread-1' }, 71),
    )
    unknownParams.feature.enabled = false
    expect(state.unknownEvents).toHaveLength(2)
    expect(state.unknownEvents[0]).toEqual({ method: 'future/event', params: { feature: { enabled: true } }, emittedAtMs: 70 })
    expect(state.unknownEvents[1]?.method).toBe('item/started')
  })

  it('does not mutate prior state while applying deltas', () => {
    const before = reduceAll(event('item/agentMessage/delta', { ...ids, itemId: 'immutable', delta: 'A' }))
    const beforeSnapshot = structuredClone(before)
    const after = reduceAgentActivity(before, event('item/agentMessage/delta', { ...ids, itemId: 'immutable', delta: 'B' }))
    expect(before).toEqual(beforeSnapshot)
    expect(findActivity(before, 'immutable', 'agentMessage').text).toBe('A')
    expect(findActivity(after, 'immutable', 'agentMessage').text).toBe('AB')
    expect(after.activities).not.toBe(before.activities)
  })

  it('caps streamed output at one MiB and accounts for omitted characters', () => {
    const first = 'a'.repeat(MAX_ACTIVITY_TEXT_LENGTH - 2)
    const state = reduceAll(
      event('item/commandExecution/outputDelta', { ...ids, itemId: 'huge', delta: first }),
      event('item/commandExecution/outputDelta', { ...ids, itemId: 'huge', delta: '12345' }),
      event('item/commandExecution/outputDelta', { ...ids, itemId: 'huge', delta: '678' }),
    )
    const activity = findActivity(state, 'huge', 'command')
    expect(activity.output).toHaveLength(MAX_ACTIVITY_TEXT_LENGTH)
    expect(activity.output.endsWith('12')).toBe(true)
    expect(activity.truncated).toBe(true)
    expect(activity.truncatedChars).toBe(6)
  })

  it('applies one shared text budget to completed multi-field activities', () => {
    const state = reduceAll(event('item/completed', {
      ...ids,
      item: {
        type: 'reasoning', id: 'huge-reasoning',
        summary: ['s'.repeat(MAX_ACTIVITY_TEXT_LENGTH)],
        content: ['unretained'],
      },
    }))
    const activity = findActivity(state, 'huge-reasoning', 'reasoning')
    expect(activity.summary[0]).toHaveLength(MAX_ACTIVITY_TEXT_LENGTH)
    expect(activity.content).toEqual([''])
    expect(activity.truncated).toBe(true)
    expect(activity.truncatedChars).toBe('unretained'.length)
  })

  it('marks a delta type collision as an unknown event without corrupting the item', () => {
    const state = reduceAll(
      event('item/started', { ...ids, item: { type: 'agentMessage', id: 'collision', text: 'safe', phase: null } }),
      event('item/commandExecution/outputDelta', { ...ids, itemId: 'collision', delta: 'bad' }),
    )
    expect(findActivity(state, 'collision', 'agentMessage').text).toBe('safe')
    expect(state.unknownEvents).toHaveLength(1)
    expect(state.unknownEvents[0]?.method).toBe('command/delta:type-mismatch')
  })
})
