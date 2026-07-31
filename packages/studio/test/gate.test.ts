// The eval-panel gate, exercised with fakes.
//
// These tests exist because this wiring previously had NONE. It lived copy-pasted inside two
// generator CLIs where the only way to run it was to pay for a narration and a judge call — and since
// model output is non-deterministic, even a paid run could not have proven the two copies agreed. The
// fused path went its whole life missing the unpriced-model spend guard for exactly that reason.
//
// The seams below (narrate / judgeGrounding / excise / groundingEnabled) are the live defaults in
// production; only the tests pass fakes.

import { describe, expect, test } from 'bun:test'
import { gateNarration } from '../src/pipeline/gate'
import type { NarrationRequest } from '../src/pipeline/narrate'
import type { StopEval } from '../src/eval/types'

// ⚠ No left/right language in these fixtures. `evaluateLaterality` emits a GROUNDING-dimension
// finding for naming a side of the road (direction of travel is unknown on a free-roam clip), and it
// carries the same `ungrounded place-claim` prefix — so a stray "off to the right" would silently
// route every test through the excision branch and never go clean.
const CLEAN = 'The lake sits quiet this morning, smooth as glass, and the pines lean in close along the shoulder.'
const REPAIRED = 'The lake sits quiet this morning, smooth as glass.'

const base: NarrationRequest = {
  region: 'Lake Tahoe',
  stopType: 'story',
  place: { name: 'Emerald Bay' },
  facts: ['A stone house sits at the head of the bay.'],
}

const input = (over: Partial<Parameters<typeof gateNarration>[0]> = {}) => ({
  seq: 0,
  name: 'Emerald Bay',
  base,
  well: ['A stone house sits at the head of the bay.'],
  targetSeconds: 60,
  maxSeconds: 90,
  diversityContext: [] as string[],
  systemPrompt: 'you are the skipper',
  ...over,
})

const grounding = (pass: boolean, findings: string[] = []): StopEval => ({
  seq: 0,
  dimension: 'grounding',
  pass,
  score: pass ? 1 : 0,
  findings,
})

describe('gateNarration', () => {
  test('ships a clean take and feeds it back into the diversity context', async () => {
    const ctx: string[] = []
    const r = await gateNarration(input({ diversityContext: ctx }), {
      narrate: async () => ({ script: CLEAN }) as never,
      groundingEnabled: () => false,
    })
    expect(r.shipped).toBe(true)
    expect(r.script).toBe(CLEAN)
    // The next clip in this run must be scored against this one — a single-element diversity check
    // is a no-op by arithmetic, which is how one phrase reached dozens of released clips.
    expect(ctx).toEqual([CLEAN])
  })

  test('withholds when a GATE dimension fails, and does not pollute the diversity context', async () => {
    const ctx: string[] = []
    const r = await gateNarration(input({ diversityContext: ctx }), {
      narrate: async () => ({ script: CLEAN }) as never,
      groundingEnabled: () => true,
      judgeGrounding: async () => grounding(false, ['ungrounded place-claim: a battle nobody fought']),
      excise: async (prev) => prev, // excision can't help; a no-op keeps the prior take
    })
    expect(r.shipped).toBe(false)
    expect(ctx).toEqual([])
  })

  test('repairs an ungrounded claim by EXCISION, never by re-rolling the clip', async () => {
    let narrateCalls = 0
    let exciseCalls = 0
    let judged = 0
    const r = await gateNarration(input(), {
      narrate: async () => {
        narrateCalls++
        return { script: CLEAN } as never
      },
      groundingEnabled: () => true,
      // Fails once, then clean — so the excised take is a strict improvement and gets accepted.
      judgeGrounding: async () => {
        judged++
        return judged === 1 ? grounding(false, ['ungrounded place-claim: a battle nobody fought']) : grounding(true)
      },
      excise: async () => {
        exciseCalls++
        return REPAIRED
      },
    })
    expect(exciseCalls).toBe(1)
    // The initial take only — re-rolling just reaches for a different flourish, so the grounding
    // retake must NOT go back to the narrator.
    expect(narrateCalls).toBe(1)
    expect(r.script).toBe(REPAIRED)
    expect(r.shipped).toBe(true)
  })

  test('re-narrates for a NON-grounding finding instead of excising', async () => {
    let narrateCalls = 0
    let exciseCalls = 0
    let judged = 0
    await gateNarration(input(), {
      narrate: async () => {
        narrateCalls++
        return { script: CLEAN } as never
      },
      groundingEnabled: () => true,
      judgeGrounding: async () => {
        judged++
        return judged === 1 ? grounding(false, ['reads like a brochure']) : grounding(true)
      },
      excise: async () => {
        exciseCalls++
        return REPAIRED
      },
    })
    expect(exciseCalls).toBe(0)
    expect(narrateCalls).toBe(2) // the initial take + one retake
  })

  test('skips the grounding judge entirely when it is switched off', async () => {
    let judged = 0
    await gateNarration(input(), {
      narrate: async () => ({ script: CLEAN }) as never,
      groundingEnabled: () => false,
      judgeGrounding: async () => {
        judged++
        return grounding(true)
      },
    })
    expect(judged).toBe(0) // that call is an Opus request — it must not fire when disabled
  })

  test('the retake budget is respected', async () => {
    let narrateCalls = 0
    await gateNarration(input(), {
      narrate: async () => {
        narrateCalls++
        return { script: `${CLEAN} ${'and on it went. '.repeat(narrateCalls)}` } as never
      },
      groundingEnabled: () => true,
      // Never clean, and each take scores the same — the thrash guard should stop the loop early
      // rather than burn the full budget on takes that aren't improving.
      judgeGrounding: async () => grounding(false, ['reads like a brochure']),
      maxRounds: 3,
    })
    expect(narrateCalls).toBeLessThanOrEqual(4) // initial + at most 3 retakes
    expect(narrateCalls).toBeGreaterThan(1)
  })
})
