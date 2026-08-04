// Region bbox validation at the admin write boundary. A region bbox is "swLng,swLat,neLng,neLat"
// (decimal degrees); the studio pipeline point-in-bbox-selects pois from it, so a swapped-corner or
// oversized box silently scopes a LATER spending enrich/generate over a huge candidate set
// (cost-runaway). Pure + native-free so it unit-tests under `bun test`. (audit #5)

import { parseRegionBbox, pointInRegionBbox, type RegionBbox } from '@skipper/engine'

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
  // ⚠ Parses through the ONE reader (see the footer) rather than re-splitting. A validator that
  // parses differently from the reader is the worst version of this bug: it approves a string the
  // reader will later resolve differently, or rejects one the reader handles fine — and the FOUR
  // parsers this sweep collapsed are exactly how that happened before.
  const box = parseRegionBbox(raw)
  if (!box) {
    return 'bbox must be "swLng,swLat,neLng,neLat" — 4 decimal-degree numbers'
  }
  const { swLng, swLat, neLng, neLat } = box
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

// ⚠ The corners type and both readers moved to @skipper/engine in the 1.1 sweep — there were FOUR
// independently-written parsers of `regions.bbox`, and this one was the only one that TRIMMED, so a
// bbox typed with a space after a comma resolved here and matched zero pois everywhere else.
// Re-exported under the old name so this server's importers are unchanged.
export type BboxCorners = RegionBbox

export const parseBbox = parseRegionBbox
export const pointInBbox = (box: BboxCorners, lat: number, lng: number): boolean =>
  pointInRegionBbox(box, lat, lng)

/** A route's bounding rectangle, as a drive stores it (`drives.bbox_*`). */
export interface Rect {
  minLat: number
  minLng: number
  maxLat: number
  maxLng: number
}

/**
 * Do a region bbox and a route rectangle OVERLAP? The RECTANGLE counterpart of `pointInBbox`, and the
 * same geometry-first rule one dimension up: a POI's region is point-in-bbox, a DRIVE's region(s) are
 * the regions its frozen route bbox intersects — neither is ever stored as an FK
 * (docs/decisions/geometry-first-regions.md). Touching edges count as overlapping: a route that grazes
 * a region's boundary is in it, and the alternative is a drive that belongs to nothing by a rounding
 * error. Regions may overlap, so a drive can legitimately match several — and matching NONE is a real
 * answer (a route outside every configured region), not missing data.
 */
export function bboxOverlapsRect(box: BboxCorners, rect: Rect): boolean {
  return !(
    rect.maxLng < box.swLng ||
    rect.minLng > box.neLng ||
    rect.maxLat < box.swLat ||
    rect.minLat > box.neLat
  )
}
