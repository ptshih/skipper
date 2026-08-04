// GOOGLE WILL ROUTE A DRIVE UP A GATED FOREST TRACK, AND SAYS SO IN EXACTLY ONE PLACE.
// docs/decisions/undrivable-endpoint-anchors.md — the wire half of the rule; the corpus half is
// `audit-endpoint-routability` (packages/studio), which chases the bad anchor down BY NAME.
//
// ⚠ WHY A GATE AND NOT A REQUEST PARAMETER. Routes has no avoid-unpaved and no avoid-private:
// `routeModifiers` is exactly avoidTolls / avoidHighways / avoidFerries / avoidIndoor / vehicleInfo /
// tollPasses. So there is no way to ASK for a drivable route — the only signal is `routes.warnings` on
// the way back, which makes this a decision that can only be made after the bill has landed.
//
// ⚠ WHAT IT COST TO NOT HAVE THIS. The curated `Spooner Lake` endpoint was stored at the LAKE's
// centroid; Carson City → that pin routed 71 minutes each way up NF-038 instead of 19 on US-50, and the
// rider was shown a charming 143-minute round trip with a "Make this drive" button under it. Nothing
// failed. Every number on that card was correct.
//
// ⚠ MODULE MOCKS ARE PROCESS-WIDE UNDER BUN (the 96-pass/9-fail incident). Every mock here spreads the
// real module and delegates whenever `driving === false`, and `@skipper/db` delegates through a PROXY
// rather than a ternary in the factory — a factory runs once at import time, when `driving` is still
// false, so a ternary there would hand drives.ts the real client forever.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { drives, places } from '@skipper/db/schema'
import type { MaterializedRoute, Waypoint } from '@skipper/routing'
import { hasRestrictedRoads } from '@skipper/routing'
import type { LngLat } from '@skipper/engine'
import { ACCOUNT, ANON, type FakeSession } from './fixtures'

let driving = false

/* -------------------------------- fixtures -------------------------------- */

const START = '00000000-0000-4000-8000-000000000701'
const FAR = '00000000-0000-4000-8000-000000000702'

/** ⚠ START AND FAR SHARE NOTHING — `sameSpot` (drives.ts) reads these coordinates to decide whether the
 *  rider asked for a loop, and the ordering test below needs to be able to make one on demand. */
const GATED = '00000000-0000-4000-8000-000000000703'

const PLACES = [
  { id: START, name: 'Start Pier', lat: 39.0, lng: -120.0, accessLat: null, accessLng: null },
  { id: FAR, name: 'The Lake Itself', lat: 39.2, lng: -120.2, accessLat: null, accessLng: null },
  // A place whose own pin is not drivable, carrying the public turn-off a car is sent to instead.
  // The two are ~1.6 km apart, so a test that confused them could not pass by rounding.
  { id: GATED, name: 'Gated Beach', lat: 39.31, lng: -120.31, accessLat: 39.3, accessLng: -120.3 },
]

/* ------------------------------- the session ------------------------------ */

let session: FakeSession = ANON
const realSession = { ...(await import('../src/session')) }
mock.module('../src/session', () => ({
  ...realSession,
  resolveSessionSafely: (getSession: () => Promise<unknown>, opts?: { attempts?: number; baseMs?: number }) =>
    driving ? Promise.resolve(session) : realSession.resolveSessionSafely(getSession, opts),
}))

/* -------------------------------- the ledger ------------------------------ */

const realCredits = { ...(await import('../src/credits')) }
mock.module('../src/credits', () => ({
  ...realCredits,
  ensureFreeGrant: async (userId: string) => (driving ? undefined : realCredits.ensureFreeGrant(userId)),
  creditSummary: async (userId: string) =>
    driving ? { remaining: 3, granted: 5 } : realCredits.creditSummary(userId),
}))

/* ---------------------------------- the db --------------------------------- */

const dialect = new PgDialect()

/** Thrown the moment a request reads anything only a POST-GATE request reads. A refused route must
 *  return BEFORE the corpus read (and therefore, on create, before the ledger batch), so "did the gate
 *  let this through?" is observable as "was the sentinel reached?" — which a status code alone cannot
 *  say, since this handler answers 422 for `no_route` and `no_stories` too. */
