// Route geometry for the M1 generator — pure functions, no external deps.
//
// The corridor polyline is a FROZEN, dense [lng, lat] point list (Emerald Bay
// Run: 3,698 pts over ~48 km, so vertices sit ~13 m apart). Two jobs here:
//   1. Spread Wikipedia geosearch probes evenly along the whole corridor.
//   2. Place each found POI ON the route — its along-route distance and, via the
//      frozen total drive time, its along-route TIME. Pacing is by drive TIME,
//      not distance (the invariant), so everything downstream keys off seconds.
//
// Because the polyline is so dense, nearest-VERTEX is a good proxy for nearest-
// point-on-route (worst-case error ~half the ~13 m vertex spacing), so we skip
// segment projection and just scan vertices. Cheap at 3,698 points.

/** A [lng, lat] pair (GeoJSON axis order) — matches the corridors.polyline column. */
export type LngLat = [number, number]

const EARTH_RADIUS_M = 6_371_008.8 // mean Earth radius (IUGG)

const toRad = (deg: number): number => (deg * Math.PI) / 180

/** Great-circle distance between two [lng, lat] points, in meters. */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const [lng1, lat1] = a
  const [lng2, lat2] = b
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h = sinLat * sinLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLng * sinLng
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Cumulative along-route distance (meters) at each vertex. Same length as the
 * polyline; element 0 is 0. `at[n-1]` is the total route length.
 */
export function cumulativeMeters(polyline: LngLat[]): number[] {
  const out = new Array<number>(polyline.length)
  if (polyline.length === 0) return out
  out[0] = 0
  for (let i = 1; i < polyline.length; i++) {
    const prev = polyline[i - 1]!
    const cur = polyline[i]!
    out[i] = out[i - 1]! + haversineMeters(prev, cur)
  }
  return out
}

/** Total polyline length in meters (0 for a degenerate <2-point line). */
export function totalMeters(cumulative: number[]): number {
  return cumulative.length ? cumulative[cumulative.length - 1]! : 0
}

export interface RoutePosition {
  /** Index of the nearest polyline vertex. */
  index: number
  /** Straight-line distance from `point` to that vertex (a "how far off the road" proxy). */
  offRouteM: number
  /** Along-route distance to that vertex, in meters. */
  alongM: number
}

/**
 * Snap an arbitrary point (a found POI) onto the route: the nearest vertex, how
 * far off-route it is, and its along-route distance. Linear scan — fine at a few
 * thousand vertices, and we do it a few dozen times per corridor.
 */
export function nearestOnRoute(polyline: LngLat[], cumulative: number[], point: LngLat): RoutePosition {
  let bestIndex = 0
  let bestDist = Infinity
  for (let i = 0; i < polyline.length; i++) {
    const d = haversineMeters(polyline[i]!, point)
    if (d < bestDist) {
      bestDist = d
      bestIndex = i
    }
  }
  return { index: bestIndex, offRouteM: bestDist, alongM: cumulative[bestIndex] ?? 0 }
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

export interface RouteSample {
  point: LngLat
  alongM: number
}

/**
 * Evenly-spaced probe points along the route (one per ~`stepMeters` traveled),
 * used to seed Wikipedia geosearch so we cover the whole corridor rather than
 * just the named waypoints. Always includes the first and last vertex.
 */
export function sampleAlong(polyline: LngLat[], cumulative: number[], stepMeters: number): RouteSample[] {
  const samples: RouteSample[] = []
  if (polyline.length === 0) return samples
  let nextAt = 0
  for (let i = 0; i < polyline.length; i++) {
    if (cumulative[i]! >= nextAt) {
      samples.push({ point: polyline[i]!, alongM: cumulative[i]! })
      nextAt = cumulative[i]! + stepMeters
    }
  }
  // Guarantee the final vertex is covered (the corridor's far end).
  const lastIdx = polyline.length - 1
  const last = samples[samples.length - 1]
  if (!last || last.alongM < cumulative[lastIdx]!) {
    samples.push({ point: polyline[lastIdx]!, alongM: cumulative[lastIdx]! })
  }
  return samples
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
