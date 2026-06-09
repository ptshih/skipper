// Hand-curated tour specs — "the rails." The ONLY human input to a drive: a headline,
// a region, named endpoints, and an ordered list of waypoints that pin the route to the
// road we mean. The frozen polyline geometry is materialized from these once (via the
// Google Routes API) by ./materialize.ts and then never re-derived.
//
// A tour is the whole self-contained drive now (corridors merged into tours): its own
// route + endpoints + region. Waypoints are { lat, lng }; [0] is the origin (the start
// anchor's coords), [last] the destination (the end anchor's coords), and everything
// between is an ordered intermediate that keeps the route honest (CA-89 along the West
// Shore has inland shortcuts the router would otherwise take).
//
// Source slate: ../../generator/src/content/tahoe-corridors.md (founder-approved).

export interface Waypoint {
  /** Human label — for provenance/readability only; not sent to the router. */
  label: string
  lat: number
  lng: number
}

export interface TourSpec {
  slug: string
  /** Region key + spoken display name — a `regions` row is upserted from these. */
  regionSlug: string
  regionName: string
  /** Marquee POI; the tour's display name is "[headline], [start] to [end]". */
  headline: string
  /** Clean, spoken endpoint names (NOT the raw waypoint labels). */
  startAnchorName: string
  endAnchorName: string
  /** Non-volatile blurb (no hours/prices/live data). Mirrors the slate doc. */
  summary: string
  /** Ordered: [0] = origin (start-anchor coords), [last] = destination (end-anchor coords). */
  waypoints: Waypoint[]
}

export const TOUR_SPECS: TourSpec[] = [
  {
    slug: 'emerald-bay-run',
    regionSlug: 'lake-tahoe',
    regionName: 'Lake Tahoe',
    headline: 'Emerald Bay',
    startAnchorName: 'South Lake Tahoe',
    endAnchorName: 'Tahoe City',
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
  {
    slug: 'east-shore-run',
    regionSlug: 'lake-tahoe',
    regionName: 'Lake Tahoe',
    headline: 'Cave Rock',
    startAnchorName: 'South Lake Tahoe',
    endAnchorName: 'Kings Beach',
    summary:
      'The East Shore run: from South Lake Tahoe up Highway 50 and 28 past Cave Rock, Sand Harbor, and Thunderbird Lodge, through Incline Village to Kings Beach.',
    // Origin at Stateline (where US-50 meets the lake and heads up the east shore),
    // then NV-28 north along the East Shore. Minimal pins: the Stateline->Kings Beach
    // lakeside run is already the shortest path, so we only anchor two on-highway
    // points (Cave Rock on US-50, Sand Harbor on NV-28) to keep it honest. Earlier
    // lakeshore-village pins (Spooner Lake, Thunderbird) snapped to backcountry forest
    // roads and sent the router on huge Carson-Range detours — don't reintroduce them.
    // POI discovery samples the whole polyline, so the line still passes Zephyr Cove,
    // Glenbrook, Spooner, Thunderbird Lodge, Incline, and Crystal Bay regardless.
    waypoints: [
      { label: 'Stateline, South Lake Tahoe', lat: 38.9655, lng: -119.9425 },
      { label: 'Cave Rock', lat: 39.047, lng: -119.9478 },
      { label: 'Sand Harbor', lat: 39.1984, lng: -119.9308 },
      { label: 'Kings Beach', lat: 39.2371, lng: -120.026 },
    ],
  },
]

export function specBySlug(slug: string): TourSpec | undefined {
  return TOUR_SPECS.find((s) => s.slug === slug)
}

/**
 * The frozen tour artifact written to ./data/<slug>.json by ./materialize.ts and read
 * back by ./seed.ts. The polyline is GeoJSON [lng, lat] pairs (matching the
 * tours.polyline column); provenance documents how it was frozen so the route is never
 * silently re-derived. (seed.ts takes the route GEOMETRY from here and the
 * headline/region/anchor METADATA from the spec above, so an older frozen artifact that
 * predates the metadata fields still seeds correctly.)
 */
export interface FrozenTour {
  slug: string
  regionSlug: string
  regionName: string
  headline: string
  startAnchorName: string
  endAnchorName: string
  summary: string
  polyline: [number, number][]
  startAnchor: { name: string; lat: number; lng: number }
  endAnchor: { name: string; lat: number; lng: number }
  provenance: {
    source: 'google-routes-v2'
    waypoints: Waypoint[]
    distanceMeters: number
    durationSeconds: number
    pointCount: number
    materializedAt: string
  }
}
