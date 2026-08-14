import { describe, expect, it, vi } from 'vitest'
import {
  DeepSeekUsageAccumulator,
  pricingAt,
  resolveUsdCnyQuote,
} from '../../src/main/providers/deepseekPricing.js'

describe('DeepSeek pricing', () => {
  it('uses the official current prices before the scheduled peak/off-peak transition', () => {
    expect(pricingAt('deepseek-v4-flash', new Date('2026-08-14T08:00:00Z'))).toMatchObject({
      cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28, tier: 'current',
    })
    expect(pricingAt('deepseek-v4-pro', new Date('2026-08-14T08:00:00Z'))).toMatchObject({
      cacheHit: 0.003625, cacheMiss: 0.435, output: 0.87, tier: 'current',
    })
  })

  it('switches between official UTC peak and off-peak prices after 2026-08-16', () => {
    expect(pricingAt('deepseek-v4-pro', new Date('2026-08-17T02:00:00Z'))).toMatchObject({
      cacheHit: 0.044, cacheMiss: 1.32, output: 3.96, tier: 'peak',
    })
    expect(pricingAt('deepseek-v4-pro', new Date('2026-08-17T05:00:00Z'))).toMatchObject({
      cacheHit: 0.022, cacheMiss: 0.66, output: 1.98, tier: 'off_peak',
    })
  })

  it('accumulates only token deltas and converts the estimate to CNY', () => {
    const accumulator = new DeepSeekUsageAccumulator('deepseek-v4-flash', {
      rate: 7,
      date: '2026-08-14',
      source: 'frankfurter-ecb',
    })
    const first = accumulator.update({
      inputTokens: 1_000_000,
      cachedInputTokens: 250_000,
      cacheWriteInputTokens: 0,
      outputTokens: 100_000,
      reasoningOutputTokens: 50_000,
      totalTokens: 1_100_000,
    }, new Date('2026-08-14T08:00:00Z'))
    expect(first.uncachedInputTokens).toBe(750_000)
    expect(first.estimatedUsd).toBeCloseTo(0.1337, 8)
    expect(first.estimatedCny).toBeCloseTo(0.9359, 8)

    const second = accumulator.update({
      inputTokens: 1_100_000,
      cachedInputTokens: 350_000,
      cacheWriteInputTokens: 0,
      outputTokens: 100_000,
      reasoningOutputTokens: 50_000,
      totalTokens: 1_200_000,
    }, new Date('2026-08-14T08:01:00Z'))
    expect(second.estimatedUsd).toBeCloseTo(0.13398, 8)
  })

  it('does not reprice earlier tokens when a scan crosses a pricing boundary', () => {
    const accumulator = new DeepSeekUsageAccumulator('deepseek-v4-flash', {
      rate: 1,
      date: '2026-08-14',
      source: 'fallback',
    })
    accumulator.update({
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 1_000_000,
    }, new Date('2026-08-16T15:59:00Z'))
    const afterPeak = accumulator.update({
      inputTokens: 2_000_000,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 2_000_000,
    }, new Date('2026-08-17T02:00:00Z'))
    expect(afterPeak.estimatedUsd).toBeCloseTo(0.58, 8)
  })

  it('uses a bounded live quote and falls back without failing a scan', async () => {
    const live = await resolveUsdCnyQuote(vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      date: '2026-08-13', rates: { CNY: 6.743 },
    }), { status: 200 }))))
    expect(live).toEqual({ rate: 6.743, date: '2026-08-13', source: 'frankfurter-ecb' })

    const fallback = await resolveUsdCnyQuote(vi.fn(() => Promise.reject(new Error('offline'))))
    expect(fallback).toEqual({ rate: 6.743, date: '2026-08-13', source: 'fallback' })
  })
})
