/**
 * `GET /regions` AND `GET /bootstrap` — the memo, and the release gate it must never cross.
 *
 * ⚠ BOTH ROUTES LIVE HERE ON PURPOSE, and it is the lesson of a real outage rather than tidiness.
 * They answer the same question through the same `loadRegionsPayload`, and `/bootstrap` took over
 * the cold open's region list on 2026-08-04 (`5d842738`) with NO test of any kind while this file
 * guarded `/regions` carefully. Two days later the admin staged-region preview was found broken.
 * (That defect was on the CLIENT — `getBootstrap` passed `anonymous: true`, so the session never
 * reached the server and `isAdmin` could not fire; the client half is pinned in
 * `apps/mobile/src/lib/api-source.test.ts`.) A guarantee proven on one route says nothing about the
 * other, so proving it twice, here, is what stops the next split from being silent.
 * ⚠ And they must share ONE FILE rather than one each: bun's `mock.module` is PROCESS-WIDE, so a
 * second file mocking `@skipper/db` and `../src/session` poisons this one and `session.test.ts`
 * (measured — it passed alone and broke three suites). Add route cases here, not in a new file.
 *
 * The route memoizes its response because it is hit on every app launch and its answer changes only
 * when an operator releases a region or re-runs `curate-places`. A cache in front of a RELEASE-GATED
 * endpoint is exactly the shape that leaks unreleased content, so the rules are pinned here:
 *
 *   1. A rider's (anonymous) response is memoized and served without touching the DB again.
 *   2. An ADMIN never reads the memo — someone checking a staged region before releasing it must see
 *      the real answer, not a cached public one.
 *   3. An ADMIN response is never WRITTEN to the memo — otherwise the next rider is served unreleased
 *      regions, violating "public read paths serve released_at IS NOT NULL only".
 *
 * Rule 3 is the one worth the whole file. It is invisible in review, produces no error, and would
 * hand strangers a region the operator has not published.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Same seed + same reason as cors.test.ts: ../src/index calls `assertAuthEnv()` at top level.
process.env.BETTER_AUTH_SECRET ??= 'test-only-secret-that-signs-nothing-real'

// Only `regions` is needed: the stub keys on "is this the regions table?" and everything else falls
// through to the places rows.
const { regions } = await import('@skipper/db/schema')

/** Rows the stub serves, and a counter proving whether the DB was reached at all. */
let regionRows: unknown[] = []
let placeRows: unknown[] = []
let selects = 0

/** A drizzle query-builder stub: every chained method returns itself, and the terminal await
 *  resolves to the rows for whichever table `.from()` was handed. */
function chain(rows: unknown[]) {
  const self: Record<string, unknown> = {
    where: () => self,
    orderBy: () => self,
    limit: () => self,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(res, rej),
  }
  return self
}

const realDb = { ...(await import('@skipper/db')) }
mock.module('@skipper/db', () => ({
  ...realDb,
  db: {
    select: () => {
      selects++
      return { from: (t: unknown) => chain(t === regions ? regionRows : placeRows) }
    },
  },
}))

/** Who the next request is. null = an ordinary rider; ADMIN = the founder checking a staged region.
 *  Mocked at ./session, which is where `withSession` resolves through — so no auth crypto or env is
 *  involved and the middleware under test is the real one. */
let sessionToReturn: unknown = null
const ADMIN = { user: { id: 'admin-1', role: 'admin', isAnonymous: false } }
const realSession = { ...(await import('../src/session')) }
mock.module('../src/session', () => ({
  ...realSession,
  resolveSessionSafely: async () => sessionToReturn,
}))

const origWarn = console.warn
console.warn = () => {}
const app = (await import('../src/index')).default
console.warn = origWarn

const RELEASED = { id: 'r1', slug: 'lake-tahoe', displayName: 'Lake Tahoe', bbox: null }
const STAGED = { id: 'r2', slug: 'yosemite', displayName: 'Yosemite', bbox: null }

