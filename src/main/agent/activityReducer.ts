import {
  MAX_ACTIVITY_TEXT_LENGTH,
  type AgentActivity,
  type AgentActivityBase,
  type AgentActivityState,
  type AgentActivityStatus,
  type AgentErrorActivity,
  type AgentErrorDetails,
  type AgentServerEvent,
  type AgentTurnStatus,
  type FileChange,
  type PlanStep,
  type SerializableValue,
  type UserMessageContent,
} from '../../shared/agent.js'

type UnknownRecord = Record<string, unknown>
type ItemLifecycle = 'started' | 'completed'

export function createAgentActivityState(): AgentActivityState {
  return {
    threadId: null,
    turnId: null,
    turnStatus: 'idle',
    activities: [],
    unknownEvents: [],
    lastError: null,
  }
}

export function reduceAgentActivity(
  state: Readonly<AgentActivityState>,
  event: Readonly<AgentServerEvent>,
): AgentActivityState {
  const params = asRecord(event.params)
  if (!params) return addUnknownEvent(state, event)

  switch (event.method) {
    case 'thread/started':
      return reduceThreadStarted(state, params, event.emittedAtMs ?? null)
    case 'thread/status/changed':
      return reduceThreadStatus(state, params)
    case 'turn/started':
      return reduceTurn(state, params, 'started', event.emittedAtMs ?? null)
    case 'turn/completed':
      return reduceTurn(state, params, 'completed', event.emittedAtMs ?? null)
    case 'turn/diff/updated':
      return reduceTurnDiff(state, params, event.emittedAtMs ?? null)
    case 'turn/plan/updated':
      return reduceTurnPlan(state, params, event.emittedAtMs ?? null)
    case 'item/started':
      return reduceItem(state, params, 'started', event.emittedAtMs ?? null)
    case 'item/completed':
      return reduceItem(state, params, 'completed', event.emittedAtMs ?? null)
    case 'item/agentMessage/delta':
      return reduceTextDelta(state, params, 'agentMessage', event.emittedAtMs ?? null)
    case 'item/plan/delta':
      return reduceTextDelta(state, params, 'plan', event.emittedAtMs ?? null)
    case 'item/commandExecution/outputDelta':
      return reduceTextDelta(state, params, 'command', event.emittedAtMs ?? null)
    case 'item/fileChange/outputDelta':
      return reduceTextDelta(state, params, 'fileChange', event.emittedAtMs ?? null)
    case 'item/reasoning/summaryTextDelta':
      return reduceReasoningDelta(state, params, 'summary', event.emittedAtMs ?? null)
    case 'item/reasoning/textDelta':
      return reduceReasoningDelta(state, params, 'content', event.emittedAtMs ?? null)
    case 'item/reasoning/summaryPartAdded':
      return reduceReasoningPart(state, params, event.emittedAtMs ?? null)
    case 'item/mcpToolCall/progress':
      return reduceMcpProgress(state, params, event.emittedAtMs ?? null)
    case 'error':
      return reduceError(state, params, event.emittedAtMs ?? null)
    default:
      return addUnknownEvent(state, event)
  }
}

function reduceThreadStarted(
  state: Readonly<AgentActivityState>,
  params: UnknownRecord,
  emittedAtMs: number | null,
): AgentActivityState {
  const thread = asRecord(params.thread)
  const threadId = stringValue(thread?.id)
  if (!thread || !threadId) return addMalformedEvent(state, 'thread/started', params, emittedAtMs)

  const preview = limitedText(stringValue(thread.preview) ?? '')
  const status = threadStatus(thread.status)
  const activity: AgentActivity = {
    ...baseActivity(`thread:${threadId}`, threadId, null, status, secondsToMs(thread.createdAt) ?? emittedAtMs, null),
    type: 'thread',
    modelProvider: stringValue(thread.modelProvider),
    cwd: stringValue(thread.cwd),
    preview: preview.text,
    truncated: preview.truncated,
    truncatedChars: preview.truncatedChars,
  }
  let next: AgentActivityState = {
    ...state,
    threadId,
    activities: upsertActivity(state.activities, activity),
    unknownEvents: [...state.unknownEvents],
  }

  for (const turn of arrayValue(thread.turns)) {
    const turnRecord = asRecord(turn)
    if (turnRecord) next = reduceTurnRecord(next, threadId, turnRecord, 'completed', emittedAtMs, false)
  }
  return next
}

