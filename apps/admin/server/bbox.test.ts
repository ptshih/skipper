import { describe, expect, test } from 'bun:test'
import { bboxError, bboxOverlapsRect, MAX_BBOX_SPAN_DEG, parseBbox } from './bbox'

describe('bboxError (region bbox validation at the write boundary — audit #5)', () => {
  test('accepts a well-formed bbox (lake-tahoe-ish)', () => {
    expect(bboxError('-120.25,38.85,-119.90,39.28')).toBeNull()
  })

  test('rejects a non-4-number / non-finite shape', () => {
    expect(bboxError('-120,39,-119')).not.toBeNull() // 3 numbers
    expect(bboxError('-120,39,-119,39,1')).not.toBeNull() // 5 numbers
    expect(bboxError('-120,39,-119,abc')).not.toBeNull() // NaN
    expect(bboxError('')).not.toBeNull()
  })

  test('rejects out-of-range coordinates', () => {
    expect(bboxError('-181,39,-119,40')).not.toBeNull() // lng < -180
    expect(bboxError('-120,39,-119,91')).not.toBeNull() // lat > 90
  })

  test('rejects swapped / degenerate corners (the Nominatim lat/lng reorder swap)', () => {
    expect(bboxError('-119.90,39.28,-120.25,38.85')).not.toBeNull() // sw and ne swapped → swLng>neLng
    expect(bboxError('-120,39,-120,40')).not.toBeNull() // swLng == neLng (degenerate)
    expect(bboxError('-120,39,-119,39')).not.toBeNull() // swLat == neLat (degenerate)
  })

  test('rejects a span larger than the cap (continent-scale fat-finger)', () => {
    // A box spanning > MAX_BBOX_SPAN_DEG in longitude.
    expect(bboxError(`-120,38,${-120 + MAX_BBOX_SPAN_DEG + 1},39`)).not.toBeNull()
  })

  test('allows a large but plausible multi-state corridor (within the cap)', () => {
    // ~10° of longitude (Yosemite→Moab scale) is permitted.
    expect(bboxError('-120.0,37.0,-109.5,39.0')).toBeNull()
  })

  test('tolerates surrounding whitespace in each number', () => {
    expect(bboxError(' -120.25 , 38.85 , -119.90 , 39.28 ')).toBeNull()
  })
})

describe('bboxOverlapsRect (a DRIVE’s derived region — geometry-first, one dimension up)', () => {
  // The Tahoe basin, as the region rows carry it: "swLng,swLat,neLng,neLat".
  const tahoe = parseBbox('-120.25,38.85,-119.90,39.28')!

  test('a route rectangle inside the region overlaps it', () => {
    expect(bboxOverlapsRect(tahoe, { minLat: 39.0, minLng: -120.1, maxLat: 39.2, maxLng: -120.0 })).toBe(true)
  })

  test('a route that only CROSSES the region overlaps it (neither contains the other)', () => {
    // A long east-west corridor straddling the basin — no corner of either box is inside the other,
    // which is exactly the case a naive "is a corner contained?" test gets wrong.
    expect(bboxOverlapsRect(tahoe, { minLat: 39.0, minLng: -121.5, maxLat: 39.1, maxLng: -119.0 })).toBe(true)
  })

  test('a route entirely outside overlaps nothing', () => {
    // Yosemite-ish: south and west of the basin.
    expect(bboxOverlapsRect(tahoe, { minLat: 37.6, minLng: -119.7, maxLat: 37.9, maxLng: -119.4 })).toBe(false)
    // Due east, past the eastern edge.
    expect(bboxOverlapsRect(tahoe, { minLat: 39.0, minLng: -119.5, maxLat: 39.2, maxLng: -119.3 })).toBe(false)
  })

  test('a touching edge counts as overlapping', () => {
    expect(bboxOverlapsRect(tahoe, { minLat: 39.0, minLng: -119.90, maxLat: 39.2, maxLng: -119.5 })).toBe(true)
  })
})
