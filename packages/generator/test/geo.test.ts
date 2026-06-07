import { describe, expect, test } from 'bun:test'
import {
  cumulativeMeters,
  encodePolyline,
  haversineMeters,
  nearestOnRoute,
  sampleAlong,
  timeAtAlong,
  totalMeters,
  type LngLat,
} from '../src/pipeline/geo'

/** One degree of latitude in meters at the radius geo.ts uses (R*π/180). */
const ONE_DEG_LAT_M = (6_371_008.8 * Math.PI) / 180 // ≈ 111195

const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)

describe('haversineMeters', () => {
  test('zero distance for identical points', () => {
    expect(haversineMeters([0, 0], [0, 0])).toBe(0)
  })

  test('one degree of latitude ≈ 111.2 km', () => {
    near(haversineMeters([0, 0], [0, 1]), ONE_DEG_LAT_M, 1) // within 1 m
  })

  test('one degree of longitude at the equator ≈ one degree of latitude', () => {
    near(haversineMeters([0, 0], [1, 0]), ONE_DEG_LAT_M, 1)
  })

  test('SF → LA ≈ 559 km', () => {
    const sf: LngLat = [-122.4194, 37.7749]
    const la: LngLat = [-118.2437, 34.0522]
    near(haversineMeters(sf, la), 559_000, 5_000)
  })
})

describe('encodePolyline', () => {
  // Google's canonical example (lat,lng): (38.5,-120.2) (40.7,-120.95) (43.252,-126.453)
  test('matches the canonical Google-encoded string', () => {
    const points: LngLat[] = [
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]
    expect(encodePolyline(points)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
  })

  test('empty polyline encodes to empty string', () => {
    expect(encodePolyline([])).toBe('')
  })
})

describe('cumulativeMeters / totalMeters', () => {
  const line: LngLat[] = [
    [0, 0],
    [0, 1],
    [0, 2],
  ]
  test('starts at 0, is monotonic, length matches', () => {
    const cum = cumulativeMeters(line)
    expect(cum.length).toBe(3)
    expect(cum[0]).toBe(0)
    expect(cum[1]! > cum[0]!).toBe(true)
    expect(cum[2]! > cum[1]!).toBe(true)
  })
  test('total ≈ 2 degrees of latitude', () => {
    near(totalMeters(cumulativeMeters(line)), 2 * ONE_DEG_LAT_M, 2)
  })
  test('empty polyline → total 0', () => {
    expect(totalMeters(cumulativeMeters([]))).toBe(0)
  })
})

describe('nearestOnRoute', () => {
  const line: LngLat[] = [
    [0, 0],
    [0, 1],
    [0, 2],
  ]
  const cum = cumulativeMeters(line)
  test('snaps to the closest vertex with a small off-route distance', () => {
    const pos = nearestOnRoute(line, cum, [0.0001, 1.0]) // ~11 m east of vertex 1
    expect(pos.index).toBe(1)
    near(pos.alongM, ONE_DEG_LAT_M, 2)
    expect(pos.offRouteM).toBeLessThan(20)
  })
})

describe('timeAtAlong', () => {
  test('linear interpolation of drive time', () => {
    near(timeAtAlong(ONE_DEG_LAT_M, 2 * ONE_DEG_LAT_M, 3600), 1800, 1e-6)
  })
  test('guards zero-length route', () => {
    expect(timeAtAlong(100, 0, 3600)).toBe(0)
  })
})

describe('sampleAlong', () => {
  // ~11.1 km north-south line at ~111 m spacing.
  const line: LngLat[] = Array.from({ length: 101 }, (_, i) => [0, i * 0.001] as LngLat)
  const cum = cumulativeMeters(line)
  test('samples roughly every step and always includes the last vertex', () => {
    const samples = sampleAlong(line, cum, 2_000) // every ~2 km over ~11.1 km
    expect(samples.length).toBeGreaterThanOrEqual(6)
    expect(samples[0]!.alongM).toBe(0)
    expect(samples[samples.length - 1]!.alongM).toBe(totalMeters(cum))
  })
})
