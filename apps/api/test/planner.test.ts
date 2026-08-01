// Tests for the live planner (build step 6). Three things are worth pinning, and only three:
// the prompt still says what makes it safe, the six-outcome classifier maps stop_reason correctly,
// and the transcript caps hold.
//
// ⚠ NONE OF THIS SPENDS. `runPlannerTurn` takes an injected client (the `client` field on
// PlannerModelArgs) precisely so the classifier — the entire reason planner.ts exists — is reachable
// without a network call or an API key. A module-private client would mean the logic deciding whether
// a rider's "yes" becomes a drive could only ever be exercised by paying for it.
//
// ⚠ What these tests deliberately do NOT cover: the rate limiters. `rateLimit()` returns next()
// unconditionally under NODE_ENV=test, which is every sanctioned invocation — so a test asserting a
// 429 would assert nothing. The limiters are verified by probe instead (see limits.ts).

import { describe, expect, spyOn, test } from 'bun:test'
import Anthropic from '@anthropic-ai/sdk'
import { PLANNER_SYSTEM_PROMPT } from '../src/planner-prompt'
import { buildRosterBlock, PlannerTurnError, runPlannerTurn, type PlannerModelArgs } from '../src/planner'
import { checkTranscript, MAX_PLAN_MESSAGES, MAX_PLAN_MESSAGE_CHARS, MAX_PLAN_TOTAL_CHARS } from '../src/limits'

/* -------------------------------------------------------------------------- */
/* The prompt — the clauses that make it safe to run ungated.                   */
/* -------------------------------------------------------------------------- */

describe('planner prompt', () => {
  // ⚠ The spec asks for this one by name. The planner is the first time the persona speaks LIVE and
  // there is no eval gate in front of it, so the deflection is prompt-held — which means the only
  // thing standing between a rider and an invented fact is text in a file that someone might "tidy".
  test('the deflection clause survives — the planner does not answer WHAT', () => {
    expect(PLANNER_SYSTEM_PROMPT).toContain('road talk')
    expect(PLANNER_SYSTEM_PROMPT.toLowerCase()).toContain('you do not answer')
  })

  test('it states that the anchor list is the whole world, not a sample', () => {
    expect(PLANNER_SYSTEM_PROMPT).toContain('everything you have')
  })

  test('it forbids composing an id rather than copying one', () => {
    expect(PLANNER_SYSTEM_PROMPT.toLowerCase()).toContain('never compose one')
  })

  // ⚠ INV-10: the OTHER prompt is written around a fact sheet ("the card") and stop kinds. If any of
  // that vocabulary appears here, someone has edited the wrong prompt — the most likely mistake a
  // future agent makes, because both files say "You are the Skipper" at the top.
  test('no narration-prompt vocabulary leaked across (INV-10)', () => {
    for (const leaked of ['the card', 'fact sheet', 'scenic', 'grounding']) {
      expect(PLANNER_SYSTEM_PROMPT.toLowerCase()).not.toContain(leaked)
    }
  })

  // The persona KEPT the jungle-boat comedy and LEFT the boat — nautical framing is this character's
  // standing failure mode. ⚠ Assert the prompt FORBIDS it, not that the words are absent: the prompt
  // legitimately says `no "all aboard"` in order to ban it, and an absence check fails on its own
  // guardrail. (It did. That is why this comment exists.)
  test('the prompt bans nautical framing rather than using it', () => {
    expect(PLANNER_SYSTEM_PROMPT).toContain('leave the boat behind')
  })

  // It rides in the CACHED prefix, so a byte change per request would re-bill the whole prompt.
  test('the prompt is a static literal — nothing interpolated', () => {
    expect(PLANNER_SYSTEM_PROMPT).not.toContain('${')
  })
})

describe('buildRosterBlock', () => {
  test('prints ids and names, and says the list is exhaustive', () => {
    const block = buildRosterBlock('Lake Tahoe', [
      { id: '3582ed8a-a55e-4fb2-b8af-59dcd9eef16c', name: 'Tahoe City' },
      { id: '9f1c0b2e-7a4d-4c8b-9e6f-2a1b3c4d5e6f', name: 'Kings Beach' },
    ])
    expect(block).toContain('Lake Tahoe')
    expect(block).toContain('Tahoe City')
    expect(block).toContain('3582ed8a-a55e-4fb2-b8af-59dcd9eef16c')
  })

  // An uncurated region is a real state, not an error: the skipper honestly has nowhere to go.
  test('an empty roster does not throw', () => {
    expect(() => buildRosterBlock('Nowhere', [])).not.toThrow()
  })
})

/* -------------------------------------------------------------------------- */
/* The classifier — the reason planner.ts exists.                               */
/* -------------------------------------------------------------------------- */

/** A stand-in for the SDK's streaming client. Structurally compatible with what runPlannerTurn uses,
 *  which is the whole benefit of the injected seam being a `Pick<Anthropic,'messages'>` rather than a
 *  concrete class: no SDK instance, no key, no network. */