function reduceThreadStatus(state: Readonly<AgentActivityState>, params: UnknownRecord): AgentActivityState {
  const threadId = stringValue(params.threadId)
  if (!threadId) return addMalformedEvent(state, 'thread/status/changed', params, null)
  const index = state.activities.findIndex((activity) => activity.type === 'thread' && activity.threadId === threadId)
  if (index < 0) {
    const activity: AgentActivity = {
      ...baseActivity(`thread:${threadId}`, threadId, null, threadStatus(params.status), null, null),
      type: 'thread',
      modelProvider: null,
      cwd: null,
      preview: '',
    }
    return { ...state, threadId, activities: upsertActivity(state.activities, activity), unknownEvents: [...state.unknownEvents] }
  }
  const existing = state.activities[index]
  if (!existing) return addMalformedEvent(state, 'thread/status/changed', params, null)
  return {
    ...state,
    threadId,
    activities: replaceAt(state.activities, index, { ...existing, status: threadStatus(params.status) }),
    unknownEvents: [...state.unknownEvents],
  }
}

function reduceTurn(
  state: Readonly<AgentActivityState>,
  params: UnknownRecord,
  lifecycle: ItemLifecycle,
  emittedAtMs: number | null,
): AgentActivityState {
  const threadId = stringValue(params.threadId)
  const turn = asRecord(params.turn)
  if (!threadId || !turn) return addMalformedEvent(state, `turn/${lifecycle}`, params, emittedAtMs)
  return reduceTurnRecord(state, threadId, turn, lifecycle, emittedAtMs, true)
}

function reduceTurnRecord(
  state: Readonly<AgentActivityState>,
  threadId: string,
  turn: UnknownRecord,
  lifecycle: ItemLifecycle,
  emittedAtMs: number | null,
  makeCurrent: boolean,
): AgentActivityState {
  const turnId = stringValue(turn.id)
  if (!turnId) return addMalformedEvent(state, `turn/${lifecycle}`, turn, emittedAtMs)
  const error = errorDetails(turn.error, false)
  const status = turnStatus(turn.status, lifecycle)
  const startedAtMs = secondsToMs(turn.startedAt) ?? (lifecycle === 'started' ? emittedAtMs : null)
  const completedAtMs = secondsToMs(turn.completedAt) ?? (lifecycle === 'completed' ? emittedAtMs : null)
  const activity: AgentActivity = {
    ...baseActivity(`turn:${turnId}`, threadId, turnId, status, startedAtMs, completedAtMs),
    type: 'turn',
    error,
    durationMs: numberValue(turn.durationMs),
  }
  let next: AgentActivityState = {
    ...state,
    threadId: makeCurrent ? threadId : state.threadId,
    turnId: makeCurrent ? turnId : state.turnId,
    turnStatus: makeCurrent ? toAgentTurnStatus(status) : state.turnStatus,
    activities: upsertActivity(state.activities, activity),
    unknownEvents: [...state.unknownEvents],
  }

  for (const item of arrayValue(turn.items)) {
    const record = asRecord(item)
    if (record) next = upsertItemRecord(next, threadId, turnId, record, lifecycle, emittedAtMs, makeCurrent)
  }
  if (lifecycle === 'completed') {
    next = {
      ...next,
      activities: next.activities.map((candidate) => candidate.turnId === turnId && candidate.status === 'inProgress'
        ? { ...candidate, status, completedAtMs: candidate.completedAtMs ?? completedAtMs }
        : candidate),
    }
  }
  if (error && makeCurrent) next = appendTurnError(next, threadId, turnId, error, completedAtMs)
  return next
}

function reduceTurnDiff(
  state: Readonly<AgentActivityState>,
  params: UnknownRecord,
  emittedAtMs: number | null,
): AgentActivityState {
  const ids = notificationIds(params)
  const diff = stringValue(params.diff)
  if (!ids || diff === null) return addMalformedEvent(state, 'turn/diff/updated', params, emittedAtMs)
  const limited = limitedText(diff)
  const activity: AgentActivity = {
    ...baseActivity(`turn-diff:${ids.turnId}`, ids.threadId, ids.turnId, 'inProgress', emittedAtMs, null),
    type: 'fileChange',
    changes: [{ path: '', kind: 'aggregate', movePath: null, diff: limited.text }],
    output: '',
    truncated: limited.truncated,
    truncatedChars: limited.truncatedChars,
  }
  return withCurrentIds(state, ids, upsertActivity(state.activities, activity))
}

