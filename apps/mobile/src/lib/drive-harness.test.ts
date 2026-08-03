// A whole drive, asserted, in milliseconds — the test that a desk pass used to be a sitting for.
//
// ⚠ These assert on the pipeline a REAL PHONE runs (createFixMapper → TriggerEngine), not on the
// engine's own synthetic simulator. The difference is the entire point: everything below can see an
// accuracy rejection, an iOS sentinel, a frozen cursor and a missed end predicate, none of which
// `runDrive` in @skipper/engine is capable of producing. docs/designs/desk-drive-harness.md §4.4.
import { describe, expect, test } from 'bun:test'
import type { DriveStopRef, LngLat } from '@skipper/engine'
import { driveTrace, syntheticTrace } from './drive-harness'
import type { RawFix } from './gps-util'

// ~5.5 km due north from (0,0): 501 vertices at 0.0001° (~11.1 m) each.
const ROUTE: LngLat[] = Array.from({ length: 501 }, (_, i) => [0, i * 0.0001])

// Four stops spaced along it, on the line, with the tight anchored-style floor.
const STOPS: DriveStopRef[] = [100, 200, 300, 400].map((v, i) => ({
  seq: i,
  lat: ROUTE[v]![1],
  lng: ROUTE[v]![0],
  name: `stop ${i}`,
  stopType: 'story',
  triggerRadiusM: 250,
  durationMs: 60_000,
}))

describe('driveTrace — the baseline drive', () => {
  test('a clean synthetic trace fires every stop, in order, and completes', () => {
    const r = driveTrace(ROUTE, STOPS, syntheticTrace(ROUTE, { mph: 45 }))
    expect(r.rejected).toBe(0)
    expect(r.neverFired).toEqual([])
    expect(r.fired.map((f) => f.seq)).toEqual([0, 1, 2, 3])
    expect(r.ended).toBe(true)
    // Each stop should get real warning, not fire on top of the anchor.
    for (const f of r.fired) expect(f.leadSec).toBeGreaterThan(0)
  })

  test('fire times increase monotonically — no stop fires out of order', () => {
    const r = driveTrace(ROUTE, STOPS, syntheticTrace(ROUTE, { mph: 45 }))
    for (let i = 1; i < r.fired.length; i++) {
      expect(r.fired[i]!.tSec).toBeGreaterThan(r.fired[i - 1]!.tSec)
    }
  })

  test('the projection cursor reaches the end of the route', () => {
    const r = driveTrace(ROUTE, STOPS, syntheticTrace(ROUTE, { mph: 45 }))
    expect(r.finalAlongM).toBeGreaterThan(5_000)
  })
})

