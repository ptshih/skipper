// Materialize a corridor's FROZEN polyline from the Google Routes API.
//
// Run ONCE per corridor. It reads a hand-curated spec (./corridors.ts), asks the
// Routes API to compute a road-snapped route through the waypoints, decodes the
// polyline to GeoJSON [lng, lat] pairs, and writes the result to
// ./data/<slug>.json. That JSON is the FROZEN artifact (committed, version
// controlled) — the route is never recomputed at request time. ./seed.ts reads
// these JSON files; it never calls Google.
//
// Usage (key injected via dotenvx; never hard-code it):
//   dotenvx run -f .env.development -- bun packages/db/seed/materialize.ts <slug>
//   dotenvx run -f .env.development -- bun packages/db/seed/materialize.ts --all
//
// Needs GOOGLE_MAPS_API_KEY (a Routes-API-enabled key on a billed project).

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CORRIDOR_SPECS, specBySlug, type CorridorSpec, type FrozenCorridor } from './corridors'

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data')
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'

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

async function computeRoute(spec: CorridorSpec, apiKey: string) {
  const toLoc = (w: { lat: number; lng: number }) => ({
    location: { latLng: { latitude: w.lat, longitude: w.lng } },
  })
  const wp = spec.waypoints
  const origin = wp[0]
  const destination = wp[wp.length - 1]
  if (!origin || !destination || wp.length < 2) {
    throw new Error(`${spec.slug}: need at least an origin and a destination`)
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
    routes?: { distanceMeters: number; duration: string; polyline: { encodedPolyline: string } }[]
  }
  if (!res.ok || json.error) {
    const e = json.error
    throw new Error(`Routes API ${res.status}: ${e ? `${e.status} — ${e.message}` : 'unknown error'}`)
  }
  const route = json.routes?.[0]
  if (!route?.polyline?.encodedPolyline) {
    throw new Error(`${spec.slug}: Routes API returned no polyline`)
  }
  return route
}

async function materialize(spec: CorridorSpec, apiKey: string): Promise<FrozenCorridor> {
  const route = await computeRoute(spec, apiKey)
  const polyline = decodePolyline(route.polyline.encodedPolyline)
  // duration comes back like "786s".
  const durationSeconds = Number.parseInt(route.duration.replace(/s$/, ''), 10)
  const frozen: FrozenCorridor = {
    slug: spec.slug,
    region: spec.region,
    name: spec.name,
    summary: spec.summary,
    polyline,
    provenance: {
      source: 'google-routes-v2',
      waypoints: spec.waypoints,
      distanceMeters: route.distanceMeters,
      durationSeconds,
      pointCount: polyline.length,
      materializedAt: new Date().toISOString(),
    },
  }
  mkdirSync(DATA_DIR, { recursive: true })
  const file = join(DATA_DIR, `${spec.slug}.json`)
  writeFileSync(file, JSON.stringify(frozen, null, 2) + '\n')
  const miles = (route.distanceMeters / 1609.344).toFixed(1)
  const mins = Math.round(durationSeconds / 60)
  console.log(
    `✓ ${spec.slug}: ${polyline.length} points, ${miles} mi, ~${mins} min -> ${file}`,
  )
  return frozen
}

async function main() {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    throw new Error(
      'GOOGLE_MAPS_API_KEY is not set. Run via dotenvx, e.g.\n' +
        '  dotenvx run -f .env.development -- bun packages/db/seed/materialize.ts <slug>',
    )
  }
  const arg = process.argv[2]
  if (!arg) {
    throw new Error('Usage: materialize.ts <slug> | --all')
  }
  const specs = arg === '--all' ? CORRIDOR_SPECS : [specBySlug(arg)]
  for (const spec of specs) {
    if (!spec) throw new Error(`No corridor spec for slug "${arg}"`)
    await materialize(spec, apiKey)
  }
}

await main()