function reduceTurnPlan(
  state: Readonly<AgentActivityState>,
  params: UnknownRecord,
  emittedAtMs: number | null,
): AgentActivityState {
  const ids = notificationIds(params)
  if (!ids) return addMalformedEvent(state, 'turn/plan/updated', params, emittedAtMs)
  const steps = arrayValue(params.plan).map(toPlanStep)
  const explanation = stringValue(params.explanation)
  const budget = createBudget()
  const safeExplanation = explanation === null ? null : consumeBudget(budget, explanation)
  const safeSteps = steps.map((step) => ({ ...step, step: consumeBudget(budget, step.step) }))
  const status: AgentActivityStatus = safeSteps.length > 0 && safeSteps.every((step) => step.status === 'completed')
    ? 'completed'
    : 'inProgress'
  const activity: AgentActivity = {
    ...baseActivity(`turn-plan:${ids.turnId}`, ids.threadId, ids.turnId, status, emittedAtMs, null),
    type: 'plan',
    text: '',
    explanation: safeExplanation,
    steps: safeSteps,
    truncated: budget.truncatedChars > 0,
    truncatedChars: budget.truncatedChars,
  }
  return withCurrentIds(state, ids, upsertActivity(state.activities, activity))
}

function reduceItem(
  state: Readonly<AgentActivityState>,
  params: UnknownRecord,
  lifecycle: ItemLifecycle,
  emittedAtMs: number | null,
): AgentActivityState {
  const ids = notificationIds(params)
  const item = asRecord(params.item)
  if (!ids || !item) return addMalformedEvent(state, `item/${lifecycle}`, params, emittedAtMs)
  return upsertItemRecord(state, ids.threadId, ids.turnId, item, lifecycle, lifecycleTimestamp(params, lifecycle) ?? emittedAtMs, true)
}

function upsertItemRecord(
  state: Readonly<AgentActivityState>,
  threadId: string,
  turnId: string,
  item: UnknownRecord,
  lifecycle: ItemLifecycle,
  timestampMs: number | null,
  makeCurrent: boolean,
): AgentActivityState {
  const activity = itemToActivity(item, threadId, turnId, lifecycle, timestampMs)
  const activities = upsertActivity(state.activities, activity)
  return makeCurrent
    ? withCurrentIds(state, { threadId, turnId }, activities)
    : { ...state, activities, unknownEvents: [...state.unknownEvents] }
}

