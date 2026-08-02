// POST /drives/plan — the SSE half (build step 7).
//
// WHAT THIS FILE IS FOR, in one line: the frame format IS the contract with apps/mobile, and there is
// no compiler between the two ends of it. Every assertion below is either "the JSON path did not move"
// or "these exact bytes still leave the server".
//
// ⚠ NONE OF THIS SPENDS. ../src/planner is the ONE module in this path that imports the Anthropic SDK
// (that quarantine is stated at the top of the file and is exactly what this test consumes), so mocking
// it leaves the REAL handler, the REAL caps, the REAL negotiation branch and the REAL route translation
// running with no network and no key.
//
// ⚠⚠ MODULE MOCKS **DO** LEAK BETWEEN TEST FILES UNDER BUN. An earlier draft of this header claimed
// the opposite on the strength of a probe, and it was WRONG in the way that matters: `bun test` runs
// every file in ONE process against ONE module registry, so a bare `mock.module('../src/planner', …)`
// here replaced the module for `planner.test.ts` too. Measured 2026-08-01: each file green in
// isolation, and the full suite 96 pass / **9 fail** — the entire six-outcome classifier and all three
// cancellation tests, timing out against this file's leftover stub. `bun run check` was red.
//
// ⚠ AND THE LOUD FAILURE WAS LUCK. Those 9 died only because the last stub left behind was a promise
// that never resolves. Had it resolved, they would have PASSED while exercising a mock — the exact
// "green test, deleted implementation" failure this repo mutation-checks for, with nothing to notice it.
//
// So every mock below obeys two rules, and neither is optional:
//   1. SPREAD THE REAL MODULE. A partial mock is a load-time landmine for any file that imports an
//      export the mock omits (`SyntaxError: Export named 'buildRosterBlock' not found`).
//   2. DELEGATE WHEN NOT OVERRIDDEN. `impl` is null except inside a test that set it, so a later file
//      calling `runPlannerTurn` reaches the REAL one.
//
// ⚠ INV-13: this file asserts an ABSENCE — a vendor error string must reach neither the rider's body
// nor the process log. That is the assertion that catches someone "helpfully" passing hono an onError.

import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { drivePlanResponse, plannedRoute } from '@skipper/shared'
import {
  checkTranscript,
  MAX_PLAN_BODY_BYTES,
  MAX_PLAN_MESSAGE_CHARS,
  MAX_PLAN_MESSAGES,
  MAX_PLAN_TOTAL_CHARS,
  PLAN_WRAP_UP_AFTER_MESSAGES,
} from '../src/limits'
// ⚠ Safe to import statically alongside ../src/limits: ../src/planner-prompt imports NOTHING by design,
// so it reaches neither ./auth's module-load throw nor the SDK. If this ever needs a seed, that is the bug.
import { PLANNER_WRAP_UP_NOTICE } from '../src/planner-prompt'

/* -------------------------------------------------------------------------- */
/* Harness. Mocks FIRST — plan-route.ts's static imports resolve through them.  */
/* -------------------------------------------------------------------------- */

// The real ./drives reaches ./entitlements -> ./auth, which throws at module load without a secret, so
// seed one to snapshot it. Same value and same `??=` as cors.test.ts: it signs nothing, and seeding is
// strictly cheaper than shipping a partial mock of a module that also exports `driveRoutes` (which
// cors.test.ts's app import needs, whichever order bun happens to run these in).
process.env.BETTER_AUTH_SECRET ??= 'test-only-secret-that-signs-nothing-real'

const realDrives = { ...(await import('../src/drives')) }
mock.module('../src/drives', () => ({
  ...realDrives,
  loadRegionAnchors: async () => [{ id: '3582ed8a-a55e-4fb2-b8af-59dcd9eef16c', name: 'Tahoe City' }],
}))

/** The region read, stubbed. Mutable so a test can make the region vanish. */
let regionRows: unknown[] = [{ bbox: '-120.2,38.9,-119.9,39.3', name: 'Lake Tahoe' }]
// A self-returning proxy: every property access and every call yields itself, and awaiting it resolves
// `regionRows`. That covers `db.select({...}).from(x).where(y).limit(1)` without pinning the query's
// exact shape — this file is about frames, not about drizzle.
const chain: any = new Proxy(function () {} as any, {
  get: (_t, k) => (k === 'then' ? (res: (v: unknown) => unknown) => Promise.resolve(regionRows).then(res) : chain),
  apply: () => chain,
})
const realDb = { ...(await import('@skipper/db')) }
mock.module('@skipper/db', () => ({ ...realDb, db: chain, getDb: () => chain }))

const realPlanner = { ...(await import('../src/planner')) }
/** ⚠ THE REAL CLASS, not a look-alike. `plan-route.ts` branches on `err instanceof PlannerTurnError`,
 *  and a structurally identical stand-in fails that check silently — the client_gone branch would be
 *  dead code while every other test in this file still passed. Spreading the real module is what makes
 *  using the real class free. */
