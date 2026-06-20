// Region bbox validation at the admin write boundary. A region bbox is "swLng,swLat,neLng,neLat"
// (decimal degrees); the studio pipeline point-in-bbox-selects pois from it, so a swapped-corner or
// oversized box silently scopes a LATER spending enrich/generate over a huge candidate set
// (cost-runaway). Pure + native-free so it unit-tests under `bun test`. (audit #5)

// A generous span cap (~1650 km/deg of latitude): passes any real region or multi-state corridor
// (e.g. Yosemite→Moab is ~10° of longitude), but catches a continent/hemisphere fat-finger or a
// units/order mix-up that would balloon a paid run.
export const MAX_BBOX_SPAN_DEG = 15

/**
 * Validate a region bbox string. Returns an operator-facing error message, or null when it's well-formed.
 * Checks: 4 finite decimal-degree numbers, in-range (lng ±180, lat ±90), correctly ordered
 * (swLng<neLng, swLat<neLat — catches the Nominatim lat/lng reorder swap), and a sane span.
 */
export function bboxError(raw: string): string | null {
  const parts = raw.split(',').map((s) => Number(s.trim()))
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return 'bbox must be "swLng,swLat,neLng,neLat" — 4 decimal-degree numbers'
  }
  const [swLng, swLat, neLng, neLat] = parts as [number, number, number, number]
  if (swLng < -180 || swLng > 180 || neLng < -180 || neLng > 180) {
    return 'bbox longitude out of range (expected -180..180)'
  }
  if (swLat < -90 || swLat > 90 || neLat < -90 || neLat > 90) {
    return 'bbox latitude out of range (expected -90..90)'
  }
  if (swLng >= neLng || swLat >= neLat) {
    return 'bbox corners are swapped or degenerate (need swLng<neLng and swLat<neLat)'
  }
  if (neLng - swLng > MAX_BBOX_SPAN_DEG || neLat - swLat > MAX_BBOX_SPAN_DEG) {
    return `bbox spans more than ${MAX_BBOX_SPAN_DEG}° — likely an error (a region is a drive area, not a continent)`
  }
  return null
}

export interface BboxCorners {
  swLng: number
  swLat: number
  neLng: number
  neLat: number
}

/** Parse a "swLng,swLat,neLng,neLat" region bbox into corners; null if absent/malformed. Pair with
 *  bboxError at a write boundary; this is the read-side parse for point-in-bbox queries (e.g. the
 *  region-release stamp, which selects in-bbox pois). */
export function parseBbox(raw: string | null | undefined): BboxCorners | null {
  if (!raw) return null
  const p = raw.split(',').map((s) => Number(s.trim()))
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return null
  return { swLng: p[0]!, swLat: p[1]!, neLng: p[2]!, neLat: p[3]! }
}