function itemToActivity(
  item: UnknownRecord,
  threadId: string,
  turnId: string,
  lifecycle: ItemLifecycle,
  timestampMs: number | null,
): AgentActivity {
  const itemType = stringValue(item.type) ?? 'unknown'
  const id = stringValue(item.id) ?? `unknown:${itemType}:${turnId}`
  const status = itemStatus(item, lifecycle)
  const common = baseActivity(
    id,
    threadId,
    turnId,
    status,
    lifecycle === 'started' ? timestampMs : null,
    lifecycle === 'completed' ? timestampMs : null,
  )
  const budget = createBudget()

  switch (itemType) {
    case 'userMessage':
      return withBudget({
        ...common,
        type: 'userMessage',
        clientId: stringValue(item.clientId),
        content: arrayValue(item.content).map((value) => userContent(value, budget)),
      }, budget)
    case 'agentMessage':
      return withBudget({
        ...common,
        type: 'agentMessage',
        text: consumeBudget(budget, stringValue(item.text) ?? ''),
        phase: messagePhase(item.phase),
      }, budget)
    case 'reasoning':
      return withBudget({
        ...common,
        type: 'reasoning',
        summary: arrayValue(item.summary).map((value) => consumeBudget(budget, stringValue(value) ?? '')),
        content: arrayValue(item.content).map((value) => consumeBudget(budget, stringValue(value) ?? '')),
      }, budget)
    case 'commandExecution':
      return withBudget({
        ...common,
        type: 'command',
        command: consumeBudget(budget, stringValue(item.command) ?? ''),
        cwd: stringValue(item.cwd),
        processId: stringValue(item.processId),
        source: sourceName(item.source),
        output: consumeBudget(budget, stringValue(item.aggregatedOutput) ?? ''),
        exitCode: numberValue(item.exitCode),
        durationMs: numberValue(item.durationMs),
        commandActions: arrayValue(item.commandActions).map((value) => toSerializable(value)),
      }, budget)
    case 'fileChange':
      return withBudget({
        ...common,
        type: 'fileChange',
        changes: arrayValue(item.changes).map((value) => fileChange(value, budget)),
        output: '',
      }, budget)
    case 'mcpToolCall':
      return withBudget({
        ...common,
        type: 'mcpTool',
        server: consumeBudget(budget, stringValue(item.server) ?? ''),
        tool: consumeBudget(budget, stringValue(item.tool) ?? ''),
        arguments: toSerializable(item.arguments),
        result: item.result == null ? null : toSerializable(item.result),
        error: mcpError(item.error, budget),
        progress: '',
        durationMs: numberValue(item.durationMs),
      }, budget)
    case 'dynamicToolCall':
      return withBudget({
        ...common,
        type: 'dynamicTool',
        namespace: stringValue(item.namespace),
        tool: consumeBudget(budget, stringValue(item.tool) ?? ''),
        arguments: toSerializable(item.arguments),
        contentItems: arrayValue(item.contentItems).map((value) => toSerializable(value)),
        success: booleanValue(item.success),
        durationMs: numberValue(item.durationMs),
      }, budget)
    case 'webSearch':
      return withBudget({
        ...common,
        type: 'webSearch',
        query: consumeBudget(budget, stringValue(item.query) ?? ''),
        action: item.action == null ? null : toSerializable(item.action),
        results: arrayValue(item.results).map((value) => toSerializable(value)),
      }, budget)
    case 'imageGeneration':
      return withBudget({
        ...common,
        type: 'imageGeneration',
        revisedPrompt: nullableBudgetText(item.revisedPrompt, budget),
        savedPath: nullableBudgetText(item.savedPath, budget),
        transparentBackground: booleanValue(item.transparentBackground),
      }, budget)
    case 'collabAgentToolCall':
      return withBudget({
        ...common,
        type: 'collab',
        tool: consumeBudget(budget, sourceName(item.tool) ?? ''),
        senderThreadId: stringValue(item.senderThreadId),
        receiverThreadIds: arrayValue(item.receiverThreadIds).flatMap((value) => {
          const idValue = stringValue(value)
          return idValue === null ? [] : [idValue]
        }),
        prompt: nullableBudgetText(item.prompt, budget),
        model: nullableBudgetText(item.model, budget),
        reasoningEffort: sourceName(item.reasoningEffort),
        agentsStates: serializableRecord(item.agentsStates),
      }, budget)
    case 'subAgentActivity':
      return withBudget({
        ...common,
        type: 'subagent',
        kind: consumeBudget(budget, sourceName(item.kind) ?? 'unknown'),
        agentThreadId: consumeBudget(budget, stringValue(item.agentThreadId) ?? ''),
        agentPath: consumeBudget(budget, stringValue(item.agentPath) ?? ''),
      }, budget)
    case 'plan':
      return withBudget({
        ...common,
        type: 'plan',
        text: consumeBudget(budget, stringValue(item.text) ?? ''),
        explanation: null,
        steps: [],
      }, budget)
    default:
      return {
        ...common,
        type: 'unknownItem',
        itemType,
        raw: toSerializable(item),
      }
  }
}

function reduceTextDelta(
  state: Readonly<AgentActivityState>,
  params: UnknownRecord,
  target: 'agentMessage' | 'plan' | 'command' | 'fileChange',
  emittedAtMs: number | null,
): AgentActivityState {
  const ids = notificationItemIds(params)
  const delta = stringValue(params.delta)
  if (!ids || delta === null) return addMalformedEvent(state, `${target}/delta`, params, emittedAtMs)
  const index = findActivityIndex(state.activities, ids.itemId)
  const existing = state.activities[index] ?? placeholderActivity(target, ids, emittedAtMs)
  if (existing.type !== target) return addMalformedEvent(state, `${target}/delta:type-mismatch`, params, emittedAtMs)

  let next: AgentActivity
  if (existing.type === 'agentMessage') {
    const appended = appendLimited(existing.text, delta, existing.truncatedChars)
    next = { ...existing, text: appended.text, truncated: appended.truncated, truncatedChars: appended.truncatedChars }
  } else if (existing.type === 'plan') {
    const appended = appendLimited(existing.text, delta, existing.truncatedChars)
    next = { ...existing, text: appended.text, truncated: appended.truncated, truncatedChars: appended.truncatedChars }
  } else {
    const appended = appendLimited(existing.output, delta, existing.truncatedChars)
    next = { ...existing, output: appended.text, truncated: appended.truncated, truncatedChars: appended.truncatedChars }
  }
  const activities = index < 0 ? [...state.activities, next] : replaceAt(state.activities, index, next)
  return withCurrentIds(state, ids, activities)
}

