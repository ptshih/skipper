import { describe, expect, test } from 'bun:test'
import { geocodeBoundsFor, polylineBbox, resolveAnchorChoice, type RegionAnchor } from '../src/drive-geometry'

// Pure geometry helpers behind the geometry-first drive model. polylineBbox freezes a drive's stored
// region extent (drives.bbox_*) AND bounds the corpus spatial prefilter; geocodeBoundsFor biases
// endpoint geocoding to the region. A lat/lng transposition or sign slip here silently resolves a
// drive to the wrong place / loads the wrong candidate set — exactly what these pin. No DB/network.

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

describe('geocodeBoundsFor', () => {
  test('reorders the lng,lat-ordered bbox into a lat,lng geocode viewport', () => {
    // input "lngMin,latMin,lngMax,latMax" → "latMin,lngMin|latMax,lngMax"
    expect(geocodeBoundsFor('-120.25,38.86,-119.55,39.65')).toBe('38.86,-120.25|39.65,-119.55')
  })

  test('returns undefined for a null / malformed bbox (wrong arity or non-numeric)', () => {
    expect(geocodeBoundsFor(null)).toBeUndefined()
    expect(geocodeBoundsFor('-120.25,38.86,-119.55')).toBeUndefined() // only 3 parts
    expect(geocodeBoundsFor('a,b,c,d')).toBeUndefined() // non-numeric
  })
})

// The grounded resolver's pick-vs-fallback decision. A valid in-range index resolves to the anchor's
// EXACT coords (the whole point — no geocode hop, which had mislocated "Tahoe City" to South Lake
// Tahoe); an out-of-range/negative index falls back to a geocodable name; neither => null.
describe('resolveAnchorChoice', () => {
  const anchors: RegionAnchor[] = [
    { name: 'Tahoe City', kind: null, lat: 39.1722, lng: -120.1389 },
    { name: 'Kings Beach', kind: null, lat: 39.2411, lng: -120.0231 },
  ]

  test('a valid index picks that anchor (exact coords, no geocode)', () => {
    expect(resolveAnchorChoice(0, 'ignored', anchors)).toEqual({ kind: 'anchor', anchor: anchors[0]! })
    expect(resolveAnchorChoice(1, '', anchors)).toEqual({ kind: 'anchor', anchor: anchors[1]! })
  })

  test('index -1 falls back to the (trimmed) name to geocode', () => {
    expect(resolveAnchorChoice(-1, '  Sand Harbor  ', anchors)).toEqual({ kind: 'geocode', name: 'Sand Harbor' })
  })

  test('an out-of-range index falls back to the name (never indexes past the list)', () => {
    expect(resolveAnchorChoice(99, 'Zephyr Cove', anchors)).toEqual({ kind: 'geocode', name: 'Zephyr Cove' })
    expect(resolveAnchorChoice(2, 'Zephyr Cove', anchors)).toEqual({ kind: 'geocode', name: 'Zephyr Cove' }) // length === 2
  })

  test('a non-integer index is not a valid pick', () => {
    expect(resolveAnchorChoice(1.5, 'Emerald Bay', anchors)).toEqual({ kind: 'geocode', name: 'Emerald Bay' })
  })

  test('null when there is neither a valid index nor a usable name', () => {
    expect(resolveAnchorChoice(-1, '   ', anchors)).toBeNull()
    expect(resolveAnchorChoice(-1, undefined, anchors)).toBeNull()
    expect(resolveAnchorChoice(0, '', [])).toBeNull() // empty anchor list, no fallback name
  })
})
