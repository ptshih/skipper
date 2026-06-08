// Geometry for the drive simulator — pure functions, no deps.
//
// Mirrors @skipper/generator's geo helpers (kept local so the sim + the eventual
// player core stay decoupled from the generator). [lng, lat] axis order throughout,
// matching corridors.polyline.

export type LngLat = [number, number]

const EARTH_RADIUS_M = 6_371_008.8
export const MPH_TO_MPS = 0.44704

const toRad = (deg: number): number => (deg * Math.PI) / 180
const toDeg = (rad: number): number => (rad * 180) / Math.PI

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

/** Initial bearing (degrees, 0=N, 90=E) when traveling from `a` to `b`. */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const [lng1, lat1] = a
  const [lng2, lat2] = b
  const φ1 = toRad(lat1)
  const φ2 = toRad(lat2)
  const Δλ = toRad(lng2 - lng1)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** Smallest absolute difference between two bearings (degrees), 0..180. */
export function angularDiffDeg(a: number, b: number): number {
  const diff = Math.abs(((a - b + 540) % 360) - 180)
  return diff
}

/** Linear interpolation between two [lng, lat] points (fine over the ~13 m vertex spacing). */
export function interpolate(a: LngLat, b: LngLat, frac: number): LngLat {
  const t = Math.max(0, Math.min(1, frac))
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/** Cumulative along-route distance (meters) at each vertex; element 0 is 0. */
export function cumulativeMeters(polyline: LngLat[]): number[] {
  const out = new Array<number>(polyline.length)
  if (polyline.length === 0) return out
  out[0] = 0
  for (let i = 1; i < polyline.length; i++) {
    out[i] = out[i - 1]! + haversineMeters(polyline[i - 1]!, polyline[i]!)
  }
  return out
}

export interface RoutePosition {
  index: number
  /** The nearest route point ([lng, lat]) — a POI's "trigger point". */
  lng: number
  lat: number
  /** How far the POI sits off the road (m). */
  offRouteM: number
  /** Along-route distance of that point (m). */
  alongM: number
}

/**
 * Snap a point (a POI) to the nearest vertex on the route. The dense polyline
 * (~13 m spacing) makes nearest-vertex a good proxy for nearest-point-on-segment.
 * Used so a stop triggers as the vehicle passes the POI's point ON THE ROAD — not
 * when it gets within X meters of a POI that may sit far off to the side.
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
  const v = polyline[bestIndex]!
  return { index: bestIndex, lng: v[0], lat: v[1], offRouteM: bestDist, alongM: cumulative[bestIndex] ?? 0 }
}
