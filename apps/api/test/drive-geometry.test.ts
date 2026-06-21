import { describe, expect, test } from 'bun:test'
import { polylineBbox } from '../src/drive-geometry'

// Pure geometry helper behind the geometry-first drive model. polylineBbox freezes a drive's stored
// region extent (drives.bbox_*) AND bounds the corpus spatial prefilter. A lat/lng transposition or
// sign slip here silently resolves a drive to the wrong place / loads the wrong candidate set —
// exactly what these pin. No DB/network.

describe('polylineBbox', () => {
  test('spans the min/max lat+lng of a [lng,lat] polyline', () => {
    // Tahoe-ish corner points, deliberately out of order to prove it scans, not assumes endpoints.
    const bbox = polylineBbox([
      [-120.1, 39.0],
      [-120.3, 39.2],
      [-119.9, 38.9],
    ])
    expect(bbox).toEqual({ minLat: 38.9, minLng: -120.3, maxLat: 39.2, maxLng: -119.9 })
  })

  test('a single point collapses to a zero-area bbox (min === max)', () => {
    expect(polylineBbox([[-120.1, 39.0]])).toEqual({
      minLat: 39.0,
      minLng: -120.1,
      maxLat: 39.0,
      maxLng: -120.1,
    })
  })

  test('does not transpose lat/lng (a due-EAST leg widens lng only, not lat)', () => {
    const bbox = polylineBbox([
      [-120.0, 39.0],
      [-119.0, 39.0],
    ])
    expect(bbox.minLat).toBe(39.0)
    expect(bbox.maxLat).toBe(39.0)
    expect(bbox.minLng).toBe(-120.0)
    expect(bbox.maxLng).toBe(-119.0)
  })
})
