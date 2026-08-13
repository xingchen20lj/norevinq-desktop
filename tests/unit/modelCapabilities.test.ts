import { describe, expect, it } from 'vitest'
import {
  canRunCodex,
  DEEPSEEK_V4_FLASH_CAPABILITIES,
  DEEPSEEK_V4_PRO_CAPABILITIES,
} from '../../src/shared/modelCapabilities.js'

describe('DeepSeek capability registry', () => {
  it('allows the verified flash model to power Codex', () => {
    expect(canRunCodex(DEEPSEEK_V4_FLASH_CAPABILITIES)).toBe(true)
    expect(DEEPSEEK_V4_FLASH_CAPABILITIES.imageInput).toBe(false)
    expect(DEEPSEEK_V4_FLASH_CAPABILITIES.statefulResponses).toBe(false)
  })

  it('allows the verified pro model to power Codex', () => {
    expect(canRunCodex(DEEPSEEK_V4_PRO_CAPABILITIES)).toBe(true)
    expect(DEEPSEEK_V4_PRO_CAPABILITIES.imageInput).toBe(false)
    expect(DEEPSEEK_V4_PRO_CAPABILITIES.webSearch).toBe(true)
  })
})
