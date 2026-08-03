/**
 * `GET /regions` — the memo, and the release gate it must never cross.
 *
 * The route memoizes its response because it is hit on every app launch and its answer changes only
 * when an operator releases a region or re-runs `curate-places`. A cache in front of a RELEASE-GATED
 * endpoint is exactly the shape that leaks unreleased content, so the rules are pinned here:
 *
 *   1. The default (anonymous) response is memoized and served without touching the DB again.
 *   2. `?includeStaged=1` NEVER reads the memo — an admin checking a staged region must see the real
 *      answer, not a cached public one.
 *   3. A staged response is NEVER written to the memo — otherwise the next anonymous rider would be
 *      served unreleased regions, violating "public read paths serve released_at IS NOT NULL only".
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
 *  Mocked at ./session rather than at auth so no crypto or env is involved — the route calls
 *  `resolveSessionSafely` directly now that the staged path is opt-in. */
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

const get = (path: string) => app.fetch(new Request(`http://localhost${path}`))
const names = async (res: Response) =>
  ((await res.json()) as { regions: { displayName: string }[] }).regions.map((r) => r.displayName)

// The memo is module state that survives between tests, so each case starts from a known cache by
// letting the first request populate it. `selects` is reset per test to measure only that test.
beforeEach(() => {
  selects = 0
  regionRows = [RELEASED]
  placeRows = []
  sessionToReturn = null
})

describe('the anonymous memo', () => {
  test('serves the payload and, on a repeat, without touching the DB again', async () => {
    expect(await names(await get('/regions'))).toEqual(['Lake Tahoe'])
    const afterFirst = selects
    selects = 0
    expect(await names(await get('/regions'))).toEqual(['Lake Tahoe'])
    // The point of the whole change: a second app launch costs zero queries.
    expect(selects).toBe(0)
    // And the first one ran BOTH queries — if this is 1, the parallelisation dropped a query rather
    // than parallelising it.
    expect(afterFirst).toBeGreaterThanOrEqual(2)
  })
})

describe('the release gate the memo must not cross', () => {
  test('?includeStaged=1 does NOT read the memo', async () => {
    await get('/regions') // populate
    selects = 0
    sessionToReturn = ADMIN
    await get('/regions?includeStaged=1')
    // A staged request must reach the DB even when a fresh anonymous payload is cached — an admin
    // checking a region before release cannot be served the public answer.
    expect(selects).toBeGreaterThan(0)
  })

  test('AN ADMIN PREVIEW IS NEVER MEMOIZED — the leak this file exists for', async () => {
    // The admin sees the unreleased region (the stub stands in for the unfiltered query).
    sessionToReturn = ADMIN
    regionRows = [RELEASED, STAGED]
    expect(await names(await get('/regions?includeStaged=1'))).toContain('Yosemite')

    // Now an ordinary rider, and the DB has gone back to serving only released rows. If that admin
    // response had been cached, they would be handed Yosemite — a region the operator has not
    // published — with no error, no log, and nothing else in the system disagreeing.
    sessionToReturn = null
    regionRows = [RELEASED]
    expect(await names(await get('/regions'))).toEqual(['Lake Tahoe'])
  })

  test('the param alone grants nothing — a non-admin sending it still gets the public answer', async () => {
    // `?includeStaged=1` is a hint about whether the question is worth asking, never a bypass:
    // `isAdmin` still decides, so a stranger who discovers the param gains no visibility. (They do
    // spend a session read, which is exactly the cost the opt-in is meant to move onto whoever asks.)
    sessionToReturn = null
    const res = await get('/regions?includeStaged=1')
    expect(await names(res)).toEqual(['Lake Tahoe'])
  })
})
