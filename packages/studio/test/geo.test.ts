import { describe, expect, test } from 'bun:test'
// The route-geometry primitives are owned by @skipper/engine (single-sourced with buildDrive's
// pacing) — test them at their source. Only encodePolyline (+ the LngLat type) is studio-local.
import {
  cumulativeMeters,
  haversineMeters,
  nearestOnRoute,
  routeBearingAt,
  timeAtAlong,
  totalMeters,
} from '@skipper/engine'
import { encodePolyline, type LngLat } from '../src/pipeline/geo'

/** One degree of latitude in meters at the radius geo.ts uses (R*π/180). */
const ONE_DEG_LAT_M = (6_371_008.8 * Math.PI) / 180 // ≈ 111195

const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)

// NOTE: haversineMeters + bearingDeg are RE-EXPORTED from @skipper/engine; their core distance/
// cardinal cases live in packages/engine/test/geo.test.ts (the source of truth). Only the
// studio-unique axes/cases are kept here.
describe('haversineMeters', () => {
  // The latitude-degree magnitude + cardinal cases are the engine's (re-exported); this keeps only
  // the studio-unique LONGITUDE axis (different code path: cos(lat) scaling at the equator).
  test('one degree of longitude at the equator ≈ one degree of latitude', () => {
    near(haversineMeters([0, 0], [1, 0]), ONE_DEG_LAT_M, 1)
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
  test('returns the snapped vertex coordinates (the trigger point)', () => {
    const pos = nearestOnRoute(line, cum, [0.0001, 1.0])
    expect(pos.lng).toBe(0) // snapped onto the route, not the off-route input lng 0.0001
    expect(pos.lat).toBe(1)
  })
})

describe('routeBearingAt', () => {
  // A route that runs due north (vertices 0..2) then turns due east (vertices 2..4).
  const line: LngLat[] = [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ]
  test('uses the forward segment at an interior vertex', () => {
    near(routeBearingAt(line, 0), 0, 1e-6) // heading north
    near(routeBearingAt(line, 2), 90, 0.1) // at the corner, the NEXT segment heads east
  })
  test('uses the trailing segment at the final vertex', () => {
    near(routeBearingAt(line, line.length - 1), 90, 0.1) // last leg heads east
  })
  test('degenerate polyline → 0', () => {
    expect(routeBearingAt([[0, 0]], 0)).toBe(0)
    expect(routeBearingAt([], 0)).toBe(0)
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