function reduceReasoningDelta(
  state: Readonly<AgentActivityState>,
  params: UnknownRecord,
  target: 'summary' | 'content',
  emittedAtMs: number | null,
): AgentActivityState {
  const ids = notificationItemIds(params)
  const delta = stringValue(params.delta)
  const valueIndex = numberValue(target === 'summary' ? params.summaryIndex : params.contentIndex)
  if (!ids || delta === null || valueIndex === null || valueIndex < 0 || !Number.isInteger(valueIndex)) {
    return addMalformedEvent(state, `reasoning/${target}Delta`, params, emittedAtMs)
  }
  const index = findActivityIndex(state.activities, ids.itemId)
  const existing: AgentActivity = state.activities[index]
    ?? { ...baseActivity(ids.itemId, ids.threadId, ids.turnId, 'inProgress', emittedAtMs, null), type: 'reasoning', summary: [], content: [] }
  if (existing.type !== 'reasoning') return addMalformedEvent(state, `reasoning/${target}Delta:type-mismatch`, params, emittedAtMs)

  const values = [...existing[target]]
  while (values.length <= valueIndex) values.push('')
  const used = existing.summary.reduce((total, text) => total + text.length, 0)
    + existing.content.reduce((total, text) => total + text.length, 0)
  const current = values[valueIndex] ?? ''
  const allowed = Math.max(0, MAX_ACTIVITY_TEXT_LENGTH - used)
  const accepted = delta.slice(0, allowed)
  values[valueIndex] = current + accepted
  const omitted = delta.length - accepted.length
  const next: AgentActivity = {
    ...existing,
    [target]: values,
    truncated: existing.truncated || omitted > 0,
    truncatedChars: existing.truncatedChars + omitted,
  }
  const activities = index < 0 ? [...state.activities, next] : replaceAt(state.activities, index, next)
  return withCurrentIds(state, ids, activities)
}

function reduceReasoningPart(
  state: Readonly<AgentActivityState>,
  params: UnknownRecord,
  emittedAtMs: number | null,
): AgentActivityState {
  const ids = notificationItemIds(params)
  const summaryIndex = numberValue(params.summaryIndex)
  if (!ids || summaryIndex === null || summaryIndex < 0 || !Number.isInteger(summaryIndex)) {
    return addMalformedEvent(state, 'reasoning/summaryPartAdded', params, emittedAtMs)
  }
  const index = findActivityIndex(state.activities, ids.itemId)
  const existing: AgentActivity = state.activities[index]
    ?? { ...baseActivity(ids.itemId, ids.threadId, ids.turnId, 'inProgress', emittedAtMs, null), type: 'reasoning', summary: [], content: [] }
  if (existing.type !== 'reasoning') return addMalformedEvent(state, 'reasoning/summaryPartAdded:type-mismatch', params, emittedAtMs)
  const summary = [...existing.summary]
  while (summary.length <= summaryIndex) summary.push('')
  const next = { ...existing, summary }
  const activities = index < 0 ? [...state.activities, next] : replaceAt(state.activities, index, next)
  return withCurrentIds(state, ids, activities)
}

function reduceMcpProgress(
  state: Readonly<AgentActivityState>,
  params: UnknownRecord,
  emittedAtMs: number | null,
): AgentActivityState {
  const ids = notificationItemIds(params)
  const message = stringValue(params.message)
  if (!ids || message === null) return addMalformedEvent(state, 'item/mcpToolCall/progress', params, emittedAtMs)
  const index = findActivityIndex(state.activities, ids.itemId)
  const existing: AgentActivity = state.activities[index]
    ?? {
        ...baseActivity(ids.itemId, ids.threadId, ids.turnId, 'inProgress', emittedAtMs, null),
        type: 'mcpTool', server: '', tool: '', arguments: null, result: null, error: null, progress: '', durationMs: null,
      }
  if (existing.type !== 'mcpTool') return addMalformedEvent(state, 'item/mcpToolCall/progress:type-mismatch', params, emittedAtMs)
  const separator = existing.progress.length === 0 ? '' : '\n'
  const appended = appendLimited(existing.progress, separator + message, existing.truncatedChars)
  const next: AgentActivity = { ...existing, progress: appended.text, truncated: appended.truncated, truncatedChars: appended.truncatedChars }
  const activities = index < 0 ? [...state.activities, next] : replaceAt(state.activities, index, next)
  return withCurrentIds(state, ids, activities)
}

function reduceError(
  state: Readonly<AgentActivityState>,
  params: UnknownRecord,
  emittedAtMs: number | null,
): AgentActivityState {
  const threadId = stringValue(params.threadId) ?? state.threadId
  const turnId = stringValue(params.turnId) ?? state.turnId
  const details = errorDetails(params.error, booleanValue(params.willRetry) ?? false)
  if (!details) return addMalformedEvent(state, 'error', params, emittedAtMs)
  const activity = makeErrorActivity(
    `error:${threadId ?? 'none'}:${turnId ?? 'none'}:${String(state.activities.filter((item) => item.type === 'error').length)}`,
    threadId,
    turnId,
    details,
    emittedAtMs,
  )
  return {
    ...state,
    threadId,
    turnId,
    turnStatus: details.willRetry ? state.turnStatus : 'failed',
    activities: [...state.activities, activity],
    unknownEvents: [...state.unknownEvents],
    lastError: activity,
  }
}