const { PlannerTurnError } = realPlanner

interface FakeArgs {
  onSay?: (delta: string) => void
  signal?: AbortSignal
  /** D12's wrap-up nudge. ⚠ OPTIONAL HERE ON PURPOSE, and the D12 section asserts `'wrapUpNotice' in
   *  args` rather than a truthiness check — the production shape is an ABSENT key on a normal turn, and
   *  a test that only checked for falsiness would pass against the bug this field shipped with. */
  wrapUpNotice?: string
}
/** ⚠ `stopReason` is carried even though the handler must never branch on it — it is what lets the
 *  plan_degraded tests below be mutation-checked against the adversarial review's literal
 *  `stop_reason !== 'tool_use'` condition with the REAL value a healthy turn would have ('end_turn'),
 *  instead of an undefined that trivially satisfies any inequality. */
type FakeTurn = { outcome: string; say: string; rawRoute: unknown; stopReason?: string | null }

/** The turn this test wants, or NULL to fall through to the real `runPlannerTurn`.
 *  ⚠ Null is the resting state and `afterEach` restores it. That is what keeps the leak documented at
 *  the top of this file harmless: a later test file calling `runPlannerTurn` gets the real one. */
let impl: ((a: FakeArgs) => Promise<FakeTurn>) | null = null
/** A holder plus a reader, rather than a bare `let`: every write happens inside the mock factory
 *  below, which the checker cannot see, so control-flow narrowing would otherwise collapse the field
 *  to `never` at the assertion site. Reading through a function resets that narrowing. */
const seen: { args: FakeArgs | null } = { args: null }
const lastPlannerArgs = (): FakeArgs => {
  if (!seen.args) throw new Error('runPlannerTurn was never called')
  return seen.args
}
mock.module('../src/planner', () => ({
  ...realPlanner,
  runPlannerTurn: (a: FakeArgs) => {
    seen.args = a
    // ⚠ Delegate when this file is not driving. Without this the stub outlives the file and answers
    // for planner.test.ts — see the header. The real call needs an injected client or a key, so it
    // behaves exactly as it would with no mock present.
    return impl ? impl(a) : realPlanner.runPlannerTurn(a as never)
  },
}))

/** ⚠ Belt to the delegate's braces: leave the registry entry inert the moment this file is done. */
afterEach(() => {
  impl = null
  seen.args = null
})
afterAll(() => {
  impl = null
})

const { planRoutes } = await import('../src/plan-route')

const SSE = 'text/event-stream'
const post = (body: unknown, accept?: string, init?: RequestInit) =>
  planRoutes.fetch(
    new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(accept ? { accept } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      ...init,
    }),
  )

const OK = { turns: [{ role: 'rider', text: 'plan me something scenic' }], regionId: crypto.randomUUID() }

/** Reset the mutable world. Each test owns its own turn; nothing is shared but the harness. */
function say(text: string, deltas: string[] = []): void {
  impl = async (a) => {
    for (const d of deltas) a.onSay?.(d)
    return { outcome: 'say', say: text, rawRoute: null }
  }
}

/* -------------------------------------------------------------------------- */
/* A — content negotiation.                                                     */
/* -------------------------------------------------------------------------- */

describe('POST /drives/plan — Accept negotiation', () => {
  test('no Accept header takes the JSON path, unchanged', async () => {
    say('Where are you starting?')
    const res = await post(OK)
    expect(res.headers.get('content-type')).toStartWith('application/json')
    expect(drivePlanResponse.parse(await res.json())).toEqual({ say: 'Where are you starting?', done: false })
  })

  // ⚠ THE "existing tests stay green" GUARANTEE, asserted rather than assumed. A 1.0 client and every
  // step-6 test send this (or nothing) and must get byte-identical JSON.
  test('Accept: application/json takes the JSON path', async () => {
    say('Still JSON.')
    const res = await post(OK, 'application/json')
    expect(res.headers.get('content-type')).toStartWith('application/json')
    expect(drivePlanResponse.parse(await res.json()).say).toBe('Still JSON.')
  })

  test('Accept: text/event-stream streams', async () => {
    say('Streaming.')
    const res = await post(OK, SSE)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    // The buffering opt-out for an intermediary we do not control. Nothing in-process needs it; a
    // proxy that holds our frames until close would make the whole feature invisible.
    expect(res.headers.get('x-accel-buffering')).toBe('no')
    await res.text()
  })

  // ⚠ Pins SUBSTRING matching. A client may legitimately send a list, and RN's fetch has historically
  // appended `*​/*`. An equality check here would silently drop every real device back to JSON.
  test('a compound Accept still streams', async () => {
    say('Streaming.')
    const res = await post(OK, 'text/event-stream, application/json')
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    await res.text()
  })
})

/* -------------------------------------------------------------------------- */
/* B — every PRE-STREAM path answers identically on both Accepts.               */
/* -------------------------------------------------------------------------- */

