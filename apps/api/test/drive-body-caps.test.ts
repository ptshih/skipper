// MAX_DRIVE_BODY_BYTES AT THE ROUTE (INV-3/INV-12, D32) — the other half of test/limits.test.ts.
//
// limits.test.ts proves `readBoundedText` measures real bytes rather than the caller's Content-Length.
// That is the mechanism. This file proves the mechanism is actually WIRED to both drive write routes,
// which is the part a refactor silently drops: `readJsonBody`'s first act used to be `await c.req.json()`,
// and going back to that typechecks, passes every existing test, and re-opens an unauthenticated path
// that buffers an unbounded body into memory before anything can object.
//
// ⚠ THE SHARED SCHEMA CANNOT DO THIS JOB, which is why the cap is not redundant with validation.
// `createDriveRequest`/`driveProposeRequest` are plain `z.object`s, so they STRIP unknown keys rather
// than rejecting them — a body of two legal anchor ids plus a megabyte of padding parses CLEANLY. Every
// oversized fixture below is exactly that shape, so a build with the cap removed does not 4xx: it
// succeeds. The byte cap is the only thing standing there.
//
// ⚠ AND THE CAP MUST NEVER 413 A REAL DRIVE. The last block derives the worst-case LEGAL body from the
// shared schema's own limits (probed, not hardcoded) and asserts the cap clears it, so shrinking the
// constant below what a legitimate request can carry is a red test rather than a rider-visible bug.
//
// ⚠ NEEDS NO SECRET, NO NETWORK AND NO DB — `../src/session` is mocked so the auth factory is never
// constructed (drive-access.test.ts's header explains why that laziness is load-bearing).
//
// ⚠ MODULE MOCKS ARE PROCESS-WIDE UNDER BUN. Every mock below SPREADS the real module and DELEGATES
// whenever this file is not driving; the `db` mock delegates through a PROXY because a mock factory runs
// once at import time, when `driving` is still false.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { createDriveRequest, driveProposeRequest } from '@skipper/shared'
import { MAX_DRIVE_BODY_BYTES } from '../src/limits'
import { ACCOUNT, ANON, type FakeSession } from './fixtures'

/** True only while a test in THIS file is driving; every mock delegates to the real module otherwise. */
let driving = false

/* ------------------------------- the session ------------------------------ */

// Session fixtures are shared (./fixtures); the mocks below stay here — they are process-wide.
let session: FakeSession = ANON

const realSession = { ...(await import('../src/session')) }
mock.module('../src/session', () => ({
  ...realSession,
  // ⚠ Forward BOTH arguments — session.test.ts passes { attempts, baseMs } and asserts the call count.
  resolveSessionSafely: (getSession: () => Promise<unknown>, opts?: { attempts?: number; baseMs?: number }) =>
    driving ? Promise.resolve(session) : realSession.resolveSessionSafely(getSession, opts),
}))

/* -------------------------------- the ledger ------------------------------ */

/** Reached only by a body that got PAST the cap, on the create path. Stubbed with a healthy balance so
 *  the credit gate can never be the thing that answers a test about bytes. */
const realCredits = { ...(await import('../src/credits')) }
mock.module('../src/credits', () => ({
  ...realCredits,
  ensureFreeGrant: async (userId: string) => (driving ? undefined : realCredits.ensureFreeGrant(userId)),
  creditSummary: async (userId: string) =>
    driving ? { remaining: 3, granted: 5 } : realCredits.creditSummary(userId),
}))

/* ---------------------------------- the db --------------------------------- */

/** Queries actually EXECUTED (counted in `then`, so builder chaining is free). `0` is the assertion on
 *  every 413 path — the cap's promise is that an oversized body costs nothing downstream. */
let dbQueries = 0

/** Every drizzle builder call this file can see, answering an empty result set. Empty is the honest
 *  answer: the fixtures below name anchor ids that are in no `places` row, so a legal-sized body ends at
 *  the allowlist's 400 — which is precisely the signal "the body was ACCEPTED". */
const queryStub: Record<string, unknown> = {}
for (const step of ['select', 'from', 'where', 'limit', 'innerJoin', 'orderBy']) {
  queryStub[step] = () => queryStub
}
queryStub.then = (resolve: (v: unknown[]) => unknown, reject: (e: unknown) => unknown) => {
  dbQueries++
  return Promise.resolve([]).then(resolve, reject)
}

