import { z } from 'zod'
import type { CodexModelSummary } from '../../shared/runtime.js'

const initializeResultSchema = z.object({
  userAgent: z.string().min(1),
  platformFamily: z.string().nullable().optional(),
  platformOs: z.string().nullable().optional(),
})

const reasoningEffortSchema = z.union([
  z.string(),
  z.object({
    reasoningEffort: z.string(),
  }),
])

const modelSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
  hidden: z.boolean().optional(),
  defaultReasoningEffort: z.string().nullable().optional(),
  supportedReasoningEfforts: z.array(reasoningEffortSchema).optional(),
  inputModalities: z.array(z.string()).optional(),
  supportsPersonality: z.boolean().optional(),
})

const modelListResultSchema = z.object({
  data: z.array(modelSchema),
})

export type InitializeDetails = {
  userAgent: string
  platformFamily: string | null
  platformOs: string | null
}

export function parseInitializeResult(value: unknown): InitializeDetails {
  const result = initializeResultSchema.parse(value)
  return {
    userAgent: result.userAgent,
    platformFamily: result.platformFamily ?? null,
    platformOs: result.platformOs ?? null,
  }
}

export function parseModelListResult(value: unknown): CodexModelSummary[] {
  const result = modelListResultSchema.parse(value)
  return result.data.flatMap((model) => {
    const id = model.id ?? model.model
    if (!id) return []
    return [{
      id,
      displayName: model.displayName ?? id,
      description: model.description ?? null,
      isDefault: model.isDefault ?? false,
      hidden: model.hidden ?? false,
      defaultReasoningEffort: model.defaultReasoningEffort ?? null,
      supportedReasoningEfforts: (model.supportedReasoningEfforts ?? []).map((effort) =>
        typeof effort === 'string' ? effort : effort.reasoningEffort,
      ),
      inputModalities: model.inputModalities ?? ['text'],
      supportsPersonality: model.supportsPersonality ?? false,
    }]
  })
}
