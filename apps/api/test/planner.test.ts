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
import { CLAUDE_MODELS } from '@skipper/shared'
import { PLAN_ROUTE_TOOL, PLANNER_SYSTEM_PROMPT, PLANNER_WRAP_UP_NOTICE } from '../src/planner-prompt'
import { MAX_ROUTE_VIA } from '@skipper/shared'
import {
  buildDrawnBlock,
  buildRosterBlock,
  PlannerTurnError,
  runPlannerTurn,
  type PlannerModelArgs,
} from '../src/planner'
import {
  checkTranscript,
  MAX_PLAN_MESSAGES,
  MAX_PLAN_MESSAGE_CHARS,
  MAX_PLAN_TOTAL_CHARS,
  PLANNER_MAX_TOKENS,
} from '../src/limits'

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

  // The model CANNOT SEE that it already called the tool — `toWire` sends role + text only, so the route
  // never comes back to it and its sole evidence is its own sentence. Without a rule for the turn AFTER a
  // draw it falls back into drawing: asked "What's your name?" on device it replied "Folks just call me
  // the Skipper. Consider it drawn." and re-emitted the route. Pinned because the section is the only
  // thing standing between that gap and a skipper who claims work he did not do.
  test('it tells the skipper a drawn drive STAYS drawn', () => {
    expect(PLANNER_SYSTEM_PROMPT.toLowerCase()).toContain('once it is drawn')
    expect(PLANNER_SYSTEM_PROMPT.toLowerCase()).toContain('you do not say you did a thing you did not do')
  })

  // The example must not stop at the draw — one that does teaches the drive as the end of the
  // conversation, which is the failure above in miniature.
  //
  // ⚠ THIS USED TO PIN THE LITERAL "Consider it drawn", AND THAT WAS THE BUG IT WAS GUARDING. The
  // prompt quotes that exact phrase as its canonical example of claiming work you did not just do —
  // and the example then taught it as the model's draw line. A few-shot beats an instruction, so the
  // prompt was maximising the probability of the one string it forbids, and the observed 2026-08-03
  // device failure was that string verbatim. The draw beat now RESTATES THE DRIVE instead, which also
  // gives the model the record it otherwise lacks (it cannot see its own tool call — see the prompt's
  // header). Pinned as the PROPERTY the phrase was standing in for: enough beats, and the exchange
  // does not end on the draw.
  test('the example exchange carries beats AFTER the draw', () => {
    const ex = PLANNER_SYSTEM_PROMPT.slice(PLANNER_SYSTEM_PROMPT.indexOf('== One example exchange =='))
    expect(ex).toContain('<example>')
    expect((ex.match(/^Them:/gm) ?? []).length).toBeGreaterThanOrEqual(4)
    // The last spoken beat is the skipper's, so the exchange never models the draw as the end.
    expect(ex.trimEnd().split('\n').filter((l) => l.startsWith('You:')).length).toBeGreaterThanOrEqual(4)
    expect(ex).toContain('whole of my paperwork')
  })

  // ⚠ THE PERMISSION, NOT ONLY THE PROHIBITION — and the asymmetry it corrects is what shipped a bug.
  // Every pin above suppresses a redraw; nothing pinned the case where a redraw is CORRECT, so the
  // prompt drifted toward refusing them. Founder, 2026-08-03: the chat was "refusing to redraw the
  // route after changing it up and chatting more". Root cause was that the prompt named "a different
  // length" as an axis earning a redraw, while `toProposeRequest` DROPS `targetMinutes` — so the only
  // compliant emission for "shorter" was a byte-identical route the client then refused.
  test('a duration change is NOT an axis that earns a redraw; moving an end is', () => {
    const drawn = PLANNER_SYSTEM_PROMPT.slice(PLANNER_SYSTEM_PROMPT.indexOf('== Once it is drawn =='))
    expect(drawn).toContain('a nearer far end')
    // The dead axis must not be listed among the things that earn another draw.
    expect(drawn).not.toContain('a different length')
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

/* -------------------------------------------------------------------------- */
/* The tool — PROMPT SURFACE, and until 2026-08-03 nothing imported it at all.  */
/* -------------------------------------------------------------------------- */

// ⚠ WHY THIS BLOCK EXISTS. `PLAN_ROUTE_TOOL.description` is read by the MODEL and renders BEFORE the
// system prompt (order is tools → system → messages), so it is the highest-salience text for the
// call/do-not-call decision — and it was imported by ZERO tests, meaning the ~10 lines at the centre of
// the founder's "refusing to redraw" report could be rewritten to anything with every suite green.
describe('plan_route tool', () => {
  test('the name the classifier matches on is stable', () => {
    // ./planner finds the block by `b.name === PLAN_ROUTE_TOOL.name`; a rename silently degrades every
    // route turn to 'say' — a rider says yes and watches nothing happen.
    expect(PLAN_ROUTE_TOOL.name).toBe('plan_route')
  })

  // ⚠ THE FIELD THAT REVERSED A LONG-STANDING DECISION, and it is pinned so nobody restores the old
  // shape from the old argument. Measured 2026-08-03: on EVERY draw turn the model emitted the tool
  // JSON and no text block — under the new prompt AND the pre-rewrite one — so every rider heard the
  // server's one fixed fallback instead of the Skipper saying their drive back. Required, not
  // optional: an optional field the model may omit reproduces exactly the defect it fixes.
  test('`say` is a REQUIRED field on the tool', () => {
    const props = PLAN_ROUTE_TOOL.input_schema.properties as Record<string, { type: string }>
    expect(props.say?.type).toBe('string')
    expect(PLAN_ROUTE_TOOL.input_schema.required).toContain('say')
  })

  test('every field the handler translates exists, and only the endpoints and the line are required', () => {
    // These names are the MODEL's vocabulary, deliberately not the wire DTO's camelCase — toPlannedRoute
    // (./plan-route) reads exactly these keys, so a rename here is a silently dropped route.
    const props = PLAN_ROUTE_TOOL.input_schema.properties as Record<string, unknown>
    expect(Object.keys(props).sort()).toEqual(
      [
        'end_anchor_id',
        'return_anchor_id',
        'round_trip',
        'say',
        'start_anchor_id',
        'target_minutes',
        'via_anchor_ids',
      ].sort(),
    )
    // Requiring round_trip or target_minutes would push the model to assert an intent the rider never
    // expressed just to satisfy the schema. `say` is different in kind — there is no honest default
    // for "what the Skipper said", and an optional one reproduces the wordless-draw defect.
    expect(PLAN_ROUTE_TOOL.input_schema.required).toEqual(['say', 'start_anchor_id', 'end_anchor_id'])
  })

  test('the via cap leaves room for the TWO waypoints the server APPENDS', () => {
    // A round trip maps to `{ start, end: start, via: [...via, end, return] }` — the turnaround AND the
    // way home (2026-08-03, no-same-road loops) — so a model that filled `via` to this tool's brim must
    // still clear the shared wire cap. Otherwise toPlannedRoute drops the whole route and the rider
    // hears the retry line for a drive that was fine. It was `+ 1` while a loop appended only the
    // turnaround; the append grew and this bound has to grow with it.
    const via = PLAN_ROUTE_TOOL.input_schema.properties as { via_anchor_ids: { maxItems: number } }
    expect(via.via_anchor_ids.maxItems + 2).toBeLessThanOrEqual(MAX_ROUTE_VIA)
  })

  // The founder's 2026-08-03 report, from the tool's side. The description must define drive IDENTITY
  // the same way `proposeKey` does (start + end + via), so the model cannot believe a new
  // `target_minutes` makes a new drive — and it must not carry a blanket "never call this again",
  // which also closed the client's own propose-failure retry path.
  test('it defines a drive by its endpoints, not its duration', () => {
    expect(PLAN_ROUTE_TOOL.description).toContain('target_minutes included')
    expect(PLAN_ROUTE_TOOL.description).not.toContain('never call this a second time')
  })

  test('it still demands the line, and now names the field that carries it', () => {
    // The prompt's "say a line every single turn" was measured NOT to work on a draw turn, which is
    // why `say` is a required field rather than a hope. The description must point at it by name.
    expect(PLAN_ROUTE_TOOL.description).toContain('`say`')
    expect(PLAN_ROUTE_TOOL.description).toContain('watch nothing happen')
  })
})

/* -------------------------------------------------------------------------- */
/* The model's MISSING MEMORY — what it already drew.                          */
/* -------------------------------------------------------------------------- */

// ⚠ WHY THIS BLOCK EXISTS. The transcript is text-only — `toWire` carries role + text and DROPS the
// route — so the model cannot see that it ever called the tool, and its whole evidence of having drawn
// is its own sentence. That single fact caused most of this surface's defects: answering "What do I
// call you?" with "Consider it drawn", re-emitting an identical route on "sweet", and guessing at
// whether a new ask was a DIFFERENT drive. The client now sends what it drew and this renders it back.
describe('buildDrawnBlock', () => {
  const A = { id: 'a1', name: 'Kings Beach' }
  const B = { id: 'b2', name: 'Emerald Bay State Park' }
  const C = { id: 'c3', name: 'Tahoe City' }

  test('names the drive in order, from the ROSTER — never from the caller', () => {
    const block = buildDrawnBlock([{ start: 'a1', end: 'b2' }], [A, B, C])
    expect(block).toContain('Kings Beach to Emerald Bay State Park')
  })

  // ⚠ IT RESTATES THE PROMPT'S RULE ON PURPOSE, AND THIS PINS THAT. Removing it as "one rule, two
  // homes" is the obvious tidy-up and it was done on 2026-08-04 — four replays later the re-emit
  // defect was back (0,1,1,0 across 200 turns vs 0,0 across 100 with the rule here). A rule beside
  // the data it governs is doing work the same rule 3,000 cached tokens earlier is not.
  test('restates the do-not-redraw rule beside the data — measured, not tidiness', () => {
    const block = buildDrawnBlock([{ start: 'a1', end: 'b2' }], [A, B, C])!
    expect(block.toLowerCase()).toContain('do not draw one of these again')
  })

  test('midpoints ride in order', () => {
    const block = buildDrawnBlock([{ start: 'a1', end: 'b2', via: ['c3'] }], [A, B, C])
    expect(block).toContain('Kings Beach to Tahoe City to Emerald Bay State Park')
  })

  // ⚠ THE SECURITY SHAPE. The caller sends ids; names come from the allowlist. An id that is not on it
  // is DROPPED rather than rendered or rejected — this is CONTEXT, not a routing instruction, so a
  // stale or forged entry must degrade to one fewer remembered drive, never to an error and never to a
  // place name the region does not have.
  test('an unknown id drops the whole drive rather than printing a gap', () => {
    expect(buildDrawnBlock([{ start: 'a1', end: 'nope' }], [A, B, C])).toBeNull()
    const block = buildDrawnBlock([{ start: 'a1', end: 'nope' }, { start: 'a1', end: 'b2' }], [A, B, C])
    expect(block).toContain('Kings Beach to Emerald Bay State Park')
    expect(block).not.toContain('nope')
  })

  test('nothing to say returns null, so the caller can omit the block entirely', () => {
    expect(buildDrawnBlock([], [A, B])).toBeNull()
  })

  test('a name carrying a newline cannot forge an extra line', () => {
    // Same rule the roster block enforces: this is a SYSTEM block, so a smuggled newline would read as
    // authoritative structure.
    const block = buildDrawnBlock([{ start: 'a1', end: 'x' }], [A, { id: 'x', name: 'Bad\nPlace' }])
    expect(block).toContain('Bad Place')
    expect(block!.split('\n').filter((l) => l.includes('Kings Beach')).length).toBe(1)
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

/** What `runPlannerTurn` actually asked the vendor for, from the most recent `fakeClient` call.
 *
 *  ⚠ THE FAKE USED TO THROW THIS AWAY, so nothing asserted the call PARAMETERS at all — the two most
 *  expensive fields on this path (the model that gets billed, and the token ceiling) were unverified
 *  while every test around them was green. Captured module-wide rather than returned, because
 *  `fakeClient(...)` is used positionally at a dozen call sites and threading a handle through all of
 *  them would be churn for one assertion. Null it before you read it. */
let lastStreamParams: StreamParams | null = null

/** Only the fields asserted below. Structural on purpose — naming the SDK's params type here would
 *  couple this file to a type name that moves between SDK majors, for no added strictness (the client
 *  itself is cast through `unknown` anyway). */
type StreamParams = {
  model?: unknown
  max_tokens?: unknown
  thinking?: { type?: unknown; display?: unknown }
  /** The system blocks, in render order. ⚠ Captured for D12: WHERE the wrap-up notice sits relative to
   *  the cache breakpoint is a cost property with no other observable — see the block at the bottom. */
  system?: { text?: unknown; cache_control?: unknown }[]
}

/** Read the capture, or fail loudly if the model was never called.
 *
 *  ⚠ A FUNCTION, NOT A DIRECT READ, AND THAT IS NOT STYLE. TypeScript does not reset the narrowing of a
 *  `let` across a call that assigns it from inside a callback, so `lastStreamParams = null` followed by
 *  `lastStreamParams?.model` narrows to `never` and every assertion downstream becomes a type error —
 *  or, with a looser type, a vacuous pass on `undefined`. Reading through a call has no stale narrowing.
 *  ⚠ It THROWS rather than returning null: "the model was never called" must be a red test, not an
 *  assertion quietly evaluated against nothing. */
function lastCallParams(): StreamParams {
  if (!lastStreamParams) throw new Error('runPlannerTurn never opened a model call — nothing to assert')
  return lastStreamParams
}

/** A stand-in for the SDK's streaming client. Structurally compatible with what runPlannerTurn uses,
 *  which is the whole benefit of the injected seam being a `Pick<Anthropic,'messages'>` rather than a
 *  concrete class: no SDK instance, no key, no network. */
function fakeClient(message: Record<string, unknown>) {
  return {
    messages: {
      stream: (params: StreamParams) => {
        lastStreamParams = params
        return {
          on() {},
          request_id: 'req_test',
          finalMessage: async () => ({
            // ⚠ DELIBERATELY NOT `CLAUDE_MODELS.planner`. This is the vendor's ECHO, which the API is
            // not bound to return as the alias we asked for — it may resolve to a longer dated id. A
            // fixture where the two are equal makes "the pricing key and the echo are separate fields"
            // unfalsifiable, which is exactly the conflation the cost line exists to prevent.
            model: 'claude-opus-5-99991231',
            usage: { input_tokens: 10, output_tokens: 5 },
            ...message,
          }),
        }
      },
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

  // ⚠ THE WORDLESS-DRAW FIX. Measured 2026-08-03: on a draw turn this model emits the tool JSON and NO
  // text block at all — every time, under the pre-rewrite prompt too — so the rider heard the server's
  // one fixed fallback instead of their drive said back. `say` is now a required tool field and gets
  // unwrapped here.
  test('the line is unwrapped from the tool call when no text block came back', async () => {
    const turn = await runPlannerTurn(
      baseArgs(
        fakeClient({
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', name: 'plan_route', input: { say: 'There she is.', start_anchor_id: 'a', end_anchor_id: 'b' } }],
        }),
      ),
    )
    expect(turn.outcome).toBe('route')
    expect(turn.say).toBe('There she is.')
  })

  test('a REAL text block still wins over the tool field', async () => {
    // A model that speaks both ways must not have the streamed prose overridden by the call's copy.
    const turn = await runPlannerTurn(
      baseArgs(
        fakeClient({
          stop_reason: 'tool_use',
          content: [textBlock('Streamed line.'), { type: 'tool_use', name: 'plan_route', input: { say: 'Tool line.', start_anchor_id: 'a', end_anchor_id: 'b' } }],
        }),
      ),
    )
    expect(turn.say).toBe('Streamed line.')
  })

  test('a non-string say reads as ABSENT rather than reaching the rider', async () => {
    // `input` is model output. A cast here would put "[object Object]" in the bubble.
    const turn = await runPlannerTurn(
      baseArgs(
        fakeClient({
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', name: 'plan_route', input: { say: { oops: 1 }, start_anchor_id: 'a', end_anchor_id: 'b' } }],
        }),
      ),
    )
    expect(turn.say).toBe('')
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
/* The call parameters — what this request actually bills (INV-11 / INV-8).     */
/* -------------------------------------------------------------------------- */

describe('the model call this route bills', () => {
  // ⚠ INV-11/INV-12: this call spends on EVERY anonymous request, forever, and its only in-code guards
  // are the explicit model and `max_tokens`. Both were previously asserted nowhere — the fake discarded
  // the request. ⚠ Read from the CONSTANTS, never their values: a test that hardcodes 2_048 turns a
  // deliberate cap change into a test failure while a REPOINTED cap sails through.
  test('it bills the planner model at the capped token budget', async () => {
    lastStreamParams = null
    await runPlannerTurn(baseArgs(fakeClient({ stop_reason: 'end_turn', content: [textBlock('hi')] })))
    const params = lastCallParams()

    // Not `CLAUDE_MODELS.opus` — that key is the studio pipeline's model, and repointing this one at it
    // changes what a fail-closed eval gate is calibrated against as a side effect of a "constant edit".
    expect(params.model).toBe(CLAUDE_MODELS.planner)
    expect(params.max_tokens).toBe(PLANNER_MAX_TOKENS)
  })

  // ⚠ INV-8, AND IT IS A SILENT FAILURE, NOT A LOUD ONE. With thinking disabled this model can write a
  // tool call into VISIBLE TEXT instead of a tool_use block: the turn succeeds, no error is raised, the
  // route never reaches the map. Nothing else in this file can catch that — every classifier test above
  // feeds a hand-built response and would stay green. Asserted as "present AND not disabled" so BOTH
  // ways of turning it off (deleting the field, or `{type:'disabled'}`) are red.
  test('thinking stays ON, with reasoning withheld from rider-facing text (INV-8)', async () => {
    lastStreamParams = null
    await runPlannerTurn(baseArgs(fakeClient({ stop_reason: 'end_turn', content: [textBlock('hi')] })))
    const params = lastCallParams()

    expect(params.thinking).toBeDefined()
    expect(params.thinking?.type).not.toBe('disabled')
    // Stated rather than defaulted: rider-facing prose must never carry reasoning, and the SDK's own
    // docstring claims a 'summarized' default that is stale for this model.
    expect(params.thinking?.display).toBe('omitted')
  })
})

/* -------------------------------------------------------------------------- */
/* The cost line (1.7(b)) — the ONE guard that survives an autoscaled instance. */
/*                                                                              */
/* ⚠ WHY THESE ASSERT ON PARSED JSON RATHER THAN SUBSTRINGS. Cloud Run puts a    */
/* plain text line in `textPayload`, unqueryable by field; a single line of      */
/* serialized JSON lands in `jsonPayload`, where `usd` is a numeric field a      */
/* log-based distribution metric reads directly. `recordModelUsage`'s process    */
/* tally has NO reader in apps/api and cannot have one under autoscale, so this  */
/* line is what makes rider-triggered spend visible at all.                      */
/* -------------------------------------------------------------------------- */

/** Parse the single cost line a spy captured. ⚠ Asserts single-ness on the way past: a JSON object
 *  split across lines is NOT reassembled by Cloud Logging — each line becomes its own plain-text
 *  entry, which is the whole failure this format exists to avoid. */
function costLine(spy: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  const calls = spy.mock.calls.flat().map(String)
  expect(calls).toHaveLength(1)
  const raw = calls[0] as string
  expect(raw).not.toContain('\n')
  return JSON.parse(raw) as Record<string, unknown>
}

describe('the plan_spend cost line', () => {
  test('a served turn emits ONE line of JSON carrying both model names', async () => {
    const info = spyOn(console, 'info')
    let line: Record<string, unknown>
    try {
      await runPlannerTurn(baseArgs(fakeClient({ stop_reason: 'end_turn', content: [textBlock('hi')] })))
      line = costLine(info) // ⚠ read BEFORE mockRestore, which clears .mock.calls
    } finally {
      info.mockRestore()
    }

    // ⚠ The event name is HARDCODED on purpose, unlike the caps above. It is an operator-facing wire
    // name — a saved Cloud Logging query and a metric filter are pinned to this exact string, the same
    // way a URL path is. Importing a constant here would let a rename pass green and silently orphan
    // every dashboard built on it.
    expect(line.evt).toBe('plan_spend')
    expect(line.outcome).toBe('served')
    expect(line.severity).toBe('INFO')

    // ⚠ TWO FIELDS, TWO MEANINGS. `model` is the PRICING key — the alias MODEL_PRICING and the tally are
    // both keyed on — and `served_by` is the vendor's echo, which may resolve to a longer id. Pricing
    // the echo tallies $0 under a second, unpriced key, and the drift guard cannot catch it because it
    // only validates the ids we REQUEST. The inequality is the assertion that keeps them separate.
    expect(line.model).toBe(CLAUDE_MODELS.planner)
    expect(line.served_by).toBe('claude-opus-5-99991231')
    expect(line.model).not.toBe(line.served_by)

    expect(line.stop_reason).toBe('end_turn')
    expect(line.in).toBe(10)
    expect(line.out).toBe(5)

    // ⚠ A JSON NUMBER, NOT `"$0.000175"`. A distribution metric reads an already-numeric jsonPayload
    // field with no extractor regex; a currency-prefixed string needs one, and that regex starts
    // matching nothing the day someone tidies the prefix — the metric goes quiet, not red.
    expect(typeof line.usd).toBe('number')
    expect(line.usd).toBeCloseTo(10 * 5e-6 + 5 * 25e-6, 9) // priced off MODEL_PRICING[planner]
  })

  // ⚠ INV-13, AND THIS IS THE FILE'S ONLY PROOF OF IT. Every field on the line is meant to be a count,
  // an id or a closed enum — nothing that CAN hold prose. The two distinctive strings below are the two
  // things that must never be logged: what the rider typed, and what the skipper said back.
  test('the line carries no rider prose and no model prose (INV-13)', async () => {
    const RIDER = 'zqx-rider-typed-this'
    const SAY = 'zqx-skipper-said-this'
    const info = spyOn(console, 'info')
    let raw = ''
    try {
      await runPlannerTurn({
        ...baseArgs(fakeClient({ stop_reason: 'end_turn', content: [textBlock(SAY)] })),
        turns: [{ role: 'rider', text: RIDER }],
      })
      raw = info.mock.calls.flat().map(String).join('\n')
    } finally {
      info.mockRestore()
    }

    expect(raw).not.toContain(RIDER)
    expect(raw).not.toContain(SAY)
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
    let line: Record<string, unknown> = {}
    let errCount = -1
    try {
      err = await runPlannerTurn({ ...baseArgs(client), signal: ac.signal }).catch((e: unknown) => e)
      // ⚠ READ THE RECORD BEFORE RESTORING. bun's mockRestore() clears `.mock.calls`, so a spy read
      // after restore reports NOTHING — which turns an "it must not be logged" assertion into a test
      // that can never fail. (It did. That is why this comment exists.)
      line = costLine(info)
      errCount = errSpy.mock.calls.length
    } finally {
      info.mockRestore()
      errSpy.mockRestore()
    }

    expect((err as PlannerTurnError).reason).toBe('client_gone')
    // Same event as a served turn, so a spend total is a SUM over one `evt` rather than a union of
    // three greps — which is exactly what a cancellation logged under its own wording used to force.
    expect(line.evt).toBe('plan_spend')
    // The spend reached the line: `message_start` landed, output accumulated, then the rider left.
    expect(line.out).toBe(3)
    expect(typeof line.usd).toBe('number')

    // ⚠ A RIDER CLOSING THE APP IS NOT AN OUTAGE, and this is the assertion that says so. It used to
    // read `expect(logged).not.toContain('failed')`; the rule did not change when the format did, only
    // where it is written down. An operator alerts on the failure bucket — by `outcome` and by the
    // severity Cloud Logging lifts out of the payload — so a cancellation filed there is how a
    // perfectly healthy service looks like it is on fire the day the app gets popular.
    expect(line.outcome).toBe('cancelled')
    expect(line.outcome).not.toBe('failed')
    expect(line.severity).toBe('INFO')
    // ...and it must not reach stderr either, which is where every local log tail is looking.
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
    let line: Record<string, unknown> = {}
    try {
      err = await runPlannerTurn({ ...baseArgs(client), signal: new AbortController().signal }).catch((e: unknown) => e)
      line = costLine(errSpy) // before mockRestore clears it
    } finally {
      errSpy.mockRestore()
    }

    expect((err as PlannerTurnError).reason).toBe('timeout')
    expect(line.evt).toBe('plan_spend')
    expect(line.outcome).toBe('failed')
    expect(line.err).toBe('timeout')

    // ⚠ THE FAILURE LINE MUST CARRY ITS OWN SEVERITY. Cloud Run does NOT infer ERROR from stderr —
    // severity comes from this reserved field or the entry gets the default — so a JSON rewrite that
    // forgot it would silently DEMOTE the one line an operator pages on to look exactly like a healthy
    // turn, with nothing failing anywhere. `costLine` above already proves it went to console.error,
    // which is the half that local log tails and this spy read.
    expect(line.severity).toBe('ERROR')

    // The salvage applies here too: a turn that dies after message_start was billed for what it made.
    expect(line.out).toBe(3)
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

/* -------------------------------------------------------------------------- */
/* D12 — WHERE the wrap-up notice is rendered. This is a COST test.             */
/* -------------------------------------------------------------------------- */

// ⚠ THE FAILURE HERE IS INVISIBLE, exactly like planner-roster.test.ts's. The notice is volatile — it
// appears only on the tail of a long conversation — so if it were ever rendered BEFORE the cache
// breakpoint, or spliced into the prompt or the roster, the cached prefix would change on precisely the
// turns it shows up. Every response stays byte-identical, every other test stays green, and the only
// tell is `cr=0` in the cost line and the invoice. On an anonymous route that spends forever (INV-11),
// that is the expensive kind of silence — so the ORDER is asserted, not just the presence.
describe('D12: the wrap-up notice renders after the cache breakpoint', () => {
  const say = { stop_reason: 'end_turn', content: [textBlock('Where are you starting?')] }

  test('without a notice there are two blocks, and the LAST one carries the breakpoint', async () => {
    lastStreamParams = null
    await runPlannerTurn(baseArgs(fakeClient(say)))
    const system = lastCallParams().system ?? []
    expect(system.length).toBe(2)
    expect(system[0]?.text).toBe(PLANNER_SYSTEM_PROMPT)
    expect(system[0]?.cache_control).toBeUndefined()
    expect(system[1]?.cache_control).toEqual({ type: 'ephemeral' })
  })

  test('with a notice it is a THIRD block, after the breakpoint and uncached', async () => {
    lastStreamParams = null
    await runPlannerTurn({ ...baseArgs(fakeClient(say)), wrapUpNotice: PLANNER_WRAP_UP_NOTICE })
    const system = lastCallParams().system ?? []
    expect(system.length).toBe(3)

    // The prefix is UNCHANGED — the two blocks a normal turn sends are byte-identical here. This is the
    // assertion that actually costs money to break: it is what makes the notice free of cache impact.
    expect(system[0]?.text).toBe(PLANNER_SYSTEM_PROMPT)
    expect(system[1]?.cache_control).toEqual({ type: 'ephemeral' })

    // ...and the volatile block is LAST, and carries no breakpoint of its own (a second breakpoint on a
    // per-turn-varying block is the same bug wearing a different hat).
    expect(system[2]?.text).toBe(PLANNER_WRAP_UP_NOTICE)
    expect(system[2]?.cache_control).toBeUndefined()
  })

  // ⚠ Guards the OTHER direction of the same mistake: interpolating the notice into the prompt or the
  // roster instead of appending a block. That would satisfy "the model was told" while destroying the
  // prefix, so presence alone is not enough — the first two blocks must not CONTAIN it either.
  // ⚠ THE CANARY CANNOT BE "near its end". That phrase is SHARED: the prompt's `== Wrapping up ==`
  // section says "or you are told the conversation is near its end", which is the listener half of the
  // coupling the notice's opening line completes. An earlier draft of this test asserted on it and went
  // red against correct code. Assert on the whole notice, plus a fragment only the notice has.
  test('the notice is never spliced into the cached prefix', async () => {
    lastStreamParams = null
    await runPlannerTurn({ ...baseArgs(fakeClient(say)), wrapUpNotice: PLANNER_WRAP_UP_NOTICE })
    const system = lastCallParams().system ?? []
    for (const block of [system[0], system[1]]) {
      expect(String(block?.text)).not.toContain(PLANNER_WRAP_UP_NOTICE)
      expect(String(block?.text)).not.toContain('there was a clock')
    }
  })
})
