// Tests for the live planner (build step 6). Three things are worth pinning, and only three:
// the prompt still says what makes it safe, the six-outcome classifier maps the finish reason
// correctly, and the transcript caps hold.
//
// ⚠ NONE OF THIS SPENDS. `runPlannerTurn` takes an injected client (the `client` field on
// PlannerModelArgs) precisely so the classifier — the entire reason planner.ts exists — is reachable
// without a network call or an API key. A module-private client would mean the logic deciding whether
// a rider's "yes" becomes a drive could only ever be exercised by paying for it.
//
// ⚠ What these tests deliberately do NOT cover: the rate limiters. `rateLimit()` returns next()
// unconditionally under NODE_ENV=test, which is every sanctioned invocation — so a test asserting a
// 429 would assert nothing. The limiters are verified by probe instead (see limits.ts).

import { afterEach, beforeEach, describe, expect, setSystemTime, spyOn, test } from 'bun:test'
import { ApiError, FunctionCallingConfigMode, ThinkingLevel } from '@google/genai'
import { LLM_MAX_OUTPUT_TOKENS, LLM_MODELS } from '@skipper/shared'
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
  test('an example exchange carries beats AFTER the draw', () => {
    const section = PLANNER_SYSTEM_PROMPT.slice(PLANNER_SYSTEM_PROMPT.indexOf('== One example exchange =='))
    expect(section).toContain('<example>')
    const blocks = [...section.matchAll(/<example>([\s\S]*?)<\/example>/g)].map((m) => m[1]!)
    // ⚠ ASSERTED ON THE BLOCK THAT MODELS THE POST-DRAW BEATS, not across the whole section, so that a
    // future second example cannot satisfy the counts while THIS block is gutted. That is not
    // hypothetical: four examples were tried on 2026-08-04 (see the prompt's own note on why they were
    // reverted), and under an aggregate count the assertion would have passed on the new ones alone.
    const withTail = blocks.find((b) => b.includes('whole of my paperwork'))
    expect(withTail).toBeDefined()
    expect((withTail!.match(/^Them:/gm) ?? []).length).toBeGreaterThanOrEqual(4)
    expect(withTail!.trimEnd().split('\n').filter((l) => l.startsWith('You:')).length).toBeGreaterThanOrEqual(4)
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
    const props = PLAN_ROUTE_TOOL.parameters.properties as Record<string, { type: string }>
    expect(props.say?.type).toBe('string')
    expect(PLAN_ROUTE_TOOL.parameters.required).toContain('say')
  })

  test('every field the handler translates exists, and only the endpoints and the line are required', () => {
    // These names are the MODEL's vocabulary, deliberately not the wire DTO's camelCase — toPlannedRoute
    // (./plan-route) reads exactly these keys, so a rename here is a silently dropped route.
    const props = PLAN_ROUTE_TOOL.parameters.properties as Record<string, unknown>
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
    expect(PLAN_ROUTE_TOOL.parameters.required).toEqual(['say', 'start_anchor_id', 'end_anchor_id'])
  })

  test('the via cap leaves room for the TWO waypoints the server APPENDS', () => {
    // A round trip maps to `{ start, end: start, via: [...via, end, return] }` — the turnaround AND the
    // way home (2026-08-03, no-same-road loops) — so a model that filled `via` to this tool's brim must
    // still clear the shared wire cap. Otherwise toPlannedRoute drops the whole route and the rider
    // hears the retry line for a drive that was fine. It was `+ 1` while a loop appended only the
    // turnaround; the append grew and this bound has to grow with it.
    const via = PLAN_ROUTE_TOOL.parameters.properties as { via_anchor_ids: { maxItems: number } }
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
  config?: {
    maxOutputTokens?: unknown
    thinkingConfig?: { thinkingLevel?: unknown; includeThoughts?: unknown }
    toolConfig?: { functionCallingConfig?: { mode?: unknown } }
    tools?: { functionDeclarations?: { name?: unknown; parametersJsonSchema?: unknown }[] }[]
    /** The system-instruction parts, in render order. ⚠ Captured for D12: WHERE the wrap-up notice sits
     *  relative to the stable prefix is a cost property with no other observable — see the block at the
     *  bottom. */
    systemInstruction?: { parts?: { text?: unknown }[] }
  }
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

/** What a scripted turn streams back, in Gemini's vocabulary: the reply's parts, its finish reason and
 *  (optionally) a prompt-level block. */
interface Scripted {
  finish?: string
  parts?: unknown[]
  blockReason?: string
  /** Defaults to 10 prompt / 3 visible / 2 thinking — non-zero so a dropped recording reads as $0. */
  usage?: Record<string, number>
}

/** The chunks a real stream would deliver for `reply`: every text part in its own chunk first (so
 *  streaming is actually exercised), then one closing chunk with the non-text parts, the finish reason
 *  and the usage — which is where the live API puts usage (probed 2026-09-23: earlier chunks carry
 *  `trafficType` only). */
function chunksFor(reply: Scripted): unknown[] {
  const parts = reply.parts ?? []
  const texts = parts.filter((p) => typeof (p as { text?: unknown }).text === 'string')
  const rest = parts.filter((p) => typeof (p as { text?: unknown }).text !== 'string')
  // ⚠ DELIBERATELY NOT `LLM_MODELS.planner`. This is the vendor's ECHO, which the API is not bound to
  // return verbatim as the id we asked for. A fixture where the two are equal makes "the pricing key and
  // the echo are separate fields" unfalsifiable, which is exactly the conflation the cost line prevents.
  const meta = { modelVersion: 'gemini-3.8-flash-001', responseId: 'resp_test' }
  return [
    ...texts.map((t) => ({ ...meta, candidates: [{ content: { role: 'model', parts: [t] } }], usageMetadata: { trafficType: 'ON_DEMAND' } })),
    {
      ...meta,
      ...(reply.blockReason ? { promptFeedback: { blockReason: reply.blockReason } } : {}),
      candidates: reply.blockReason ? [] : [{ content: { role: 'model', parts: rest }, ...(reply.finish ? { finishReason: reply.finish } : {}) }],
      usageMetadata: reply.usage ?? { promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 2 },
    },
  ]
}

async function* streamOf(chunks: unknown[]): AsyncGenerator<unknown> {
  for (const c of chunks) yield c
}

/** A stand-in for the SDK's streaming client. Structurally compatible with what runPlannerTurn uses,
 *  which is the whole benefit of the injected seam being a structural `PlannerClient` rather than a
 *  concrete class: no SDK instance, no credentials, no network. */
function fakeClient(reply: Scripted) {
  return {
    models: {
      generateContentStream: async (params: StreamParams) => {
        lastStreamParams = params
        return streamOf(chunksFor(reply))
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

const textPart = (text: string) => ({ text })
const callPart = (name: string, args: unknown) => ({ functionCall: { id: 'call_1', name, args }, thoughtSignature: 'c2ln' })

describe('planner outcome classification', () => {
  test('text with no function call is a normal conversational beat', async () => {
    const turn = await runPlannerTurn(baseArgs(fakeClient({ finish: 'STOP', parts: [textPart('Where are you starting?')] })))
    expect(turn.outcome).toBe('say')
    expect(turn.say).toBe('Where are you starting?')
    expect(turn.rawRoute).toBeNull()
  })

  test('a function call is the ONLY outcome that carries a route', async () => {
    const turn = await runPlannerTurn(
      baseArgs(
        fakeClient({
          // Gemini finishes a reply that carries a call with STOP — there is no tool_use finish (probed).
          finish: 'STOP',
          parts: [textPart('Drawing that up.'), callPart('plan_route', { start_anchor_id: 'a', end_anchor_id: 'b' })],
        }),
      ),
    )
    expect(turn.outcome).toBe('route')
    expect(turn.rawRoute).toEqual({ start_anchor_id: 'a', end_anchor_id: 'b' })
  })

  // ⚠ THE WORDLESS-DRAW FIX. Measured 2026-08-03 on Claude, and the 2026-09-23 Gemini probe did the
  // same: on a draw turn the model emits the call and NO text part at all, so the rider heard the
  // server's one fixed fallback instead of their drive said back. `say` is a required tool field and
  // gets unwrapped here.
  test('the line is unwrapped from the call when no text part came back', async () => {
    const turn = await runPlannerTurn(
      baseArgs(fakeClient({ finish: 'STOP', parts: [callPart('plan_route', { say: 'There she is.', start_anchor_id: 'a', end_anchor_id: 'b' })] })),
    )
    expect(turn.outcome).toBe('route')
    expect(turn.say).toBe('There she is.')
  })

  test('a REAL text part still wins over the tool field', async () => {
    // A model that speaks both ways must not have the streamed prose overridden by the call's copy.
    const turn = await runPlannerTurn(
      baseArgs(
        fakeClient({
          finish: 'STOP',
          parts: [textPart('Streamed line.'), callPart('plan_route', { say: 'Tool line.', start_anchor_id: 'a', end_anchor_id: 'b' })],
        }),
      ),
    )
    expect(turn.say).toBe('Streamed line.')
  })

  test('a non-string say reads as ABSENT rather than reaching the rider', async () => {
    // `args` is model output. A cast here would put "[object Object]" in the bubble.
    const turn = await runPlannerTurn(
      baseArgs(fakeClient({ finish: 'STOP', parts: [callPart('plan_route', { say: { oops: 1 }, start_anchor_id: 'a', end_anchor_id: 'b' })] })),
    )
    expect(turn.say).toBe('')
  })

  // ⚠ A call with the WRONG name is not a route. This is not hypothetical — writing these tests with a
  // made-up tool name is exactly how it was found, and a renamed tool that still "worked" would mean the
  // classifier was matching on shape rather than identity.
  test('a call with an unrecognised name is not a route', async () => {
    const turn = await runPlannerTurn(
      baseArgs(fakeClient({ finish: 'STOP', parts: [textPart('Hmm.'), callPart('something_else', { start_anchor_id: 'a' })] })),
    )
    expect(turn.rawRoute).toBeNull()
  })

  // Gemini has no `disable_parallel_tool_use`, so two calls in one turn are possible. "The route" must
  // still be exactly one, and deterministic.
  test('two plan_route calls in one turn: the FIRST is the route', async () => {
    const turn = await runPlannerTurn(
      baseArgs(
        fakeClient({
          finish: 'STOP',
          parts: [
            callPart('plan_route', { say: 'First.', start_anchor_id: 'a', end_anchor_id: 'b' }),
            callPart('plan_route', { say: 'Second.', start_anchor_id: 'c', end_anchor_id: 'd' }),
          ],
        }),
      ),
    )
    expect(turn.rawRoute).toEqual({ say: 'First.', start_anchor_id: 'a', end_anchor_id: 'b' })
  })

  // ⚠ THE ONE THAT MATTERS MOST. A truncated turn is HTTP 200 with a half-formed call or none at all —
  // byte-identical, from the caller's side, to "the planner chose not to route this turn". One is a
  // normal chat beat; the other is a paid call that produced nothing. Conflating them is how a rider
  // says yes and watches nothing happen.
  test('MAX_TOKENS is TRUNCATED, not a route, even when a call is present', async () => {
    const turn = await runPlannerTurn(
      baseArgs(
        fakeClient({
          finish: 'MAX_TOKENS',
          parts: [textPart('Alright, so we start at'), callPart('plan_route', { start_anchor_id: 'a' })],
        }),
      ),
    )
    expect(turn.outcome).toBe('truncated')
    // The partial call is discarded unread — a half-drawn route must never reach the rider.
    expect(turn.rawRoute).toBeNull()
    // ...but the words the rider already watched stream are kept.
    expect(turn.say).toContain('Alright')
  })

  test('a safety finish is REFUSED and never carries an explanation', async () => {
    const turn = await runPlannerTurn(baseArgs(fakeClient({ finish: 'SAFETY', parts: [] })))
    expect(turn.outcome).toBe('refused')
    expect(turn.say).toBe('')
  })

  // A prompt blocked before generation arrives with NO candidate at all — only a block reason. Reading
  // it as "no finish" would call it an outage.
  test('a blocked PROMPT is refused, not aborted', async () => {
    const turn = await runPlannerTurn(baseArgs(fakeClient({ blockReason: 'PROHIBITED_CONTENT' })))
    expect(turn.outcome).toBe('refused')
  })

  // Gemini's structured version of the leak ./tool-call-leak guards against in prose: the model TRIED to
  // call and produced something unexecutable. Nothing in it is trustworthy, and the exact finish rides
  // stopReason so it stays measurable in the cost line.
  test('MALFORMED_FUNCTION_CALL is aborted, never a route', async () => {
    const turn = await runPlannerTurn(
      baseArgs(fakeClient({ finish: 'MALFORMED_FUNCTION_CALL', parts: [callPart('plan_route', { start_anchor_id: 'a', end_anchor_id: 'b' })] })),
    )
    expect(turn.outcome).toBe('aborted')
    expect(turn.rawRoute).toBeNull()
    expect(turn.stopReason).toBe('MALFORMED_FUNCTION_CALL')
  })

  test('a stream that ends with NO finish reason is aborted', async () => {
    const turn = await runPlannerTurn(baseArgs(fakeClient({ parts: [textPart('And then we')] })))
    expect(turn.outcome).toBe('aborted')
  })

  test('a clean end with neither text nor route is EMPTY, not a silent success', async () => {
    const turn = await runPlannerTurn(baseArgs(fakeClient({ finish: 'STOP', parts: [] })))
    expect(turn.outcome).toBe('empty')
  })

  // Text streams to the caller as it lands, chunk by chunk — and a sink that throws (an SSE write to a
  // socket the rider just closed) must not turn a paid, finished turn into an "upstream" failure.
  test('text streams through onSay, and a throwing sink does not fail the turn', async () => {
    const seen: string[] = []
    const turn = await runPlannerTurn({
      ...baseArgs(fakeClient({ finish: 'STOP', parts: [textPart('Where '), textPart('to?')] })),
      onSay: (d) => {
        seen.push(d)
        throw new Error('socket closed')
      },
    })
    expect(seen).toEqual(['Where ', 'to?'])
    expect(turn.outcome).toBe('say')
    expect(turn.say).toBe('Where to?')
  })
})

/* -------------------------------------------------------------------------- */
/* The call parameters — what this request actually bills (INV-11 / INV-8).     */
/* -------------------------------------------------------------------------- */

describe('the model call this route bills', () => {
  // ⚠ INV-11/INV-12: this call spends on EVERY anonymous request, forever, and its only in-code guards
  // are the explicit model and `maxOutputTokens`. Both were previously asserted nowhere — the fake
  // discarded the request. ⚠ Read from the CONSTANTS, never their values: a test that hardcodes 2_048
  // turns a deliberate cap change into a test failure while a REPOINTED cap sails through.
  test('it bills the planner model at the capped token budget', async () => {
    lastStreamParams = null
    await runPlannerTurn(baseArgs(fakeClient({ finish: 'STOP', parts: [textPart('hi')] })))
    const params = lastCallParams()

    // Not `LLM_MODELS.quality` — that key is the studio pipeline's model, and repointing this one at it
    // changes what a fail-closed eval gate is calibrated against as a side effect of a "constant edit".
    expect(params.model).toBe(LLM_MODELS.planner)
    expect(params.config?.maxOutputTokens).toBe(PLANNER_MAX_TOKENS)
  })

  // limits.ts imports nothing on purpose, so the planner's cap is its own literal — and it must still be
  // the shared model ceiling every other call uses (founder, 2026-09-23: "significantly bump caps").
  test('the planner cap is the shared model ceiling, not a smaller hand-kept number', () => {
    expect(PLANNER_MAX_TOKENS).toBe(LLM_MAX_OUTPUT_TOKENS)
  })

  // ⚠ INV-8. On Claude this pinned "thinking present AND not disabled", because with thinking off the
  // model could write a tool call into VISIBLE TEXT — a silent wrong answer no classifier test can see.
  // Gemini 3.8 has no "off", so what remains to pin is that a depth IS set (the production value, not an
  // accidental default) and that thoughts are NEVER requested: rider-facing text must not carry reasoning.
  test('thinking depth is set explicitly, and thoughts are never requested (INV-8)', async () => {
    lastStreamParams = null
    await runPlannerTurn(baseArgs(fakeClient({ finish: 'STOP', parts: [textPart('hi')] })))
    const thinking = lastCallParams().config?.thinkingConfig
    // The ONE exception to the founder's always-HIGH rule (2026-09-23): the planner runs LOW — measured
    // equal on every eval gate and 2-4x faster to the first word. Read through the shared
    // PLANNER_THINKING_LEVEL, so the exception lives in one named place.
    expect(thinking?.thinkingLevel).toBe(ThinkingLevel.LOW)
    expect(thinking?.includeThoughts).not.toBe(true)
  })

  test('the effort seam maps onto thinking depth, one value per run', async () => {
    lastStreamParams = null
    await runPlannerTurn({ ...baseArgs(fakeClient({ finish: 'STOP', parts: [textPart('hi')] })), effort: 'low' })
    expect(lastCallParams().config?.thinkingConfig?.thinkingLevel).toBe(ThinkingLevel.LOW)
  })

  // VALIDATED lets the model talk OR call (a forced call would invent route fields on a chat turn) and,
  // unlike AUTO, enforces the schema and its required fields — `say` among them, which the wordless-draw
  // fix depends on. The declaration must be the prompt module's tool verbatim (INV-10: it is prompt surface).
  test('the route function is offered in VALIDATED mode, declared verbatim from the prompt module', async () => {
    lastStreamParams = null
    await runPlannerTurn(baseArgs(fakeClient({ finish: 'STOP', parts: [textPart('hi')] })))
    const config = lastCallParams().config
    expect(config?.toolConfig?.functionCallingConfig?.mode).toBe(FunctionCallingConfigMode.VALIDATED)
    const decl = config?.tools?.[0]?.functionDeclarations?.[0]
    expect(decl?.name).toBe(PLAN_ROUTE_TOOL.name)
    expect(decl?.parametersJsonSchema).toBe(PLAN_ROUTE_TOOL.parameters)
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
  // ⚠ The rate below is Gemini 3.8 Flash's INTRODUCTORY one, which PRICE_CHANGES doubles on a published
  // date. Pinning the clock keeps this test about the line's arithmetic instead of about today's date —
  // a hard-coded rate plus a live clock is a test that goes red on New Year's Day for no reason.
  beforeEach(() => setSystemTime(new Date('2026-09-23T12:00:00Z')))
  afterEach(() => setSystemTime())

  test('a served turn emits ONE line of JSON carrying both model names', async () => {
    const info = spyOn(console, 'info')
    let line: Record<string, unknown>
    try {
      await runPlannerTurn(baseArgs(fakeClient({ finish: 'STOP', parts: [textPart('hi')] })))
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

    // ⚠ TWO FIELDS, TWO MEANINGS. `model` is the PRICING key — the id MODEL_PRICING and the tally are
    // both keyed on — and `served_by` is the vendor's echo, which may differ. Pricing the echo tallies $0
    // under a second, unpriced key, and the drift guard cannot catch it because it only validates the ids
    // we REQUEST. The inequality is the assertion that keeps them separate.
    expect(line.model).toBe(LLM_MODELS.planner)
    expect(line.served_by).toBe('gemini-3.8-flash-001')
    expect(line.model).not.toBe(line.served_by)

    expect(line.stop_reason).toBe('STOP')
    expect(line.usage_reported).toBe(true)
    expect(line.in).toBe(10)
    // Thinking bills as output: 3 visible + 2 thinking.
    expect(line.out).toBe(5)
    expect(line.thinking).toBe(2)

    // ⚠ A JSON NUMBER, NOT `"$0.000175"`. A distribution metric reads an already-numeric jsonPayload
    // field with no extractor regex; a currency-prefixed string needs one, and that regex starts
    // matching nothing the day someone tidies the prefix — the metric goes quiet, not red.
    expect(typeof line.usd).toBe('number')
    // 10 in × $0.825/MTok + 5 out × $4.125/MTok — Gemini 3.8 Flash on the `us` multi-region (the
    // non-global rate, +10%). Hard-coded rather than read off MODEL_PRICING so a repriced planner row is a
    // red test here, not a silent shift. The line rounds to 6 decimals (micro-dollars).
    expect(line.usd).toBe(Math.round((10 * 0.825e-6 + 5 * 4.125e-6) * 1e6) / 1e6)
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
        ...baseArgs(fakeClient({ finish: 'STOP', parts: [textPart(SAY)] })),
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
      models: {
        generateContentStream: async () => {
          calls.n++
          return streamImpl()
        },
      },
    } as unknown as NonNullable<PlannerModelArgs['client']>
    return { client, calls }
  }

  /** What the SDK throws when its fetch is aborted — for the rider, for our deadline, and for its own
   *  per-attempt timeout alike: a bare `controller.abort()`, so a reason-less AbortError. */
  const abortError = () => new DOMException('This operation was aborted', 'AbortError')

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

  // The turn reported usage and then the rider left. That spend has to reach the tally, and it has to be
  // logged as a cancellation rather than an outage.
  test('a rider who leaves mid-stream is client_gone, and reported spend is salvaged', async () => {
    const ac = new AbortController()
    const { client } = countingClient(() =>
      (async function* () {
        yield { candidates: [{ content: { role: 'model', parts: [{ text: 'Well now' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 } }
        // Abort AFTER the call is open, which is the real sequence: the composite signal is built first,
        // then the request goes out, then the rider hits back.
        ac.abort()
        throw abortError()
      })(),
    )

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
    // The reported spend reached the line.
    expect(line.usage_reported).toBe(true)
    expect(line.out).toBe(3)
    expect(typeof line.usd).toBe('number')

    // ⚠ A RIDER CLOSING THE APP IS NOT AN OUTAGE, and this is the assertion that says so. An operator
    // alerts on the failure bucket — by `outcome` and by the severity Cloud Logging lifts out of the
    // payload — so a cancellation filed there is how a perfectly healthy service looks like it is on
    // fire the day the app gets popular.
    expect(line.outcome).toBe('cancelled')
    expect(line.outcome).not.toBe('failed')
    expect(line.severity).toBe('INFO')
    // ...and it must not reach stderr either, which is where every local log tail is looking.
    expect(errCount).toBe(0)
  })

  // ⚠ THE COMMON CASE ON GEMINI: usage arrives on the FINAL chunk only, so a turn cut off mid-stream has
  // no counts to salvage. The line must say "unknown", never let zeros read as a free turn.
  test('a cancellation with no reported usage is logged as unreported, not as free', async () => {
    const ac = new AbortController()
    const { client } = countingClient(() =>
      (async function* () {
        yield { candidates: [{ content: { role: 'model', parts: [{ text: 'Well now' }] } }], usageMetadata: { trafficType: 'ON_DEMAND' } }
        ac.abort()
        throw abortError()
      })(),
    )
    const info = spyOn(console, 'info')
    let line: Record<string, unknown> = {}
    try {
      await runPlannerTurn({ ...baseArgs(client), signal: ac.signal }).catch(() => null)
      line = costLine(info)
    } finally {
      info.mockRestore()
    }
    expect(line.outcome).toBe('cancelled')
    expect(line.usage_reported).toBe(false)
    expect(line.usd).toBe(0)
  })

  // ⚠ REGRESSION GUARD. Without this, the branch above can quietly swallow the REAL timeout path —
  // the two are told apart only by asking the rider's own signal whether it aborted.
  test('a genuine vendor timeout is still a timeout when the rider is still there', async () => {
    const { client } = countingClient(() =>
      (async function* () {
        yield { candidates: [{ content: { role: 'model', parts: [{ text: 'Well' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 } }
        throw abortError()
      })(),
    )

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

    // The salvage applies here too: a turn that reported usage before dying was billed for it.
    expect(line.out).toBe(3)
  })

  // ⚠ INV-13 on the failure path. `ApiError.message` IS the raw response body, JSON-stringified — it can
  // quote the offending request field, i.e. rider text. Only the status and OUR class for it may land.
  test('a vendor HTTP error logs its status class and never its body', async () => {
    const LEAK = 'zqx-body-quoting-rider-text'
    const { client } = countingClient(() => {
      throw new ApiError({ message: JSON.stringify({ error: { message: LEAK } }), status: 429 })
    })
    const errSpy = spyOn(console, 'error')
    let err: unknown
    let raw = ''
    let line: Record<string, unknown> = {}
    try {
      err = await runPlannerTurn(baseArgs(client)).catch((e: unknown) => e)
      raw = errSpy.mock.calls.flat().map(String).join('\n')
      line = costLine(errSpy)
    } finally {
      errSpy.mockRestore()
    }
    expect((err as PlannerTurnError).reason).toBe('upstream')
    expect(line.err).toBe('rate_limited')
    expect(line.status).toBe(429)
    expect(line.usage_reported).toBe(false)
    expect(raw).not.toContain(LEAK)
    expect((err as Error).message).not.toContain(LEAK)
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
// appears only on the tail of a long conversation — so if it were ever rendered BEFORE the stable prefix
// ends, or spliced into the prompt or the roster, the prefix would change on precisely the turns it shows
// up. Every response stays byte-identical, every other test stays green, and the only tell is
// `cache_read: 0` in the cost line and the invoice. On an anonymous route that spends forever (INV-11),
// that is the expensive kind of silence — so the ORDER is asserted, not just the presence. (Gemini's
// cache is implicit — a common request PREFIX, no breakpoints — so order is the whole of the property.)
describe('D12: the wrap-up notice renders after the stable prefix', () => {
  const say = { finish: 'STOP', parts: [textPart('Where are you starting?')] }
  const parts = () => lastCallParams().config?.systemInstruction?.parts ?? []

  test('without a notice there are two parts: the prompt, then the roster', async () => {
    lastStreamParams = null
    await runPlannerTurn(baseArgs(fakeClient(say)))
    const system = parts()
    expect(system.length).toBe(2)
    expect(system[0]?.text).toBe(PLANNER_SYSTEM_PROMPT)
    expect(String(system[1]?.text)).toContain('Tahoe City')
  })

  test('with a notice it is a THIRD part, after the stable prefix', async () => {
    lastStreamParams = null
    await runPlannerTurn(baseArgs(fakeClient(say)))
    const plain = parts().map((p) => p.text)
    lastStreamParams = null
    await runPlannerTurn({ ...baseArgs(fakeClient(say)), wrapUpNotice: PLANNER_WRAP_UP_NOTICE })
    const system = parts()
    expect(system.length).toBe(3)

    // The prefix is UNCHANGED — the two parts a normal turn sends are byte-identical here. This is the
    // assertion that actually costs money to break: it is what makes the notice free of cache impact.
    expect(system.slice(0, 2).map((p) => p.text)).toEqual(plain)

    // ...and the volatile part is LAST.
    expect(system[2]?.text).toBe(PLANNER_WRAP_UP_NOTICE)
  })

  // ⚠ Guards the OTHER direction of the same mistake: interpolating the notice into the prompt or the
  // roster instead of appending a part. That would satisfy "the model was told" while destroying the
  // prefix, so presence alone is not enough — the first two parts must not CONTAIN it either.
  // ⚠ THE CANARY CANNOT BE "near its end". That phrase is SHARED: the prompt's `== Wrapping up ==`
  // section says "or you are told the conversation is near its end", which is the listener half of the
  // coupling the notice's opening line completes. An earlier draft of this test asserted on it and went
  // red against correct code. Assert on the whole notice, plus a fragment only the notice has.
  test('the notice is never spliced into the stable prefix', async () => {
    lastStreamParams = null
    await runPlannerTurn({ ...baseArgs(fakeClient(say)), wrapUpNotice: PLANNER_WRAP_UP_NOTICE })
    const system = parts()
    for (const block of [system[0], system[1]]) {
      expect(String(block?.text)).not.toContain(PLANNER_WRAP_UP_NOTICE)
      expect(String(block?.text)).not.toContain('there was a clock')
    }
  })
})
