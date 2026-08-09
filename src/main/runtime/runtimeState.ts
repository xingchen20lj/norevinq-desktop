import type { CodexRuntimeSnapshot, RuntimeSubscription } from '../../shared/runtime.js'

export const INITIAL_RUNTIME_SNAPSHOT: CodexRuntimeSnapshot = Object.freeze({
  phase: 'stopped',
  generation: 0,
  binaryPath: null,
  version: null,
  userAgent: null,
  platformFamily: null,
  platformOs: null,
  startedAt: null,
  readyAt: null,
  lastExitCode: null,
  lastSignal: null,
  restartAttempt: 0,
  error: null,
  models: [],
})

export class RuntimeStateStore {
  #snapshot: CodexRuntimeSnapshot
  readonly #subscriptions = new Set<RuntimeSubscription>()

  constructor(initial: CodexRuntimeSnapshot = INITIAL_RUNTIME_SNAPSHOT) {
    this.#snapshot = cloneSnapshot(initial)
  }

  getSnapshot(): CodexRuntimeSnapshot {
    return cloneSnapshot(this.#snapshot)
  }

  update(patch: Partial<CodexRuntimeSnapshot>): CodexRuntimeSnapshot {
    this.#snapshot = cloneSnapshot({ ...this.#snapshot, ...patch })
    const snapshot = this.getSnapshot()
    for (const subscription of this.#subscriptions) subscription(snapshot)
    return snapshot
  }

  subscribe(subscription: RuntimeSubscription): () => void {
    this.#subscriptions.add(subscription)
    return () => this.#subscriptions.delete(subscription)
  }
}

function cloneSnapshot(snapshot: CodexRuntimeSnapshot): CodexRuntimeSnapshot {
  return {
    ...snapshot,
    models: snapshot.models.map((model) => ({
      ...model,
      supportedReasoningEfforts: [...model.supportedReasoningEfforts],
      inputModalities: [...model.inputModalities],
    })),
  }
}
