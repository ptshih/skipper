import { describe, expect, test } from 'bun:test'
import {
  angularDiffDeg,
  bearingDeg,
  checkSpeakableAnchor,
  cumulativeMeters,
  haversineMeters,
  interpolate,
  radiusForKind,
  SPEAKABLE_ANCHOR_RADIUS_MULT,
  speakableAnchorMaxM,
} from '../src/geo'
import type { LngLat } from '../src/geo'

describe('geo', () => {
  test('haversineMeters: ~111 km per degree of latitude', () => {
    const d = haversineMeters([0, 0], [0, 1])
    expect(d).toBeGreaterThan(110_000)
    expect(d).toBeLessThan(112_000)
  })

  test('bearingDeg: cardinal directions', () => {
    expect(bearingDeg([0, 0], [0, 1])).toBeCloseTo(0, 1) // north
    expect(bearingDeg([0, 0], [1, 0])).toBeCloseTo(90, 0) // east
    expect(bearingDeg([0, 0], [0, -1])).toBeCloseTo(180, 1) // south
    expect(bearingDeg([0, 0], [-1, 0])).toBeCloseTo(270, 0) // west
  })

  test('angularDiffDeg wraps around 360', () => {
    expect(angularDiffDeg(10, 350)).toBeCloseTo(20)
    expect(angularDiffDeg(350, 10)).toBeCloseTo(20)
    expect(angularDiffDeg(0, 180)).toBeCloseTo(180)
    expect(angularDiffDeg(90, 90)).toBe(0)
  })

  test('interpolate is clamped and linear at the midpoint', () => {
    expect(interpolate([0, 0], [2, 4], 0.5)).toEqual([1, 2])
    expect(interpolate([0, 0], [2, 4], -1)).toEqual([0, 0])
    expect(interpolate([0, 0], [2, 4], 5)).toEqual([2, 4])
  })

  test('cumulativeMeters is monotonic and starts at 0', () => {
    const line: LngLat[] = [
      [0, 0],
      [0, 0.001],
      [0, 0.002],
    ]
    const cum = cumulativeMeters(line)
    expect(cum[0]).toBe(0)
    expect(cum[1]!).toBeGreaterThan(0)
    expect(cum[2]!).toBeGreaterThan(cum[1]!)
  })
})

describe('radiusForKind vocabulary', () => {
  test('extended landforms get the areal/mountain tier (they used to fall to the 600 m default)', () => {
    expect(radiusForKind('point')).toBe(1200) // peninsula-class
    expect(radiusForKind('cape')).toBe(1200)
    expect(radiusForKind('pass')).toBe(1500) // a high mountain feature
    expect(radiusForKind('waterfall')).toBe(1000)
    expect(radiusForKind('overlook')).toBe(1000)
  })

  test('"viewpoint" is park-tier — the \\bpoint\\b areal pattern must not swallow it', () => {
    expect(radiusForKind('viewpoint')).toBe(1000)
  })

  test('a spring stays compact (a point-source feature, not an areal body)', () => {
    expect(radiusForKind('spring')).toBe(600)
  })

  test('matching is case-insensitive so a capitalized kind never under-triggers', () => {
    expect(radiusForKind('State Park')).toBe(1000)
    expect(radiusForKind('CAPE')).toBe(1200)
    expect(radiusForKind('Mountain')).toBe(1500)
  })
})

describe('speakable anchor sanity', () => {
  test('speakableAnchorMaxM is the kind-aware radius widened to an edge-to-edge ceiling', () => {
    expect(speakableAnchorMaxM('state park')).toBe(Math.round(SPEAKABLE_ANCHOR_RADIUS_MULT * radiusForKind('state park')))
    expect(speakableAnchorMaxM('state park')).toBe(1500) // 1000 × 1.5
    expect(speakableAnchorMaxM('peninsula')).toBe(1800) // 1200 × 1.5
    expect(speakableAnchorMaxM('museum')).toBe(900) //    600 × 1.5
    expect(speakableAnchorMaxM(null)).toBe(900)
  })

  test('an anchor on top of the pin is always fine', () => {
    const r = checkSpeakableAnchor([-120.1, 39.05], [-120.1, 39.05], null)
    expect(r.distanceM).toBeCloseTo(0, 5)
    expect(r.ok).toBe(true)
  })

  test('the Sugar Pine Point case — an 810 m park vantage clears comfortably (not a near-miss)', () => {
    // pin -120.122,39.0575 → lighthouse anchor -120.113971,39.061266 (the one live anchor).
    const r = checkSpeakableAnchor([-120.122, 39.0575], [-120.113971, 39.061266], 'state park')
    expect(r.distanceM).toBeGreaterThan(790)
    expect(r.distanceM).toBeLessThan(830)
    expect(r.maxM).toBe(1500)
    expect(r.ok).toBe(true)
  })

  test('kind-awareness: the SAME distance fails as a default poi but passes as a park', () => {
    // ~1112 m north (0.01° lat): beyond the 900 m default ceiling, inside the 1500 m park ceiling.
    const pin: LngLat = [-120.1, 39.05]
    const anchor: LngLat = [-120.1, 39.06]
    const asDefault = checkSpeakableAnchor(pin, anchor, null)
    expect(asDefault.distanceM).toBeGreaterThan(900)
    expect(asDefault.ok).toBe(false)
    const asPark = checkSpeakableAnchor(pin, anchor, 'state park')
    expect(asPark.distanceM).toBe(asDefault.distanceM)
    expect(asPark.ok).toBe(true)
  })

  test('a km-away anchor is rejected even for the widest kind (the hallucinated-coord case)', () => {
    // 1° north ≈ 111 km — the typo/hallucination this guard exists to catch (peak ceiling = 2250 m).
    const r = checkSpeakableAnchor([-120.1, 39.05], [-120.1, 40.05], 'mountain peak')
    expect(r.distanceM).toBeGreaterThan(110_000)
    expect(r.ok).toBe(false)
  })
})
