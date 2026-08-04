// A LOOP MAY NOT DRIVE THE SAME ROAD TWICE — the wire half of the no-same-road rule (founder,
// 2026-08-03; docs/decisions/no-same-road-loops.md). The planner half is the way-home beat in
// planner-prompt.ts and is covered by plan-stream.test.ts.
//
// ⚠ WHY IT CANNOT BE A PROMPT TEST. The rider names the way home, but whether that yields a RING is a
// fact about the road network nobody in the conversation knows: the model is handed no coordinates at
// all (D9), and Google is free to route the return leg back down the outbound road when that is
// shorter. The evidence is the POLYLINE, so the decision can only be made after it comes back — which
// is what this file drives.
//
// ⚠ THE TWO BILLED SITES CARRY INDEPENDENT COPIES OF THE CALL. `/propose` refuses on the free path and
// `POST /drives` refuses on the path that SPENDS A CREDIT; a client can reach create without ever
// calling propose, so covering one proves nothing about the other. Both are driven from one table
// below, and both must agree — a create stricter than propose sells a rider a drive and refuses it at
// the till.
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
import { LOOP_MAX_RETRACE, retraceFraction, type LngLat } from '@skipper/engine'
import { ACCOUNT, ANON, thereAndBack, type FakeSession } from './fixtures'

let driving = false

/* -------------------------------- fixtures -------------------------------- */

const START = '00000000-0000-4000-8000-000000000601'
const FAR = '00000000-0000-4000-8000-000000000602'
const HOME_BY = '00000000-0000-4000-8000-000000000603'

/** ⚠ START AND FAR SHARE A COORDINATE PAIR ONLY WHERE THE TEST WANTS A LOOP. `sameSpot` (drives.ts) is
 *  what decides "the rider asked to come back around", so these coordinates ARE the loop flag. */
