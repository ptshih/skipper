// Route geometry for the M1 generator.
//
// The shared PRIMITIVES — haversineMeters, bearingDeg, cumulativeMeters,
// nearestOnRoute (+ LngLat / RoutePosition) — now live in @skipper/drive-core (the
// pure, RN-safe driving/trigger core) and are RE-EXPORTED here, so generator call
// sites keep importing them from './geo' unchanged. This file adds the
// GENERATION-specific helpers on top: even probe sampling along the route, polyline
// encoding, side-of-approach, total length, route bearing, and along-route time.
// [lng, lat] axis order throughout, matching tours.polyline.
//
// (Previously these primitives were hand-copied between the generator and the sim;
// the copy is gone now that both share @skipper/drive-core.)

import { bearingDeg, signedBearingDeltaDeg, type LngLat } from '@skipper/drive-core'

export {
  type LngLat,
  type RoutePosition,
  haversineMeters,
  bearingDeg,
  cumulativeMeters,
  nearestOnRoute,
  METERS_PER_MILE,
} from '@skipper/drive-core'

/**
 * Which side of the road a point sits on, relative to the direction of travel.
 * `headingDeg` is the compass heading of travel (0=N, clockwise); `from` is the
 * on-route trigger point and `to` is the off-route POI. Compass bearings increase
 * clockwise, so a target whose bearing is clockwise of the heading is on the
 * RIGHT. Returns null when the point is too near dead-ahead/behind to call a side
 * confidently (the caller then omits it rather than guessing a coin-flip side).
 */
export function sideOfApproach(headingDeg: number, from: LngLat, to: LngLat): 'left' | 'right' | null {
  const rel = signedBearingDeltaDeg(bearingDeg(from, to), headingDeg) // (-180, 180]
  const mag = Math.abs(rel)
  if (mag < 10 || mag > 170) return null // ~collinear with travel — no clear side
  return rel > 0 ? 'right' : 'left'
}

/** Rough sub-region label for narration context — tells the model where the driver IS. */
export function regionLabel(lat: number, lng: number): string {
  if (lat > 39.35 && lng > -119.9) return 'Reno, Nevada'
  if (lat > 39.0 && lng > -119.85) return 'Carson City, Nevada'
  return 'Lake Tahoe'
}

/** Total polyline length in meters (0 for a degenerate <2-point line). */
export function totalMeters(cumulative: number[]): number {
  return cumulative.length ? cumulative[cumulative.length - 1]! : 0
}

/**
 * The route's heading of travel (degrees, 0=N) at vertex `index` — the direction
 * a vehicle is moving as it passes that point. Uses the forward segment
 * (index → index+1), or the trailing segment at the final vertex. Returns 0 for a
 * degenerate (<2-vertex) polyline, where heading is undefined.
 */
export function routeBearingAt(polyline: LngLat[], index: number): number {
  if (polyline.length < 2) return 0
  const i = Math.min(Math.max(index, 0), polyline.length - 1)
  const [from, to] = i < polyline.length - 1 ? [polyline[i]!, polyline[i + 1]!] : [polyline[i - 1]!, polyline[i]!]
  return bearingDeg(from, to)
}

/**
 * Convert an along-route distance to an along-route TIME (seconds), assuming the
 * frozen total drive time is spread uniformly over the route length. A linear
 * approximation — real speed varies (town vs. highway, the climb) — but it is
 * accurate enough to PACE and ORDER stops for M1, and it keeps the whole pipeline
 * honest to the "pace by drive time" invariant. Documented here so it is not
 * mistaken for a precise ETA.
 */
export function timeAtAlong(alongM: number, totalRouteM: number, totalRouteSec: number): number {
  if (totalRouteM <= 0) return 0
  return (alongM / totalRouteM) * totalRouteSec
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
