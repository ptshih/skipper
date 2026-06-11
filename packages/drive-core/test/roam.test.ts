import { describe, expect, test } from 'bun:test'
import { DEFAULT_ROAM_TRIGGER, RoamEngine } from '../src/roam'
import type { RoamPinRef } from '../src/roam'
import type { GpsFix } from '../src/trigger'

const fix = (lat: number, lng: number, speedMps: number, headingDeg: number, tSec = 0): GpsFix => ({
  lat,
  lng,
  speedMps,
  headingDeg,
  tSec,
  alongM: 0,
})

// Pins around the origin (0.01° lat ≈ 1.11 km). 60s clips.
const pin = (poiId: string, lat: number, lng: number): RoamPinRef => ({
  poiId,
  lat,
  lng,
  durationMs: 60_000,
  name: poiId,
})
const NORTH = pin('north', 0.01, 0)
const MPH60 = 26.82
const MPH20 = 8.94

describe('RoamEngine — proximity + heading', () => {
  test('fires on approach within the speed-adaptive radius, nearest first', () => {
    const near = pin('near', 0.0085, 0) // ~167 m ahead
    const far = pin('far', 0.0095, 0) // ~278 m ahead
    const e = new RoamEngine([far, near])
    const fired = e.update(fix(0.007, 0, MPH60, 0)) // both within 322 m, heading north
    expect(fired).toHaveLength(1)
    expect(fired[0]!.poiId).toBe('near')
  })

  test('floor applies when crawling: 200 m pin fires at parking-lot speed', () => {
    const e = new RoamEngine([NORTH])
    // ~200 m south of pin, 1 m/s (below heading gate, within the 600 m floor).
    expect(e.update(fix(0.0082, 0, 1, 180))).toHaveLength(1)
  })

  test('heading-toward gate: a pin BEHIND does not fire at speed (heading KNOWN)', () => {
    const e = new RoamEngine([NORTH])
    // Vehicle north of the pin, heading further north (pin behind), well within radius.
    expect(e.update(fix(0.0112, 0, MPH60, 0))).toHaveLength(0)
  })

  test('UNKNOWN heading (iOS course -1) skips the gate — proximity still fires', () => {
    // The first live drive's zero-fire bug: -1 sanitized to 0 read as "due north" and
    // gated out every other direction. A negative heading must mean "unknown".
    const e = new RoamEngine([NORTH])
    // Vehicle north of the pin (pin geometrically behind), at speed, heading UNKNOWN.
    expect(e.update(fix(0.0112, 0, MPH60, -1))).toHaveLength(1)
  })

  test('beyond the floor at low speed → no fire', () => {
    const e = new RoamEngine([NORTH])
    // ~700 m out at 20 mph: 8.94*15 ≈ 134 m < 600 floor < 700 → no fire.
    expect(e.update(fix(0.0037, 0, MPH20, 0))).toHaveLength(0)
  })

  test('per-pin radiusM (kind-aware areal hint) widens the floor for that pin only', () => {
    const peak = { ...pin('peak', 0.01, 0), radiusM: 1500 }
    const cabin = pin('cabin', 0.02, 0.012) // ~1.6 km away, default floor
    const e = new RoamEngine([peak, cabin], { minGapSec: 0 })
    // ~1.1 km from the peak: inside its 1500 m radius → fires; cabin stays silent.
    const fired = e.update(fix(0, 0, MPH20, 0))
    expect(fired).toHaveLength(1)
    expect(fired[0]!.poiId).toBe('peak')
  })
})

describe('RoamEngine — governors', () => {
  test('min-gap: a second pin cannot start until clip + gap elapse', () => {
    const a = pin('a', 0.0085, 0)
    const b = pin('b', 0.012, 0) // ~390 m past a — outside suppressRadius
    const e = new RoamEngine([a, b])
    expect(e.update(fix(0.007, 0, MPH60, 0, 0))).toHaveLength(1) // a fires at t=0
    // t=30: still inside a's 60s clip → gate closed even though b qualifies.
    expect(e.update(fix(0.0103, 0, MPH60, 0, 30))).toHaveLength(0)
    // t=140: clip (60s) + minGap (75s) = 135s elapsed → b may fire.
    const fired = e.update(fix(0.0103, 0, MPH60, 0, 140))
    expect(fired).toHaveLength(1)
    expect(fired[0]!.poiId).toBe('b')
  })

  test('cooldown: a fired pin does not re-fire within cooldownSec', () => {
    const e = new RoamEngine([NORTH], { minGapSec: 0 })
    expect(e.update(fix(0.0085, 0, MPH60, 0, 0))).toHaveLength(1)
    // Same approach 30 min later — still inside the 4h cooldown.
    expect(e.update(fix(0.0085, 0, MPH60, 0, 1_800))).toHaveLength(0)
    // Past the cooldown it may tell it again.
    const again = e.update(fix(0.0085, 0, MPH60, 0, DEFAULT_ROAM_TRIGGER.cooldownSec + 1_800))
    expect(again).toHaveLength(1)
  })

  test('cluster suppression: a co-located twin stays quiet after a fire', () => {
    const bay = pin('bay', 0.0085, 0)
    const park = pin('park', 0.0087, 0) // ~22 m from bay — the twin
    const e = new RoamEngine([bay, park], { minGapSec: 0 })
    expect(e.update(fix(0.007, 0, MPH60, 0, 0))).toHaveLength(1) // bay (nearest)
    // Gate reopens after the clip; the twin is within suppressRadiusM of the fire → quiet.
    expect(e.update(fix(0.0084, 0, MPH60, 0, 70))).toHaveLength(0)
    expect(e.firedCount).toBe(1)
  })

  test('one encounter per fix even when several qualify', () => {
    const e = new RoamEngine([pin('x', 0.0085, 0), pin('y', 0.0086, 0.004)], { minGapSec: 0 })
    expect(e.update(fix(0.0075, 0, MPH60, 0, 0))).toHaveLength(1)
  })
})

describe('RoamEngine — chattiness (setMinGap)', () => {
  test('retuning the gap mid-session changes future spacing without resetting cooldowns', () => {
    const a = pin('a', 0.0085, 0)
    const b = pin('b', 0.012, 0)
    const e = new RoamEngine([a, b])
    expect(e.update(fix(0.007, 0, MPH60, 0, 0))).toHaveLength(1) // a fires; gate holds 60s clip + 75s gap
    e.setMinGap(0) // talkative: gate now reopens right at clip end
    expect(e.update(fix(0.0103, 0, MPH60, 0, 30))).toHaveLength(0) // still inside the clip
    expect(e.update(fix(0.0103, 0, MPH60, 0, 61))).toHaveLength(0) // gate computed at fire time holds
    // a's cooldown survives the retune: re-approach a long after the gate opens — no re-fire.
    const e2 = new RoamEngine([a], { minGapSec: 0 })
    e2.update(fix(0.007, 0, MPH60, 0, 0))
    e2.setMinGap(0)
    expect(e2.update(fix(0.007, 0, MPH60, 0, 120))).toHaveLength(0)
  })
})