describe('driveTrace — the failures a synthetic simulator structurally cannot show', () => {
  test('⚠ ZERO-FIRE: an all-noisy trace at REST is rejected wholesale and no stop fires', () => {
    // The shape of the field-confirmed failure: fixes arrive, nothing plays, and nothing in the app
    // says why. The harness makes it a visible number (rejected) instead of a silent drive.
    const trace = syntheticTrace(ROUTE, { mph: 45 }).map((f) => ({
      ...f,
      coords: { ...f.coords, accuracy: 900, speed: 0 },
    }))
    const r = driveTrace(ROUTE, STOPS, trace)
    expect(r.admitted).toBe(0)
    expect(r.rejected).toBe(trace.length)
    expect(r.neverFired).toEqual([0, 1, 2, 3])
    expect(r.ended).toBe(false)
  })

  test('the SAME noise at speed still drives the whole drive — the gate must not fail closed', () => {
    // 120 m in a granite canyon at 30 m/s: ceiling is speed*12*0.5 = 180 m, so these are admitted.
    // A regression that drops the speed-aware term turns this test into the one above.
    const trace = syntheticTrace(ROUTE, { mph: 67 }).map((f) => ({
      ...f,
      coords: { ...f.coords, accuracy: 120, speed: 30 },
    }))
    const r = driveTrace(ROUTE, STOPS, trace)
    expect(r.rejected).toBe(0)
    expect(r.neverFired).toEqual([])
    expect(r.ended).toBe(true)
  })

  test('⚠ a -1 heading must NOT gate stops out — it means "unknown", not "due north"', () => {
    // saneNonNeg(-1) = 0 reads as a real due-north heading; on a northbound route that happens to
    // pass, which is exactly why the bug survived reasoning and needed a road to find. Drive SOUTH so
    // a mistakenly-zeroed heading would point away from every stop and gate them all out.
    const south: LngLat[] = ROUTE.map(([lng, lat]) => [lng, -lat])
    const southStops = STOPS.map((s) => ({ ...s, lat: -s.lat }))
    const trace = syntheticTrace(south, { mph: 45 }).map((f) => ({
      ...f,
      coords: { ...f.coords, heading: -1 },
    }))
    const r = driveTrace(south, southStops, trace)
    expect(r.neverFired).toEqual([])
  })

  test('a cold-start prefix is rejected, and the drive still completes afterwards', () => {
    const clean = syntheticTrace(ROUTE, { mph: 45 })
    const cold: RawFix[] = clean.slice(0, 8).map((f) => ({
      ...f,
      coords: { ...f.coords, accuracy: 1000, speed: 0 },
    }))
    const r = driveTrace(ROUTE, STOPS, [...cold, ...clean])
    expect(r.rejected).toBe(8)
    expect(r.neverFired).toEqual([])
    expect(r.ended).toBe(true)
  })

  test('a dropout BETWEEN stops costs nothing — the cursor spans the gap', () => {
    // ⚠ Picking this window needs the FIRING positions, not the stop positions: at 20.12 m/s the
    // effective radius is ~250 m, so each stop fires ~12 fixes EARLY. Stops sit at 1110/2220/3330/
    // 4440 m (fixes ~55/110/165/221) and therefore fire at fixes ~43/98/153/209. Fixes 65-89 are
    // clear of every one of those. A window chosen from stop positions alone silently straddles a
    // firing point and the test then measures the wrong thing — which is exactly what it did first.
    const clean = syntheticTrace(ROUTE, { mph: 45 })
    const withGap = [...clean.slice(0, 65), ...clean.slice(90)]
    const r = driveTrace(ROUTE, STOPS, withGap)
    expect(r.ended).toBe(true)
    expect(r.neverFired).toEqual([])
  })

  test('⚠ FOUND BY THIS HARNESS: a dropout that SPANS a stop loses it, silently and forever', () => {
    // Excise 90 s straddling stop 2 (vertex 300 ≈ 3330 m; the gap covers ~2414-4205 m). No fix ever
    // lands inside its radius, so the engine's passed-point retire drops it once the car reappears
    // beyond it. There is no catch-up path.
    //
    // This is CORRECT — with no GPS you genuinely cannot know you passed it — but it is not
    // HARMLESS: the rider spent a credit on that stop, drove through a dead zone Tahoe has plenty
    // of, and gets silence with no explanation. Worth knowing it is a product decision (fire late?
    // mark it skipped?) rather than a bug, and worth pinning so the behaviour cannot change unnoticed.
    // ⚠ Telemetry DOES see it, but only as an aggregate: none of `StopSkipReason`'s five members
    // covers "never triggered", so it lands in the unattributed remainder `drive_completed` describes
    // (stops_played + stops_skipped < stops_total). That remainder is deliberate and documented — but
    // it cannot separate a dead zone from a stop that was never near the road, which are different
    // problems with different fixes. Naming the cause would need a sixth reason, not a new event.
    const clean = syntheticTrace(ROUTE, { mph: 45 })
    const withGap = [...clean.slice(0, 120), ...clean.slice(210)]
    const r = driveTrace(ROUTE, STOPS, withGap)
    expect(r.ended).toBe(true)
    expect(r.neverFired).toEqual([2])
    expect(r.fired.map((f) => f.seq)).toEqual([0, 1, 3])
  })

  test('⚠ a drive started 2000 miles away fires NOTHING and never completes', () => {
    // App Review in Cupertino. Before off-route rejection, the cursor walked forward on every fix,
    // fed the end predicate and fired the outro in seconds — drive over, credit spent, silence.
    const cupertino = syntheticTrace(ROUTE, { mph: 45 }).map((f) => ({
      ...f,
      coords: { ...f.coords, latitude: 37.33 + (f.coords.latitude ?? 0), longitude: -122.03 },
    }))
    const r = driveTrace(ROUTE, STOPS, cupertino)
    expect(r.fired).toHaveLength(0)
    expect(r.ended).toBe(false)
    expect(r.finalAlongM).toBe(0)
  })

  test('a trace that stops halfway leaves the drive unfinished', () => {
    const clean = syntheticTrace(ROUTE, { mph: 45 })
    const r = driveTrace(ROUTE, STOPS, clean.slice(0, Math.floor(clean.length / 2)))
    expect(r.ended).toBe(false)
    expect(r.neverFired.length).toBeGreaterThan(0)
  })
})

describe('driveTrace — trigger parameters are injectable, so a desk drive can SWEEP them', () => {
  test('a tiny radius at speed still fires (the speed-adaptive lead dominates the floor)', () => {
    const trace = syntheticTrace(ROUTE, { mph: 45 })
    const tiny = STOPS.map((s) => ({ ...s, triggerRadiusM: 10 }))
    const r = driveTrace(ROUTE, tiny, trace)
    // At 20 m/s with a 12 s lead the effective radius is ~241 m, so the 10 m floor is irrelevant.
    // This is exactly why tuning the FLOOR against a fast synthetic drive teaches you nothing.
    expect(r.neverFired).toEqual([])
  })

  test('dropping the lead to zero makes the bare floor decide, and it still fires on-route stops', () => {
    const trace = syntheticTrace(ROUTE, { mph: 45 })
    const r = driveTrace(ROUTE, STOPS, trace, { leadSeconds: 0 })
    expect(r.neverFired).toEqual([])
    // With no lead, warning collapses toward zero — the number the founder would feel in the car.
    for (const f of r.fired) expect(f.leadSec).toBeLessThan(15)
  })
})

describe('syntheticTrace — the control case', () => {
  test('is byte-stable across runs (a fixture that drifts is not a fixture)', () => {
    expect(syntheticTrace(ROUTE, { mph: 45 })).toEqual(syntheticTrace(ROUTE, { mph: 45 }))
  })

  test('speed changes the fix count, not the geometry', () => {
    const slow = syntheticTrace(ROUTE, { mph: 20 })
    const fast = syntheticTrace(ROUTE, { mph: 60 })
    expect(slow.length).toBeGreaterThan(fast.length)
    expect(slow[0]!.coords.latitude).toBeCloseTo(fast[0]!.coords.latitude, 9)
  })

  test('returns nothing for a degenerate route rather than throwing', () => {
    expect(syntheticTrace([], {})).toEqual([])
    expect(syntheticTrace([[0, 0]], {})).toEqual([])
  })
})
