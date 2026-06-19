import { describe, expect, test } from 'bun:test'
import { buildRouteSnapper } from '../src/pacing'
import type { LngLat } from '../src/geo'

// ~11.1 km north-south line (lat 38.000 → 38.100); lat 38.0+i*0.001 → alongSec ≈ i*6.6 over 660s.
const polyline: LngLat[] = Array.from({ length: 101 }, (_, i) => [0, 38.0 + i * 0.001] as LngLat)
const TOTAL_SEC = 660

describe('buildRouteSnapper', () => {
  const snap = buildRouteSnapper(polyline, TOTAL_SEC)

  test('snaps an off-route point to the route (trigger lng = 0, small off-route, heading ~north)', () => {
    const s = snap([0.0001, 38.05]) // ~11 m east of the midpoint
    expect(s.triggerLng).toBe(0)
    expect(s.triggerLat).toBeCloseTo(38.05, 5)
    expect(s.offRouteM).toBeLessThan(20)
    expect(s.approachHeadingDeg === 0 || s.approachHeadingDeg === 360 || s.approachHeadingDeg < 1).toBe(true)
  })

  test('along-route time scales with along-route distance (midpoint ≈ half the drive)', () => {
    expect(snap([0, 38.05]).alongSec).toBeCloseTo(TOTAL_SEC / 2, 0)
    expect(snap([0, 38.0]).alongSec).toBeCloseTo(0, 5)
  })
})
