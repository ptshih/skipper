// THE CURATED-ANCHOR ALLOWLIST AT THE WIRE (INV-1) — the spec's own Acceptance line, which had no test:
// "POST /drives/propose REJECTS a non-anchor start, end, OR via midpoint with a 400 BEFORE any Routes call."
//
// ⚠ WHY THIS IS A COST FILE AND NOT A VALIDATION FILE. `POST /drives/propose` is the open anonymous
// front door (D14/D15) and it bills a Google Routes call on every request, forever, with no human in the
// loop (INV-11). The ONLY thing between a stranger and "route me between any two points on Earth" is
// that a request may name an endpoint solely by the id of an `endpoint_eligible` `places` row, re-asserted
// server-side. If that check ever moves AFTER `materializeRoute` — or quietly stops covering `via` — the
// endpoint keeps returning 200s and the regression is visible only on the GCP bill.
//
// So the assertion this file is built around is NEGATIVE: the Routes call NEVER HAPPENED. A status code
// alone cannot say that (a 400 issued after a billed call is still a 400), which is why
// `materializeRoute` is mocked as a recorder that THROWS — reaching it is both observable and fatal.
//
// ⚠ `via` IS HALF THE INVARIANT. It was `z.array(resolvedEndpoint)` while start/end were being hardened
// to ids: that satisfies "reject a non-anchor ENDPOINT" word-for-word while still shipping 8 arbitrary
// billable coordinates through the middle of the route. Guarding both ends and leaving the middle open is
// not a partial guarantee, it is none — hence a dedicated block below.
//
// ⚠ NEEDS NO SECRET, NO NETWORK AND NO DB. `../src/session` is mocked so the auth factory is never
// touched (see drive-access.test.ts for why that laziness is load-bearing); `@skipper/db` is a fixture
// that answers the places query from memory; `@skipper/routing` never reaches Google.
//
// ⚠ MODULE MOCKS ARE PROCESS-WIDE UNDER BUN — one registry for the whole run (the 96-pass/9-fail
// incident). Every mock below obeys both halves of the house rule: SPREAD the real module, and DELEGATE
// whenever this file is not driving (`driving === false`). The `db` mock delegates through a PROXY rather
// than a ternary in the factory, because a mock factory runs once at import time — when `driving` is
// still false — so a ternary there would hand drives.ts the real client forever.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { places } from '@skipper/db/schema'
import type { Waypoint } from '@skipper/routing'
import { ACCOUNT, ANON, type FakeSession } from './fixtures'

/** True only while a test in THIS file is driving; every mock delegates to the real module otherwise. */
let driving = false

/* ------------------------------- the session ------------------------------ */

// The session fixtures are shared (./fixtures) — the anonymous front door is the surface INV-1
// actually protects, so ANON is the default here. The mocks below stay in THIS file: they are
// process-wide.
let session: FakeSession = ANON

const realSession = { ...(await import('../src/session')) }
mock.module('../src/session', () => ({
  ...realSession,
  // ⚠ Forward BOTH arguments — session.test.ts passes { attempts, baseMs } and asserts the call count.
  resolveSessionSafely: (getSession: () => Promise<unknown>, opts?: { attempts?: number; baseMs?: number }) =>
    driving ? Promise.resolve(session) : realSession.resolveSessionSafely(getSession, opts),
}))

/* -------------------------------- the ledger ------------------------------ */

/** Only the create path touches these, and only after its credit gate. Stubbed so this file stays
 *  DB-free; the ledger's own semantics belong to credits.test.ts and drive-access.test.ts. */
const realCredits = { ...(await import('../src/credits')) }
mock.module('../src/credits', () => ({
  ...realCredits,
  ensureFreeGrant: async (userId: string) => (driving ? undefined : realCredits.ensureFreeGrant(userId)),
  creditSummary: async (userId: string) =>
    driving ? { remaining: 3, granted: 5 } : realCredits.creditSummary(userId),
}))

/* ----------------------------- the places table ---------------------------- */

interface PlaceFixture {
  id: string
  name: string
  lat: number
  lng: number
}

const START = '00000000-0000-4000-8000-000000000501'
const MID_1 = '00000000-0000-4000-8000-000000000a11'
const MID_2 = '00000000-0000-4000-8000-000000000a22'
const END = '00000000-0000-4000-8000-0000000000e0'
/** A real curated row a curator DE-LISTED. Must be indistinguishable from one that never existed. */
const DE_CURATED = '00000000-0000-4000-8000-0000000000d0'
/** Well-formed but in no `places` row. ⚠ Well-formed is load-bearing: a malformed id 400s at the shared
 *  schema instead, and the test would then be proving that Zod works rather than that the allowlist does. */