function appendTurnError(
  state: Readonly<AgentActivityState>,
  threadId: string,
  turnId: string,
  details: AgentErrorDetails,
  emittedAtMs: number | null,
): AgentActivityState {
  const id = `turn-error:${turnId}`
  const activity = makeErrorActivity(id, threadId, turnId, details, emittedAtMs)
  return { ...state, activities: upsertActivity(state.activities, activity), lastError: activity }
}

function makeErrorActivity(
  id: string,
  threadId: string | null,
  turnId: string | null,
  details: AgentErrorDetails,
  emittedAtMs: number | null,
): AgentErrorActivity {
  const budget = createBudget()
  const message = consumeBudget(budget, details.message)
  const additionalDetails = details.additionalDetails === null ? null : consumeBudget(budget, details.additionalDetails)
  return withBudget({
    ...baseActivity(id, threadId, turnId, details.willRetry ? 'inProgress' : 'failed', emittedAtMs, details.willRetry ? null : emittedAtMs),
    type: 'error',
    message,
    additionalDetails,
    code: details.code,
    willRetry: details.willRetry,
  }, budget)
}

function placeholderActivity(
  type: 'agentMessage' | 'plan' | 'command' | 'fileChange',
  ids: { threadId: string; turnId: string; itemId: string },
  emittedAtMs: number | null,
): AgentActivity {
  const base = baseActivity(ids.itemId, ids.threadId, ids.turnId, 'inProgress', emittedAtMs, null)
  if (type === 'agentMessage') return { ...base, type, text: '', phase: null }
  if (type === 'plan') return { ...base, type, text: '', explanation: null, steps: [] }
  if (type === 'command') {
    return {
      ...base, type, command: '', cwd: null, processId: null, source: null, output: '', exitCode: null, durationMs: null, commandActions: [],
    }
  }
  return { ...base, type, changes: [], output: '' }
}

function upsertActivity(activities: readonly AgentActivity[], incoming: AgentActivity): AgentActivity[] {
  const index = findActivityIndex(activities, incoming.id)
  if (index < 0) return [...activities, incoming]
  const existing = activities[index]
  if (!existing) return [...activities, incoming]
  const merged = existing.type === incoming.type ? mergeSameType(existing, incoming) : incoming
  return replaceAt(activities, index, merged)
}

function mergeSameType(existing: AgentActivity, incoming: AgentActivity): AgentActivity {
  const lifecycle = {
    startedAtMs: incoming.startedAtMs ?? existing.startedAtMs,
    completedAtMs: incoming.completedAtMs ?? existing.completedAtMs,
    truncated: incoming.truncated || existing.truncated,
    truncatedChars: incoming.truncatedChars + existing.truncatedChars,
  }
  if (existing.type === 'agentMessage' && incoming.type === 'agentMessage') {
    return { ...incoming, ...lifecycle, text: preferCompleteText(incoming.text, existing.text) }
  }
  if (existing.type === 'reasoning' && incoming.type === 'reasoning') {
    return {
      ...incoming,
      ...lifecycle,
      summary: preferCompleteArray(incoming.summary, existing.summary),
      content: preferCompleteArray(incoming.content, existing.content),
    }
  }
  if (existing.type === 'command' && incoming.type === 'command') {
    return {
      ...incoming,
      ...lifecycle,
      command: incoming.command || existing.command,
      output: preferCompleteText(incoming.output, existing.output),
      processId: incoming.processId ?? existing.processId,
    }
  }
  if (existing.type === 'fileChange' && incoming.type === 'fileChange') {
    return { ...incoming, ...lifecycle, output: incoming.output || existing.output, changes: incoming.changes.length > 0 ? incoming.changes : existing.changes }
  }
  if (existing.type === 'mcpTool' && incoming.type === 'mcpTool') {
    return { ...incoming, ...lifecycle, progress: incoming.progress || existing.progress }
  }
  if (existing.type === 'plan' && incoming.type === 'plan') {
    return { ...incoming, ...lifecycle, text: preferCompleteText(incoming.text, existing.text) }
  }
  return { ...incoming, ...lifecycle }
}