const PLACES = [
  { id: START, name: 'Start Pier', lat: 39.0, lng: -120.0 },
  { id: FAR, name: 'Far End', lat: 39.2, lng: -120.2 },
  { id: HOME_BY, name: 'Way Home', lat: 39.1, lng: -119.8 },
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

/**
 * Thrown by the DB proxy the moment a request reads ANYTHING other than `places`.
 *
 * ⚠ THIS SENTINEL IS HALF THE FILE'S EVIDENCE. A refused loop must return BEFORE the corpus read, and
 * an accepted one must continue INTO it — so "did the gate let this through?" is observable as
 * "was the sentinel reached?", which a status code alone cannot say. It is why the accepted cases
 * below assert a throw rather than a 200: this file deliberately carries no corpus fixtures, and
 * inventing some would only prove that the fixtures work.
 */
const PAST_THE_GATE = 'loop-retrace.test.ts: the request continued past the loop gate into the corpus'

/** Set the instant a request reads a table only a POST-GATE request reads. ⚠ A FLAG RATHER THAN A
 *  THROWN ERROR AS THE ASSERTION: hono owns the handler's stack, so whether a throw surfaces to the
 *  caller or becomes a 500 is hono's business and not something this file should pin. The flag is true
 *  either way. */
let reachedCorpus = false

function answerPlacesQuery(where: unknown): typeof PLACES {
  const { params } = dialect.sqlToQuery(where as SQL)
  const asked = new Set(params.filter((p): p is string => typeof p === 'string'))
  return PLACES.filter((r) => asked.has(r.id))
}

const fakeDb: Record<string, unknown> = {
  select: () => ({
    from: (table: unknown) => {
      // The allowlist read (`hydrateAnchors`) — every request in this file makes it, gate or no gate.
      if (table === places) {
        return { where: (cond: unknown) => Promise.resolve(answerPlacesQuery(cond)) }
      }
      // Create's idempotent-replay lookup, answered "no such drive" so the request falls through to a
      // normal create. It sits BEFORE the gate, so it must not read as having cleared it.
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

/** The polyline the mocked Routes call will return for the next request. */
let nextPolyline: LngLat[] = []

const realRouting = { ...(await import('@skipper/routing')) }
mock.module('@skipper/routing', () => ({
  ...realRouting,
  materializeRoute: async (waypoints: readonly Waypoint[], apiKey?: string): Promise<MaterializedRoute> => {
    if (!driving) {
      return apiKey === undefined
        ? realRouting.materializeRoute(waypoints)
        : realRouting.materializeRoute(waypoints, apiKey)
    }
    // ⚠ The BILL is modelled as having already landed: the gate runs on what came back, so every case
    // in this file is one where money was spent and the only question is what the rider gets for it.
    return {
      polyline: nextPolyline,
      distanceMeters: 40_000,
      durationSeconds: 3_000,
      // Clean of Google's own route warnings — this file is about the SHAPE of a loop, and a restricted
      // road is a different refusal with its own coverage.
      warnings: [],
      restricted: false,
      provenance: {
        source: 'google-routes-v2',
        waypoints: [...waypoints],
        distanceMeters: 40_000,
        durationSeconds: 3_000,
        pointCount: nextPolyline.length,
        materializedAt: '2026-08-03T00:00:00.000Z',
      },
    }
  },
}))

const { driveRoutes } = await import('../src/drives')

/* --------------------------------- shapes ---------------------------------- */

/** Out and back down the SAME road — the shape the whole rule exists to refuse.
 *  ⚠ Built from the SHARED `road` (./fixtures), which restricted-route.test.ts also measures against:
 *  the sample density is part of the retrace fraction, so the two suites must not drift apart on it. */
const THERE_AND_BACK: LngLat[] = thereAndBack(20)

/** A closed ring — out one way, home another. */
const RING: LngLat[] = Array.from({ length: 721 }, (_, i): LngLat => {
  const a = (i / 720) * 2 * Math.PI
  return [-120 + 0.15 * Math.cos(a) * 1.3, 39 + 0.15 * Math.sin(a)]
})

let hush: (() => void) | null = null
beforeEach(() => {
  driving = true
  session = ANON
  const realWarn = console.warn
  const realInfo = console.info
  console.warn = () => {}
  console.info = () => {}
  hush = () => {
    console.warn = realWarn
    console.info = realInfo
  }
})
afterEach(() => {
  driving = false
  session = ANON
  nextPolyline = []
  reachedCorpus = false
  hush?.()
  hush = null
})

// `async` so the return is a Promise even when hono answers synchronously — the past-the-gate cases
// below deliberately provoke a throw and need something to `.catch()`.
const call = async (path: string, body: unknown): Promise<Response> =>
  driveRoutes.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

/** Both billed sites. `/propose` is free and anonymous; `/` spends a credit behind the account wall. */
const BILLED_SITES: [name: string, path: string, who: FakeSession][] = [
  ['POST /drives/propose (the free preview)', '/propose', ANON],
  ['POST /drives (the path that spends a credit)', '/', ACCOUNT],
]

/** A loop request: start and end are the SAME anchor, with the far end and the way home as midpoints —
 *  the shape `toPlannedRoute` builds (apps/api/src/plan-route.ts). */
const loopBody = (extra: Record<string, unknown> = {}) => ({
  start: START,
  end: START,
  via: [FAR, HOME_BY],
  idempotencyKey: crypto.randomUUID(),
  ...extra,
})

/* -------------------------------------------------------------------------- */

describe('the fixtures are the shapes this file claims they are', () => {
  // ⚠ Pinned FIRST, because every assertion below is meaningless if the synthetic polylines do not
  // actually sit on the two sides of the gate. A test whose fixture drifted would keep passing while
  // measuring nothing.
  test('the there-and-back retraces and the ring does not', () => {
    expect(retraceFraction(THERE_AND_BACK)).toBeGreaterThan(LOOP_MAX_RETRACE)
    expect(retraceFraction(RING)).toBeLessThan(LOOP_MAX_RETRACE)
  })
})

describe('a loop that drives the same road twice is refused', () => {
  for (const [name, path, who] of BILLED_SITES) {
    test(`${name} — refused with loop_retraces, before the corpus read`, async () => {
      session = who
      nextPolyline = THERE_AND_BACK
      const res = await call(path, loopBody())
      expect(res.status).toBe(422)
      // ⚠ `loop_retraces` specifically, never "some 422": this handler also answers 422 for `no_route`
      // and `no_stories`, so a status-only assertion would pass on a build where the gate was deleted
      // and the request died further down for an unrelated reason.
      expect(((await res.json()) as { error?: string }).error).toBe('loop_retraces')
      // BEFORE the corpus read — and on the create path, therefore before the ledger batch. A refused
      // loop costs the Routes call that produced the evidence, and never a rider's credit.
      expect(reachedCorpus).toBe(false)
    })
  }

  test('the message names the ONE thing the rider can change', async () => {
    nextPolyline = THERE_AND_BACK
    const res = await call('/propose', loopBody())
    const body = (await res.json()) as { message?: string }
    // A dead end nobody can route around is a real answer, so the copy has to offer the straight run
    // as well as a different way round — otherwise the rider is told no with nowhere to go.
    expect(body.message?.toLowerCase()).toContain('way')
    expect(body.message?.toLowerCase()).toContain('straight through')
  })
})

describe('a real ring is let through', () => {
  for (const [name, path, who] of BILLED_SITES) {
    test(`${name} — continues past the gate`, async () => {
      session = who
      nextPolyline = RING
      // Reaching the corpus read IS the pass: the gate did not refuse it. (This file carries no corpus
      // fixtures on purpose — see PAST_THE_GATE.)
      await call(path, loopBody()).catch(() => undefined)
      expect(reachedCorpus).toBe(true)
    })
  }
})

describe('the gate is LOOPS ONLY — a one-way drive is never second-guessed', () => {
  // ⚠ THE DELIBERATE ASYMMETRY, and the reason it is not an oversight. A one-way drive that doubles
  // back is doing so because the rider asked to pass through somewhere on the way ("out to Incline, but
  // go by Emerald Bay first"). That retrace is their own explicit request, and refusing it would be
  // overruling them. "Bring me back around" is different in kind: it is an ask for a ring, and nobody
  // asked to see the same road twice.
  for (const [name, path, who] of BILLED_SITES) {
    test(`${name} — a RETRACING one-way route is allowed through`, async () => {
      session = who
      nextPolyline = THERE_AND_BACK
      await call(path, {
        start: START,
        end: FAR,
        via: [HOME_BY],
        idempotencyKey: crypto.randomUUID(),
      }).catch(() => undefined)
      expect(reachedCorpus).toBe(true)
    })
  }
})