const UNKNOWN = '00000000-0000-4000-8000-0000000000ff'

/** ⚠ DELIBERATELY NOT IN REQUEST ORDER. `hydrateAnchors` must return waypoints in the CALLER's order,
 *  not the database's — `inArray` guarantees no ordering, and these are ROUTE WAYPOINTS, so a reorder
 *  silently buys a DIFFERENT (still billed) route. A fixture listed in request order would let a
 *  `rows.map(...)` mutant pass, which is the whole reason this array is shuffled. */
const PLACES: PlaceFixture[] = [
  { id: END, name: 'End Marina', lat: 39.0, lng: -120.0 },
  { id: MID_2, name: 'Second Mid', lat: 39.2, lng: -120.2 },
  { id: START, name: 'Start Pier', lat: 39.3, lng: -120.3 },
  { id: MID_1, name: 'Mid Lookout', lat: 39.1, lng: -120.1 },
  // ⚠ DE_CURATED IS DELIBERATELY ABSENT FROM THIS FIXTURE. Since 2026-08-04 there is no
  // "exists but ineligible" state: `places` holds destinations only, so PRUNING IS A DELETE. The id
  // below is therefore just a row that is not there, and the test named for it now asserts the same
  // thing the UNKNOWN case does — by construction rather than by matching error copy, which is
  // stronger than what it replaced.
]

/* ---------------------------------- the db --------------------------------- */

const dialect = new PgDialect()

/** How many queries this file's fixture answered — the "was the database reached at all" counter. */
let dbQueries = 0

/**
 * Answer `hydrateAnchors`'s query from the fixture, HONOURING THE PREDICATES THE QUERY ACTUALLY RENDERS.
 *
 * ⚠ IT RENDERS THE SQL rather than ignoring it, so "the right rows were requested" is OBSERVED rather
 * than assumed — the fixture answers only what the query actually asked for.
 *
 * ⚠ The eligibility-predicate machinery that used to live here is gone with the flag (2026-08-04). It
 * existed to fail if `hydrateAnchors` stopped asserting `endpoint_eligible = true`; there is no such
 * predicate now, because `places` holds destinations only and membership IS eligibility. The regression
 * it guarded cannot occur, and a check for a column that does not exist would be theatre.
 */
function answerPlacesQuery(where: unknown): Pick<PlaceFixture, 'id' | 'name' | 'lat' | 'lng'>[] {
  dbQueries++
  const { params } = dialect.sqlToQuery(where as SQL)
  const asked = new Set(params.filter((p): p is string => typeof p === 'string'))
  return PLACES.filter((r) => asked.has(r.id)).map(({ id, name, lat, lng }) => ({ id, name, lat, lng }))
}

const fakeDb: Record<string, unknown> = {
  select: () => ({
    from: (table: unknown) => ({
      where: (cond: unknown) => {
        // Every request in this file is shaped to end at the allowlist, so `places` is the only table
        // that may be read. Anything else means a request travelled further than the fixture believes
        // and the test has stopped measuring what it claims to.
        if (table !== places) {
          throw new Error('anchor-allowlist.test.ts: a request read a table other than `places`')
        }
        return Promise.resolve(answerPlacesQuery(cond))
      },
    }),
  }),
}

const realDb = { ...(await import('@skipper/db')) }
const dbProxy = new Proxy(
  {},
  {
    get(_t, k) {
      if (!driving) return (realDb.db as unknown as Record<string | symbol, unknown>)[k]
      const hit = fakeDb[k as string]
      if (hit === undefined) {
        throw new Error(
          `anchor-allowlist.test.ts: unexpected db.${String(k)} — a request reached a query this file ` +
            'has no fixture for. Fix the request shape or the fixture; do NOT widen this to a no-op.',
        )
      }
      return hit
    },
  },
)
mock.module('@skipper/db', () => ({ ...realDb, db: dbProxy }))

/* -------------------------------- the router ------------------------------- */

/** Thrown BY the Routes recorder. Both handlers map a materializeRoute throw to their own 422, so a 422
 *  in this file says "the billed call was reached" exactly as loudly as a non-empty `routeCalls` does. */
const ROUTES_REACHED = 'anchor-allowlist.test.ts: materializeRoute was REACHED (a billed Routes call)'

/** Every waypoint list handed to Routes, in call order. `[]` is the assertion for most of this file. */
const routeCalls: Waypoint[][] = []