describe('POST /drives/plan — rejections are identical on both Accepts', () => {
  // ⚠ Assert the CONTENT-TYPE on every one of these, not just the status. A status-only assertion
  // passes even if the body were framed, which is precisely the regression this section exists for.
  const both: (string | undefined)[] = [undefined, SSE]

  test.each(both)('a body over the byte cap is a plain 413 (accept=%s)', async (accept) => {
    regionRows = [{ bbox: '-120.2,38.9,-119.9,39.3', name: 'Lake Tahoe' }]
    const res = await post('x'.repeat(MAX_PLAN_BODY_BYTES + 1), accept)
    expect(res.status).toBe(413)
    expect(res.headers.get('content-type')).toStartWith('application/json')
    expect(await res.text()).not.toContain('event:')
  })

  test.each(both)('invalid JSON is a plain 400 (accept=%s)', async (accept) => {
    const res = await post('{not json', accept)
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toStartWith('application/json')
    expect(((await res.json()) as { error?: string }).error).toBe('bad_request')
  })

  test.each(both)('a bad shape is a plain 400 (accept=%s)', async (accept) => {
    const res = await post({ turns: [], regionId: crypto.randomUUID() }, accept)
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toStartWith('application/json')
  })

  // The in-persona wrap-up. It is a 200 with `done: true`, and the CLIENT keys on `done` — it never
  // learns the number (INV-3/INV-12), which is the whole reason this is not a 4xx.
  test.each(both)('the transcript cap bows out in persona (accept=%s)', async (accept) => {
    const res = await post(
      { turns: Array.from({ length: MAX_PLAN_MESSAGES + 1 }, () => ({ role: 'rider', text: 'x' })), regionId: crypto.randomUUID() },
      accept,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toStartWith('application/json')
    const body = drivePlanResponse.parse(await res.json())
    expect(body.done).toBe(true)
    expect(body.say.length).toBeGreaterThan(0)
  })

  test.each(both)('an unknown region bows out in persona (accept=%s)', async (accept) => {
    regionRows = []
    try {
      const res = await post(OK, accept)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toStartWith('application/json')
      const body = drivePlanResponse.parse(await res.json())
      expect(body.done).toBe(true)
      expect(body.say.length).toBeGreaterThan(0)
    } finally {
      regionRows = [{ bbox: '-120.2,38.9,-119.9,39.3', name: 'Lake Tahoe' }]
    }
  })
})

/* -------------------------------------------------------------------------- */
/* B2 — the two transcript caps, and the ORDER they bind in.                    */
/* -------------------------------------------------------------------------- */

/** What actually goes on the wire for a body, in BYTES — never `.length`, which is UTF-16 code units
 *  and is the exact confusion these two caps exist to keep apart. */
const bodyBytes = (body: unknown): number => new TextEncoder().encode(JSON.stringify(body)).byteLength

describe('POST /drives/plan — the transcript caps bind in a deliberate ORDER', () => {
  const both: (string | undefined)[] = [undefined, SSE]
  const region = () => crypto.randomUUID()

  // ⚠ WHAT WAS MISSING, AND IT WAS THE HALF THAT MATTERS. planner.test.ts asserts checkTranscript's
  // RETURN VALUE for all three branches; nothing anywhere asserted what the HANDLER does with two of
  // them. Only 'too_many_turns' had ever reached the route (section B). The rule is the same for all
  // three: a rider mid-conversation with a character never meets a validator, so every cap is the
  // in-persona 200 with `done: true` and never a 4xx — and `done` is all the client learns, because
  // the number itself is ours (INV-3/INV-12).
  //
  // ⚠ AND THESE ARE ORDERING PROOFS, not three branch tests. The BYTE cap and the CHAR cap are both in
  // play on every one of these requests; which one answers is the property under test. The arithmetic
  // relationship between the constants is guarded in limits.test.ts — this is the BEHAVIOUR that
  // relationship is supposed to buy, asserted end to end. Every value is imported; nothing is written
  // as a literal here, so a re-tuned cap re-tunes the fixture with it.

  test.each(both)('one wall-of-text turn bows out in persona, UNDER the byte cap (accept=%s)', async (accept) => {
    const turns = [{ role: 'rider', text: 'x'.repeat(MAX_PLAN_MESSAGE_CHARS + 1) }]
    const body = { turns, regionId: region() }
    // The per-message bound is what fires — not the total, which this is nowhere near.
    expect(checkTranscript(turns)).toBe('turn_too_long')
    // ...and not the byte cap either. If this ever fails, the request never reached checkTranscript and
    // the rest of the test is proving something else.
    expect(bodyBytes(body)).toBeLessThanOrEqual(MAX_PLAN_BODY_BYTES)

    const res = await post(body, accept)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toStartWith('application/json')
    const parsed = drivePlanResponse.parse(await res.json())
    expect(parsed.done).toBe(true)
    expect(parsed.say.length).toBeGreaterThan(0)
  })

  // THE ORDERING PROOF, in the direction limits.ts argues for: for ordinary Latin text the CHAR cap is
  // the effective guard and the byte cap stays pure parse protection. A body that trips the char cap
  // fits inside the byte cap by construction, so the rider gets the wrap-up rather than the 413 — a
  // 413 here would mean the wallet guard had become decorative.
  test.each(both)('a transcript over the CHAR cap answers in persona, not 413 (accept=%s)', async (accept) => {
    const each = 'y'.repeat(MAX_PLAN_MESSAGE_CHARS)
    const n = Math.floor(MAX_PLAN_TOTAL_CHARS / MAX_PLAN_MESSAGE_CHARS) + 1
    // Otherwise 'too_many_turns' would answer first and this would be section B's test again.
    expect(n).toBeLessThanOrEqual(MAX_PLAN_MESSAGES)
    const turns = Array.from({ length: n }, () => ({ role: 'rider', text: each }))
    const body = { turns, regionId: region() }
    expect(checkTranscript(turns)).toBe('transcript_too_long')
    expect(bodyBytes(body)).toBeLessThanOrEqual(MAX_PLAN_BODY_BYTES)

    const res = await post(body, accept)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toStartWith('application/json')
    expect(drivePlanResponse.parse(await res.json()).done).toBe(true)
  })

  // THE CONVERSE, and the whole reason BOTH caps exist rather than either alone: for a dense script one
  // character is 3-4 bytes AND roughly one token, so a transcript the char cap has nothing to say about
  // is still a body worth rejecting. Here the order flips and the byte cap is the one that answers —
  // as a 413, because at that size there is no transcript to bow out of yet.
  test.each(both)('a dense-script body the CHAR cap accepts is still a 413 (accept=%s)', async (accept) => {
    const each = '観'.repeat(MAX_PLAN_MESSAGE_CHARS) // 1 UTF-16 unit, 3 UTF-8 bytes
    const n = Math.floor(MAX_PLAN_TOTAL_CHARS / MAX_PLAN_MESSAGE_CHARS)
    const turns = Array.from({ length: n }, () => ({ role: 'rider', text: each }))
    const body = { turns, regionId: region() }
    // The char cap passes it — this is exactly the request a chars-only guard would send to the model.
    expect(checkTranscript(turns)).toBeNull()
    expect(bodyBytes(body)).toBeGreaterThan(MAX_PLAN_BODY_BYTES)

    const res = await post(body, accept)
    expect(res.status).toBe(413)
    expect(res.headers.get('content-type')).toStartWith('application/json')
    expect(await res.text()).not.toContain('event:')
  })
})

/* -------------------------------------------------------------------------- */
/* C — the frame format. This IS the contract with apps/mobile.                 */
/* -------------------------------------------------------------------------- */

const frames = (body: string) =>
  body
    .split('\n\n')
    .filter((b) => b.trim() !== '')
    .map((b) => {
      const event = /^event: (.*)$/m.exec(b)?.[1] ?? 'message'
      const data = b
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6))
        .join('\n')
      return { event, data }
    })

