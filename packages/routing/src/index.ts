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

/** Decode a Google encoded polyline (precision 5) to **[lng, lat]** pairs.
 *
 *  ⚠ AXIS ORDER IS [lng, lat] — GeoJSON order, matching what the API ships and what `@skipper/engine`
 *  consumes. Google's own encoding is lat-then-lng, so this function SWAPS. Getting that backwards
 *  does not throw and does not fail a typecheck (both are `number`); it silently relocates every drive,
 *  and Tahoe's coordinates (~39, ~-120) swap into the Indian Ocean rather than anywhere suspicious-
 *  looking on a map you'd think to check.
 *
 *  Exported for tests only — every runtime caller goes through `materializeRoute`. It is worth testing
 *  directly because it is the one piece of pure, fiddly arithmetic on the path (varint + zigzag +
 *  delta), everything downstream trusts its output completely (pacing, trigger radii, the map, and
 *  `buildDrive`'s selection), and a subtly wrong decode moves stops rather than breaking them — which
 *  reads as "the triggering is flaky" from inside a car. */
export function decodePolyline(encoded: string): [number, number][] {
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

/** The Routes API response fields we consume — narrowed to the `X-Goog-FieldMask` below. */
export interface RoutesApiRoute {
  /** ⚠ OPTIONAL on purpose: proto3 JSON omits zero-valued fields. See `shapeRoute`. */
  distanceMeters?: number
  duration: string
  polyline: { encodedPolyline: string }
  /** Google's own warnings about the route it chose. ⚠ OPTIONAL for the same proto3 reason as
   *  `distanceMeters` — an unremarkable route omits the field rather than sending `[]`. */
  warnings?: string[]
}

/**
 * Warning phrases that mean "Google found a way, but not one to send a rider down".
 *
 * ⚠ WHY THIS EXISTS AT ALL. Routes has NO modifier for it: `routeModifiers` supports exactly
 * `avoidTolls`, `avoidHighways`, `avoidFerries`, `avoidIndoor`, `vehicleInfo` and `tollPasses` —
 * there is no avoid-unpaved and no avoid-private (verified against
 * developers.google.com/maps/documentation/routes/route-modifiers, 2026-08-04). So the router will
 * cheerfully route a drive up a gated forest track, and the ONLY thing that says so is `warnings`.
 * This is not hypothetical: the curated `Spooner Lake` endpoint was stored at the LAKE's centroid, and
 * Carson City → that point came back 71 minutes via NF-038 — "restricted usage or private roads" —
 * against 19 minutes on US-50 to the same lake's visitor center 800 m away. A rider was one tap and
 * one non-refundable credit from a 143-minute drive up a road they cannot legally finish.
 * See docs/decisions/undrivable-endpoint-anchors.md.
 *
 * ⚠ AN ALLOWLIST OF BAD PHRASES, NEVER "any warning is bad", AND IT FAILS OPEN ON PURPOSE. Most
 * warnings are ordinary travel advice — tolls, borders, a seasonal closure, a time-zone change — and a
 * gate that refused every warned route would refuse most of the drives worth taking. An unrecognised
 * phrase therefore does NOT refuse; it rides through and shows up in `audit-endpoint-routability`,
 * which prints every warning it sees precisely so a new phrase is noticed by an operator rather than
 * by a rider who stopped getting drives.
 *
 * ⚠ MATCHED CASE-INSENSITIVELY ON A SUBSTRING, and that only holds because the request pins
 * `languageCode` (see `buildRoutesRequestBody`). Warnings are LOCALIZED display text; unpinned, Google
 * infers the language from the route's location and this list silently stops matching.
 */
export const RESTRICTED_ROAD_WARNINGS: readonly string[] = [
  // The observed one — Google's phrasing for a gated/permit/private segment.
  'restricted usage',
  'private road',
  // Dirt and gravel. A Skipper drive is a road trip; the rider is in whatever car they own.
  'unpaved',
]

/** Does Google's own warning list say this route is not drivable as a road trip?
 *  Pure, and exported so the request path and the corpus auditor cannot disagree about what
 *  "undrivable" means — one expression, counted and acted on in both places. */
export const hasRestrictedRoads = (warnings: readonly string[] | undefined): boolean =>
  (warnings ?? []).some((w) => {
    const lower = w.toLowerCase()
    return RESTRICTED_ROAD_WARNINGS.some((phrase) => lower.includes(phrase))
  })

/** Build the `computeRoutes` request body from ordered waypoints. Pure — extracted from the fetch so
 *  it can be tested, because this is the function that decides WHICH points reach a BILLED endpoint.
 *  First is origin, last is destination, everything between rides as `intermediates`. */
export function buildRoutesRequestBody(waypoints: readonly Waypoint[]) {
  const toLoc = (w: { lat: number; lng: number }) => ({
    location: { latLng: { latitude: w.lat, longitude: w.lng } },
  })
  const wp = waypoints
  const origin = wp[0]
  const destination = wp[wp.length - 1]
  if (!origin || !destination || wp.length < 2) {
    throw new Error('need at least an origin and a destination (2+ waypoints)')
  }
  return {
    origin: toLoc(origin),
    destination: toLoc(destination),
    intermediates: wp.slice(1, -1).map(toLoc),
    travelMode: 'DRIVE',
    // Dense geometry — this route is frozen and used for speed-adaptive trigger
    // geofencing + the drive simulator, so prefer more points over fewer.
    polylineQuality: 'HIGH_QUALITY',
    // ⚠ LOAD-BEARING FOR `hasRestrictedRoads`, not a display nicety. `warnings` is LOCALIZED text, and
    // the reference is explicit that an unset languageCode means "the display language is inferred
    // from the location of the route request" — i.e. the strings we match on would change with the
    // region we expand into, and the gate would fail open everywhere new. Pinning it makes the phrase
    // match a function of our request rather than of Google's guess about our rider.
    languageCode: 'en-US',
  }
}

/**
 * What we ask Routes to send back.
 *
 * ⚠ EXPORTED SO IT CAN BE PINNED BY A TEST, because dropping a field here does not fail — it degrades
 * silently. `routes.warnings` is the specific one: proto3 omits an absent field, so a mask without it
 * yields a response where every route on earth looks clean, `hasRestrictedRoads` returns false for all
 * of them, and the gate passes everything while still appearing to run. There is no error to notice.
 *
 * These are all plain Route-level fields — none of the traffic-aware / alternative-routes /
 * navigation-instruction features that move Routes onto a costlier SKU.
 */
export const ROUTES_FIELD_MASK =
  'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.warnings'

async function computeRoute(waypoints: readonly Waypoint[], apiKey: string) {
  const body = buildRoutesRequestBody(waypoints)
  const res = await fetch(ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': ROUTES_FIELD_MASK,
    },
    body: JSON.stringify(body),
    // Bun applies no default fetch timeout, so a hung upstream would pin a Cloud Run slot until the
    // coarse ~300s platform deadline — on the UNRATED, credit-spending POST /drives path. Bound it; the
    // AbortError surfaces as a throw, which materializeRoute's callers already map to a 422 no_route.
    signal: AbortSignal.timeout(8000),
  })
  const json = (await res.json()) as {
    error?: { code: number; status: string; message: string }
    routes?: RoutesApiRoute[]
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
  /** Every warning Google attached, verbatim and unfiltered — the auditor prints these so a phrase
   *  `RESTRICTED_ROAD_WARNINGS` does not know about is discovered by an operator, not by a rider. */
  warnings: string[]
  /** THE DECISION: Google says this route uses restricted / private / unpaved roads. Derived here,
   *  once, so a caller can never re-derive it differently from the raw list above. */
  restricted: boolean
  provenance: RouteProvenanceCore
}

