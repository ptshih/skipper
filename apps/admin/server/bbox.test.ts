import { describe, expect, test } from 'bun:test'
import { bboxError, MAX_BBOX_SPAN_DEG } from './bbox'

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