const realDb = { ...(await import('@skipper/db')) }
const dbProxy = new Proxy(
  {},
  {
    get(_t, k) {
      if (!driving) return (realDb.db as unknown as Record<string | symbol, unknown>)[k]
      const hit = queryStub[k as string]
      if (hit === undefined) {
        throw new Error(
          `drive-body-caps.test.ts: unexpected db.${String(k)} — a request reached a query this file has ` +
            'no fixture for (a write?). Fix the request shape or the fixture; do NOT widen this to a no-op.',
        )
      }
      return hit
    },
  },
)
mock.module('@skipper/db', () => ({ ...realDb, db: dbProxy }))

/* -------------------------------- the router ------------------------------- */

/** ⚠ A pure TRIPWIRE here, with no recorder: nothing in this file may ever reach a billed Google Routes
 *  call. An oversized body must die at the cap and a legal one dies at the allowlist, so if this throws,
 *  a bytes test has started spending money. (The ordered hand-off INTO Routes is anchor-allowlist.test.ts's
 *  subject, not this file's.) */
const realRouting = { ...(await import('@skipper/routing')) }
let routesReached = 0
mock.module('@skipper/routing', () => ({
  ...realRouting,
  materializeRoute: async (waypoints: Parameters<typeof realRouting.materializeRoute>[0], apiKey?: string) => {
    if (!driving) {
      return apiKey === undefined
        ? realRouting.materializeRoute(waypoints)
        : realRouting.materializeRoute(waypoints, apiKey)
    }
    routesReached++
    throw new Error('drive-body-caps.test.ts: a body-cap test reached a BILLED Google Routes call')
  },
}))

/* --------------------------------- the app --------------------------------- */

// Imported AFTER the mocks so drives.ts's static imports resolve through them.
const { driveRoutes } = await import('../src/drives')

beforeEach(() => {
  driving = true
  session = ANON
})

afterEach(() => {
  driving = false
  session = ANON
  dbQueries = 0
  routesReached = 0
})

/** ⚠ A raw string body, never an object — the whole subject is BYTES, so nothing may re-serialize on the
 *  way in. Content-Type is set because the routes are JSON routes; the cap deliberately ignores headers. */
const post = (path: string, body: string) =>
  driveRoutes.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }),
  )

const START = '00000000-0000-4000-8000-000000000501'
const END = '00000000-0000-4000-8000-0000000000e0'

/**
 * A LEGAL, PARSEABLE request body padded to exactly `bytes` with an UNKNOWN key.
 *
 * ⚠ The padding rides in an unknown key on purpose. `z.object` strips those, so this body validates —
 * meaning a build whose cap was removed answers 200/400-from-the-allowlist, never 413. That is what makes
 * the oversized tests below measure the cap and nothing else.
 * All-ASCII, so `String.length === byteLength` (asserted, because that equality is the only reason this
 * helper may reason in characters at all).
 */
function bodyOfExactly(bytes: number): string {
  const shape = (padding: string) => JSON.stringify({ start: START, end: END, padding })
  const out = shape('x'.repeat(Math.max(0, bytes - shape('').length)))
  if (Buffer.byteLength(out, 'utf8') !== bytes) {
    throw new Error(`drive-body-caps.test.ts: could not build a ${bytes}-byte body (got ${out.length})`)
  }
  return out
}

/** One byte over is the only interesting size: the guard is `>`, so this is the first rejected body. */
const OVERSIZED = bodyOfExactly(MAX_DRIVE_BODY_BYTES + 1)

/* -------------------------------------------------------------------------- */

describe('POST /drives/propose — the ANONYMOUS path is bounded (INV-3)', () => {
  test('a body one byte over the cap is 413, before any DB or Routes work', async () => {
    const res = await post('/propose', OVERSIZED)
    expect(res.status).toBe(413)
    expect(((await res.json()) as { error?: string }).error).toBe('payload_too_large')
    // The cap's actual promise: an oversized anonymous request costs nothing downstream.
    expect(dbQueries).toBe(0)
    expect(routesReached).toBe(0)
  })

  test('the 413 echoes none of the body back (INV-13)', async () => {
    // A rider's request body is transient rider content; the refusal is a fixed string. This also keeps
    // the endpoint from becoming a reflector.
    const body = await (await post('/propose', OVERSIZED)).text()
    expect(body).not.toContain('xxxxxxxxxxxxxxxx')
    expect(body).not.toContain(START)
  })

  test('a body of EXACTLY the cap is accepted — the bound is `>`, not `>=`', async () => {
    // Pins which side of the boundary the constant sits on, and doubles as proof that the 413 above came
    // from the cap rather than from something else about large bodies. It gets past `readJsonBody`
    // entirely and dies at the curated-anchor allowlist, which is the "body accepted" signal here.
    const res = await post('/propose', bodyOfExactly(MAX_DRIVE_BODY_BYTES))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error?: string }).error).toBe('unknown_anchor')
  })
})