function baseActivity(
  id: string,
  threadId: string | null,
  turnId: string | null,
  status: AgentActivityStatus,
  startedAtMs: number | null,
  completedAtMs: number | null,
): AgentActivityBase {
  return { id, threadId, turnId, status, startedAtMs, completedAtMs, truncated: false, truncatedChars: 0 }
}

function withCurrentIds(
  state: Readonly<AgentActivityState>,
  ids: { threadId: string; turnId: string },
  activities: AgentActivity[],
): AgentActivityState {
  return { ...state, threadId: ids.threadId, turnId: ids.turnId, activities, unknownEvents: [...state.unknownEvents] }
}

function addMalformedEvent(
  state: Readonly<AgentActivityState>,
  method: string,
  params: unknown,
  emittedAtMs: number | null,
): AgentActivityState {
  return addUnknownEvent(state, { method, params, ...(emittedAtMs === null ? {} : { emittedAtMs }) })
}

function addUnknownEvent(state: Readonly<AgentActivityState>, event: Readonly<AgentServerEvent>): AgentActivityState {
  return {
    ...state,
    activities: [...state.activities],
    unknownEvents: [...state.unknownEvents, {
      method: event.method,
      params: toSerializable(event.params),
      emittedAtMs: event.emittedAtMs ?? null,
    }],
  }
}

function notificationIds(params: UnknownRecord): { threadId: string; turnId: string } | null {
  const threadId = stringValue(params.threadId)
  const turnId = stringValue(params.turnId)
  return threadId && turnId ? { threadId, turnId } : null
}

function notificationItemIds(params: UnknownRecord): { threadId: string; turnId: string; itemId: string } | null {
  const ids = notificationIds(params)
  const itemId = stringValue(params.itemId)
  return ids && itemId ? { ...ids, itemId } : null
}

function lifecycleTimestamp(params: UnknownRecord, lifecycle: ItemLifecycle): number | null {
  return numberValue(lifecycle === 'started' ? params.startedAtMs : params.completedAtMs)
}

function itemStatus(item: UnknownRecord, lifecycle: ItemLifecycle): AgentActivityStatus {
  const rawStatus = sourceName(item.status)
  if (rawStatus === 'failed' || rawStatus === 'declined' || rawStatus === 'interrupted' || rawStatus === 'completed' || rawStatus === 'inProgress') {
    return rawStatus
  }
  if (item.success === false) return 'failed'
  return lifecycle === 'completed' ? 'completed' : 'inProgress'
}

function threadStatus(value: unknown): AgentActivityStatus {
  const type = sourceName(value)
  if (type === 'active') return 'inProgress'
  if (type === 'idle') return 'idle'
  if (type === 'systemError') return 'failed'
  return 'unknown'
}

function turnStatus(value: unknown, lifecycle: ItemLifecycle): AgentActivityStatus {
  const status = sourceName(value)
  if (status === 'completed' || status === 'failed' || status === 'interrupted' || status === 'inProgress') return status
  return lifecycle === 'completed' ? 'completed' : 'inProgress'
}

function toAgentTurnStatus(status: AgentActivityStatus): AgentTurnStatus {
  if (status === 'inProgress' || status === 'completed' || status === 'failed' || status === 'interrupted' || status === 'idle') return status
  return 'unknown'
}

function errorDetails(value: unknown, willRetry: boolean): AgentErrorDetails | null {
  const error = asRecord(value)
  const message = stringValue(error?.message)
  if (!error || message === null) return null
  return {
    message,
    additionalDetails: stringValue(error.additionalDetails),
    code: error.codexErrorInfo == null ? null : toSerializable(error.codexErrorInfo),
    willRetry,
  }
}

function userContent(value: unknown, budget: TextBudget): UserMessageContent {
  const input = asRecord(value)
  const type = stringValue(input?.type) ?? 'unknown'
  if (!input) return { type: 'unknown', inputType: type, value: toSerializable(value) }
  if (type === 'text') return { type: 'text', text: consumeBudget(budget, stringValue(input.text) ?? '') }
  if (type === 'image' || type === 'localImage') {
    return { type: 'image', url: consumeBudget(budget, stringValue(input.url) ?? stringValue(input.path) ?? ''), local: type === 'localImage' }
  }
  if (type === 'audio' || type === 'localAudio') {
    return { type: 'audio', url: consumeBudget(budget, stringValue(input.url) ?? stringValue(input.path) ?? ''), local: type === 'localAudio' }
  }
  if (type === 'skill' || type === 'mention') {
    return { type, name: consumeBudget(budget, stringValue(input.name) ?? ''), path: consumeBudget(budget, stringValue(input.path) ?? '') }
  }
  return { type: 'unknown', inputType: type, value: toSerializable(input) }
}

