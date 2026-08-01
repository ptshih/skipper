import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  CLAUDE_MODELS,
  llmSpendLines,
  llmSpentUsd,
  MODEL_PRICING,
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
  // means adding a key to CLAUDE_MODELS cannot be forgotten here: the test fails the moment it lands.
  test('DRIFT GUARD: every CLAUDE_MODELS id has a pricing entry', () => {
    for (const id of Object.values(CLAUDE_MODELS)) {
      expect(MODEL_PRICING[id]).toBeDefined()
    }
  })

  // ⚠ The planner is the ONLY rider-triggered model — a wrong rate here misprices every anonymous
  // request, forever, with no --apply and no human in the loop (INV-11). Pinned to the published
  // Opus-tier rate rather than left to a generic "is it defined" check.
  test('the live planner is priced at the published Opus rate', () => {
    expect(MODEL_PRICING[CLAUDE_MODELS.planner]).toEqual({ inputPerMTok: 5, outputPerMTok: 25 })
  })

  // usageUsd prices ONE call without touching the process tally — the shape the request path needs,
  // since a long-lived API process accumulating a global total would grow without bound and mean
  // nothing. Same arithmetic as the tally, so pin them against each other.
  test('usageUsd prices a single call and leaves the tally untouched', () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 100_000 }
    expect(usageUsd(CLAUDE_MODELS.planner, usage)).toBeCloseTo(7.5, 6)
    expect(llmSpentUsd()).toBe(0) // nothing recorded
    recordModelUsage(CLAUDE_MODELS.planner, usage)
    expect(llmSpentUsd()).toBeCloseTo(usageUsd(CLAUDE_MODELS.planner, usage), 6)
  })

  test('usageUsd on an unpriced model is honestly zero, not a guess', () => {
    expect(usageUsd('mystery-model', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBe(0)
  })
})

