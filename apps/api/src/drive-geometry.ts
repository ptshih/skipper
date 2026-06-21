// Pure geometry helpers for the geometry-first drive model. Kept OUT of drives.ts so they carry no
// auth/DB import side-effects and stay unit-testable (drives.ts pulls in the auth stack at import).
import type { Polyline } from '@skipper/db/schema'

/** Parse a region's "lng_min,lat_min,lng_max,lat_max" bbox → a geocoding bias viewport
 *  "swLat,swLng|neLat,neLng" so an ambiguous in-region name resolves locally. Undefined when unset/bad.
 *  NOTE the reorder: the input is lng,lat-ordered; the geocode viewport is lat,lng-ordered. */
export function geocodeBoundsFor(bbox: string | null): string | undefined {
  if (!bbox) return undefined
  const p = bbox.split(',').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return undefined
  const [lngMin, latMin, lngMax, latMax] = p as [number, number, number, number]
  return `${latMin},${lngMin}|${latMax},${lngMax}`
}

/** The route's bounding rectangle (min/max lat/lng over the polyline) — the drive's STALE-PROOF
 *  spatial extent (the polyline is frozen). Stored on the drive; also the corpus prefilter. */
export function polylineBbox(polyline: Polyline): {
  minLat: number
  minLng: number
  maxLat: number
  maxLng: number
} {
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const [lng, lat] of polyline) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
  }
  return { minLat, minLng, maxLat, maxLng }
}

/** A grounded endpoint candidate: a real, narratable place in the region with EXACT coords. The
 *  drive resolver picks start/end from these instead of free-typing a name to geocode. */
export interface RegionAnchor {
  name: string
  kind: string | null
  lat: number
  lng: number
}

/** Resolve ONE grounded endpoint choice from the model into either a fixed anchor (use its exact
 *  coords — no geocode, so no drift) or a fallback place name to geocode. A valid in-range index
 *  wins; otherwise the trimmed fallback name; null when neither yields anything. Pure (no network)
 *  so the pick-vs-fallback logic is unit-tested without the geocode hop. */
export function resolveAnchorChoice(
  index: number,
  name: string | undefined,
  anchors: readonly RegionAnchor[],
): { kind: 'anchor'; anchor: RegionAnchor } | { kind: 'geocode'; name: string } | null {
  if (Number.isInteger(index) && index >= 0 && index < anchors.length) {
    return { kind: 'anchor', anchor: anchors[index]! }
  }
  const q = (name ?? '').trim()
  return q ? { kind: 'geocode', name: q } : null
}
