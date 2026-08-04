import { describe, expect, test } from 'bun:test'
import {
  buildRoutesRequestBody,
  hasRestrictedRoads,
  ROUTES_FIELD_MASK,
  shapeRoute,
  type RoutesApiRoute,
  type Waypoint,
} from '../src/index'

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

  test('PINS languageCode — the restricted-road gate matches on localized warning text', () => {
    // Unset, Google infers the display language from the route's location, and `warnings` comes back
    // in it. The phrase list in RESTRICTED_ROAD_WARNINGS is English, so an unpinned language means the
    // gate quietly stops matching — passing every restricted route instead of refusing it. Nothing
    // else in the response would look wrong.
    expect(buildRoutesRequestBody([a, b]).languageCode).toBe('en-US')
  })
})

describe('ROUTES_FIELD_MASK', () => {
  test('ASKS FOR routes.warnings — without it the restricted-road gate silently passes everything', () => {
    // The one failure in this file that produces no error anywhere: proto3 omits fields the mask did
    // not request, so a mask missing this makes every route look unwarned, `restricted` false for all
    // of them, and the gate a no-op that still appears to run.
    expect(ROUTES_FIELD_MASK.split(',')).toContain('routes.warnings')
  })

  test('still asks for the three fields a frozen route is built from', () => {
    const fields = ROUTES_FIELD_MASK.split(',')
    expect(fields).toContain('routes.distanceMeters')
    expect(fields).toContain('routes.duration')
    expect(fields).toContain('routes.polyline.encodedPolyline')
  })
})

// Google will route a drive up a gated forest track and say so only here — there is no avoid-unpaved
// or avoid-private modifier to ask for instead. This predicate is the whole gate.
describe('hasRestrictedRoads', () => {
  test('catches the phrase that actually shipped a 143-minute drive', () => {
    expect(hasRestrictedRoads(['This route has restricted usage or private roads.'])).toBe(true)
  })

  test('catches private and unpaved roads too', () => {
    expect(hasRestrictedRoads(['This route includes a private road.'])).toBe(true)
    expect(hasRestrictedRoads(['This route includes unpaved roads.'])).toBe(true)
  })

  test('case-insensitive — the phrasing is Google’s, not ours', () => {
    expect(hasRestrictedRoads(['RESTRICTED USAGE OR PRIVATE ROADS'])).toBe(true)
  })

  test('FAILS OPEN on ordinary travel advice — a warned route is not the same as a bad one', () => {
    // The failure this guards against is a gate that refuses most of the drives worth taking. Tolls,
    // borders and seasonal closures are normal road-trip facts, not reasons to withhold a drive.
    expect(hasRestrictedRoads(['This route has tolls.'])).toBe(false)
    expect(hasRestrictedRoads(['This route may cross country borders.'])).toBe(false)
    expect(hasRestrictedRoads(['Parts of this route may be closed at certain times.'])).toBe(false)
  })

  test('no warnings at all is the normal case, not a failure', () => {
    // proto3 omits the empty list, so `undefined` is what an unremarkable route actually sends.
    expect(hasRestrictedRoads(undefined)).toBe(false)
    expect(hasRestrictedRoads([])).toBe(false)
  })

  test('one bad phrase among benign ones still refuses', () => {
    expect(
      hasRestrictedRoads(['This route has tolls.', 'This route has restricted usage or private roads.']),
    ).toBe(true)
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

  test('AN ABSENT warnings FIELD IS THE NORMAL ROUTE — it must not read as restricted', () => {
    // Same proto3 omission as distanceMeters. If this coalesced wrong the gate would refuse every
    // ordinary drive, which is the loudest possible failure — but the mirror bug is the silent one:
    // see the field-mask test below.
    const shaped = shapeRoute(route(), [wp('A', 0, 0), wp('B', 1, 1)], STAMP)
    expect(shaped.warnings).toEqual([])
    expect(shaped.restricted).toBe(false)
  })

  test('a restricted-roads warning rides through to `restricted`, with the raw text kept', () => {
    // The raw list is kept because the auditor prints it — a phrase the allowlist does not know about
    // must be discoverable by an operator rather than invisible.
    const shaped = shapeRoute(
      route({ warnings: ['This route has restricted usage or private roads.'] }),
      [wp('A', 0, 0), wp('B', 1, 1)],
      STAMP,
    )
    expect(shaped.restricted).toBe(true)
    expect(shaped.warnings).toEqual(['This route has restricted usage or private roads.'])
  })

  test('a benign warning is preserved but does NOT mark the route restricted', () => {
    const shaped = shapeRoute(route({ warnings: ['This route has tolls.'] }), [wp('A', 0, 0), wp('B', 1, 1)], STAMP)
    expect(shaped.restricted).toBe(false)
    expect(shaped.warnings).toHaveLength(1)
  })

  test('duration and distance agree between the route and its provenance', () => {
    // They are written twice; a divergence would make the provenance lie about the route it describes.
    const shaped = shapeRoute(route({ distanceMeters: 999 }), [wp('A', 0, 0), wp('B', 1, 1)], STAMP)
    expect(shaped.provenance.durationSeconds).toBe(shaped.durationSeconds)
    expect(shaped.provenance.distanceMeters).toBe(shaped.distanceMeters)
  })
})