/* -------------------------------------------------------------------------- */

describe('POST /drives — the ACCOUNT path is bounded too', () => {
  test('⚠ an ACCOUNT session with an oversized body gets 413 — NOT the 401 an anonymous one would', async () => {
    // ⚠ THE FIXTURE IS THE TEST. `requireAccount` and the in-handler tier backstop both answer 401 BEFORE
    // the body is ever read, so an anonymous fixture here would pass while asserting nothing about bytes
    // — the classic "green for the wrong reason". `error: 'payload_too_large'` is what proves the request
    // travelled past the wall and was stopped by the CAP; the sibling test below shows the same bytes
    // stopping at 401 without an account, so this distinction is real and not incidental.
    session = ACCOUNT
    const res = await post('/', OVERSIZED)
    expect(res.status).toBe(413)
    expect(((await res.json()) as { error?: string }).error).toBe('payload_too_large')
    expect(dbQueries).toBe(0)
    expect(routesReached).toBe(0)
  })

  test('the same oversized body from an ANONYMOUS session stops at the wall (401) — the wrong-reason pass', async () => {
    session = ANON
    const res = await post('/', OVERSIZED)
    expect(res.status).toBe(401)
    expect(((await res.json()) as { error?: string }).error).toBe('account_required')
  })

  test('a body of EXACTLY the cap is accepted on the create path too', async () => {
    session = ACCOUNT
    const res = await post('/', bodyOfExactly(MAX_DRIVE_BODY_BYTES))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error?: string }).error).toBe('unknown_anchor')
  })
})

/* -------------------------------------------------------------------------- */

describe('⚠ the cap must never 413 a REAL drive', () => {
  /**
   * The largest `via` the SHARED schema will accept, discovered FROM THE SCHEMA rather than copied out
   * of it — the bound lives in packages/shared (INV-12 keeps request-SHAPE caps there, not in
   * ../src/limits), so a hardcoded number here would be a second home for it and would drift silently
   * the day someone widens the array.
   */
  function schemaMaxVia(): number {
    const probeCeiling = 64 // far above any plausible waypoint cap; asserted to be non-binding below
    let max = 0
    for (let n = 1; n <= probeCeiling; n++) {
      const via = Array.from({ length: n }, () => crypto.randomUUID())
      if (!createDriveRequest.safeParse({ start: START, end: END, via }).success) break
      max = n
    }
    return max
  }

  const maxVia = schemaMaxVia()

  /** The biggest request this API's own DTO calls legal: both endpoints, a full `via`, an idempotency
   *  key. Every field is a uuid, so this is a fixed size the schema itself determines. */
  const worstCaseLegalBody = JSON.stringify({
    start: START,
    end: END,
    via: Array.from({ length: maxVia }, () => crypto.randomUUID()),
    idempotencyKey: crypto.randomUUID(),
  })

  test('the probe actually found the schema’s ceiling', () => {
    // Without this, a schema that accepted ANY length would silently make `maxVia` the probe's own
    // ceiling and the drift guard below would measure the probe instead of the API.
    expect(maxVia).toBeGreaterThan(0)
    expect(maxVia).toBeLessThan(64)
    // The propose and create schemas share one `via` definition today. If they ever diverge, propose
    // could accept a body create rejects (or vice versa) while both still "have a cap" — assert they
    // agree, because the single MAX_DRIVE_BODY_BYTES below is sized for one worst case, not two.
    const via = Array.from({ length: maxVia }, () => crypto.randomUUID())
    expect(driveProposeRequest.safeParse({ start: START, end: END, via }).success).toBe(true)
  })

  test('MAX_DRIVE_BODY_BYTES clears the worst-case legal body with room to spare', () => {
    // The drift guard: shrink the constant under a legitimate request and this goes red here, instead of
    // going red in a rider's hand halfway through a create they were about to be charged for.
    expect(Buffer.byteLength(worstCaseLegalBody, 'utf8')).toBeLessThan(MAX_DRIVE_BODY_BYTES)
  })

  test('the worst-case legal body is NOT rejected by either route', async () => {
    // It travels the whole way to the allowlist on both paths — the shape of "accepted", since these ids
    // exist in no `places` row.
    const proposeRes = await post('/propose', worstCaseLegalBody)
    expect(proposeRes.status).not.toBe(413)
    expect(((await proposeRes.json()) as { error?: string }).error).toBe('unknown_anchor')

    session = ACCOUNT
    const createRes = await post('/', worstCaseLegalBody)
    expect(createRes.status).not.toBe(413)
    expect(((await createRes.json()) as { error?: string }).error).toBe('unknown_anchor')
    expect(routesReached).toBe(0)
  })
})
