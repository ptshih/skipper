// @skipper/routing — server-side route materialization (NOT bundled by mobile).
//
// `materializeRoute` freezes an A→B (or multi-waypoint) road-snapped polyline from the Google
// Routes API — no disk, no file write. apps/api's Create-a-Drive (POST /drives, /drives/propose)
// calls it to freeze a runtime-authored route into the DB. It lives in its own server-side package
// (every consumer of @skipper/db imports it server-side; mobile never does) so the DEFERRED admin
// authored-tour Create flow and the M4 drive-dedup/precompute path can reuse it without a re-extract.
// (History: this was @skipper/db/seed/materialize — moved out of the seed namespace 2026-06-19 so a
// runtime path no longer depends on seed tooling, and the api image no longer ships packages/db/seed.)
//
// Needs GOOGLE_MAPS_API_KEY (a Routes-API-enabled key on a billed project).

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'

/** An ordered route waypoint. `label` is for provenance/readability; not sent to the router. */
export interface Waypoint {
  label: string
  lat: number
  lng: number
}

/** Provenance for a frozen route — the `drives.routeProvenance` core (Create-a-Drive adds `authoring`). */
export interface RouteProvenanceCore {
  source: 'google-routes-v2'
  waypoints: Waypoint[]
  distanceMeters: number
  durationSeconds: number
  pointCount: number
  materializedAt: string
}

/** Decode a Google encoded polyline (precision 5) to [lng, lat] pairs. */
function decodePolyline(encoded: string): [number, number][] {
  const factor = 1e5
  let index = 0
  let lat = 0
  let lng = 0
  const out: [number, number][] = []
  while (index < encoded.length) {
    let shift = 0
    let result = 0
    let byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1
    shift = 0
    result = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1
    out.push([lng / factor, lat / factor])
  }
  return out
}

async function computeRoute(waypoints: readonly Waypoint[], apiKey: string) {
  const toLoc = (w: { lat: number; lng: number }) => ({
    location: { latLng: { latitude: w.lat, longitude: w.lng } },
  })
  const wp = waypoints
  const origin = wp[0]
  const destination = wp[wp.length - 1]
  if (!origin || !destination || wp.length < 2) {
    throw new Error('need at least an origin and a destination (2+ waypoints)')
  }
  const body = {
    origin: toLoc(origin),
    destination: toLoc(destination),
    intermediates: wp.slice(1, -1).map(toLoc),
    travelMode: 'DRIVE',
    // Dense geometry — this route is frozen and used for speed-adaptive trigger
    // geofencing + the drive simulator, so prefer more points over fewer.
    polylineQuality: 'HIGH_QUALITY',
  }
  const res = await fetch(ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as {
    error?: { code: number; status: string; message: string }
    routes?: { distanceMeters?: number; duration: string; polyline: { encodedPolyline: string } }[]
  }
  if (!res.ok || json.error) {
    const e = json.error
    throw new Error(`Routes API ${res.status}: ${e ? `${e.status} — ${e.message}` : 'unknown error'}`)
  }
  const route = json.routes?.[0]
  if (!route?.polyline?.encodedPolyline) {
    throw new Error('Routes API returned no polyline')
  }
  return route
}

/** The route + its provenance, frozen but NOT written to disk — the reusable core. */
export interface MaterializedRoute {
  polyline: [number, number][]
  distanceMeters: number
  durationSeconds: number
  provenance: RouteProvenanceCore
}

/** Freeze a road-snapped route from ordered waypoints via the Google Routes API. The admin
 *  (Create Tour) calls it to freeze a runtime-authored route into the DB. No file write. */
export async function materializeRoute(
  waypoints: readonly Waypoint[],
  apiKey: string = requireApiKey(),
): Promise<MaterializedRoute> {
  const route = await computeRoute(waypoints, apiKey)
  const polyline = decodePolyline(route.polyline.encodedPolyline)
  // duration comes back like "786s".
  const durationSeconds = Number.parseInt(route.duration.replace(/s$/, ''), 10)
  // Routes uses proto3 JSON, which OMITS a zero-value field rather than sending `0`. A degenerate
  // A→A route — a "loop" prompt resolves start == end — has distanceMeters 0, so the field is
  // absent. Coalesce to 0 (the honest distance): otherwise `undefined` flows into Math.round() →
  // NaN → JSON `null`, which fails the driveProposal `number` DTO and surfaces to the rider as a
  // bogus "please update Skipper" (a real bug: a loop is a degenerate route, not a stale client).
  const distanceMeters = route.distanceMeters ?? 0
  return {
    polyline,
    distanceMeters,
    durationSeconds,
    provenance: {
      source: 'google-routes-v2',
      waypoints: [...waypoints],
      distanceMeters,
      durationSeconds,
      pointCount: polyline.length,
      materializedAt: new Date().toISOString(),
    },
  }
}

function requireApiKey(): string {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    throw new Error('GOOGLE_MAPS_API_KEY is not set (a Routes-API-enabled key on a billed project).')
  }
  return apiKey
}
