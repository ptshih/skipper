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
// ⚠ Imported AFTER the mocks above resolve — ./roster-cache reaches ./drives, which is mocked here.
import { resetRosterMemo } from '../src/roster-cache'

/* -------------------------------------------------------------------------- */
/* Harness. Mocks FIRST — plan-route.ts's static imports resolve through them.  */
/* -------------------------------------------------------------------------- */

// The real ./drives reaches ./entitlements -> ./auth, which throws at module load without a secret, so
// seed one to snapshot it. Same value and same `??=` as cors.test.ts: it signs nothing, and seeding is
// strictly cheaper than shipping a partial mock of a module that also exports `driveRoutes` (which
// cors.test.ts's app import needs, whichever order bun happens to run these in).
process.env.BETTER_AUTH_SECRET ??= 'test-only-secret-that-signs-nothing-real'

/** How many times the anchor read actually ran. ⚠ The ONLY way to observe the roster memo from out
 *  here — a cache that is working looks exactly like one that is not, from the response body. */
let anchorLoads = 0

/**
 * The stubbed region's roster.
 *
 * ⚠ IT IS LOAD-BEARING NOW, NOT SCENERY, AND THAT CHANGED THE MEANING OF `crypto.randomUUID()` IN THIS
 * FILE. `plan-route.ts` re-asserts every anchor id the model emits against the list the turn was given,
 * so a route only survives translation when its ids are IN here. A random UUID is therefore how a test
 * SAYS "off the roster" — deliberately, in the off-roster section — and using one by accident makes a
 * route silently vanish for a reason the test does not name. Draw from the constants below.
 *
 * ⚠ Thirteen entries, and the count is derived rather than picked: the via-cap test has to exceed
 * MAX_ROUTE_VIA (8) with ids that all EXIST, or it proves the allowlist check instead of the cap it was
 * written for. Four named + nine midpoints covers that with one to spare.
 */
const rosterId = (n: number): string => `3582ed8a-a55e-4fb2-b8af-59dcd9eef1${n.toString(16).padStart(2, '0')}`
const ROSTER: readonly { id: string; name: string }[] = [
  // ⚠ Byte-identical to the single anchor this stub used to return, so the roster-memo and D9-shape
  // assertions that name 'Tahoe City' keep testing exactly what they tested before.
  { id: rosterId(0x6c), name: 'Tahoe City' },
  { id: rosterId(0x01), name: 'Emerald Bay State Park' },
  { id: rosterId(0x02), name: 'Kings Beach' },
  { id: rosterId(0x03), name: 'Incline Village' },
  ...Array.from({ length: 9 }, (_, i) => ({ id: rosterId(0x10 + i), name: `Waypoint ${i + 1}` })),
]
const [TAHOE_CITY, EMERALD_BAY, KINGS_BEACH] = ROSTER.map((a) => a.id) as [string, string, string]
/** Nine ON-ROSTER midpoints — enough to push a translated route past MAX_ROUTE_VIA using ids that all
 *  exist, which is what keeps the via-cap test about the cap. */
const VIA_POOL: readonly string[] = ROSTER.slice(4).map((a) => a.id)
/** An id that is deliberately NOT on the roster. Named, so a reader never has to wonder whether a bare
 *  `crypto.randomUUID()` in a route was the point or an oversight. */
const OFF_ROSTER_ID = (): string => crypto.randomUUID()

