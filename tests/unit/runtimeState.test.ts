import { describe, expect, it, vi } from 'vitest'
import { RuntimeStateStore } from '../../src/main/runtime/runtimeState.js'

describe('RuntimeStateStore', () => {
  it('publishes immutable snapshots and allows unsubscribe', () => {
    const store = new RuntimeStateStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    const ready = store.update({ phase: 'ready', generation: 1, models: [] })
    expect(ready.phase).toBe('ready')
    expect(listener).toHaveBeenCalledOnce()

    ready.models.push({
      id: 'mutated-outside',
      displayName: 'Mutated',
      description: null,
      isDefault: false,
      hidden: false,
      defaultReasoningEffort: null,
      supportedReasoningEfforts: [],
      inputModalities: [],
      supportsPersonality: false,
    })
    expect(store.getSnapshot().models).toEqual([])

    unsubscribe()
    store.update({ phase: 'stopped' })
    expect(listener).toHaveBeenCalledOnce()
  })
})
