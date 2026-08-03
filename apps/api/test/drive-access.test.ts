// Request-level proof of the /drives ACCESS BOUNDARY (1.1 step 8a — D15/INV-15).
//
// ⚠ THIS FILE IS THE PRIMARY CONTROL FOR INV-15, not the deploy ordering. The hazard is INTRA-8a:
// 8a moved `requireAccount` off the `/drives*` mount onto five individual owner routes, and if it
// missed ONE, the route that lost its gate WRITES — `GET /` materializes the free grant, `POST /`
// spends a credit — against an anonymous user id better-auth HARD-DELETES at link with no FK, no
// cascade and no `purgeUserData` (INV-4), stranding a row forever in an append-only ledger that has
// no second copy. Shipping order cannot detect a missing gate. A request can. "Deploy 8a before the
// mobile mint" remains an unchanged OPERATIONAL instruction; it is simply no longer the mitigation.
//
// ⚠ NEEDS NO SECRET AND NO DB, and both are load-bearing. `../src/drives` reaches `../src/entitlements`
// -> `../src/auth`, which is a LAZY MEMOIZED proxy since the step-8 pre-work precisely so this file can
// exist. The `../src/session` mock below means the auth factory is never touched. Do NOT "fix" a future
// failure here by seeding BETTER_AUTH_SECRET or DATABASE_URL — if this file starts needing either, the
// laziness regressed and THAT is the bug, not the test.
//
// ⚠ MODULE MOCKS LEAK BETWEEN FILES UNDER BUN — one process, one module registry (see
// plan-stream.test.ts's header and the 96-pass/9-fail incident). Every mock below obeys both rules:
// SPREAD the real module, and DELEGATE whenever this file is not driving (`current === null`).

import { afterEach, describe, expect, mock, test } from 'bun:test'
import { DRIVE_CREATE_RATE } from '../src/limits'
import { ACCOUNT, ANON, type FakeSession } from './fixtures'

/* ------------------------------- the session ------------------------------ */

// `FakeSession` is structurally what `tierOf` (@skipper/shared) and drives.ts's
// `c.get('session')?.user.id` read — declared once rather than reproducing better-auth's full
// inferred Session type.
//
// ⚠ ANON/ACCOUNT are SHARED (./fixtures), and ANON is load-bearing in two different ways that are not
// the same field — the mutation check that keeps this file honest (flip `isAnonymous` and 8 tests here
// must go red) is written out there. Read it before editing either fixture.

/** What this file wants the session resolver to answer.
 *  - a FakeSession → that session
 *  - `'none'`      → no session at all, WITHOUT delegating. ⚠ The sentinel exists because delegating
 *                    would run the real resolver, whose thunk is `auth.api.getSession` — which builds
 *                    the auth instance and drags BETTER_AUTH_SECRET back in, re-breaking the exact
 *                    property this file rests on.
 *  - `null`        → this file is NOT driving: delegate to the real fail-open resolver, so
 *                    session.test.ts keeps calling the real one with its own thunks. */
let current: FakeSession | 'none' | null = null

const realSession = { ...(await import('../src/session')) }
mock.module('../src/session', () => ({
  ...realSession,
  // ⚠ Forward BOTH arguments — session.test.ts passes { attempts, baseMs } and asserts the call count.
  resolveSessionSafely: (
    getSession: () => Promise<unknown>,
    opts?: { attempts?: number; baseMs?: number },
  ) =>
    current === null
      ? realSession.resolveSessionSafely(getSession, opts)
      : Promise.resolve(current === 'none' ? null : current),
}))

/* ------------------------------- the ledger ------------------------------- */

/** INV-15's hazard is a WRITE, so this file asserts the write is never REACHED — not just that the
 *  status is 401. A 401 issued after the grant row was written is still a 401.
 *  Same spread+delegate discipline; credits.test.ts only exercises the pure builders, which the
 *  spread passes straight through untouched. */
