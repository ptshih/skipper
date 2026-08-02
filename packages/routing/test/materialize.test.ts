import { describe, expect, test } from 'bun:test'
import { buildRoutesRequestBody, shapeRoute, type RoutesApiRoute, type Waypoint } from '../src/index'

const wp = (label: string, lat: number, lng: number): Waypoint => ({ label, lat, lng })

// Two waypoints of the canonical Google-encoded example, so decoding is exercised end to end here
// without re-testing the decoder itself (polyline.test.ts owns that).
const ENCODED = '_p~iF~ps|U_ulLnnqC'
const STAMP = '2026-08-02T12:00:00.000Z'

const route = (over: Partial<RoutesApiRoute> = {}): RoutesApiRoute => ({
  duration: '786s',
  polyline: { encodedPolyline: ENCODED },
  ...over,
})

// The request body decides WHICH coordinates reach a billed endpoint. Getting the origin/
// destination/intermediates split wrong does not fail loudly — it routes and charges for the wrong
// drive.
describe('buildRoutesRequestBody', () => {
  const a = wp('A', 39.0, -120.0)
  const b = wp('B', 39.1, -120.1)
  const c = wp('C', 39.2, -120.2)

  test('first is origin, last is destination, the middle rides as intermediates', () => {
    const body = buildRoutesRequestBody([a, b, c])
    expect(body.origin.location.latLng).toEqual({ latitude: 39.0, longitude: -120.0 })
    expect(body.destination.location.latLng).toEqual({ latitude: 39.2, longitude: -120.2 })
    expect(body.intermediates).toHaveLength(1)
    expect(body.intermediates[0]!.location.latLng).toEqual({ latitude: 39.1, longitude: -120.1 })
  })

  test('two waypoints means NO intermediates — not a duplicated endpoint', () => {
    // slice(1, -1) on a 2-element array is empty. An off-by-one here would resend an endpoint as a
    // via point and bill for a different route than the rider confirmed.
    const body = buildRoutesRequestBody([a, b])
    expect(body.intermediates).toEqual([])
  })

  test('every middle waypoint rides, in order', () => {
    const body = buildRoutesRequestBody([a, b, c, wp('D', 39.3, -120.3)])
    expect(body.intermediates.map((i) => i.location.latLng.latitude)).toEqual([39.1, 39.2])
  })

  test('fewer than two waypoints throws BEFORE any billed call', () => {
    // The guard exists so a malformed plan cannot reach the Routes API at all.
    expect(() => buildRoutesRequestBody([])).toThrow(/origin and a destination/)
    expect(() => buildRoutesRequestBody([a])).toThrow(/origin and a destination/)
  })

  test('asks for dense geometry, which the trigger geofencing depends on', () => {
    // The route is frozen and drives speed-adaptive triggering + the simulator; a downgrade to the
    // default polyline quality would thin the geometry and move trigger points.
    const body = buildRoutesRequestBody([a, b])
    expect(body.polylineQuality).toBe('HIGH_QUALITY')
    expect(body.travelMode).toBe('DRIVE')
  })
})

describe('shapeRoute', () => {
  test('parses the "786s" duration string to seconds', () => {
    expect(shapeRoute(route(), [wp('A', 0, 0), wp('B', 1, 1)], STAMP).durationSeconds).toBe(786)
  })

  test('A MISSING distanceMeters BECOMES 0 — the proto3 omission that already shipped as a bug', () => {
    // Routes uses proto3 JSON, which omits zero-valued fields rather than sending `0`. A degenerate
    // A→A route — which is exactly what a "take me on a loop" prompt resolves to — has distance 0 and
    // therefore NO distanceMeters field. Before the `?? 0`, undefined flowed into Math.round() → NaN →
    // JSON null, failed the driveProposal `number` DTO, and surfaced to the rider as a bogus
    // "please update Skipper". The absence of the field is the normal case here, not a malformed one.
    const shaped = shapeRoute(route({ distanceMeters: undefined }), [wp('A', 0, 0), wp('B', 1, 1)], STAMP)
    expect(shaped.distanceMeters).toBe(0)
    expect(Number.isNaN(shaped.distanceMeters)).toBe(false)
    expect(shaped.provenance.distanceMeters).toBe(0)
  })

  test('a present distanceMeters passes through, including a real 0', () => {
    const pts: Waypoint[] = [wp('A', 0, 0), wp('B', 1, 1)]
    expect(shapeRoute(route({ distanceMeters: 12_345 }), pts, STAMP).distanceMeters).toBe(12_345)
    expect(shapeRoute(route({ distanceMeters: 0 }), pts, STAMP).distanceMeters).toBe(0)
  })

  test('provenance records the decoded point count, not the waypoint count', () => {
    // pointCount describes the GEOMETRY that was frozen; conflating it with the waypoints would make
    // the provenance record useless for spotting a thinned polyline later.
    const shaped = shapeRoute(route(), [wp('A', 0, 0), wp('B', 1, 1)], STAMP)
    expect(shaped.polyline).toHaveLength(2)
    expect(shaped.provenance.pointCount).toBe(2)
  })

  test('provenance COPIES the waypoints — a later mutation cannot rewrite the record', () => {
    // The provenance is frozen into drives.routeProvenance as the record of what was actually
    // routed. Aliasing the caller's array would let a downstream edit silently rewrite history.
    const pts: Waypoint[] = [wp('A', 0, 0), wp('B', 1, 1)]
    const shaped = shapeRoute(route(), pts, STAMP)
    pts.push(wp('C', 2, 2))
    expect(shaped.provenance.waypoints).toHaveLength(2)
  })

  test('the timestamp is the one passed in, so the output is a function of its inputs', () => {
    expect(shapeRoute(route(), [wp('A', 0, 0), wp('B', 1, 1)], STAMP).provenance.materializedAt).toBe(STAMP)
  })

  test('provenance names the source, which is what makes a frozen route auditable', () => {
    expect(shapeRoute(route(), [wp('A', 0, 0), wp('B', 1, 1)], STAMP).provenance.source).toBe(
      'google-routes-v2',
    )
  })

  test('duration and distance agree between the route and its provenance', () => {
    // They are written twice; a divergence would make the provenance lie about the route it describes.
    const shaped = shapeRoute(route({ distanceMeters: 999 }), [wp('A', 0, 0), wp('B', 1, 1)], STAMP)
    expect(shaped.provenance.durationSeconds).toBe(shaped.durationSeconds)
    expect(shaped.provenance.distanceMeters).toBe(shaped.distanceMeters)
  })
})