describe('POST /drives/plan — SSE frames', () => {
  // ⚠ Byte-for-byte, deliberately not through a parser. The format is the contract; asserting it
  // through our own parser would only prove the parser agrees with itself.
  test('deltas then exactly one terminal turn, byte for byte', async () => {
    say('Where are you starting from?', ['Where are you ', 'starting from?'])
    const body = await (await post(OK, SSE)).text()
    expect(body).toBe(
      'event: say\ndata: {"delta":"Where are you "}\n\n' +
        'event: say\ndata: {"delta":"starting from?"}\n\n' +
        'event: turn\ndata: {"say":"Where are you starting from?","done":false}\n\n',
    )
  })

  // ⚠ THE NEWLINE BITE, and the entire reason the payload is a JSON OBJECT rather than the bare
  // delta. SSE `data:` lines are newline-delimited; JSON.stringify escapes every control character
  // below U+0020, so a delta carrying a newline can never become a second `data:` line. A regression
  // to `data: ${delta}` fails HERE and nowhere else.
  test('a delta containing a newline stays ONE data line', async () => {
    say('line one\nline two', ['line one\nline two'])
    const body = await (await post(OK, SSE)).text()
    expect(body).toContain('data: {"delta":"line one\\nline two"}')
    expect(body.split('\n').filter((l) => l.startsWith('data: ')).length).toBe(2)
  })

  test('hostile delta text round-trips exactly', async () => {
    // A carriage return, quotes, a backslash, an emoji, and text that looks like a frame field —
    // everything a rider could paste that a naive `data: ${delta}` format would mangle or forge.
    const hostile = 'a\r\nb "quoted" \\ 🚀\ndata: fake\n\nevent: turn'
    say('done', [hostile])
    const body = await (await post(OK, SSE)).text()
    const sayFrames = frames(body).filter((f) => f.event === 'say')
    expect(sayFrames.length).toBe(1)
    expect(JSON.parse(sayFrames[0]!.data).delta).toBe(hostile)
    expect(frames(body).filter((f) => f.event === 'turn').length).toBe(1)
  })

  // ⚠ THE ONE CONTRACT DETAIL A CLIENT AUTHOR GETS WRONG BY DEFAULT. The terminal `say` may DIFFER
  // from the concatenated deltas — a truncation APPENDS the retry line to what the rider already
  // watched stream. The client must REPLACE its buffer, never append to it.
  test('a truncated turn APPENDS to the streamed text in the terminal frame', async () => {
    const partial = 'Alright, so we start at'
    impl = async (a) => {
      a.onSay?.(partial)
      return { outcome: 'truncated', say: partial, rawRoute: null }
    }
    const body = await (await post(OK, SSE)).text()
    const terminal = JSON.parse(frames(body).find((f) => f.event === 'turn')!.data)
    expect(terminal.say).toStartWith(partial)
    expect(terminal.say.length).toBeGreaterThan(partial.length)
    expect(terminal.say).not.toBe(partial)
    expect(terminal.done).toBe(false)
  })

  // ...and a refusal REPLACES it entirely. Same rule, opposite direction — which is why the rule is
  // "replace" and not "append when longer".
  test('a refusal REPLACES the streamed text in the terminal frame', async () => {
    const leaked = 'Sure, I can tell you about'
    impl = async (a) => {
      a.onSay?.(leaked)
      return { outcome: 'refused', say: leaked, rawRoute: null }
    }
    const body = await (await post(OK, SSE)).text()
    expect(body).toContain(JSON.stringify({ delta: leaked }))
    const terminal = JSON.parse(frames(body).find((f) => f.event === 'turn')!.data)
    expect(terminal.say).not.toContain(leaked)
    expect(terminal.say.length).toBeGreaterThan(0)
  })

  // The tool→wire translation is now visible on the wire, so pin it here too: `round_trip` is NOT the
  // wire's loop shape (end === start, turnaround as the LAST via midpoint).
  test('a route rides the terminal frame only, already translated', async () => {
    const start = crypto.randomUUID()
    const far = crypto.randomUUID()
    impl = async (a) => {
      a.onSay?.('Drawing that up.')
      return {
        outcome: 'route',
        say: 'Drawing that up.',
        rawRoute: { start_anchor_id: start, end_anchor_id: far, round_trip: true, target_minutes: 90 },
      }
    }
    const body = await (await post(OK, SSE)).text()
    const said = frames(body).filter((f) => f.event === 'say')
    expect(said.length).toBe(1)
    expect(said[0]!.data).not.toContain(start)
    const terminal = drivePlanResponse.parse(JSON.parse(frames(body).find((f) => f.event === 'turn')!.data))
    const route = plannedRoute.parse(terminal.route)
    expect(route.start).toBe(start)
    expect(route.end).toBe(start)
    expect(route.via?.[route.via.length - 1]).toBe(far)
    expect(route.targetMinutes).toBe(90)
  })
})

