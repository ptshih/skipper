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

import { afterAll, afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { drivePlanResponse, plannedRoute } from '@skipper/shared'
import { MAX_PLAN_BODY_BYTES, MAX_PLAN_MESSAGES } from '../src/limits'

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
}
type FakeTurn = { outcome: string; say: string; rawRoute: unknown }

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
