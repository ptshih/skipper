/**
 * `regionForPoint` — which region a saved drive is labelled with on `GET /drives`.
 *
 * The label is DERIVED per request from the drive's frozen start point, never stored
 * (`docs/decisions/geometry-first-regions.md`; the deliberation that reconsidered and re-affirmed
 * that is `docs/designs/my-drives-legibility.md` §4). This file pins the containment rule, which is
 * the part with edge cases — the query that feeds it is the boring part and is deliberately not here,
 * which is exactly why the function is pure.
 *
 * Two rules are worth the file:
 *
 *   1. **Most specific wins.** `geometry-first-regions.md`'s tripwire names overlapping/nested boxes
 *      (a broad "Sierra Nevada" containing "Lake Tahoe") as a stop-and-reconsider case. A rider in
 *      Tahoe means Tahoe. Without this rule the answer is whatever order Postgres returned, so a
 *      drive would change its label between requests for no reason a log could explain.
 *   2. **No match is a real answer.** A drive whose start is outside every RELEASED region has no
 *      label and must still render. Hiding it would let a bbox edit silently eat a rider's library.
 */
import { describe, expect, test } from 'bun:test'
import { regionForPoint, type RegionBox } from '../src/region-geo'

/** `parseRegionBbox`'s shape: "lng_min,lat_min,lng_max,lat_max" → swLng/swLat/neLng/neLat. */
const box = (
  id: string,
  swLng: number,
  swLat: number,
  neLng: number,
  neLat: number,
): RegionBox => ({
  id,
  slug: id,
  displayName: id,
  box: { swLng, swLat, neLng, neLat },
})

// Roughly the Tahoe basin, and a deliberately larger box enclosing it.
const TAHOE = box('lake-tahoe', -120.2, 38.8, -119.9, 39.3)
const SIERRA = box('sierra-nevada', -121.0, 38.0, -119.0, 40.0)

describe('regionForPoint', () => {
  test('labels a point inside exactly one region', () => {
    const r = regionForPoint([TAHOE], 39.0, -120.0)
    expect(r?.slug).toBe('lake-tahoe')
  })

  test('returns null when no region contains the point — a REAL answer, not a failure', () => {
    expect(regionForPoint([TAHOE], 36.5, -118.0)).toBeNull()
    // And with nothing released at all, which is a live state before the first region ships.
    expect(regionForPoint([], 39.0, -120.0)).toBeNull()
  })

  test('MOST SPECIFIC wins when one region nests inside another', () => {
    // The rider is in Tahoe, which is also inside the broader Sierra box. Tahoe is the answer.
    expect(regionForPoint([SIERRA, TAHOE], 39.0, -120.0)?.slug).toBe('lake-tahoe')
  })

  test('most-specific is ORDER-INDEPENDENT — the whole point of having a rule', () => {
    // Same two regions, both orderings. Postgres makes no ordering promise without ORDER BY, so if
    // this ever disagrees the label flickers between requests.
    const a = regionForPoint([SIERRA, TAHOE], 39.0, -120.0)?.slug
    const b = regionForPoint([TAHOE, SIERRA], 39.0, -120.0)?.slug
    expect(a).toBe('lake-tahoe')
    expect(b).toBe('lake-tahoe')
  })

  test('falls back to the enclosing region when the point misses the narrower one', () => {
    // Inside Sierra, outside Tahoe — the broad region is the correct label here, not null.
    expect(regionForPoint([SIERRA, TAHOE], 38.2, -120.5)?.slug).toBe('sierra-nevada')
  })

  test('containment is INCLUSIVE on all four edges', () => {
    // Matches `pointInRegionBbox`, which the admin poi-count and the API's `between` anchor query also
    // use — a place exactly on a boundary must not belong to a region on one screen and not another.
    expect(regionForPoint([TAHOE], 38.8, -120.2)?.slug).toBe('lake-tahoe') // SW corner
    expect(regionForPoint([TAHOE], 39.3, -119.9)?.slug).toBe('lake-tahoe') // NE corner
    expect(regionForPoint([TAHOE], 38.8, -120.0)?.slug).toBe('lake-tahoe') // south edge
  })

  test('a hair outside the edge is outside', () => {
    expect(regionForPoint([TAHOE], 38.79, -120.0)).toBeNull()
    expect(regionForPoint([TAHOE], 39.0, -120.21)).toBeNull()
  })

  test('carries the display name, so the client never has to resolve an id', () => {
    const named: RegionBox = { ...TAHOE, displayName: 'Lake Tahoe' }
    expect(regionForPoint([named], 39.0, -120.0)).toEqual({
      id: 'lake-tahoe',
      slug: 'lake-tahoe',
      displayName: 'Lake Tahoe',
    })
  })
})
