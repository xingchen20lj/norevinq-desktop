import { describe, expect, it } from 'vitest'
import { parseInitializeResult, parseModelListResult } from '../../src/main/runtime/protocolAdapter.js'

describe('Codex protocol adapter', () => {
  it('normalizes initialize metadata', () => {
    expect(parseInitializeResult({
      userAgent: 'codex_cli_rs/0.147.0',
      platformFamily: 'unix',
      platformOs: 'macos',
      futureField: true,
    })).toEqual({
      userAgent: 'codex_cli_rs/0.147.0',
      platformFamily: 'unix',
      platformOs: 'macos',
    })
  })

  it('accepts both structured and string reasoning efforts', () => {
    expect(parseModelListResult({
      data: [{
        id: 'gpt-test',
        displayName: 'GPT Test',
        isDefault: true,
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: ['low', { reasoningEffort: 'medium', description: 'Balanced' }],
        inputModalities: ['text', 'image'],
        supportsPersonality: true,
      }],
      nextCursor: null,
    })).toEqual([{
      id: 'gpt-test',
      displayName: 'GPT Test',
      description: null,
      isDefault: true,
      hidden: false,
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: ['low', 'medium'],
      inputModalities: ['text', 'image'],
      supportsPersonality: true,
    }])
  })

  it('rejects malformed model payloads', () => {
    expect(() => parseModelListResult({ data: 'not-an-array' })).toThrow()
  })
})