const PAST_THE_GATE = 'restricted-route.test.ts: the request continued past the gate into the corpus'

let reachedCorpus = false

function answerPlacesQuery(where: unknown): typeof PLACES {
  const { params } = dialect.sqlToQuery(where as SQL)
  const asked = new Set(params.filter((p): p is string => typeof p === 'string'))
  return PLACES.filter((r) => asked.has(r.id))
}

const fakeDb: Record<string, unknown> = {
  select: () => ({
    from: (table: unknown) => {
      if (table === places) {
        return { where: (cond: unknown) => Promise.resolve(answerPlacesQuery(cond)) }
      }
      // Create's idempotent-replay lookup sits BEFORE the gate — it must not read as having cleared it.
      if (table === drives) {
        return { where: () => ({ limit: () => Promise.resolve([]) }) }
      }
      reachedCorpus = true
      throw new Error(PAST_THE_GATE)
    },
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
        reachedCorpus = true
        throw new Error(PAST_THE_GATE)
      }
      return hit
    },
  },
)
mock.module('@skipper/db', () => ({ ...realDb, db: dbProxy }))

/* -------------------------------- the router ------------------------------- */

/** What Google says about the next route. `warnings` is the whole input to the rule under test. */
let nextWarnings: string[] = []
/** The polyline the mocked Routes call returns — only the ordering test cares what shape it is. */
let nextPolyline: LngLat[] = []
/** Every waypoint list handed to the BILLED Routes call, in order. The access-point tests assert on
 *  this rather than on a status code: "what did we actually ask Google to route?" is the question, and
 *  nothing in the response can answer it. */
let routeCalls: Waypoint[][] = []

const realRouting = { ...(await import('@skipper/routing')) }
mock.module('@skipper/routing', () => ({
  ...realRouting,
  materializeRoute: async (waypoints: readonly Waypoint[], apiKey?: string): Promise<MaterializedRoute> => {
    if (!driving) {
      return apiKey === undefined
        ? realRouting.materializeRoute(waypoints)
        : realRouting.materializeRoute(waypoints, apiKey)
    }
    routeCalls.push(waypoints.map((w) => ({ ...w })))
    // ⚠ The BILL is modelled as having already landed — that is the whole situation this gate is in.
    // ⚠ `restricted` is computed by the REAL `hasRestrictedRoads`, never hand-set: if the mock decided
    // it, this file would be testing its own fixture and would stay green through a rewrite of the
    // predicate that decides it in production.
    return {
      polyline: nextPolyline,
      distanceMeters: 40_000,
      durationSeconds: 8_580,
      warnings: nextWarnings,
      restricted: hasRestrictedRoads(nextWarnings),
      provenance: {
        source: 'google-routes-v2',
        waypoints: [...waypoints],
        distanceMeters: 40_000,
        durationSeconds: 8_580,
        pointCount: nextPolyline.length,
        materializedAt: '2026-08-04T00:00:00.000Z',
      },
    }
  },
}))

const { driveRoutes } = await import('../src/drives')

/* --------------------------------- shapes ---------------------------------- */

/** A straight run of `km` kilometres — one road, driven once. */
function road(km: number): LngLat[] {
  const degPerKm = 1 / (111.32 * Math.cos((39 * Math.PI) / 180))
  return Array.from({ length: km * 20 + 1 }, (_, i): LngLat => [-120 + (i / 20) * degPerKm, 39])
}

/** Out and back down the SAME road — what an undrivable anchor actually produces, and therefore the
 *  shape that makes the two gates race. */
const THERE_AND_BACK: LngLat[] = [...road(20), ...[...road(20)].reverse()]

/** The exact string Google returned for the Spooner Lake pin. */
const RESTRICTED = 'This route has restricted usage or private roads.'

/* --------------------------------- harness --------------------------------- */

/** Every `route_spend` line the request emitted, parsed. ⚠ CAPTURED RATHER THAN HUSHED: a refusal
 *  happens AFTER the bill, so "the cost line still describes the call we paid for" is a claim this file
 *  is uniquely placed to check — absence of failure is not success (CLAUDE.md). */
let spendLines: Record<string, unknown>[] = []
let restore: (() => void) | null = null

