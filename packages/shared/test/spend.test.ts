import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  geminiUsage,
  LLM_MODELS,
  llmSpendLines,
  llmSpentUsd,
  MODEL_PRICING,
  PRICE_CHANGES,
  pricingFor,
  recordModelUsage,
  resetSpendTally,
  unpricedModels,
  usageUsd,
} from '../src'

// Moved here from packages/studio/test when the pricing table moved (INV-11): `POST /drives/plan`
// spends model tokens on every rider request and apps/api cannot import @skipper/studio.

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

  // ⚠ THE GUARD THAT WOULD HAVE MISSED THE PLANNER. It used to iterate a hand-written
  // [NARRATION_MODEL, JUDGMENT_MODEL] — two models, maintained by memory — so adding a model key
  // anywhere else left it unpriced, tallying $0 forever with nothing failing. Iterating the RECORD
  // means adding a key to LLM_MODELS cannot be forgotten here: the test fails the moment it lands.
  test('DRIFT GUARD: every LLM_MODELS id has a pricing entry', () => {
    for (const id of Object.values(LLM_MODELS)) {
      expect(MODEL_PRICING[id]).toBeDefined()
    }
  })

  // ⚠ The planner is the ONLY rider-triggered model — a wrong rate here misprices every anonymous
  // request, forever, with no --apply and no human in the loop (INV-11). Pinned to the published rate
  // rather than left to a generic "is it defined" check. Since 2026-09-23 that is Gemini 3.8 Flash's
  // introductory rate on Google's NON-GLOBAL tier, because the code sends to the `us` multi-region —
  // so a silent switch to `global` (cheaper) or a bump that forgets the +10% both fail here.
  test('the live planner is priced at the Gemini 3.8 Flash US multi-region rate', () => {
    expect(LLM_MODELS.planner).toBe('gemini-3.8-flash')
    expect(MODEL_PRICING[LLM_MODELS.planner]).toEqual({ inputPerMTok: 0.825, outputPerMTok: 4.125 }) // $0.75/$3.75 × 1.1
  })

  // usageUsd prices ONE call without touching the process tally — the shape the request path needs,
  // since a long-lived API process accumulating a global total would grow without bound and mean
  // nothing. Same arithmetic as the tally, so pin them against each other.
  test('usageUsd prices a single call and leaves the tally untouched', () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 100_000 }
    const beforeChange = new Date('2026-09-23T00:00:00Z')
    // 1M in at $0.825 + 100k out at $4.125/MTok.
    expect(usageUsd(LLM_MODELS.planner, usage, beforeChange)).toBeCloseTo(1.2375, 6)
    expect(llmSpentUsd()).toBe(0) // nothing recorded
    recordModelUsage(LLM_MODELS.planner, usage)
    expect(llmSpentUsd()).toBeCloseTo(usageUsd(LLM_MODELS.planner, usage), 6)
  })

  // ⚠ A static table silently stays on an expired introductory rate — every capped run and every
  // `plan_spend` line would report half of what it billed from that day on, with nothing failing.
  test('a published price change applies from its date, and not a moment before', () => {
    const change = PRICE_CHANGES['gemini-3.8-flash']!
    const from = Date.parse(change.from)
    expect(pricingFor('gemini-3.8-flash', new Date(from - 1))).toEqual(MODEL_PRICING['gemini-3.8-flash'])
    expect(pricingFor('gemini-3.8-flash', new Date(from))).toEqual({ inputPerMTok: 1.65, outputPerMTok: 8.25 })
    const usage = { input_tokens: 1_000_000, output_tokens: 0 }
    expect(usageUsd('gemini-3.8-flash', usage, new Date(from))).toBeCloseTo(1.65, 6)
    // A model with no scheduled change is untouched by the date.
    expect(pricingFor('claude-opus-4-8', new Date('2030-01-01'))).toEqual(MODEL_PRICING['claude-opus-4-8'])
  })

  test('usageUsd on an unpriced model is honestly zero, not a guess', () => {
    expect(usageUsd('mystery-model', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBe(0)
  })
})

describe('geminiUsage', () => {
  test('uncached input is prompt minus cached, and cached bills as a cache read', () => {
    expect(geminiUsage({ promptTokenCount: 10_000, cachedContentTokenCount: 8_000, candidatesTokenCount: 50 })).toEqual({
      input_tokens: 2_000,
      output_tokens: 50,
      cache_read_input_tokens: 8_000,
      cache_creation_input_tokens: 0,
    })
  })

  // Gemini 3 always thinks, and thinking bills at the output rate while being reported apart from it.
  test('thinking tokens are folded into output', () => {
    expect(geminiUsage({ promptTokenCount: 112, candidatesTokenCount: 80, thoughtsTokenCount: 64 }).output_tokens).toBe(144)
  })

  // Gemini omits zero counts rather than sending 0, and a stream that died early has no metadata at all.
  test('absent fields and absent metadata read as zero, never NaN', () => {
    expect(geminiUsage({ promptTokenCount: 131 })).toEqual({
      input_tokens: 131,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    })
    expect(geminiUsage(undefined)).toEqual({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  })

  test('priced end to end: a real probed call costs what Google bills', () => {
    // The 2026-09-23 forced-call probe: 112 prompt, 80 candidates, 64 thinking.
    const usd = usageUsd('gemini-3.8-flash', geminiUsage({ promptTokenCount: 112, candidatesTokenCount: 80, thoughtsTokenCount: 64 }), new Date('2026-09-23T00:00:00Z'))
    expect(usd).toBeCloseTo((112 * 0.825 + 144 * 4.125) / 1_000_000, 12)
  })
})
