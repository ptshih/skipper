// Region bbox validation at the admin write boundary. A region bbox is "swLng,swLat,neLng,neLat"
// (decimal degrees); the studio pipeline point-in-bbox-selects pois from it, so a swapped-corner or
// oversized box silently scopes a LATER spending enrich/generate over a huge candidate set
// (cost-runaway). Pure + native-free so it unit-tests under `bun test`. (audit #5)

import {
  parseRegionBbox,
  parseRegionBboxes,
  pointInAnyRegionBbox,
  pointInRegionBbox,
  REGION_BBOX_SEPARATOR,
  type RegionBbox,
} from '@skipper/engine'

// A generous span cap (~1650 km/deg of latitude): passes any real region or multi-state corridor
// (e.g. Yosemite→Moab is ~10° of longitude), but catches a continent/hemisphere fat-finger or a
// units/order mix-up that would balloon a paid run.
export const MAX_BBOX_SPAN_DEG = 15

/**
 * How many boxes one region may be made of.
 *
 * ⚠ A REAL GUARD, not a formality. Every box becomes another `AND` inside an `OR` in the region-scoped
 * queries (`inAnyBbox`), and those run on anonymous per-request paths — the planner's roster and the
 * example anchors are hit on every app launch. A region hand-edited into hundreds of boxes would turn a
 * cheap indexed lookup into a scan, on the routes least able to afford it. Eight is far more than the
 * shapes we actually have (the L that motivated this is TWO), and is a fat-finger catch rather than a
 * design ceiling — raise it deliberately if a genuine corridor region needs more.
 */
export const MAX_REGION_BBOXES = 8

/**
 * Validate a region bbox string — ONE box, or several separated by `;`. Returns an operator-facing
 * error message, or null when well-formed. Checks per box: 4 finite decimal-degree numbers, in-range
 * (lng ±180, lat ±90), correctly ordered (swLng<neLng, swLat<neLat — catches the Nominatim lat/lng
 * reorder swap), and a sane span. Plus a cap on how many boxes.
 *
 * ⚠ EVERY box is checked, and the message NAMES which one failed. A multi-box value where only the
 * second box is degenerate would otherwise be approved as "the region parsed", and the operator would
 * be told nothing about the half that silently matches nothing.
 */
export function bboxError(raw: string): string | null {
  const parts = raw
    .split(REGION_BBOX_SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (parts.length === 0) {
    return 'bbox must be "swLng,swLat,neLng,neLat" — 4 decimal-degree numbers'
  }
  if (parts.length > MAX_REGION_BBOXES) {
    return `a region may be at most ${MAX_REGION_BBOXES} boxes (got ${parts.length}) — separate boxes with "${REGION_BBOX_SEPARATOR}"`
  }
  for (const [i, part] of parts.entries()) {
    const err = singleBboxError(part)
    // Only label the box when there IS more than one — a single-box region's message must read
    // exactly as it always did, since that is what the console shows for the common case.
    if (err) return parts.length === 1 ? err : `box ${i + 1} of ${parts.length}: ${err}`
  }
  return null
}

function singleBboxError(raw: string): string | null {
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

// The multi-box readers — what every region-scoped path in this server should use. `parseBboxes`
// returns [] for absent/malformed input, and a region with [] must match NOTHING (see `inAnyBbox`).
export const parseBboxes = parseRegionBboxes
export const pointInAnyBbox = (boxes: readonly BboxCorners[], lat: number, lng: number): boolean =>
  pointInAnyRegionBbox(boxes, lat, lng)

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

/**
 * Does a route rectangle overlap ANY of a region's boxes? The multi-box form of `bboxOverlapsRect`.
 *
 * ⚠ ANY, not all — a drive that only ever enters the detached corner of a region is still in that
 * region. Using the region's bounding hull instead would be strictly wrong in the other direction: it
 * would claim drives in the gap between two boxes, which is exactly the ground a disjoint neighbour
 * owns (the whole reason the region is several boxes rather than one big one).
 */
export function bboxesOverlapRect(boxes: readonly BboxCorners[], rect: Rect): boolean {
  return boxes.some((b) => bboxOverlapsRect(b, rect))
}