beforeEach(() => {
  driving = true
  session = ANON
  nextPolyline = road(20)
  const realWarn = console.warn
  const realInfo = console.info
  console.warn = () => {}
  console.info = (line?: unknown) => {
    if (typeof line === 'string' && line.includes('"route_spend"')) {
      spendLines.push(JSON.parse(line) as Record<string, unknown>)
    }
  }
  restore = () => {
    console.warn = realWarn
    console.info = realInfo
  }
})
afterEach(() => {
  driving = false
  session = ANON
  nextWarnings = []
  nextPolyline = []
  reachedCorpus = false
  spendLines = []
  routeCalls = []
  restore?.()
  restore = null
})

// `async` so the return is a Promise even when hono answers synchronously — the let-through cases
// deliberately provoke the PAST_THE_GATE throw and need something to `.catch()`.
const call = async (path: string, body: unknown): Promise<Response> =>
  driveRoutes.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

/** Both billed sites. `/propose` is free and anonymous; `/` spends a credit behind the account wall.
 *  A client can reach create without ever calling propose, so covering one proves nothing about the
 *  other — and a create stricter than propose sells a rider a drive and refuses it at the till. */
const BILLED_SITES: [name: string, path: string, who: FakeSession][] = [
  ['POST /drives/propose (the free preview)', '/propose', ANON],
  ['POST /drives (the path that spends a credit)', '/', ACCOUNT],
]

const oneWay = (extra: Record<string, unknown> = {}) => ({
  start: START,
  end: FAR,
  idempotencyKey: crypto.randomUUID(),
  ...extra,
})

/* -------------------------------------------------------------------------- */

describe('a route Google flags as restricted is refused', () => {
  for (const [name, path, who] of BILLED_SITES) {
    test(`${name} — refused with restricted_route, before the corpus read`, async () => {
      session = who
      nextWarnings = [RESTRICTED]
      const res = await call(path, oneWay())
      expect(res.status).toBe(422)
      // ⚠ The error CODE, never "some 422": this handler also answers 422 for `no_route`, `no_stories`
      // and `loop_retraces`, so a status-only assertion would pass on a build where this gate was
      // deleted and the request died further down for an unrelated reason.
      expect(((await res.json()) as { error?: string }).error).toBe('restricted_route')
      expect(reachedCorpus).toBe(false)
    })
  }

  test('the message points at the SPOT, which is the thing the rider can change', async () => {
    nextWarnings = [RESTRICTED]
    const res = await call('/propose', oneWay())
    const body = (await res.json()) as { message?: string }
    expect(body.message?.toLowerCase()).toContain('spot')
  })
})

describe('the gate FAILS OPEN — a warned route is not the same as a bad one', () => {
  // Most warnings are ordinary road-trip facts. A gate that refused every warned route would refuse
  // most of the drives worth taking, and would do it silently.
  for (const benign of [
    'This route has tolls.',
    'This route may cross country borders.',
    'Parts of this route may be closed at certain times.',
  ]) {
    test(`"${benign}" is let through`, async () => {
      nextWarnings = [benign]
      await call('/propose', oneWay()).catch(() => undefined)
      expect(reachedCorpus).toBe(true)
    })
  }

  test('a route with no warnings at all is let through', async () => {
    nextWarnings = []
    await call('/propose', oneWay()).catch(() => undefined)
    expect(reachedCorpus).toBe(true)
  })
})

describe('RESTRICTED IS ANSWERED BEFORE RETRACE — the ordering is the point', () => {
  // ⚠ THE CASE THAT MOTIVATED THE ORDER, and it is the common one rather than a corner: an undrivable
  // anchor produces BOTH conditions at once. Carson City → the Spooner Lake pin went out and back up
  // the same forest track, so it is a 100% retrace as well as a restricted route. Answered in the other
  // order, the rider is told to "pick a different way round" — advice that cannot work, because there
  // is no way round: the SPOT is the problem. A wrong-but-plausible message is worse than a blunt one.
  for (const [name, path, who] of BILLED_SITES) {
    test(`${name} — a restricted THERE-AND-BACK loop answers restricted_route, not loop_retraces`, async () => {
      session = who
      nextWarnings = [RESTRICTED]
      nextPolyline = THERE_AND_BACK
      const res = await call(path, { start: START, end: START, via: [FAR], idempotencyKey: crypto.randomUUID() })
      expect(res.status).toBe(422)
      expect(((await res.json()) as { error?: string }).error).toBe('restricted_route')
    })
  }
})

