import { describe, expect, it } from 'vitest'
import {
  DEEPSEEK_CODEX_CONFIG_OVERRIDES,
  DEEPSEEK_CODEX_MODELS,
  hasDeepSeekEnvironment,
} from '../../src/main/providers/deepseek.js'

describe('DeepSeek Codex provider launch configuration', () => {
  it('uses Responses API with environment-only authentication and no websocket assumption', () => {
    expect(DEEPSEEK_CODEX_CONFIG_OVERRIDES).toContain('model_providers.deepseek.base_url="https://api.deepseek.com"')
    expect(DEEPSEEK_CODEX_CONFIG_OVERRIDES).toContain('model_providers.deepseek.env_key="DEEPSEEK_API_KEY"')
    expect(DEEPSEEK_CODEX_CONFIG_OVERRIDES).toContain('model_providers.deepseek.wire_api="responses"')
    expect(DEEPSEEK_CODEX_CONFIG_OVERRIDES).toContain('model_providers.deepseek.supports_websockets=false')
    expect(DEEPSEEK_CODEX_CONFIG_OVERRIDES.join(' ')).not.toMatch(/sk-[a-z0-9]/i)
  })

  it('advertises both verified Responses models as selectable', () => {
    const flash = DEEPSEEK_CODEX_MODELS.find(({ id }) => id === 'deepseek-v4-flash')
    const pro = DEEPSEEK_CODEX_MODELS.find(({ id }) => id === 'deepseek-v4-pro')
    expect(flash).toMatchObject({ hidden: false, inputModalities: ['text'] })
    expect(flash?.supportedReasoningEfforts).toEqual(['none', 'low', 'high', 'max'])
    expect(pro).toMatchObject({ hidden: false, inputModalities: ['text'] })
    expect(pro?.supportedReasoningEfforts).toEqual(['none', 'low', 'high', 'max'])
  })

  it('does not treat blank credentials as configured', () => {
    expect(hasDeepSeekEnvironment({ DEEPSEEK_API_KEY: ' secret ' })).toBe(true)
    expect(hasDeepSeekEnvironment({ DEEPSEEK_API_KEY: '   ' })).toBe(false)
    expect(hasDeepSeekEnvironment({})).toBe(false)
  })
})