const realCredits = { ...(await import('../src/credits')) }
const ledgerTouches: string[] = []
mock.module('../src/credits', () => ({
  ...realCredits,
  ensureFreeGrant: async (userId: string) => {
    ledgerTouches.push(`ensureFreeGrant:${userId}`)
    if (current !== null) return // driving: record the touch, never reach the DB
    return realCredits.ensureFreeGrant(userId)
  },
  creditSummary: async (userId: string) => {
    ledgerTouches.push(`creditSummary:${userId}`)
    return current !== null ? { remaining: 3, granted: 5 } : realCredits.creditSummary(userId)
  },
}))

/* ------------------------------ the DB tripwire ---------------------------- */

/** ⚠ dev and prod share ONE Neon database — there is no staging. Every request below is SHAPED to
 *  land on a DB-free early return, but "shaped to" is an argument, not a guarantee, and a developer
 *  running `dotenvx run -- bun test` would have a live production connection. So make the argument
 *  enforceable: while this file is driving, any property read on `db` throws a NAMED error instead of
 *  issuing a query. It turns "this request quietly reached the database" into a loud failure that says
 *  so. When idle it delegates, so the lazy client behaves exactly as it does for every other file. */
const realDb = { ...(await import('@skipper/db')) }
const dbTripwire = new Proxy(
  {},
  {
    get(_t, k) {
      if (current !== null) {
        throw new Error(
          'DB TOUCHED — a request in drive-access.test.ts reached @skipper/db. Either a route lost its ' +
            'gate, or the request fixture stopped hitting its DB-free early return. Fix the route or the ' +
            'fixture; do NOT delete this tripwire.',
        )
      }
      return (realDb.db as unknown as Record<string | symbol, unknown>)[k]
    },
  },
)
mock.module('@skipper/db', () => ({ ...realDb, db: dbTripwire }))

/* --------------------------------- the app -------------------------------- */

// Imported AFTER the mocks so drives.ts's static imports resolve through them.
const { requireAccount, withSession } = await import('../src/entitlements')
const { driveRoutes } = await import('../src/drives')

afterEach(() => {
  current = null
  ledgerTouches.length = 0
})

/** ⚠ Not a UUID, on purpose: it trips drives.ts's `UUID_RE` guard BEFORE any db call, so a route that
 *  LOST its gate lands on a DB-free 404 rather than a query. The status still differs from 401, so the
 *  assertion still fails — the test keeps its teeth without ever being able to reach Neon. */
const BAD_UUID = 'not-a-uuid'

