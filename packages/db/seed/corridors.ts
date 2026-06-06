// Hand-curated corridor specs — "the rails." These are the ONLY human input to a
// corridor: a name and an ordered list of waypoints that pin the drive to the
// road we mean. The frozen polyline geometry is materialized from these once (via
// the Google Routes API) by ./materialize.ts and then never re-derived.
//
// Source slate: ../../generator/src/content/tahoe-corridors.md (founder-approved).
// Waypoints are { lat, lng }. The first is the origin, the last the destination,
// and everything between is an ordered intermediate that keeps the route honest
// (CA-89 along the West Shore has inland shortcuts the router would otherwise take).

export interface Waypoint {
  /** Human label — for provenance/readability only; not sent to the router. */
  label: string
  lat: number
  lng: number
}

export interface CorridorSpec {
  slug: string
  region: string
  name: string
  /** Non-volatile blurb (no hours/prices/live data). Mirrors the slate doc. */
  summary: string
  /** Ordered: [0] = origin, [last] = destination, middle = intermediates. */
  waypoints: Waypoint[]
}

export const CORRIDOR_SPECS: CorridorSpec[] = [
  {
    slug: 'emerald-bay-run',
    region: 'Lake Tahoe',
    name: 'Emerald Bay Run',
    summary:
      'The crown-jewel West Shore drive: from South Lake Tahoe up Highway 89 past Emerald Bay, D.L. Bliss, and Sugar Pine Point to Tahoe City.',
    waypoints: [
      { label: 'The Y, South Lake Tahoe', lat: 38.9336, lng: -120.0098 },
      { label: 'Camp Richardson', lat: 38.935, lng: -120.041 },
      { label: 'Emerald Bay', lat: 38.954, lng: -120.109 },
      { label: 'D.L. Bliss State Park', lat: 38.985, lng: -120.103 },
      { label: 'Meeks Bay', lat: 39.038, lng: -120.122 },
      { label: 'Sugar Pine Point / Tahoma', lat: 39.057, lng: -120.118 },
      { label: 'Homewood', lat: 39.087, lng: -120.16 },
      { label: 'Tahoe City', lat: 39.1658, lng: -120.1426 },
    ],
  },
]

export function specBySlug(slug: string): CorridorSpec | undefined {
  return CORRIDOR_SPECS.find((s) => s.slug === slug)
}

/**
 * The frozen corridor artifact written to ./data/<slug>.json by ./materialize.ts
 * and read back by ./seed.ts. The polyline is GeoJSON [lng, lat] pairs (matching
 * the corridors.polyline column); provenance documents how it was frozen so the
 * route is never silently re-derived.
 */
export interface FrozenCorridor {
  slug: string
  region: string
  name: string
  summary: string
  polyline: [number, number][]
  provenance: {
    source: 'google-routes-v2'
    waypoints: Waypoint[]
    distanceMeters: number
    durationSeconds: number
    pointCount: number
    materializedAt: string
  }
}
