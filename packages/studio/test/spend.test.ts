import { describe, expect, test } from 'bun:test'
import { MODEL_PRICING } from '@skipper/shared'
import { estimateTtsUsd, TTS_TOKEN_PRICING } from '../src/pipeline/spend'
import { ENRICH_MODELS, JUDGMENT_MODEL, NARRATION_MODEL } from '../src/models'

// ⚠ The LLM spend tally moved to @skipper/shared (INV-11) — its tests live in
// packages/shared/test/spend.test.ts. What stays here is TTS (operator-only) plus the half of the
// drift guard that only studio can assert: studio's own TIER constants.

describe('DRIFT GUARD: every studio tier model is priced', () => {
  // The --max-cost gate reads llmSpentUsd(); an unpriced model tallies $0 and silently under-counts
  // the cap. ⚠ This guard used to iterate a hand-written [NARRATION_MODEL, JUDGMENT_MODEL] — so a
  // model added anywhere else was invisible to it, which is exactly how an unpriced planner would
  // have tallied $0 forever with nothing failing. It now covers every tier constant studio exposes,
  // and its sibling in @skipper/shared covers every CLAUDE_MODELS value.
  test('narration, judgment, and every enrich tier have a pricing entry', () => {
    for (const id of [NARRATION_MODEL, JUDGMENT_MODEL, ...Object.values(ENRICH_MODELS)]) {
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