function fakeClient(message: Record<string, unknown>) {
  return {
    messages: {
      stream: () => ({
        on() {},
        request_id: 'req_test',
        finalMessage: async () => ({
          model: 'claude-opus-5',
          usage: { input_tokens: 10, output_tokens: 5 },
          ...message,
        }),
      }),
    },
  } as unknown as NonNullable<PlannerModelArgs['client']>
}

const baseArgs = (client: NonNullable<PlannerModelArgs['client']>): PlannerModelArgs => ({
  turns: [{ role: 'rider', text: 'plan me something scenic' }],
  regionName: 'Lake Tahoe',
  anchors: [{ id: '3582ed8a-a55e-4fb2-b8af-59dcd9eef16c', name: 'Tahoe City' }],
  client,
})

const textBlock = (text: string) => ({ type: 'text', text })

describe('planner outcome classification', () => {
  test('text with no tool call is a normal conversational beat', async () => {
    const turn = await runPlannerTurn(
      baseArgs(fakeClient({ stop_reason: 'end_turn', content: [textBlock('Where are you starting?')] })),
    )
    expect(turn.outcome).toBe('say')
    expect(turn.say).toBe('Where are you starting?')
    expect(turn.rawRoute).toBeNull()
  })

  test('a tool call is the ONLY outcome that carries a route', async () => {
    const turn = await runPlannerTurn(
      baseArgs(
        fakeClient({
          stop_reason: 'tool_use',
          content: [textBlock('Drawing that up.'), { type: 'tool_use', name: 'plan_route', input: { start_anchor_id: 'a', end_anchor_id: 'b' } }],
        }),
      ),
    )
    expect(turn.outcome).toBe('route')
    expect(turn.rawRoute).toEqual({ start_anchor_id: 'a', end_anchor_id: 'b' })
  })

  // ⚠ A tool block with the WRONG name is not a route. This is not hypothetical — writing these tests
  // with a made-up tool name is exactly how it was found, and a renamed tool that still "worked" would
  // mean the classifier was matching on shape rather than identity.
  test('a tool block with an unrecognised name is not a route', async () => {
    const turn = await runPlannerTurn(
      baseArgs(
        fakeClient({
          stop_reason: 'tool_use',
          content: [textBlock('Hmm.'), { type: 'tool_use', name: 'something_else', input: { start_anchor_id: 'a' } }],
        }),
      ),
    )
    expect(turn.rawRoute).toBeNull()
  })

  // ⚠ THE ONE THAT MATTERS MOST. A truncated turn is HTTP 200 with a half-parsed tool call or none at
  // all — byte-identical, from the caller's side, to "the planner chose not to route this turn". One is
  // a normal chat beat; the other is a paid call that produced nothing. Conflating them is how a rider
  // says yes and watches nothing happen.
  test('max_tokens is TRUNCATED, not a route, even when a tool block is present', async () => {
    const turn = await runPlannerTurn(
      baseArgs(
        fakeClient({
          stop_reason: 'max_tokens',
          content: [textBlock('Alright, so we start at'), { type: 'tool_use', name: 'plan_route', input: { start_anchor_id: 'a' } }],
        }),
      ),
    )
    expect(turn.outcome).toBe('truncated')
    // The partial tool block is discarded unread — a half-drawn route must never reach the rider.
    expect(turn.rawRoute).toBeNull()
    // ...but the words the rider already watched stream are kept.
    expect(turn.say).toContain('Alright')
  })

  test('a refusal is its own outcome and never carries the explanation', async () => {
    const turn = await runPlannerTurn(
      baseArgs(fakeClient({ stop_reason: 'refusal', stop_details: { explanation: 'do not echo me' }, content: [] })),
    )
    expect(turn.outcome).toBe('refused')
    expect(turn.say).not.toContain('do not echo me')
  })

  test('a clean end with neither text nor route is EMPTY, not a silent success', async () => {
    const turn = await runPlannerTurn(baseArgs(fakeClient({ stop_reason: 'end_turn', content: [] })))
    expect(turn.outcome).toBe('empty')
  })
})

/* -------------------------------------------------------------------------- */
/* Rider cancellation (build step 7).                                           */
/*                                                                              */
/* ⚠ WHY THIS SECTION EXISTS AT ALL: a rider closing the app and our own 45-     */
/* second wall clock arrive as the SAME SDK error, and the pre-step-7 classifier */
/* called both a 'timeout'. That is not a cosmetic mislabel — it is money the    */
/* INV-11 tally never sees, and an outage alarm that fires on healthy traffic.   */
/* -------------------------------------------------------------------------- */