const realDrives = { ...(await import('../src/drives')) }
mock.module('../src/drives', () => ({
  ...realDrives,
  loadRegionAnchors: async () => {
    anchorLoads++
    return ROSTER.map((a) => ({ ...a }))
  },
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

// ⚠ THE ROSTER MEMO IS PROCESS-WIDE, AND SO IS THIS FILE'S STUBBED WORLD — so it has to be cleared
// between tests or they silently couple. `OK` carries ONE regionId for the whole file (the
// `crypto.randomUUID()` above runs once at module load), and `regionRows` is deliberately mutated to
// make the region vanish for the unknown-region test. Without this, the first test to resolve that id
// caches it and the unknown-region test reads a stale HIT — passing a region back for a world where
// none exists, and failing for a reason nothing in that test mentions.
beforeEach(() => {
  resetRosterMemo()
})

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

  test('the roster is read ONCE per region and reused across turns', async () => {
    // The whole point: this ran on every rider MESSAGE before ./roster-cache, as two sequential
    // round-trips in front of every turn of every conversation.
    anchorLoads = 0
    say('One.')
    await post(OK)
    say('Two.')
    await post(OK)
    say('Three.')
    await post(OK)
    expect(anchorLoads).toBe(1)
  })

  test('the reset seam actually clears it', async () => {
    // ⚠ Guards the seam itself, not just the cache. Every other test in this file depends on the
    // beforeEach reset working, so a silently broken reset would couple them all with no direct
    // failure — it would surface as an unrelated test reading a region that should not exist.
    anchorLoads = 0
    say('One.')
    await post(OK)
    resetRosterMemo()
    say('Two.')
    await post(OK)
    expect(anchorLoads).toBe(2)
  })

  test('a MISS is never memoized — an unknown region re-reads every time', async () => {
    // ⚠ BOUNDEDNESS, not tidiness. `regionId` is attacker-controlled on an open anonymous route, so
    // caching misses would let a stranger grow the map without limit by sending fresh UUIDs. Caching
    // only hits bounds it by the number of REAL regions. This asserts the map cannot be grown that
    // way, by proving the second unknown lookup was not served from cache.
    regionRows = []
    try {
      const first = await post({ turns: OK.turns, regionId: crypto.randomUUID() })
      expect(drivePlanResponse.parse(await first.json()).done).toBe(true)
      // Same id twice: still no cache, still the honest bow-out rather than a stale hit.
      const id = crypto.randomUUID()
      expect(drivePlanResponse.parse(await (await post({ turns: OK.turns, regionId: id })).json()).done).toBe(true)
      expect(drivePlanResponse.parse(await (await post({ turns: OK.turns, regionId: id })).json()).done).toBe(true)
    } finally {
      regionRows = [{ bbox: '-120.2,38.9,-119.9,39.3', name: 'Lake Tahoe' }]
    }
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
  // wire's loop shape (end === start, then the turnaround and the way home as the LAST TWO via
  // midpoints).
  test('a route rides the terminal frame only, already translated', async () => {
    // ⚠ ON-ROSTER ids, necessarily: the handler drops a route naming a place it never printed, so random
    // UUIDs here would make this assert the off-roster path while claiming to assert translation.
    const start = TAHOE_CITY
    const far = EMERALD_BAY
    const back = KINGS_BEACH
    impl = async (a) => {
      a.onSay?.('Drawing that up.')
      return {
        outcome: 'route',
        say: 'Drawing that up.',
        rawRoute: {
          start_anchor_id: start,
          end_anchor_id: far,
          return_anchor_id: back,
          round_trip: true,
          target_minutes: 90,
        },
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
    // ORDER IS THE CONTRACT: the far end, then the way home. The client reads the far end at `.at(-2)`
    // (turnaroundOf), so swapping these two silently prints the return leg as the destination.
    expect(route.via?.at(-2)).toBe(far)
    expect(route.via?.at(-1)).toBe(back)
    expect(route.targetMinutes).toBe(90)
  })

  // The no-same-road rule at the PLANNER layer: a loop with no way home is not drawn at all, and the
  // rider is asked which way they want to come back rather than handed a retrace or an apology.
  test('a loop with no way home is not drawn — the rider is asked for one', async () => {
    const PROMISED = 'CONSIDER-IT-DRAWN-SENTINEL'
    impl = async () => ({
      outcome: 'route',
      say: PROMISED,
      rawRoute: { start_anchor_id: TAHOE_CITY, end_anchor_id: EMERALD_BAY, round_trip: true },
    })
    const body = await (await post(OK, SSE)).text()
    const terminal = drivePlanResponse.parse(JSON.parse(frames(body).find((f) => f.event === 'turn')!.data))
    expect(terminal.route).toBeFalsy()
    // REPLACED, not appended: the model's line already promised a drive that is not coming, so leaving
    // it in front of the question reads as "here it is — now, where to?".
    expect(terminal.say).not.toContain(PROMISED)
    expect(terminal.say.toLowerCase()).toContain('come home')
    expect(terminal.done).toBe(false)
  })

  // A "way home" that IS the turnaround describes no return leg at all — Google collapses
  // `start → X → X → start` to the same out-and-back — so it must be treated as the missing answer it
  // is rather than billed and then refused a step later.
  test('a way home that repeats the turnaround or the start is treated as no way home', async () => {
    // Both spellings of "no return leg", refused before any Routes call — the wire gate downstream
    // could only catch these AFTER paying to discover them.
    for (const naming of ['end', 'start'] as const) {
      const start = TAHOE_CITY
      const far = EMERALD_BAY
      impl = async () => ({
        outcome: 'route',
        say: 'Drawing that up.',
        rawRoute: {
          start_anchor_id: start,
          end_anchor_id: far,
          return_anchor_id: naming === 'end' ? far : start,
          round_trip: true,
        },
      })
      const body = await (await post(OK, SSE)).text()
      const terminal = drivePlanResponse.parse(JSON.parse(frames(body).find((f) => f.event === 'turn')!.data))
      expect(terminal.route).toBeFalsy()
      expect(terminal.say.toLowerCase()).toContain('come home')
    }
  })

  // A ONE-WAY route is untouched by any of this — the rule is about loops, and a rider who asked to
  // pass through somewhere on the way is not being overruled.
  test('a one-way route needs no way home', async () => {
    const start = TAHOE_CITY
    const end = EMERALD_BAY
    impl = async () => ({
      outcome: 'route',
      say: 'Drawing that up.',
      rawRoute: { start_anchor_id: start, end_anchor_id: end },
    })
    const body = await (await post(OK, SSE)).text()
    const terminal = drivePlanResponse.parse(JSON.parse(frames(body).find((f) => f.event === 'turn')!.data))
    const route = plannedRoute.parse(terminal.route)
    expect(route.start).toBe(start)
    expect(route.end).toBe(end)
    expect(route.via ?? []).toEqual([])
  })

  // ⚠ THE ZERO-DISTANCE SHAPE. A one-way call whose two ends are the same id is not a drive: it
  // materializes as a near-zero polyline that `retraceFraction` scores 0 (it needs ~1.5 km of
  // along-route distance to see a doubling-back), so the no-same-road gate waves it through, /propose
  // bills Google and answers 200 with estStopCount 0, and only CREATE rejects it — after billing a
  // SECOND Routes call. Refused here so the rider is never shown the card. `isDegenerateRoute` is the
  // shared predicate the two billed request schemas refine on.
  test('a one-way route from a place back to itself is NOT a drive', async () => {
    impl = async () => ({
      outcome: 'route',
      say: 'Drawing that up.',
      rawRoute: { start_anchor_id: TAHOE_CITY, end_anchor_id: TAHOE_CITY },
    })
    const body = await (await post(OK, SSE)).text()
    const terminal = drivePlanResponse.parse(JSON.parse(frames(body).find((f) => f.event === 'turn')!.data))
    expect(terminal.route).toBeFalsy()
  })

  // ⚠ AND THE COUNTERPART, WHICH IS WHAT KEEPS THE GUARD FROM EATING THE PRODUCT: `start === end` WITH a
  // midpoint is exactly how a legitimate loop is encoded, so it must still translate. A guard written as
  // "reject start === end" would refuse every round trip in the app and pass every test above.
  test('a LOOP is start === end WITH midpoints — the degenerate guard must not touch it', async () => {
    impl = async () => ({
      outcome: 'route',
      say: 'Drawing that up.',
      rawRoute: {
        start_anchor_id: TAHOE_CITY,
        end_anchor_id: EMERALD_BAY,
        return_anchor_id: KINGS_BEACH,
        round_trip: true,
      },
    })
    const body = await (await post(OK, SSE)).text()
    const terminal = drivePlanResponse.parse(JSON.parse(frames(body).find((f) => f.event === 'turn')!.data))
    const route = plannedRoute.parse(terminal.route)
    expect(route.start).toBe(TAHOE_CITY)
    expect(route.end).toBe(TAHOE_CITY)
    expect(route.via).toEqual([EMERALD_BAY, KINGS_BEACH])
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
    expect(degradedLines(lines)).toEqual([{ severity: 'WARNING', evt: 'plan_degraded', reason: 'truncated' }])
  })

  // ⚠ THE CASE THE ADVERSARIAL REVIEW'S LITERAL CONDITION MISSES ENTIRELY. stop_reason IS 'tool_use' —
  // the vendor scored this turn a success and billed for it — but the route does not survive
  // translation, so the rider hears the retry line and no route ever reaches the map. `stop_reason !==
  // 'tool_use'` is silent here, which is why the emit keys on the OUTCOME plus this branch.
  const untranslatable: [string, unknown][] = [
    ['a missing endpoint id', { start_anchor_id: TAHOE_CITY }],
    // Over the wire's `via` ceiling — the other way a well-formed-looking tool call is not a route.
    // ⚠ EVERY ID HERE IS ON THE ROSTER, and that is what keeps this test about the CAP. With random ids
    // the allowlist check (which runs first, on purpose — an id that names no place makes every shape
    // question below it moot) would report `route_off_roster` and the cap would go untested.
    ['too many via ids', {
      start_anchor_id: TAHOE_CITY,
      end_anchor_id: EMERALD_BAY,
      via_anchor_ids: VIA_POOL,
    }],
  ]
  test.each(untranslatable)('a route the vendor called a success but we cannot translate (%s) emits', async (_label, rawRoute) => {
    impl = async () => ({ outcome: 'route', say: 'Drawing that up.', rawRoute, stopReason: 'tool_use' })
    const { value, lines } = await capture(async () => (await post(OK)).json())
    // The rider half: a turn, in persona, with no route on it.
    expect(drivePlanResponse.parse(value).route).toBeNil()
    expect(reasonsFrom(lines)).toEqual(['route_untranslatable'])
  })

  // ⚠ A WELL-FORMED CALL ABOUT A PLACE THAT DOES NOT EXIST — the model composed an id instead of copying
  // one off the printed list, which the tool description forbids precisely because it is possible. The
  // rider used to be handed this as a tappable card whose tap was a 400 from `hydrateAnchors`; now the
  // route is dropped and the turn degrades. It gets its OWN reason, not `route_untranslatable`: only this
  // one says the "copy ids exactly" instruction has stopped landing.
  const offRoster: [string, unknown][] = [
    ['a fabricated start', { start_anchor_id: OFF_ROSTER_ID(), end_anchor_id: EMERALD_BAY }],
    ['a fabricated end', { start_anchor_id: TAHOE_CITY, end_anchor_id: OFF_ROSTER_ID() }],
    // ⚠ THE MIDDLE TOO. Guarding both ends and leaving `via` open is not a partial guarantee — it is
    // none; the same lesson `resolveRouteAnchors` exists for at the wire.
    ['a fabricated midpoint', {
      start_anchor_id: TAHOE_CITY,
      end_anchor_id: EMERALD_BAY,
      via_anchor_ids: [OFF_ROSTER_ID()],
    }],
    // ⚠ AND `return_anchor_id`, the newest of these fields and the easiest to forget: it is an anchor id
    // like any other. Note this must NOT be reported as `loop_without_return` — the loop is not missing a
    // way home, it names one that does not exist, and asking "which way home?" would be the wrong
    // question.
    ['a fabricated way home', {
      start_anchor_id: TAHOE_CITY,
      end_anchor_id: EMERALD_BAY,
      return_anchor_id: OFF_ROSTER_ID(),
      round_trip: true,
    }],
  ]
  test.each(offRoster)('an anchor id the model was never given (%s) drops the route', async (_label, rawRoute) => {
    impl = async () => ({ outcome: 'route', say: 'Drawing that up.', rawRoute, stopReason: 'tool_use' })
    const { value, lines } = await capture(async () => (await post(OK)).json())
    const parsed = drivePlanResponse.parse(value)
    expect(parsed.route).toBeNil()
    // The skipper's own line survives — it may be a perfectly good sentence that came with a bad call.
    expect(parsed.say).toBe('Drawing that up.')
    expect(reasonsFrom(lines)).toEqual(['route_off_roster'])
  })

  // ⚠ THE GUARD IS THE ROSTER *THIS TURN* WAS GIVEN, which is the whole claim in the doc comment. If the
  // check ever read some other list — a second query, a global, the request body — this passes and the
  // guarantee is gone. Asserted by using an id that is real-looking and correctly shaped but simply not
  // in the stub's roster.
  test('an id from ANOTHER region is off-roster too, not merely a malformed one', async () => {
    // Shaped exactly like a roster id (same prefix, valid v4) but never printed for this region.
    const otherRegionsAnchor = rosterId(0xfe)
    expect(ROSTER.some((a) => a.id === otherRegionsAnchor)).toBe(false)
    impl = async () => ({
      outcome: 'route',
      say: 'Drawing that up.',
      rawRoute: { start_anchor_id: TAHOE_CITY, end_anchor_id: otherRegionsAnchor },
      stopReason: 'tool_use',
    })
    const { value, lines } = await capture(async () => (await post(OK)).json())
    expect(drivePlanResponse.parse(value).route).toBeNil()
    expect(reasonsFrom(lines)).toEqual(['route_off_roster'])
  })

  // ⚠ A ROUTE WITH NO LINE. Nothing STRUCTURALLY guarantees a text block rides with a tool call (see
  // PLAN_ROUTE_TOOL's note on why `say` is not a tool field) — the prompt asking for one is the whole
  // mechanism, and the model drops it on low-content turns: a rider answering "cool" after a draw got
  // `{ say: '', route }` back, verbatim, on 2026-08-03.
  //
  // It was survivable only by accident. The empty bubble arrived WITH a card, so the turn still looked
  // like something happened. Then the client began refusing to redraw a route it already holds — the
  // card is correctly suppressed, and an empty `say` makes the ENTIRE turn render as nothing: the rider
  // types and the screen does not move. Both halves are asserted, because both were missing.
  const wordless = () => ({
    outcome: 'route' as const,
    say: '',
    // ⚠ ON-ROSTER, so the route SURVIVES and this test stays about the missing line. Random ids here
    // would drop the route and the assertion below ("the route still reaches the map") would be testing
    // the off-roster path instead.
    rawRoute: { start_anchor_id: TAHOE_CITY, end_anchor_id: EMERALD_BAY },
    stopReason: 'tool_use' as const,
  })

  test.each(both)('a route with no line is COUNTED — a spike here is the prompt slipping (accept=%s)', async (accept) => {
    impl = async () => wordless()
    const { lines } = await runTurn(accept)
    // ⚠ WARNING, NOT ERROR, and that is the assertion doing the work here. A model that drew without
    // speaking is a PROMPT signal on otherwise-healthy traffic; emitting it at ERROR would put an
    // ordinary beat into Error Reporting, which is the "a guardrail doing its job must not page
    // someone" failure ../src/rate-limit already argued. Pinned so a future edit cannot promote it.
    expect(degradedLines(lines)).toEqual([{ severity: 'WARNING', evt: 'plan_degraded', reason: 'route_wordless' }])
  })

  test('the rider still hears something, and it is NOT the retry line', async () => {
    impl = async () => wordless()
    const { value } = await capture(async () => (await post(OK)).json())
    const parsed = drivePlanResponse.parse(value)
    // The drive is fine and is about to appear on screen, so asking them to say it again would be a
    // apology for nothing — this branch deliberately does not share the no-route fallback.
    expect(parsed.say.trim()).not.toBe('')
    expect(parsed.say).not.toContain('Lost my train of thought')
    // ...and the route still reaches the map. The fallback is a line, not a downgrade.
    expect(parsed.route).not.toBeNil()
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
    // ⚠ ON-ROSTER — a "successful" turn is only successful if the route survives translation. With random
    // ids this test would pass a `route_off_roster` line off as silence.
    const start = TAHOE_CITY
    const end = EMERALD_BAY
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
  // ⚠ THE COUNT WENT 2 → 3 ON 2026-08-04 and the assertion stays exact on purpose. `severity` is
  // derived from `reason` — a closed set of literals declared in ../src/plan-route — by a comparison
  // against one more literal, so it cannot carry anything from the turn. That is the ONLY kind of field
  // that may be added here, and re-pinning the exact key list rather than loosening to a subset is what
  // keeps the next addition an explicit decision instead of a silent one.
  test('the emitted line carries no rider text and no model text, and exactly three fields', async () => {
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
    expect(Object.keys(emitted[0]!).sort()).toEqual(['evt', 'reason', 'severity'])
    // Not just the structured line — NOTHING this request logged may carry either string.
    for (const line of lines) {
      expect(line).not.toContain(RIDER)
      expect(line).not.toContain(MODEL)
    }
  })

  // ⚠ THE THROW PATH, AND IT IS THE HALF THAT WAS INVISIBLE. These two reasons are raised by ../src/planner
  // BEFORE the model call, so `logPlanSpend` never runs — no `plan_spend` line either — while the rider
  // still gets HTTP 200 and an in-persona apology. A missing ANTHROPIC_API_KEY on a deployed revision was
  // therefore countable by nothing: `/health` green, no 5xx, one unstructured stderr line that no
  // log-based metric can read. That is the exact condition this event exists for.
  const thrownReasons: ['not_configured' | 'bad_transcript', string][] = [
    ['not_configured', 'a deploy with no ANTHROPIC_API_KEY'],
    ['bad_transcript', 'a caller sending a shape the vendor would reject'],
  ]
  test.each(thrownReasons)('%s is COUNTED (%s)', async (reason) => {
    impl = async () => {
      throw new PlannerTurnError(reason)
    }
    const { value, lines } = await capture(async () => (await post(OK)).json())
    // The rider half is unchanged: in persona, 200, no leak of why.
    const parsed = drivePlanResponse.parse(value)
    expect(parsed.say).toContain('Radio')
    expect(parsed.route).toBeNil()
    expect(reasonsFrom(lines)).toEqual([reason])
  })

  // ⚠ BOTH TRANSPORTS, because "a rider's Accept header cannot change what an operator sees" is the rule
  // this file exists to hold — and the SSE path runs inside hono's DETACHED callback, where a throw would
  // escape the app's error handler entirely.
  test.each(both)('not_configured is counted identically on accept=%s', async (accept) => {
    impl = async () => {
      throw new PlannerTurnError('not_configured')
    }
    const { lines } = await runTurn(accept)
    // ⚠ THE ONE REASON IN THIS SET THAT IS ERROR, and the counterpart to the WARNING pinned above. A
    // missing ANTHROPIC_API_KEY on a live deploy means every rider on that instance hears the outage
    // line while /health and every 5xx alert stay green — the exact condition this event exists to make
    // visible. If it is ever flattened to the same severity as the healthy beats, it stops being
    // findable among them.
    expect(degradedLines(lines)).toEqual([{ severity: 'ERROR', evt: 'plan_degraded', reason: 'not_configured' }])
  })

  // ⚠ THE THREE REASONS THAT MUST STAY SILENT HERE, and each for its own reason: `timeout` and `upstream`
  // are ALREADY a structured `plan_spend` line with `outcome: 'failed'` (../src/planner), so counting them
  // again double-counts one failure; `client_gone` is a rider closing the app, which is not a degradation
  // at all and is the one thing that must never page an operator. Widening the throw-path helper to a
  // catch-all is the obvious "cleanup" — this is what goes red when someone does it.
  test.each(['timeout', 'upstream', 'client_gone'] as const)('%s emits NO plan_degraded line', async (reason) => {
    impl = async () => {
      throw new PlannerTurnError(reason)
    }
    const { lines } = await capture(async () => (await post(OK)).json())
    expect(degradedLines(lines)).toEqual([])
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