const realRouting = { ...(await import('@skipper/routing')) }
mock.module('@skipper/routing', () => ({
  ...realRouting,
  /** ⚠ A RECORDER THAT THROWS, and both halves earn their keep. Recording is what lets the hand-off test
   *  assert waypoint ORDER; throwing is what stops every other request from continuing into the corpus
   *  read (which this file deliberately has no fixtures for) and what turns "we reached the bill" into a
   *  loud failure rather than a silently-correct 200. */
  materializeRoute: async (waypoints: readonly Waypoint[], apiKey?: string) => {
    if (!driving) {
      return apiKey === undefined
        ? realRouting.materializeRoute(waypoints)
        : realRouting.materializeRoute(waypoints, apiKey)
    }
    routeCalls.push([...waypoints])
    throw new Error(ROUTES_REACHED)
  },
}))

/* --------------------------------- the app --------------------------------- */

// Imported AFTER the mocks so drives.ts's static imports resolve through them.
const { driveRoutes } = await import('../src/drives')

/** The 422 branch logs. Hushed per-test so a deliberate recorder hit doesn't spray the suite output. */
let restoreConsole: (() => void) | null = null
function hushErrors() {
  const real = console.error
  console.error = () => {}
  restoreConsole = () => {
    console.error = real
  }
}

beforeEach(() => {
  driving = true
  session = ANON
})

afterEach(() => {
  driving = false
  session = ANON
  routeCalls.length = 0
  dbQueries = 0
  restoreConsole?.()
  restoreConsole = null
})

const call = (method: string, path: string, body: unknown) =>
  driveRoutes.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

/** Both billed sites, driven from one table. They carry INDEPENDENT copies of the check — each calls
 *  `hydrateAnchors` on its own chain, and create's copy sits deliberately late (after the idempotent
 *  replay and the credit gate) — so covering one proves nothing about the other. */
const BILLED_SITES: [name: string, path: string, session: FakeSession][] = [
  ['POST /drives/propose (the anonymous front door)', '/propose', ANON],
  ['POST /drives (past the wall and the credit gate)', '/', ACCOUNT],
]

/* -------------------------------------------------------------------------- */

describe('INV-1: an off-list endpoint is refused BEFORE any billed Routes call', () => {
  for (const [name, path, who] of BILLED_SITES) {
    test(`${name} — an UNKNOWN start anchor id is a 400, and Routes is never called`, async () => {
      session = who
      const res = await call('POST', path, { start: UNKNOWN, end: END })
      expect(res.status).toBe(400)
      // ⚠ `unknown_anchor` specifically, never "some 4xx": the shared schema answers `bad_request` for a
      // malformed id, so a status-only assertion would also pass on a build where the allowlist check
      // was deleted and Zod happened to reject this fixture for an unrelated reason.
      expect(((await res.json()) as { error?: string }).error).toBe('unknown_anchor')
      // THE ASSERTION THIS FILE EXISTS FOR.
      expect(routeCalls).toEqual([])
    })

    test(`${name} — an unknown END is refused too (the check is not start-only)`, async () => {
      session = who
      const res = await call('POST', path, { start: START, end: UNKNOWN })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error?: string }).error).toBe('unknown_anchor')
      expect(routeCalls).toEqual([])
    })

    test(`${name} — a PRUNED row is a 400, and Routes is never called`, async () => {
      // ⚠ Membership is re-asserted PER REQUEST, never trusted from whenever the client last saw the
      // list: a place can be pruned between a planner turn and the rider's confirm. Pruning is a DELETE
      // now, so the row is simply gone — which is why this and the UNKNOWN case are the same shape.
      session = who
      const res = await call('POST', path, { start: DE_CURATED, end: END })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error?: string }).error).toBe('unknown_anchor')
      expect(routeCalls).toEqual([])
    })
  }

  test('⚠ de-curated and never-existed are INDISTINGUISHABLE to the caller', async () => {
    // A 400 that said WHICH id failed, or that told "no such place" apart from "not eligible", would be
    // an oracle: it turns an unauthenticated endpoint into a probe that enumerates the curated set — the
    // set whose ids are the only thing on Earth that can bill this Routes call. Byte-identical or bust.
    const unknown = await call('POST', '/propose', { start: UNKNOWN, end: END })
    const decurated = await call('POST', '/propose', { start: DE_CURATED, end: END })
    expect(unknown.status).toBe(decurated.status)
    expect(await unknown.text()).toBe(await decurated.text())
    // …and the answer names no id and no place at all.
    const body = await (await call('POST', '/propose', { start: DE_CURATED, end: END })).text()
    expect(body).not.toContain(DE_CURATED)
    expect(body).not.toContain('De-curated Overlook')
    expect(routeCalls).toEqual([])
  })

  test('a MALFORMED id never even reaches the database', async () => {
    // The shared schema (`anchorId` = z.uuid()) is the outer layer, and it matters for cost too: free
    // text is precisely the endpoint shape that used to flow straight into a billed call.
    const res = await call('POST', '/propose', { start: 'Emerald Bay', end: END })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error?: string }).error).toBe('bad_request')
    expect(dbQueries).toBe(0)
    expect(routeCalls).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */

