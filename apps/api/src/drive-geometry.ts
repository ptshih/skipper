// Pure geometry helpers for the geometry-first drive model. Kept OUT of drives.ts so they carry no
// auth/DB import side-effects and stay unit-testable (drives.ts pulls in the auth stack at import).
import type { Polyline } from '@skipper/db/schema'

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
