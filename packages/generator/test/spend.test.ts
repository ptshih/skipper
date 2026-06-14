import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  estimateTtsUsd,
  llmSpendLines,
  llmSpentUsd,
  MODEL_PRICING,
  recordModelUsage,
  resetSpendTally,
  TTS_TOKEN_PRICING,
  unpricedModels,
} from '../src/pipeline/spend'
import { JUDGMENT_MODEL, NARRATION_MODEL } from '../src/models'

beforeEach(resetSpendTally) // the tally is process-global — guard against other test files
afterEach(resetSpendTally)

describe('LLM spend tally', () => {
  test('prices plain input/output at the model rate', () => {
    // Opus 4.8: 1M in @ $5 + 100k out @ $25 ⇒ $5 + $2.50
    recordModelUsage('claude-opus-4-8', { input_tokens: 1_000_000, output_tokens: 100_000 })
    expect(llmSpentUsd()).toBeCloseTo(7.5, 6)
  })

  test('cache reads bill 0.1× and cache writes 1.25× the input rate', () => {
    // Opus input $5/MTok: 1M read ⇒ $0.50; 1M write ⇒ $6.25
    recordModelUsage('claude-opus-4-8', {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
    })
    expect(llmSpentUsd()).toBeCloseTo(0.5 + 6.25, 6)
  })

  test('accumulates across calls and models', () => {
    // Opus is the only priced model now, so the second model is an unpriced one — this
    // still exercises the cross-call tally (2 Opus calls) AND the cross-model lines.
    recordModelUsage('claude-opus-4-8', { input_tokens: 500_000, output_tokens: 0 }) // $2.50
    recordModelUsage('claude-opus-4-8', { input_tokens: 500_000, output_tokens: 0 }) // $2.50
    recordModelUsage('mystery-model', { input_tokens: 0, output_tokens: 1_000_000 }) // unpriced ⇒ $0
    expect(llmSpentUsd()).toBeCloseTo(5, 6)
    expect(llmSpendLines()).toHaveLength(2)
    expect(llmSpendLines()[0]).toContain('2 calls') // Opus inserted first
  })

  test('an unknown model tallies tokens but prices as unpriced/zero dollars', () => {
    recordModelUsage('mystery-model', { input_tokens: 1_000_000, output_tokens: 1_000_000 })
    expect(llmSpentUsd()).toBe(0)
    expect(llmSpendLines()[0]).toContain('unpriced')
    expect(unpricedModels()).toEqual(['mystery-model'])
  })

  test('DRIFT GUARD: every live model id has a pricing entry (a bump must update spend.ts)', () => {
    // The --max-cost gate reads llmSpentUsd(); an unpriced model would tally as $0 and
    // silently under-count the cap. This pins models.ts ↔ MODEL_PRICING in lockstep.
    for (const id of [NARRATION_MODEL, JUDGMENT_MODEL]) {
      expect(MODEL_PRICING[id]).toBeDefined()
    }
  })
})

describe('estimateTtsUsd', () => {
  test('token math: words→seconds→audio tokens, chars→text tokens', () => {
    // 250 words ⇒ 100s est ⇒ 2500 audio tok @ $20/MTok = $0.05
    // 1000 script chars + 600 style chars = 1600 chars ⇒ 400 text tok @ $1/MTok = $0.0004
    const script = Array.from({ length: 250 }, () => 'word').join(' ') // 250 words, 1249 chars
    const { usd, estSeconds } = estimateTtsUsd([script], 600)
    expect(estSeconds).toBeCloseTo(100, 5)
    const audioUsd = (100 * TTS_TOKEN_PRICING.audioTokensPerSec * TTS_TOKEN_PRICING.audioPerMTok) / 1e6
    const textUsd = (((script.length + 600) / 4) * TTS_TOKEN_PRICING.textPerMTok) / 1e6
    expect(usd).toBeCloseTo(audioUsd + textUsd, 8)
  })

  test('a realistic tour lands in the known ≈$0.6–0.9 TTS range', () => {
    // ~16 clips ≈ 3,800 words / 21k chars total (emerald-shaped), style prompt ~1k chars.
    const clips = Array.from({ length: 16 }, () => Array.from({ length: 240 }, () => 'pace').join(' '))
    const { usd, estSeconds } = estimateTtsUsd(clips, 1_000)
    expect(estSeconds).toBeGreaterThan(20 * 60)
    expect(usd).toBeGreaterThan(0.5)
    expect(usd).toBeLessThan(1.0)
  })

  test('empty scripts cost nothing', () => {
    expect(estimateTtsUsd([], 600)).toEqual({ usd: 0, estSeconds: 0 })
  })
})