function fileChange(value: unknown, budget: TextBudget): FileChange {
  const change = asRecord(value)
  const kind = asRecord(change?.kind)
  return {
    path: consumeBudget(budget, stringValue(change?.path) ?? ''),
    kind: sourceName(change?.kind) ?? 'unknown',
    movePath: stringValue(kind?.move_path),
    diff: consumeBudget(budget, stringValue(change?.diff) ?? ''),
  }
}

function toPlanStep(value: unknown): PlanStep {
  const step = asRecord(value)
  const status = sourceName(step?.status)
  return {
    step: stringValue(step?.step) ?? '',
    status: status === 'pending' || status === 'inProgress' || status === 'completed' ? status : 'unknown',
  }
}

function messagePhase(value: unknown): 'commentary' | 'final_answer' | null {
  return value === 'commentary' || value === 'final_answer' ? value : null
}

function mcpError(value: unknown, budget: TextBudget): string | null {
  if (typeof value === 'string') return consumeBudget(budget, value)
  const error = asRecord(value)
  return error ? nullableBudgetText(error.message, budget) : null
}

function sourceName(value: unknown): string | null {
  if (typeof value === 'string') return value
  const record = asRecord(value)
  return stringValue(record?.type) ?? stringValue(record?.name)
}

function secondsToMs(value: unknown): number | null {
  const seconds = numberValue(value)
  return seconds === null ? null : seconds * 1000
}

function preferCompleteText(incoming: string, existing: string): string {
  return incoming.length >= existing.length ? incoming : existing
}

function preferCompleteArray(incoming: string[], existing: string[]): string[] {
  const incomingLength = incoming.reduce((total, text) => total + text.length, 0)
  const existingLength = existing.reduce((total, text) => total + text.length, 0)
  return incomingLength >= existingLength ? incoming : existing
}

function replaceAt(activities: readonly AgentActivity[], index: number, activity: AgentActivity): AgentActivity[] {
  const next = [...activities]
  next[index] = activity
  return next
}

function findActivityIndex(activities: readonly AgentActivity[], id: string): number {
  // Streaming deltas overwhelmingly target the newest activity. Walking backwards
  // avoids a full history scan while retaining the immutable public state shape.
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    if (activities[index]?.id === id) return index
  }
  return -1
}

type TextBudget = { remaining: number; truncatedChars: number }

function createBudget(): TextBudget {
  return { remaining: MAX_ACTIVITY_TEXT_LENGTH, truncatedChars: 0 }
}

function consumeBudget(budget: TextBudget, value: string): string {
  const accepted = value.slice(0, budget.remaining)
  budget.remaining -= accepted.length
  budget.truncatedChars += value.length - accepted.length
  return accepted
}

function withBudget<T extends AgentActivity>(activity: T, budget: TextBudget): T {
  return { ...activity, truncated: budget.truncatedChars > 0, truncatedChars: budget.truncatedChars }
}

function nullableBudgetText(value: unknown, budget: TextBudget): string | null {
  const text = stringValue(value)
  return text === null ? null : consumeBudget(budget, text)
}

function limitedText(value: string): { text: string; truncated: boolean; truncatedChars: number } {
  const text = value.slice(0, MAX_ACTIVITY_TEXT_LENGTH)
  const truncatedChars = value.length - text.length
  return { text, truncated: truncatedChars > 0, truncatedChars }
}

function appendLimited(existing: string, delta: string, alreadyTruncated: number): { text: string; truncated: boolean; truncatedChars: number } {
  const allowed = Math.max(0, MAX_ACTIVITY_TEXT_LENGTH - existing.length)
  const accepted = delta.slice(0, allowed)
  const truncatedChars = alreadyTruncated + delta.length - accepted.length
  return { text: existing + accepted, truncated: truncatedChars > 0, truncatedChars }
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as UnknownRecord : null
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function serializableRecord(value: unknown): Record<string, SerializableValue> {
  const record = asRecord(value)
  if (!record) return {}
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, toSerializable(entry)]))
}

function toSerializable(value: unknown, seen = new WeakSet<object>()): SerializableValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined') return 'undefined'
  if (typeof value === 'symbol') return value.description === undefined ? '[Symbol]' : `[Symbol ${value.description}]`
  if (typeof value === 'function') return value.name === '' ? '[Function]' : `[Function ${value.name}]`
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((entry) => toSerializable(entry, seen))
  const output: Record<string, SerializableValue> = {}
  for (const [key, entry] of Object.entries(value)) output[key] = toSerializable(entry, seen)
  return output
}