const get = () => app.fetch(new Request('http://localhost/regions'))
const names = async (res: Response) =>
  ((await res.json()) as { regions: { displayName: string }[] }).regions.map((r) => r.displayName)

// The memo is module state that survives between tests, so each case populates what it needs.
// `selects` resets per test to measure only that test.
beforeEach(() => {
  selects = 0
  regionRows = [RELEASED]
  placeRows = []
  sessionToReturn = null
})

describe('the rider memo', () => {
  test('serves the payload and, on a repeat, without touching the DB again', async () => {
    expect(await names(await get())).toEqual(['Lake Tahoe'])
    const afterFirst = selects
    selects = 0
    expect(await names(await get())).toEqual(['Lake Tahoe'])
    // The point of the whole change: a second app launch costs zero queries.
    expect(selects).toBe(0)
    // And the first one ran BOTH queries — if this is 1, the parallelisation dropped a query rather
    // than parallelising it.
    expect(afterFirst).toBeGreaterThanOrEqual(2)
  })
})

describe('the release gate the memo must not cross', () => {
  test('an admin does NOT read the memo', async () => {
    await get() // populate as a rider
    selects = 0
    sessionToReturn = ADMIN
    await get()
    // An admin must reach the DB even when a fresh rider payload is cached — someone checking a
    // region before release cannot be served the public answer.
    expect(selects).toBeGreaterThan(0)
  })

  test('AN ADMIN RESPONSE IS NEVER MEMOIZED — the leak this file exists for', async () => {
    // The admin sees the unreleased region (the stub stands in for the unfiltered query).
    sessionToReturn = ADMIN
    regionRows = [RELEASED, STAGED]
    expect(await names(await get())).toContain('Yosemite')

    // Now an ordinary rider, and the DB has gone back to serving only released rows. If that admin
    // response had been cached, they would be handed Yosemite — a region the operator has not
    // published — with no error, no log, and nothing else in the system disagreeing.
    sessionToReturn = null
    regionRows = [RELEASED]
    expect(await names(await get())).toEqual(['Lake Tahoe'])
  })

  test('an admin read does not poison a later rider read either', async () => {
    await get() // rider payload cached
    sessionToReturn = ADMIN
    regionRows = [RELEASED, STAGED]
    await get()
    sessionToReturn = null
    regionRows = [RELEASED]
    expect(await names(await get())).not.toContain('Yosemite')
  })
})

describe('GET /bootstrap honours the same gate — the route that shipped without one', () => {
  // ⚠ The stub does NOT re-implement the release filter: it returns whatever it is handed. So a rider
  // case seeds only released rows (standing in for the filtered query) and an admin case seeds both.
  // What is under test is which of those the route ASKS for — i.e. that `isAdmin` reaches
  // `loadRegionsPayload` at all, which is precisely what the outage broke.
  const boot = () => app.fetch(new Request('http://localhost/bootstrap?rotation=0'))

  test('an anonymous rider sees released regions only', async () => {
    expect(await names(await boot())).toEqual(['Lake Tahoe'])
  })

  test('a signed-in NON-admin is still just a rider', async () => {
    // The bypass is `isAdmin`, never "has an account" — a free account is not an operator.
    sessionToReturn = { user: { id: 'rider-1', role: 'user', isAnonymous: false } }
    expect(await names(await boot())).toEqual(['Lake Tahoe'])
  })

  test('AN ADMIN SEES THE STAGED REGION — the outage these cases were added for', async () => {
    sessionToReturn = ADMIN
    regionRows = [RELEASED, STAGED]
    expect(await names(await boot())).toContain('Yosemite')
  })

  test('an admin response is never served to the next rider here either', async () => {
    sessionToReturn = ADMIN
    regionRows = [RELEASED, STAGED]
    await boot()
    sessionToReturn = null
    regionRows = [RELEASED]
    expect(await names(await boot())).not.toContain('Yosemite')
  })
})
