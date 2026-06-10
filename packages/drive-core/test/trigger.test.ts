import { describe, expect, test } from 'bun:test'
import { effectiveRadiusM, snapStopsToRoute, TriggerEngine } from '../src/trigger'
import type { GpsFix, TourStopRef } from '../src/trigger'
import { runDrive } from '../src/simulate'
import type { LngLat } from '../src/geo'

const fix = (lat: number, lng: number, speedMps: number, headingDeg: number, tSec = 0): GpsFix => ({
  lat,
  lng,
  speedMps,
  headingDeg,
  tSec,
  alongM: 0,
})

// A stop due north of the origin (0.01° lat ≈ 1.11 km).
const NORTH: TourStopRef = { seq: 1, lat: 0.01, lng: 0, triggerRadiusM: 120, durationMs: 30_000, name: 'North' }
const MPH60 = 26.82 // m/s
const MPH20 = 8.94

describe('effectiveRadiusM (speed-adaptive lead)', () => {
  test('uses speed*lead above the floor, the floor below it', () => {
    expect(effectiveRadiusM(120, MPH60, 12)).toBeCloseTo(321.8, 0) // 26.82 * 12
    expect(effectiveRadiusM(120, MPH20, 12)).toBe(120) // 8.94*12 = 107 < floor
  })
})

describe('TriggerEngine', () => {
  test('fires once on approach, then debounces', () => {
    const e = new TriggerEngine([NORTH])
    expect(e.update(fix(0, 0, MPH60, 0))).toHaveLength(0) // ~1113 m out, beyond 322 m
    const fired = e.update(fix(0.008, 0, MPH60, 0)) // ~222 m out, heading north → fire
    expect(fired).toHaveLength(1)
    expect(fired[0]!.seq).toBe(1)
    expect(e.update(fix(0.0085, 0, MPH60, 0))).toHaveLength(0) // debounced
    expect(e.firedCount).toBe(1)
  })

  test('reports a sensible lead time at fire', () => {
    const e = new TriggerEngine([NORTH])
    const [ev] = e.update(fix(0.008, 0, MPH60, 0))
    expect(ev!.leadSec).toBeGreaterThan(5)
    expect(ev!.leadSec).toBeLessThan(12)
  })

  test('heading gate: a stop BEHIND does not fire above gate speed', () => {
    // Vehicle north of the stop (stop is behind), heading north (away), within 120 m.
    const e = new TriggerEngine([NORTH])
    expect(e.update(fix(0.0109, 0, MPH60, 0))).toHaveLength(0)
  })

  test('heading gate is skipped below ~5 mph (stop behind still fires when crawling)', () => {
    const e = new TriggerEngine([NORTH])
    expect(e.update(fix(0.0109, 0, 1, 0))).toHaveLength(1) // 1 m/s < gate → no heading check
  })

  test('speed-adaptive: 300 m ahead fires at 60 mph but not at 20 mph', () => {
    const ahead = fix(0.0073, 0, MPH60, 0) // ~300 m south of the stop, heading north
    expect(new TriggerEngine([NORTH]).update(ahead)).toHaveLength(1) // 300 < 322
    const slow = fix(0.0073, 0, MPH20, 0)
    expect(new TriggerEngine([NORTH]).update(slow)).toHaveLength(0) // 300 > 120 floor
  })

  test('ignores a malformed fix — a NaN coord/speed fires nothing and never consumes a stop', () => {
    // The catastrophic case: ONE bad fix would otherwise fire EVERY unfired stop at once,
    // because a NaN distance (or a NaN effective radius from a NaN speed) makes `d > radius`
    // read FALSE — so the distance gate is skipped and the stop fires.
    const stops: TourStopRef[] = [
      { seq: 1, lat: 0.008, lng: 0, triggerRadiusM: 120, durationMs: 30_000, name: 'A' },
      { seq: 2, lat: 0.0081, lng: 0, triggerRadiusM: 120, durationMs: 30_000, name: 'B' },
    ]
    const e = new TriggerEngine(stops)
    expect(e.update(fix(NaN, 0, MPH60, 0))).toHaveLength(0) // NaN coord
    expect(e.update(fix(0.008, 0, NaN, 0))).toHaveLength(0) // NaN speed (valid coords, in range)
    expect(e.firedCount).toBe(0) // neither bad fix CONSUMED a stop (no debounce side effect)
    // A subsequent VALID, in-range fix still fires both normally — the engine isn't corrupted.
    const fired = e.update(fix(0.0079, 0, MPH60, 0))
    expect(fired.map((ev) => ev.seq).sort((a, b) => a - b)).toEqual([1, 2])
  })

  test('snapStopsToRoute moves the trigger point onto the road, keeps the POI, records off-route', () => {
    const route: LngLat[] = Array.from({ length: 11 }, (_, i) => [0, i * 0.001] as LngLat) // lat 0..0.01 along lng 0
    const stops: TourStopRef[] = [{ seq: 0, lat: 0.005, lng: 0.001, triggerRadiusM: 120 }] // ~111 m east of the line
    const snapped = snapStopsToRoute(route, stops)[0]!
    expect(snapped.poiLat).toBe(0.005) // POI preserved
    expect(snapped.poiLng).toBe(0.001)
    expect(snapped.lng).toBeCloseTo(0, 6) // trigger point snapped onto the lng-0 line
    expect(snapped.lat).toBeCloseTo(0.005, 3)
    expect(snapped.offRouteM).toBeGreaterThan(90)
    expect(snapped.offRouteM).toBeLessThan(130)
  })

  test('a far off-route stop never fires over a whole drive', () => {
    // Drive straight north along lng 0; stops near the line + one 5 km to the east.
    const route: LngLat[] = Array.from({ length: 101 }, (_, i) => [0, i * 0.001] as LngLat)
    const stops: TourStopRef[] = [
      { seq: 0, lat: 0.02, lng: 0.0003, triggerRadiusM: 120, durationMs: 20_000, name: 'near A' },
      { seq: 1, lat: 0.06, lng: 0.0003, triggerRadiusM: 120, durationMs: 20_000, name: 'near B' },
      { seq: 2, lat: 0.05, lng: 0.05, triggerRadiusM: 120, durationMs: 20_000, name: 'far off-route' },
    ]
    const report = runDrive(route, stops, { mph: 45, tickHz: 4 })
    // On-route stops fire (they snap to the road); the 5 km-off stop is EXCLUDED
    // (no honest trigger point), not a triggering miss.
    expect(report.stops.find((s) => s.seq === 0)!.fired).toBe(true)
    expect(report.stops.find((s) => s.seq === 1)!.fired).toBe(true)
    expect(report.excludedOffRoute).toContain(2)
    expect(report.stops.find((s) => s.seq === 2)!.fired).toBe(false)
    expect(report.neverFired).not.toContain(2)
    // fired stops come in route order
    const fireTimes = report.events.map((e) => e.tSec)
    expect(fireTimes).toEqual([...fireTimes].sort((a, b) => a - b))
  })
})