/* -------------------------------------------------------------------------- */
/* D — failure inside the detached callback.                                    */
/* -------------------------------------------------------------------------- */

describe('POST /drives/plan — a throw inside the stream', () => {
  // ⚠ THE INV-13 CANARY, AND THE MOST LOAD-BEARING TEST IN THIS FILE. hono runs the streamSSE callback
  // DETACHED, so index.ts's app.onError never sees a throw from inside it — hono's own handler either
  // console.error()s the raw value or, if an onError is passed, writes `event: error / data: <message>`
  // straight to the rider. An Anthropic.APIError's body can quote the offending request field, i.e.
  // rider text. This test fails the moment either escape hatch is opened.
  test('a vendor error reaches neither the rider nor the log', async () => {
    const CANARY = 'CANARY-RIDER-TRANSCRIPT-FRAGMENT'
    impl = async () => {
      throw new Error(CANARY)
    }
    const spies = [spyOn(console, 'error'), spyOn(console, 'warn'), spyOn(console, 'info')]
    let body: string
    let logged = ''
    try {
      const res = await post(OK, SSE)
      expect(res.status).toBe(200)
      body = await res.text()
      // ⚠ READ THE RECORD BEFORE RESTORING. bun's mockRestore() clears `.mock.calls`, so reading the
      // spy afterwards yields an empty string — and a `not.toContain` against an empty string is a
      // test that can never fail. This assertion is the whole point of the file; keep it able to fail.
      logged = spies.flatMap((s) => s.mock.calls.flat()).map(String).join('\n')
    } finally {
      for (const s of spies) s.mockRestore()
    }

    expect(body).not.toContain(CANARY)
    expect(logged).not.toContain(CANARY)
    // The rider still gets a turn — in persona, exactly one terminal frame, and no `event: error`.
    expect(body.match(/^event: turn$/gm)!.length).toBe(1)
    expect(body).not.toContain('event: error')
    const terminal = drivePlanResponse.parse(JSON.parse(frames(body).find((f) => f.event === 'turn')!.data))
    expect(terminal.say.length).toBeGreaterThan(0)
    expect(terminal.done).toBe(false)
  })

  // The rider hung up. There is nobody to apologise to, so leaving WITHOUT a terminal frame is the
  // correct behaviour — the client's own "EOF with no turn frame = the turn failed" rule covers it,
  // and inventing an apology here would cost a wasted render on a screen nobody is looking at.
  test('client_gone leaves no terminal frame at all', async () => {
    impl = async () => {
      throw new PlannerTurnError('client_gone')
    }
    const body = await (await post(OK, SSE)).text()
    expect(body).not.toContain('event: turn')
    expect(body).not.toContain('event: error')
  })
})