describe('the access point reaches GOOGLE and never the rider', () => {
  // ⚠ THE SPLIT IS THE WHOLE DESIGN. `places.access_lat/lng` exists so a place whose own pin is not
  // drivable can still be offered: the car is sent to the public turn-off while the map marker, the
  // title and the saved drive keep the real pin. The rejected alternative — overwriting lat/lng —
  // routes correctly and then draws a pin named for a beach in the middle of a highway. Both halves
  // are asserted here, because a change that satisfies only one of them looks entirely fine from the
  // other side.

  test('the BILLED Routes call is given the access point, not the pin', async () => {
    nextWarnings = []
    await call('/propose', { start: START, end: GATED, idempotencyKey: crypto.randomUUID() }).catch(() => undefined)
    expect(routeCalls).toHaveLength(1)
    const destination = routeCalls[0]!.at(-1)!
    expect(destination.lat).toBe(39.3)
    expect(destination.lng).toBe(-120.3)
  })

  test('the place keeps its NAME through the substitution — only the coordinates move', async () => {
    // The access point replaces WHERE the car goes, never WHICH place this is. `driveLabel` builds the
    // drive's title from these labels, so a swap here would rename the rider's drive after a road.
    //
    // ⚠ The other half of the display rule — that the echoed endpoint and the saved drive's
    // start/end coordinates keep the real pin — is NOT reachable from this fixture: both live past the
    // corpus read, which this file deliberately carries no data for (see PAST_THE_GATE). It holds by
    // construction rather than by assertion: `/propose` echoes `startEp`/`endEp` (the ResolvedEndpoint
    // itself) and the insert reads `start.lat` / `start.lng`, while `accessLat` is read only inside
    // `routeWaypoints`. If that ever stops being true, this comment is the thing that was wrong.
    nextWarnings = []
    await call('/propose', { start: START, end: GATED, idempotencyKey: crypto.randomUUID() }).catch(() => undefined)
    expect(routeCalls[0]!.at(-1)!.label).toBe('Gated Beach')
  })

  test('a place with NO access point still routes to its own pin', async () => {
    // The overwhelmingly common case. A null pair must mean "route to the pin", never "route to 0,0".
    nextWarnings = []
    await call('/propose', { start: START, end: FAR, idempotencyKey: crypto.randomUUID() }).catch(() => undefined)
    const destination = routeCalls[0]!.at(-1)!
    expect(destination.lat).toBe(39.2)
    expect(destination.lng).toBe(-120.2)
  })

  test('an access point on a VIA is used too — the middle of a route bills the same as its ends', async () => {
    // INV-1's lesson restated: guarding both ends and leaving the middle open is not a partial
    // guarantee, it is none. The same applies to which coordinate the middle is routed through.
    nextWarnings = []
    await call('/propose', {
      start: START,
      end: FAR,
      via: [GATED],
      idempotencyKey: crypto.randomUUID(),
    }).catch(() => undefined)
    const mid = routeCalls[0]![1]!
    expect(mid.lat).toBe(39.3)
    expect(mid.lng).toBe(-120.3)
  })
})

describe('the refusal still reports what it BILLED', () => {
  // A refused route has already cost a Google Routes call. If the cost line were skipped on the refusal
  // path, the spend would be invisible in exactly the case an operator most needs to see it — a curated
  // anchor gone bad bills on every rider who picks it and produces nothing, forever.
  for (const [name, path, who] of BILLED_SITES) {
    test(`${name} — the route_spend line is emitted, and records restricted:true`, async () => {
      session = who
      nextWarnings = [RESTRICTED]
      await call(path, oneWay())
      expect(spendLines).toHaveLength(1)
      expect(spendLines[0]!.restricted).toBe(true)
      expect(spendLines[0]!.seconds).toBe(8_580)
    })
  }

  test('an accepted route records restricted:false rather than omitting the field', async () => {
    // An absent field and a false one are the same to a human reading the log and different to a
    // log-based metric, which is the only consumer that matters here.
    nextWarnings = []
    await call('/propose', oneWay()).catch(() => undefined)
    expect(spendLines).toHaveLength(1)
    expect(spendLines[0]!.restricted).toBe(false)
  })
})
