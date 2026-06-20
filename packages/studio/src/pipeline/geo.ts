// Route geometry for the M1 studio pipeline.
//
// The shared route-geometry — haversineMeters, bearingDeg, cumulativeMeters, nearestOnRoute,
// totalMeters, routeBearingAt, timeAtAlong, sideOfApproach (+ LngLat / RoutePosition) — now lives
// in @skipper/engine (the pure, RN-safe driving/trigger core, single-sourced with
// buildDrive's pacing) and is RE-EXPORTED here, so studio call sites keep importing it from
// './geo' unchanged. This file adds only the GENERATION-specific helpers on top: the sub-region
// narration label (regionLabel) and polyline encoding for Places search-along-route (encodePolyline).
// [lng, lat] axis order throughout, matching drives.polyline.

import type { LngLat } from '@skipper/engine'

export {
  type LngLat,
  type RoutePosition,
  haversineMeters,
  bearingDeg,
  cumulativeMeters,
  nearestOnRoute,
  METERS_PER_MILE,
  // Route-relative helpers moved DOWN to @skipper/engine (single-sourced with buildDrive's
  // pacing); re-exported so studio call sites keep importing them from './geo' unchanged.
  totalMeters,
  routeBearingAt,
  timeAtAlong,
  sideOfApproach,
} from '@skipper/engine'

/**
 * The NARRATION region — the BROAD area the Skipper may name as "where you are" without the fact
 * sheet. Deliberately coarse and ALWAYS-TRUE for its zone: from lat/lng we can place a POI in a
 * broad area, never a precise town, so we never return a city — "Reno, Nevada" would be a false
 * pinpoint for a foothills POI, and the grounding gate can't catch it (naming the region is the one
 * thing it's allowed to do without a sheet fact). The Carson Range crest (~-119.88 lng) splits the
 * greater Lake Tahoe basin (the lake + its high country: Desolation, Fallen Leaf, Squaw, Truckee,
 * the west shore — all west of the crest) from the eastern Reno/Carson valleys. A geometry-first
 * point-in-bbox lookup against real sub-regions can replace this when more regions exist.
 */
export function regionLabel(lat: number, lng: number): string {
  if (lng <= -119.88) return 'Lake Tahoe'
  return lat >= 39.4 ? 'the Reno area' : 'the Carson Valley'
}

/**
 * Encode an [lng, lat] polyline to Google's precision-5 encoded-polyline string.
 *
 * The Places "search along route" API accepts ONLY the encoded string, never a
 * coordinate array — but materialize.ts decoded the Routes-API polyline and froze
 * only the [lng, lat] points (the encoded string was discarded). Rather than
 * re-call the Routes API (the frozen route is "never recomputed"), we re-encode
 * the frozen points. Decode→encode round-trips cleanly at precision 5 (the points
 * were already quantized to 1e-5 on decode), so the result is a valid polyline
 * that SAR accepts. Inverse of materialize.ts's decodePolyline.
 */
export function encodePolyline(polyline: LngLat[]): string {
  let lastLat = 0
  let lastLng = 0
  let out = ''
  const encodeSigned = (value: number): string => {
    let v = value < 0 ? ~(value << 1) : value << 1
    let chunk = ''
    while (v >= 0x20) {
      chunk += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
      v >>= 5
    }
    chunk += String.fromCharCode(v + 63)
    return chunk
  }
  for (const [lng, lat] of polyline) {
    const latE5 = Math.round(lat * 1e5)
    const lngE5 = Math.round(lng * 1e5)
    out += encodeSigned(latE5 - lastLat)
    out += encodeSigned(lngE5 - lastLng)
    lastLat = latE5
    lastLng = lngE5
  }
  return out
}
