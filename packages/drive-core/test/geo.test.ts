import { describe, expect, test } from 'bun:test'
import { angularDiffDeg, bearingDeg, cumulativeMeters, haversineMeters, interpolate } from '../src/geo'
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