describe('⚠ INV-1 covers the MIDDLE of the route too — `via` goes through the allowlist', () => {
  for (const [name, path, who] of BILLED_SITES) {
    test(`${name} — an UNKNOWN via midpoint is a 400 before Routes`, async () => {
      // The half the spec called out as missing. `via` was `z.array(resolvedEndpoint)` while start/end
      // were hardened to ids — which satisfies "reject a non-anchor endpoint" verbatim while still
      // shipping arbitrary billable coordinates through the middle of the same single Routes request.
      session = who
      const res = await call('POST', path, { start: START, end: END, via: [UNKNOWN] })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error?: string }).error).toBe('unknown_anchor')
      expect(routeCalls).toEqual([])
    })

    test(`${name} — a DE-CURATED via midpoint is a 400 before Routes`, async () => {
      session = who
      const res = await call('POST', path, { start: START, end: END, via: [MID_1, DE_CURATED] })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error?: string }).error).toBe('unknown_anchor')
      expect(routeCalls).toEqual([])
    })

    test(`${name} — ONE bad midpoint poisons the whole request (no partial resolve)`, async () => {
      // Deliberately all-or-nothing: dropping the unresolvable midpoint and routing the rest would send
      // the rider somewhere they did not ask to go — on a call they were charged for.
      session = who
      const res = await call('POST', path, { start: START, end: END, via: [MID_1, UNKNOWN, MID_2] })
      expect(res.status).toBe(400)
      expect(routeCalls).toEqual([])
    })
  }

  test('a free-text via midpoint (the pre-hardening shape) is refused by the schema', async () => {
    // `{name, lat, lng}` is exactly what `via` used to carry. It must not parse at all any more.
    const res = await call('POST', '/propose', {
      start: START,
      end: END,
      via: [{ name: 'Somewhere off-list', lat: 39.9, lng: -120.9 }],
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error?: string }).error).toBe('bad_request')
    expect(dbQueries).toBe(0)
    expect(routeCalls).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */

describe('the allowlist HANDS OFF in order — a reordered waypoint list is a different, billed route', () => {
  test('propose passes [start, ...via, end] to Routes in the CALLER’s order', async () => {
    hushErrors()
    const res = await call('POST', '/propose', { start: START, end: END, via: [MID_1, MID_2] })
    // The recorder throws, so the handler answers its own no_route branch. Reaching Routes at all is the
    // point of this test, and stopping there is what keeps the file free of corpus fixtures.
    expect(res.status).toBe(422)
    expect(routeCalls.length).toBe(1)
    // ⚠ ORDER, not membership. `inArray` returns rows in whatever order Postgres likes and PLACES above
    // is deliberately shuffled, so a handler that mapped the QUERY RESULT instead of the caller's id list
    // would produce ['End Marina','Second Mid','Start Pier','Mid Lookout'] here.
    expect(routeCalls[0]!.map((w) => w.label)).toEqual([
      'Start Pier',
      'Mid Lookout',
      'Second Mid',
      'End Marina',
    ])
    // …and the coordinates are the SERVER's, read from the curated row — never anything a request sent.
    expect(routeCalls[0]![0]).toEqual({ label: 'Start Pier', lat: 39.3, lng: -120.3 })
    expect(routeCalls[0]![3]).toEqual({ label: 'End Marina', lat: 39.0, lng: -120.0 })
  })

  test('create passes the same ordered list on its own chain', async () => {
    hushErrors()
    session = ACCOUNT
    const res = await call('POST', '/', { start: START, end: END, via: [MID_1] })
    expect(res.status).toBe(422)
    expect(routeCalls.length).toBe(1)
    expect(routeCalls[0]!.map((w) => w.label)).toEqual(['Start Pier', 'Mid Lookout', 'End Marina'])
  })

  test('⚠ a LOOP re-expands the deduped id — start and end are the SAME anchor', async () => {
    // A round trip is `end === start` plus one midpoint (start == end alone is a degenerate zero-distance
    // route). The query dedupes the id set, so the caller's list has to be re-expanded from the lookup
    // map — a handler that returned the query's rows would hand Routes only two waypoints and quietly
    // bill for a one-way drive to the midpoint.
    hushErrors()
    const res = await call('POST', '/propose', { start: START, end: START, via: [MID_1] })
    expect(res.status).toBe(422)
    expect(routeCalls[0]!.map((w) => w.label)).toEqual(['Start Pier', 'Mid Lookout', 'Start Pier'])
  })
})
