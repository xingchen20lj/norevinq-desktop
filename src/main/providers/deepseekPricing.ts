import type { DeepSeekSecurityModel } from './deepseek.js'

const MILLION = 1_000_000
const PEAK_PRICING_START = Date.parse('2026-08-16T16:00:00Z')
const FALLBACK_USD_CNY = 6.743
const FALLBACK_RATE_DATE = '2026-08-13'

export type DeepSeekTokenUsage = {
  inputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

export type UsdCnyQuote = {
  rate: number
  date: string
  source: 'frankfurter-ecb' | 'fallback'
}

export type DeepSeekUsageEstimate = DeepSeekTokenUsage & {
  uncachedInputTokens: number
  estimatedUsd: number
  estimatedCny: number
  usdCnyRate: number
  exchangeRateDate: string
  exchangeRateSource: UsdCnyQuote['source']
  pricingTier: 'current' | 'peak' | 'off_peak'
  pricingVersion: string
}

type TokenRates = {
  cacheHit: number
  cacheMiss: number
  output: number
  tier: DeepSeekUsageEstimate['pricingTier']
  version: string
}

export class DeepSeekUsageAccumulator {
  readonly #model: DeepSeekSecurityModel
  readonly #quote: UsdCnyQuote
  #previous: DeepSeekTokenUsage | null = null
  #estimatedUsd = 0

  constructor(model: DeepSeekSecurityModel, quote: UsdCnyQuote) {
    this.#model = model
    this.#quote = quote
  }

  update(usage: DeepSeekTokenUsage, observedAt = new Date()): DeepSeekUsageEstimate {
    const previous = this.#previous
    const inputDelta = delta(usage.inputTokens, previous?.inputTokens)
    const cachedDelta = Math.min(inputDelta, delta(usage.cachedInputTokens, previous?.cachedInputTokens))
    const uncachedDelta = Math.max(0, inputDelta - cachedDelta)
    const outputDelta = delta(usage.outputTokens, previous?.outputTokens)
    const rates = pricingAt(this.#model, observedAt)
    this.#estimatedUsd += (
      cachedDelta * rates.cacheHit
      + uncachedDelta * rates.cacheMiss
      + outputDelta * rates.output
    ) / MILLION
    this.#previous = { ...usage }
    return {
      ...usage,
      uncachedInputTokens: Math.max(0, usage.inputTokens - usage.cachedInputTokens),
      estimatedUsd: this.#estimatedUsd,
      estimatedCny: this.#estimatedUsd * this.#quote.rate,
      usdCnyRate: this.#quote.rate,
      exchangeRateDate: this.#quote.date,
      exchangeRateSource: this.#quote.source,
      pricingTier: rates.tier,
      pricingVersion: rates.version,
    }
  }
}

export async function resolveUsdCnyQuote(fetcher: typeof fetch = fetch): Promise<UsdCnyQuote> {
  try {
    const response = await fetcher('https://api.frankfurter.app/latest?from=USD&to=CNY', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) throw new Error(`Exchange-rate request failed with HTTP ${String(response.status)}.`)
    const value = await response.json()
    if (!isRecord(value) || !isRecord(value.rates)) throw new Error('Exchange-rate response is invalid.')
    const rate = value.rates.CNY
    const date = value.date
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 4 || rate > 10) {
      throw new Error('USD/CNY rate is outside the accepted range.')
    }
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
      throw new Error('Exchange-rate date is invalid.')
    }
    return { rate, date, source: 'frankfurter-ecb' }
  } catch {
    return { rate: FALLBACK_USD_CNY, date: FALLBACK_RATE_DATE, source: 'fallback' }
  }
}

export function pricingAt(model: DeepSeekSecurityModel, date: Date): TokenRates {
  if (date.getTime() < PEAK_PRICING_START) {
    return model === 'deepseek-v4-flash'
      ? { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28, tier: 'current', version: '2026-08-14' }
      : { cacheHit: 0.003625, cacheMiss: 0.435, output: 0.87, tier: 'current', version: '2026-08-14' }
  }
  const hour = date.getUTCHours()
  const peak = (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)
  if (model === 'deepseek-v4-flash') {
    return peak
      ? { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32, tier: 'peak', version: '2026-08-16' }
      : { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66, tier: 'off_peak', version: '2026-08-16' }
  }
  return peak
    ? { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96, tier: 'peak', version: '2026-08-16' }
    : { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98, tier: 'off_peak', version: '2026-08-16' }
}

function delta(current: number, previous: number | undefined): number {
  return Math.max(0, current - (previous ?? 0))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