/* -------------------------------------------------------------------------- */
/* E — the one line the whole cancellation feature hangs on.                    */
/* -------------------------------------------------------------------------- */

describe('POST /drives/plan — rider cancellation wiring', () => {
  // ⚠ This pins `signal: c.req.raw.signal` in the args literal — one line, no compiler enforcement,
  // and exactly the kind of thing a refactor drops silently. Without it a rider who backgrounds the
  // app bills Opus to completion on a turn nobody will ever read (INV-11).
  test('the planner is handed the rider’s live connection', async () => {
    const ac = new AbortController()
    seen.args = null
    impl = (a) =>
      new Promise((resolve) => {
        a.signal?.addEventListener('abort', () => resolve({ outcome: 'say', say: 'never seen', rawRoute: null }))
      })

    const res = await post(OK, SSE, { signal: ac.signal })
    const bodyP = res.text()
    await new Promise((r) => setTimeout(r, 10))

    expect(lastPlannerArgs().signal).toBeInstanceOf(AbortSignal)
    expect(lastPlannerArgs().signal!.aborted).toBe(false)

    ac.abort()
    await bodyP
    expect(lastPlannerArgs().signal!.aborted).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* F — plan_degraded: the only alert surface a 200-shaped failure has.          */
/* -------------------------------------------------------------------------- */

/** Run `fn` with every console sink recorded, and hand back the lines it wrote.
 *  ⚠ READ THE RECORD BEFORE RESTORING — bun's mockRestore() clears `.mock.calls`, so a read afterwards
 *  yields nothing and every `not.toContain` below becomes a test that cannot fail. Same trap section D
 *  documents; it is worth paying twice.
 *  ⚠ ALL THREE SINKS, not just console.warn. Half of what this section proves is an ABSENCE (INV-13,
 *  and "nothing fires on a healthy turn"), and an absence asserted against one sink is satisfied by
 *  moving the write to another. */
async function capture<T>(fn: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const spies = [spyOn(console, 'warn'), spyOn(console, 'error'), spyOn(console, 'info')]
  try {
    const value = await fn()
    return { value, lines: spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(' '))) }
  } finally {
    for (const s of spies) s.mockRestore()
  }
}

/** The structured lines only. Anything unparseable is prose from somewhere else and not this signal. */
const degradedLines = (lines: string[]): Record<string, unknown>[] =>
  lines
    .map((l) => {
      try {
        return JSON.parse(l) as unknown
      } catch {
        return null
      }
    })
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object' && (o as { evt?: unknown }).evt === 'plan_degraded')

const reasonsFrom = (lines: string[]): unknown[] => degradedLines(lines).map((o) => o.reason)

/** Drain the turn on whichever transport, so the SSE callback has finished writing before the spies are
 *  read — the emit happens inside the DETACHED callback, not before the response object exists. */
const runTurn = (accept: string | undefined) => capture(async () => (await post(OK, accept)).text())

describe('POST /drives/plan — plan_degraded', () => {
  const both: (string | undefined)[] = [undefined, SSE]
  // Section B's unknown-region test mutates this; do not inherit its state.
  beforeEach(() => {
    regionRows = [{ bbox: '-120.2,38.9,-119.9,39.3', name: 'Lake Tahoe' }]
  })

  // ⚠ WHY THIS SIGNAL EXISTS AT ALL: every case below still answers HTTP 200, so a 5xx alert stays
  // green while a rider is being charged for turns that produce nothing. This line is the entire
  // detection surface, and a test that only asserted "the rider gets VOICE.retry" would leave the
  // operator half untested — which is the half that pays.
  const degraded: [string, string][] = [
    ['truncated', 'truncated'],
    ['aborted', 'aborted'],
    ['empty', 'empty'],
    // A classifier decline carries its OWN reason on purpose: it is a different operational fact from a
    // broken turn (nothing to page on; a SPIKE is a prompt problem). Collapsing it into the others
    // would make the metric unable to tell "the model is failing" from "riders are asking odd things".
    ['refused', 'refused'],
  ]

  test.each(degraded)('a %s turn emits reason=%s', async (outcome, reason) => {
    impl = async () => ({ outcome, say: '', rawRoute: null, stopReason: 'end_turn' })
    const { lines } = await runTurn(undefined)
    expect(reasonsFrom(lines)).toEqual([reason])
  })

  // ⚠ THE TRANSPORT-PARITY CLAUSE, and it is a real risk rather than a hypothetical: the two transports
  // are two separate `await`s in the handler, and the emit sits in the ONE function they share. Move it
  // to either call site and this fails — what a rider puts in an Accept header must never change what
  // an operator can see.
  test.each(both)('the same degradation emits the same line on both transports (accept=%s)', async (accept) => {
    impl = async () => ({ outcome: 'truncated', say: 'Alright, so we start at', rawRoute: null, stopReason: 'max_tokens' })
    const { lines } = await runTurn(accept)
    expect(degradedLines(lines)).toEqual([{ evt: 'plan_degraded', reason: 'truncated' }])
  })

  // ⚠ THE CASE THE ADVERSARIAL REVIEW'S LITERAL CONDITION MISSES ENTIRELY. stop_reason IS 'tool_use' —
  // the vendor scored this turn a success and billed for it — but the route does not survive
  // translation, so the rider hears the retry line and no route ever reaches the map. `stop_reason !==
  // 'tool_use'` is silent here, which is why the emit keys on the OUTCOME plus this branch.
  const untranslatable: [string, unknown][] = [
    ['a missing endpoint id', { start_anchor_id: crypto.randomUUID() }],
    // Over the wire's `via` ceiling — the other way a well-formed-looking tool call is not a route.
    ['too many via ids', {
      start_anchor_id: crypto.randomUUID(),
      end_anchor_id: crypto.randomUUID(),
      via_anchor_ids: Array.from({ length: 9 }, () => crypto.randomUUID()),
    }],
  ]
  test.each(untranslatable)('a route the vendor called a success but we cannot translate (%s) emits', async (_label, rawRoute) => {
    impl = async () => ({ outcome: 'route', say: 'Drawing that up.', rawRoute, stopReason: 'tool_use' })
    const { value, lines } = await capture(async () => (await post(OK)).json())
    // The rider half: a turn, in persona, with no route on it.
    expect(drivePlanResponse.parse(value).route).toBeNil()
    expect(reasonsFrom(lines)).toEqual(['route_untranslatable'])
  })

  // ⚠ THE OTHER HALF OF THE REVIEW'S ERROR, and the reason this signal is worth having. `end_turn` with
  // text is outcome 'say' — the ORDINARY beat, most of a 3-8 exchange conversation. Under the literal
  // `stop_reason !== 'tool_use'` condition this line fires on healthy traffic and the metric measures
  // nothing. Implement that condition and THIS test is what goes red.
  test.each(both)('a healthy say turn emits NOTHING (accept=%s)', async (accept) => {
    impl = async () => ({ outcome: 'say', say: 'Where are you starting from?', rawRoute: null, stopReason: 'end_turn' })
    const { lines } = await runTurn(accept)
    expect(degradedLines(lines)).toEqual([])
  })

  test.each(both)('a successful route turn emits NOTHING (accept=%s)', async (accept) => {
    const start = crypto.randomUUID()
    const end = crypto.randomUUID()
    impl = async () => ({
      outcome: 'route',
      say: 'Drawing that up.',
      rawRoute: { start_anchor_id: start, end_anchor_id: end },
      stopReason: 'tool_use',
    })
    const { lines } = await runTurn(accept)
    expect(degradedLines(lines)).toEqual([])
  })

  // ⚠ INV-13, ASSERTED AS AN ABSENCE. The transcript, the rider's words and the model's `say` are
  // transient rider content: counts, ids and enums may be logged, prose may not. The exact-keys
  // assertion is the part that bites in the future — it fails the moment anyone enriches this line with
  // a field derived from the turn, which is precisely how a log starts carrying a rider's sentence.
  test('the emitted line carries no rider text and no model text, and exactly two fields', async () => {
    const RIDER = 'CANARY-RIDER-SENTENCE'
    const MODEL = 'CANARY-MODEL-SAY'
    impl = async () => ({ outcome: 'truncated', say: MODEL, rawRoute: null, stopReason: 'max_tokens' })
    const { lines } = await capture(async () =>
      (
        await post({ turns: [{ role: 'rider', text: RIDER }], regionId: crypto.randomUUID() }, SSE)
      ).text(),
    )

    const emitted = degradedLines(lines)
    expect(emitted.length).toBe(1)
    expect(Object.keys(emitted[0]!).sort()).toEqual(['evt', 'reason'])
    // Not just the structured line — NOTHING this request logged may carry either string.
    for (const line of lines) {
      expect(line).not.toContain(RIDER)
      expect(line).not.toContain(MODEL)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* D12 — the in-persona wrap-up PRODUCER.                                       */
/* -------------------------------------------------------------------------- */

// ⚠ WHY THIS LIVES IN THE SSE FILE. It is not about frames, and it would read more naturally in a file
// of its own — but this file already owns `mock.module('../src/planner', …)`, and a THIRD file mocking
// the same module is the exact process-wide leak documented at the top of this one. Reusing the harness
// costs a slightly off-topic section; a new file costs another leak surface. The harness wins.
//
// ⚠ WHAT THIS ACTUALLY GUARDS, stated because it is the whole reason the section exists: `wrapUpNotice`
// was TYPED in ../src/planner and CONSUMED there for a full build step with NOTHING setting it. Nothing
// failed. An optional field that is always absent is never wrong, so tsc was green, every planner test
// was green, and D12 was prose describing behaviour the server could not produce. The only assertion
// that could ever have caught it is one that says "on this input the field is PRESENT" — which is what
// these are. A test that merely tolerates the field passes on the bug.
describe('D12: the wrap-up notice is produced, and only past the threshold', () => {
  const region = () => crypto.randomUUID()
  /** n messages of real-looking transcript, well inside every char cap. */
  const transcript = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? 'rider' : 'skipper', text: 'somewhere pretty' }))

  const planWith = async (messages: number) => {
    impl = async () => ({ outcome: 'say', say: 'Where from?', rawRoute: null, stopReason: 'end_turn' })
    const res = await post({ turns: transcript(messages), regionId: region() })
    expect(res.status).toBe(200)
    return lastPlannerArgs()
  }

  test('an ordinary conversation carries NO notice — the key is absent, not undefined', async () => {
    const args = await planWith(4)
    expect(args.wrapUpNotice).toBeUndefined()
    // ⚠ Absence, not falsiness. ../src/plan-route spreads the key in conditionally so a normal turn can
    // never render an empty third system block and forfeit the cache breakpoint's benefit for nothing.
    expect('wrapUpNotice' in args).toBe(false)
  })

  test('AT the threshold it still does not fire — the band is inclusive of normal', async () => {
    // The comparison is strictly greater-than on purpose: PLAN_WRAP_UP_AFTER_MESSAGES is the top of a
    // normal conversation, not the first abnormal one. Off-by-one here hurries a healthy rider.
    const args = await planWith(PLAN_WRAP_UP_AFTER_MESSAGES)
    expect('wrapUpNotice' in args).toBe(false)
  })

  test('one message past the threshold it fires, with the exact prose', async () => {
    const args = await planWith(PLAN_WRAP_UP_AFTER_MESSAGES + 1)
    // ⚠ Identity against the constant, not a substring or a truthiness check. The notice's opening
    // phrase is a literal coupling to the prompt's `== Wrapping up ==` section ("or you are told the
    // conversation is near its end"); a paraphrase compiled in here would pass a looser assertion while
    // silently decoupling the two halves.
    expect(args.wrapUpNotice).toBe(PLANNER_WRAP_UP_NOTICE)
  })

  test('it keeps firing right up to the hard cap, and the cap still wins past it', async () => {
    const args = await planWith(MAX_PLAN_MESSAGES)
    expect(args.wrapUpNotice).toBe(PLANNER_WRAP_UP_NOTICE)

    // One past the cap is the guard's territory, and D12 must not have quietly replaced it: the rider
    // gets the in-persona hard stop with `done: true`, and no model call is made at all.
    seen.args = null
    const res = await post({ turns: transcript(MAX_PLAN_MESSAGES + 1), regionId: region() })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { done?: boolean }).done).toBe(true)
    expect(seen.args).toBeNull()
  })

  // The notice is an instruction to the model, never words for the rider. It must not reach the wire on
  // either transport — if it ever did, a rider would watch the character read its own stage directions.
  // ⚠ The canary is a fragment ONLY the notice has. "near its end" would be wrong here for the same
  // reason it is wrong in planner.test.ts: the prompt shares that phrase by design.
  test('the notice never reaches the rider on either transport', async () => {
    impl = async () => ({ outcome: 'say', say: 'Where from?', rawRoute: null, stopReason: 'end_turn' })
    const body = { turns: transcript(PLAN_WRAP_UP_AFTER_MESSAGES + 1), regionId: region() }
    for (const accept of [undefined, SSE]) {
      const text = await (await post(body, accept)).text()
      expect(text).not.toContain(PLANNER_WRAP_UP_NOTICE)
      expect(text).not.toContain('there was a clock')
    }
  })

  // ⚠ The prose itself, pinned for the two properties that make it safe to send. Both are stated as
  // rules in ../src/planner-prompt; neither is enforceable anywhere else.
  test('the notice leaks no count and forbids its own disclosure', () => {
    // No digit anywhere: a number of remaining turns is the single thing most likely to be recited back
    // to a rider verbatim, and it would expose the machinery the prompt bars narrating.
    expect(PLANNER_WRAP_UP_NOTICE).not.toMatch(/\d/)
    expect(PLANNER_WRAP_UP_NOTICE.toLowerCase()).toContain('near its end')
    expect(PLANNER_WRAP_UP_NOTICE.toLowerCase()).toContain('say nothing about this note')
  })
})