/** Freeze a road-snapped route from ordered waypoints via the Google Routes API. apps/api's
 *  Create-a-Drive flow (POST /drives, /drives/propose) calls it to freeze a route into the DB. No file write. */
export async function materializeRoute(
  waypoints: readonly Waypoint[],
  apiKey: string = requireApiKey(),
): Promise<MaterializedRoute> {
  const route = await computeRoute(waypoints, apiKey)
  return shapeRoute(route, waypoints, new Date().toISOString())
}

/** Shape a Routes API response into the frozen `MaterializedRoute`. Pure — extracted from the fetch
 *  so the two parsing quirks below can be tested without network. `materializedAt` is passed in
 *  rather than read from the clock, so the output is a function of its inputs. */
export function shapeRoute(
  route: RoutesApiRoute,
  waypoints: readonly Waypoint[],
  materializedAt: string,
): MaterializedRoute {
  const polyline = decodePolyline(route.polyline.encodedPolyline)
  // duration comes back like "786s".
  const durationSeconds = Number.parseInt(route.duration.replace(/s$/, ''), 10)
  // Routes uses proto3 JSON, which OMITS a zero-value field rather than sending `0`. A degenerate
  // A→A route — a "loop" prompt resolves start == end — has distanceMeters 0, so the field is
  // absent. Coalesce to 0 (the honest distance): otherwise `undefined` flows into Math.round() →
  // NaN → JSON `null`, which fails the driveProposal `number` DTO and surfaces to the rider as a
  // bogus "please update Skipper" (a real bug: a loop is a degenerate route, not a stale client).
  const distanceMeters = route.distanceMeters ?? 0
  // Same proto3 omission as `distanceMeters`: an unremarkable route has no `warnings` key at all, so
  // the absent case is the NORMAL one here and must read as "nothing to say", never as a parse failure.
  const warnings = route.warnings ?? []
  return {
    polyline,
    distanceMeters,
    durationSeconds,
    warnings,
    restricted: hasRestrictedRoads(warnings),
    provenance: {
      source: 'google-routes-v2',
      // ⚠ COPIED, not aliased: provenance is frozen into `drives.routeProvenance`, and holding the
      // caller's array would let a later mutation rewrite the record of what was actually routed.
      waypoints: [...waypoints],
      distanceMeters,
      durationSeconds,
      pointCount: polyline.length,
      materializedAt,
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
