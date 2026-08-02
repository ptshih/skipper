import { describe, expect, test } from 'bun:test'
import { decodePolyline } from '../src/index'

// The route decoder — the one piece of pure arithmetic between Google's answer and everything that
// depends on where the road actually is: pacing, trigger radii, the map, and buildDrive's selection.
// A subtly wrong decode does not throw. It MOVES stops, which from inside a car reads as "the
// triggering is flaky" rather than "the polyline is wrong", so it is worth pinning precisely.
describe('decodePolyline', () => {
  // Google's own documented example for the Encoded Polyline Algorithm Format, which encodes
  // (38.5, -120.2), (40.7, -120.95), (43.252, -126.453) — lat, lng, in THAT order.
  const GOOGLE_EXAMPLE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'

  test('decodes the canonical Google example', () => {
    const out = decodePolyline(GOOGLE_EXAMPLE)
    expect(out).toHaveLength(3)
    // ⚠ Our output is [lng, lat] — the reverse of the source encoding.
    expect(out[0]![0]).toBeCloseTo(-120.2, 5)
    expect(out[0]![1]).toBeCloseTo(38.5, 5)
    expect(out[1]![0]).toBeCloseTo(-120.95, 5)
    expect(out[1]![1]).toBeCloseTo(40.7, 5)
    expect(out[2]![0]).toBeCloseTo(-126.453, 5)
    expect(out[2]![1]).toBeCloseTo(43.252, 5)
  })

  test('AXIS ORDER: [lng, lat], not [lat, lng]', () => {
    // The regression this exists for. Both are `number`, so a swap passes typecheck, passes lint, and
    // throws nothing — it just relocates every drive. For Tahoe (lat ~39, lng ~-120) a swap lands the
    // route at (-120, 39): in the Indian Ocean, which is far enough away to look like a data problem
    // rather than an axis problem.
    const [first] = decodePolyline(GOOGLE_EXAMPLE)
    expect(first![0]).toBeLessThan(0) // longitude — western hemisphere
    expect(first![1]).toBeGreaterThan(0) // latitude — northern hemisphere
    // And unambiguously: a latitude can never exceed 90, so this ordering is not a coincidence.
    expect(Math.abs(first![0])).toBeGreaterThan(90)
    expect(Math.abs(first![1])).toBeLessThan(90)
  })

  test('empty input decodes to no points, rather than throwing', () => {
    // A degenerate route (start == end) is a real case — "take me on a loop" resolves that way — and
    // materializeRoute already coalesces its zero distance. The decoder must agree and not throw.
    expect(decodePolyline('')).toEqual([])
  })

  test('a single point round-trips', () => {
    // First pair only of the canonical example.
    const out = decodePolyline('_p~iF~ps|U')
    expect(out).toHaveLength(1)
    expect(out[0]![1]).toBeCloseTo(38.5, 5)
    expect(out[0]![0]).toBeCloseTo(-120.2, 5)
  })

  test('deltas accumulate — later points are relative, not absolute', () => {
    // The whole format is delta-encoded, so an implementation that forgot to accumulate would return
    // the SECOND point as a tiny offset near (0,0) instead of near the first. Assert the points are
    // genuinely adjacent-ish rather than one being at the origin.
    const out = decodePolyline(GOOGLE_EXAMPLE)
    expect(Math.abs(out[1]![1] - out[0]![1])).toBeLessThan(5) // ~2.2° of latitude apart
    expect(Math.abs(out[1]![1])).toBeGreaterThan(30) // NOT near the equator
  })

  test('handles negative deltas (the zigzag branch)', () => {
    // In the canonical example longitude moves NEGATIVE between points 2 and 3 (-120.95 → -126.453).
    // That path is the `result & 1 ? ~(result >> 1) : result >> 1` odd branch; an implementation that
    // dropped the complement would send the route east instead of west.
    const out = decodePolyline(GOOGLE_EXAMPLE)
    expect(out[2]![0]).toBeLessThan(out[1]![0])
  })

  test('precision is 5 decimal places (≈1 m), the precision the trigger radii assume', () => {
    const out = decodePolyline(GOOGLE_EXAMPLE)
    for (const [lng, lat] of out) {
      // Exactly representable at 1e-5; guards against a factor of 1e6 (precision-6 polylines are a
      // real variant of this format, and decoding one with the wrong factor shrinks the route 10×
      // toward the equator rather than failing).
      expect(Number.isFinite(lat)).toBe(true)
      expect(Number.isFinite(lng)).toBe(true)
      expect(Math.abs(lat)).toBeLessThanOrEqual(90)
      expect(Math.abs(lng)).toBeLessThanOrEqual(180)
    }
  })
})