describe('rider cancellation', () => {
  /** A client that counts how many times a call was actually opened. */
  function countingClient(streamImpl: () => unknown) {
    const calls = { n: 0 }
    const client = {
      messages: {
        stream: () => {
          calls.n++
          return streamImpl()
        },
      },
    } as unknown as NonNullable<PlannerModelArgs['client']>
    return { client, calls }
  }

  // ⚠ THE "SPEND NOTHING" GUARANTEE, and the only test that proves it. The rider can hang up while the
  // region + anchor reads are still in flight; opening the model call at that point bills for a turn
  // that provably has no reader.
  test('an already-aborted rider costs nothing — the model is never called', async () => {
    const ac = new AbortController()
    ac.abort()
    const { client, calls } = countingClient(() => {
      throw new Error('unreachable — the call must never open')
    })

    const err = await runPlannerTurn({ ...baseArgs(client), signal: ac.signal }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PlannerTurnError)
    expect((err as PlannerTurnError).reason).toBe('client_gone')
    expect(calls.n).toBe(0)
  })

  // The turn WAS billed — `message_start` landed, output accumulated — and then the rider left. That
  // spend has to reach the tally, and it has to be logged as a cancellation rather than an outage.
  test('a rider who leaves mid-stream is client_gone, and the partial spend is salvaged', async () => {
    const ac = new AbortController()
    const { client } = countingClient(() => {
      // Abort AFTER the call is open, which is the real sequence: the composite signal is built first,
      // then the request goes out, then the rider hits back.
      ac.abort()
      return {
        on() {},
        request_id: 'req_test',
        currentMessage: { usage: { input_tokens: 10, output_tokens: 3 } },
        finalMessage: async () => {
          throw new Anthropic.APIUserAbortError()
        },
      }
    })

    const info = spyOn(console, 'info')
    const errSpy = spyOn(console, 'error')
    let err: unknown
    let logged = ''
    let errCount = -1
    try {
      err = await runPlannerTurn({ ...baseArgs(client), signal: ac.signal }).catch((e: unknown) => e)
      // ⚠ READ THE RECORD BEFORE RESTORING. bun's mockRestore() clears `.mock.calls`, so a spy read
      // after restore reports NOTHING — which turns an "it must not be logged" assertion into a test
      // that can never fail. (It did. That is why this comment exists.)
      logged = info.mock.calls.flat().map(String).join('\n')
      errCount = errSpy.mock.calls.length
    } finally {
      info.mockRestore()
      errSpy.mockRestore()
    }

    expect((err as PlannerTurnError).reason).toBe('client_gone')
    expect(logged).toContain('cancelled by rider')
    expect(logged).toContain('out=3')
    // ⚠ An operator greps `[planner] model call failed` for outages. A rider closing the app must
    // never land in that bucket, or a healthy service looks like it is on fire the day it gets busy.
    expect(logged).not.toContain('failed')
    expect(errCount).toBe(0)
  })

  // ⚠ REGRESSION GUARD. Without this, the branch above can quietly swallow the REAL timeout path —
  // the two are told apart only by asking the rider's own signal whether it aborted.
  test('a genuine vendor timeout is still a timeout when the rider is still there', async () => {
    const { client } = countingClient(() => ({
      on() {},
      request_id: 'req_test',
      currentMessage: { usage: { input_tokens: 10, output_tokens: 3 } },
      finalMessage: async () => {
        throw new Anthropic.APIConnectionTimeoutError()
      },
    }))

    const errSpy = spyOn(console, 'error')
    let err: unknown
    let logged = ''
    try {
      err = await runPlannerTurn({ ...baseArgs(client), signal: new AbortController().signal }).catch((e: unknown) => e)
      logged = errSpy.mock.calls.flat().map(String).join('\n') // before mockRestore clears it
    } finally {
      errSpy.mockRestore()
    }

    expect((err as PlannerTurnError).reason).toBe('timeout')
    expect(logged).toContain('model call failed: timeout')
    // The salvage applies here too: a turn that dies after message_start was billed for what it made.
    expect(logged).toContain('out=3')
  })
})

/* -------------------------------------------------------------------------- */
/* The caps.                                                                    */
/* -------------------------------------------------------------------------- */

describe('transcript caps (INV-3)', () => {
  const turn = (text: string) => ({ text })

  test('a normal conversation passes', () => {
    expect(checkTranscript([turn('hi'), turn('plan me a drive')])).toBeNull()
  })

  test('too many turns is refused', () => {
    expect(checkTranscript(Array.from({ length: MAX_PLAN_MESSAGES + 1 }, () => turn('x')))).toBe('too_many_turns')
  })

  // ⚠ Without a PER-MESSAGE bound, one wall-of-text turn eats the whole budget — simultaneously the
  // best prompt-injection payload shape and the least diagnosable error.
  test('one oversized turn is refused even when the total would fit', () => {
    expect(checkTranscript([turn('x'.repeat(MAX_PLAN_MESSAGE_CHARS + 1))])).toBe('turn_too_long')
  })

  test('many small turns that together exceed the total are refused', () => {
    const each = 'y'.repeat(MAX_PLAN_MESSAGE_CHARS)
    const n = Math.ceil(MAX_PLAN_TOTAL_CHARS / MAX_PLAN_MESSAGE_CHARS) + 1
    expect(n).toBeLessThanOrEqual(MAX_PLAN_MESSAGES) // else this would trip the turn cap instead
    expect(checkTranscript(Array.from({ length: n }, () => turn(each)))).toBe('transcript_too_long')
  })
})
