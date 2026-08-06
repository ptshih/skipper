import { describe, expect, test } from 'bun:test'
import { keptCountUpTo, simplifyIndices } from './simplify-path'

/** ~1 m in degrees of latitude at any latitude, and in longitude near Tahoe (39°N) it is a bit more —
 *  close enough for tests that assert "well under" or "well over" ε rather than exact metres. */
const M = 1 / 111_320

describe('simplifyIndices', () => {
  test('keeps the endpoints, always', () => {
    const pts: [number, number][] = [
      [-120, 39],
      [-120, 39.001],
      [-120, 39.002],
    ]
    const kept = simplifyIndices(pts, 5)
    expect(kept[0]).toBe(0)
    expect(kept[kept.length - 1]).toBe(pts.length - 1)
  })

  test('a dead-straight run collapses to its two ends', () => {
    // 200 collinear points. Every interior point is 0 m from the chord, so none survives any ε > 0.
    const pts: [number, number][] = Array.from({ length: 200 }, (_, i) => [-120, 39 + i * 10 * M])
    expect(simplifyIndices(pts, 2)).toEqual([0, 199])
  })

  test('a corner is never dropped, however small the detour around it', () => {
    // ⚠ THE ONE THAT MATTERS FOR A ROAD. A hairpin is a point far off the chord between its
    // neighbours; losing it would cut the corner and draw the route through the scenery.
    const pts: [number, number][] = [
      [-120, 39],
      [-120 + 300 * M, 39], // 300 m out to the side
      [-120, 39 + 600 * M],
    ]
    expect(simplifyIndices(pts, 50)).toEqual([0, 1, 2])
  })

  test('drops deviations below ε and keeps those above it', () => {
    const below: [number, number][] = [
      [-120, 39],
      [-120, 39 + 100 * M],
      [-120 + 1 * M, 39 + 200 * M], // ~1 m off the chord
      [-120, 39 + 300 * M],
    ]
    // ⚠ The 1 m wobble goes at ε=5 and the straight collapses entirely.
    expect(simplifyIndices(below, 5)).toEqual([0, 3])

    const above: [number, number][] = [
      [-120, 39],
      [-120 + 40 * M, 39 + 150 * M], // ~40 m off the chord
      [-120, 39 + 300 * M],
    ]
    expect(simplifyIndices(above, 5)).toEqual([0, 1, 2])
  })

  test('returns every index when ε is zero or the input is degenerate', () => {
    const pts: [number, number][] = [
      [-120, 39],
      [-120, 39.001],
      [-120, 39.002],
    ]
    expect(simplifyIndices(pts, 0)).toEqual([0, 1, 2])
    expect(simplifyIndices([[-120, 39]], 5)).toEqual([0])
    expect(simplifyIndices([], 5)).toEqual([])
  })

  test('output is ascending and free of duplicates', () => {
    // A wandering route, so the recursion splits repeatedly rather than trivially.
    const pts: [number, number][] = Array.from({ length: 500 }, (_, i) => [
      -120 + Math.sin(i / 7) * 200 * M,
      39 + i * 12 * M,
    ])
    const kept = simplifyIndices(pts, 3)
    expect(kept.length).toBeGreaterThan(2)
    expect(kept.length).toBeLessThan(pts.length)
    for (let i = 1; i < kept.length; i++) expect(kept[i]!).toBeGreaterThan(kept[i - 1]!)
  })

  test('a hairpin survives — the perpendicular is clamped to the SEGMENT', () => {
    // ⚠ REGRESSION GUARD for the infinite-line form. Out and almost straight back: the chord from
    // first to last is ~0 m long, so against an infinite line the tip can score misleadingly low.
    const pts: [number, number][] = [
      [-120, 39],
      [-120, 39 + 500 * M], // 500 m out
      [-120 + 1 * M, 39], // and back, 1 m to the side
    ]
    expect(simplifyIndices(pts, 20)).toContain(1)
  })
})

describe('keptCountUpTo', () => {
  const kept = [0, 5, 9, 14, 20]

  test('counts the kept indices at or below the target', () => {
    expect(keptCountUpTo(kept, 0)).toBe(1)
    expect(keptCountUpTo(kept, 4)).toBe(1)
    expect(keptCountUpTo(kept, 5)).toBe(2)
    expect(keptCountUpTo(kept, 13)).toBe(3)
    expect(keptCountUpTo(kept, 14)).toBe(4)
    expect(keptCountUpTo(kept, 20)).toBe(5)
    expect(keptCountUpTo(kept, 999)).toBe(5)
  })

  test('a target below the first kept index yields an empty prefix', () => {
    expect(keptCountUpTo([3, 8], 0)).toBe(0)
    expect(keptCountUpTo([], 5)).toBe(0)
  })

  test('the result is a slice length, so it never overruns', () => {
    for (const target of [-1, 0, 7, 20, 100]) {
      const n = keptCountUpTo(kept, target)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThanOrEqual(kept.length)
    }
  })
})