const call = (method: string, path: string, body?: unknown) =>
  driveRoutes.fetch(
    new Request(`http://localhost${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    }),
  )

/** The five OWNER routes. `POST /propose` is deliberately NOT here — it is the open anonymous front
 *  door (D14). Each body/path is chosen so an ungated request early-returns without touching the DB. */
const OWNER_ROUTES: [name: string, method: string, path: string, body?: unknown][] = [
  ['POST /drives', 'POST', '/', { start: 'x' }],
  ['GET /drives', 'GET', '/'],
  ['GET /drives/:id', 'GET', `/${BAD_UUID}`],
  ['POST /drives/:id/assets/sign', 'POST', `/${BAD_UUID}/assets/sign`],
  ['DELETE /drives/:id', 'DELETE', `/${BAD_UUID}`],
]

/* -------------------------------------------------------------------------- */

describe('the /drives account wall is PER-ROUTE (1.1 step 8a, D15/INV-15)', () => {
  for (const [name, method, path, body] of OWNER_ROUTES) {
    test(`${name} — 401 for an ANONYMOUS session`, async () => {
      current = ANON
      const res = await call(method, path, body)
      // ⚠ 401 SPECIFICALLY, never "not 200". `loadOwnedDrive` answers 404 on a miss, so a "not 200"
      // assertion would happily pass on a wide-open `GET /:id` that merely failed to find a drive.
      expect(res.status).toBe(401)
      const json = (await res.json()) as { error?: string; message?: string }
      expect(json.error).toBe('account_required')
      // ⚠ WHICH LAYER ANSWERED. `requireAccount` (../src/entitlements) sends a rider-facing `message`;
      // `GET /`'s in-handler backstop deliberately sends `{ error }` alone. So requiring a message is
      // what distinguishes "the gate refused" from "the gate was missing and the backstop caught it" —
      // and for `GET /` that is the difference this whole file exists to detect.
      expect(typeof json.message).toBe('string')
      expect(json.message).toBeTruthy()
    })
  }

  for (const [name, method, path, body] of OWNER_ROUTES) {
    test(`${name} — 401 with NO session at all`, async () => {
      current = 'none'
      const res = await call(method, path, body)
      // Pins the fail-open path in the SAFE direction: `resolveSessionSafely` degrading to null must
      // 401 an owner route, never fall through. A future `tierOf` that only special-cased
      // `isAnonymous` would open the door to a caller with no cookie; this catches that.
      expect(res.status).toBe(401)
    })
  }

  for (const [name, method, path, body] of OWNER_ROUTES) {
    test(`${name} — an ACCOUNT is NOT turned away`, async () => {
      current = ACCOUNT
      // ⚠ `GET /` has no DB-free early return for a real account, so it hits the tripwire above and
      // hono's default handler turns that into a 500 (after ./retry's bounded backoff, which logs).
      // That is the intended outcome: reaching the query IS proof the request got past the wall. Keep
      // the console quiet so the suite output stays readable.
      const [warn, error] = [console.warn, console.error]
      console.warn = () => {}
      console.error = () => {}
      try {
        const res = await call(method, path, body)
        // Deliberately NOT `toBe(200)` — these handlers need a database and this file has none. What
        // the wall owes us is only that a real account is not refused.
        expect(res.status).not.toBe(401)
      } finally {
        console.warn = warn
        console.error = error
      }
    })
  }

  test('⚠ INV-15 PROPER: an anonymous GET /drives never reaches the credit ledger', async () => {
    // The hazard is a WRITE, not a status code. `GET /drives` calls `ensureFreeGrant(userId)`, which
    // INSERTs a `free:<userId>` grant — and against an anonymous id that row outlives the user row
    // better-auth hard-deletes at link (INV-4), in an append-only ledger with no second copy.
    current = ANON
    const res = await call('GET', '/')
    expect(res.status).toBe(401)
    expect(ledgerTouches).toEqual([])
  })

  test('⚠ INV-15 PROPER: an anonymous POST /drives never reaches the credit ledger', async () => {
    current = ANON
    const res = await call('POST', '/', { start: 'x' })
    expect(res.status).toBe(401)
    expect(ledgerTouches).toEqual([])
  })

  test('an ANONYMOUS flood of POST /drives never burns the create limiter’s per-IP token', async () => {
    // ⚠ This is the request-level pin for E-D's ordering call: `requireAccount` runs BEFORE
    // `createDriveLimiter`, so an anonymous flood cannot spend a real rider's shared-IP token (the
    // limiter is keyed by IP, and behind a carrier NAT that IP is shared with paying riders).
    // It is also the only assertion in this file that goes RED if `POST /` alone loses its gate: the
    // in-handler backstop returns the SAME 401 body as the gate, so status/body cannot tell them
    // apart — but the limiter can, because it only ever increments when the gate is gone.
    // ⚠ ../src/rate-limit no-ops under NODE_ENV=test (so the suite can't trip it), so this test has to
    // lift that for its own duration. Restored in `finally`.
    const savedEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    current = ANON
    try {
      const statuses: number[] = []
      // One MORE than the limit: with the gate in front, every one of these is refused before the
      // bucket is touched. Without it, request #(limit+1) comes back 429.
      for (let i = 0; i <= DRIVE_CREATE_RATE.limit; i++) {
        statuses.push((await call('POST', '/', { start: 'x' })).status)
      }
      expect(statuses.every((s) => s === 401)).toBe(true)
      expect(statuses).not.toContain(429)
    } finally {
      process.env.NODE_ENV = savedEnv
    }
  })
})

describe('POST /drives/propose is the OPEN anonymous front door (D14)', () => {
  test('an anonymous caller is NOT walled — the request reaches the handler', async () => {
    current = ANON
    const res = await call('POST', '/propose', { start: 'x' })
    // 400 from readJsonBody's shape check — reached BEFORE `hydrateAnchors`, so no DB and no billed
    // Google Routes call. The assertion that matters is the NEGATIVE one: re-adding `requireAccount`
    // to the `driveRoutes.use('*', …)` mount turns this into a 401 and this test goes red.
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error?: string }).error).toBe('bad_request')
  })

  test('an unauthenticated caller (no session) is not walled either', async () => {
    current = 'none'
    const res = await call('POST', '/propose', { start: 'x' })
    expect(res.status).toBe(400)
  })

  test('the session still resolves on /propose — withSession stays on the mount', async () => {
    // `isAdmin(c.get('session'))` is what widens the propose corpus to STAGED clips (INV-5). Dropping
    // withSession from the mount while moving requireAccount off it would leave `session` undefined
    // and silently downgrade every admin preview — a change with no error and no failing test.
    current = ACCOUNT
    const res = await call('POST', '/propose', { start: 'x' })
    expect(res.status).toBe(400) // reached the handler, so the middleware chain ran
  })
})

/* -------------------------------------------------------------------------- */

describe('⚠ the route table itself is PINNED (the guard that catches the NEXT route)', () => {
  // The five hard-coded cases above can only see routes that exist today. This block is what makes a
  // route added later — `POST /drives/:id/ask` is already named in ../src/entitlements — impossible to
  // land unwalled. Hono records `{ basePath, path, method, handler }` per registered handler and never
  // wraps it, so handler IDENTITY is comparable (verified by this suite passing).

  /** Every (method path) whose chain includes `requireAccount`. */
  const gated = new Set(
    driveRoutes.routes.filter((r) => r.handler === requireAccount).map((r) => `${r.method} ${r.path}`),
  )

  /** Routes that are anonymous-reachable ON PURPOSE. Adding to this list is a security decision and
   *  should be argued in review — that is the entire point of it being explicit. */
  const OPEN = new Set(['POST /propose'])

  test('exactly the five OWNER routes carry requireAccount', () => {
    expect(gated).toEqual(
      new Set(['POST /', 'GET /', 'GET /:id', 'POST /:id/assets/sign', 'DELETE /:id']),
    )
  })

  test('⚠ the MOUNT is not walled — a blanket gate would re-wall the anonymous preview', () => {
    // The exact regression drives.ts and entitlements.ts both warn about: `use('*', …, requireAccount)`
    // silently re-walls `POST /propose`, the whole D14 preview, as a 401 that reads like an auth bug
    // rather than a routing one.
    expect(gated.has('ALL /*')).toBe(false)
  })

  test('EVERY registered route is either gated or on the explicit OPEN list', () => {
    const unaccounted = driveRoutes.routes
      .filter((r) => r.method !== 'ALL') // the withSession mount, asserted separately below
      .map((r) => `${r.method} ${r.path}`)
      .filter((k) => !gated.has(k) && !OPEN.has(k))
    // Named rather than boolean so the failure message says WHICH route someone forgot.
    expect([...new Set(unaccounted)]).toEqual([])
  })

  test('withSession is still on the mount', () => {
    // Without this, someone "cleaning up" the mount alongside the gate would strip the session and
    // every owner route would 401 a signed-in rider — while all the anonymous tests above stayed green.
    const mounted = driveRoutes.routes.some(
      (r) => r.method === 'ALL' && r.path === '/*' && r.handler === withSession,
    )
    expect(mounted).toBe(true)
  })

  test('on POST /, requireAccount is the FIRST handler — before the create limiter', () => {
    // E-D: the gate is pure in-memory, the limiter MUTATES a per-IP bucket. Gate-first is what keeps
    // an anonymous flood from burning a real rider's shared-IP token (exercised behaviourally above).
    const chain = driveRoutes.routes.filter((r) => r.method === 'POST' && r.path === '/')
    expect(chain.length).toBeGreaterThan(1) // gate + limiter + handler
    expect(chain[0]?.handler).toBe(requireAccount)
  })
})
