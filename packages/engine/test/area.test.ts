// Area-trigger geometry. These guard the properties the trigger loops rely on — most importantly
// that containment and boundary-distance never disagree, since the loops consume them as one number.
import { describe, expect, it } from 'bun:test'
import { convexHull, pointInRing, distanceToRingM, insideArea, signedDistanceM, ringAreaM2 } from '../src/area'
import type { LngLat } from '../src/geo'

/** A ~1 km square at Reno's latitude, in [lng, lat]. */
const LAT0 = 39.53
const dLat = (m: number) => m / 111_132
const dLng = (m: number) => m / (111_320 * Math.cos((LAT0 * Math.PI) / 180))
const at = (eastM: number, northM: number): LngLat => [-119.81 + dLng(eastM), LAT0 + dLat(northM)]
const SQUARE = [at(0, 0), at(1000, 0), at(1000, 1000), at(0, 1000)]

describe('convexHull', () => {
  it('drops interior points — the 46-member district becomes a few vertices', () => {
    const pts = [...SQUARE, at(500, 500), at(250, 400), at(700, 600)]
    expect(convexHull(pts)).toHaveLength(4)
  })

  it('handles co-located members (three Truckee members share one snapped anchor)', () => {
    const hull = convexHull([at(0, 0), at(0, 0), at(0, 0), at(500, 0), at(0, 500)])
    expect(hull).toHaveLength(3)
  })

  it('degenerates safely: 0, 1 and 2 points are not rings', () => {
    expect(convexHull([])).toHaveLength(0)
    expect(convexHull([at(0, 0)])).toHaveLength(1)
    expect(convexHull([at(0, 0), at(100, 0)])).toHaveLength(2)
  })

  it('collinear members (a strip along one street) do not produce a fake interior', () => {
    const hull = convexHull([at(0, 0), at(250, 0), at(500, 0), at(750, 0)])
    expect(hull.length).toBeLessThanOrEqual(2)
    expect(ringAreaM2(hull)).toBe(0)
  })
})

describe('pointInRing', () => {
  it('separates inside from outside', () => {
    expect(pointInRing(at(500, 500), SQUARE)).toBe(true)
    expect(pointInRing(at(1500, 500), SQUARE)).toBe(false)
    expect(pointInRing(at(500, -50), SQUARE)).toBe(false)
  })

  it('a degenerate ring contains nothing rather than throwing', () => {
    expect(pointInRing(at(0, 0), [])).toBe(false)
    expect(pointInRing(at(0, 0), [at(0, 0), at(10, 0)])).toBe(false)
  })
})

describe('distanceToRingM / signedDistanceM', () => {
  it('measures to the BOUNDARY, not the centre — the whole point of an area', () => {
    // Dead centre of a 1 km square: 500 m from every edge, though it is inside.
    expect(distanceToRingM(at(500, 500), SQUARE)).toBeGreaterThan(480)
    expect(distanceToRingM(at(500, 500), SQUARE)).toBeLessThan(520)
    // Just inside the west edge: metres, not hundreds of metres.
    expect(distanceToRingM(at(10, 500), SQUARE)).toBeLessThan(20)
  })

  it('signs it: negative inside, positive outside', () => {
    expect(signedDistanceM(at(500, 500), { ring: SQUARE, marginM: 0 })).toBeLessThan(0)
    expect(signedDistanceM(at(1200, 500), { ring: SQUARE, marginM: 0 })).toBeGreaterThan(0)
  })

  it('the boundary is decided by DISTANCE, not by parity — they can never disagree', () => {
    // A point on the edge is undefined for the parity test; the margin is what resolves it, which is
    // why insideArea pairs them and nothing calls pointInRing alone.
    const onEdge = at(0, 500)
    expect(insideArea(onEdge, { ring: SQUARE, marginM: 25 })).toBe(true)
  })
})

describe('insideArea', () => {
  const area = { ring: SQUARE, marginM: 50 }

  it('the margin admits a rider just outside, and only just', () => {
    expect(insideArea(at(-30, 500), area)).toBe(true) // 30 m out, inside the 50 m margin
    expect(insideArea(at(-80, 500), area)).toBe(false) // 80 m out
  })

  it('is not a bounding circle — a corner-adjacent point outside the hull stays out', () => {
    // 400 m diagonally off the NE corner is ~565 m from the centre-ish but clearly outside the ring.
    expect(insideArea(at(1400, 1400), area)).toBe(false)
  })
})

describe('ringAreaM2', () => {
  it('measures roughly the right size, for ordering overlapping districts', () => {
    const a = ringAreaM2(SQUARE)
    expect(a).toBeGreaterThan(0.9e6)
    expect(a).toBeLessThan(1.1e6)
  })

  it('orders a nested district inside its parent — "most specific wins" needs this', () => {
    const inner = [at(200, 200), at(600, 200), at(600, 600), at(200, 600)]
    expect(ringAreaM2(inner)).toBeLessThan(ringAreaM2(SQUARE))
  })
})
