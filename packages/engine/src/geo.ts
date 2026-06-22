// Geometry for the drive simulator — pure functions, no deps.
//
// Mirrors @skipper/studio's geo helpers (kept local so the sim + the eventual
// player core stay decoupled from the studio pipeline). [lng, lat] axis order throughout,
// matching drives.polyline.

export type LngLat = [number, number]

const EARTH_RADIUS_M = 6_371_008.8
export const MPH_TO_MPS = 0.44704
/** Meters per statute mile (exact) — the one constant for every meters→miles display. */
export const METERS_PER_MILE = 1609.344
/** A POI farther off the road than this isn't honestly "along the drive" — it has no
 *  trustworthy trigger point. The SINGLE source for the off-route floor: the studio pipeline's
 *  selection floor (`OFF_ROUTE_MAX_M`, re-exported from config), the sim, and the live
 *  player all read THIS, so "a stop the studio pipeline accepts will trigger" holds by construction. */
export const OFF_ROUTE_MAX_M = 700

/**
 * Kind-aware proximity radius (m) for an un-snapped roam/drive pin. Roam pins are raw POI
 * centroids — never road-snapped (no route to snap to) — so an areal place needs a floor that
 * matches its body: a peak's pin is its SUMMIT, a lake's is open water, while a building sits
 * near the curb. Measured on the first live drive: at a flat 250 m only 8 of 77 basin pins were
 * reachable from the highway. The client's speed-adaptive lead still extends these at speed.
 * Single-sourced here so the /roam and /drives radii can't drift apart.
 *
 * The patterns track the discovery vocabulary (`featureKind` in the studio pipeline): an extended
 * landform (peninsula/point/cape) gets the areal tier, a high mountain feature (incl. a pass) the
 * widest, scenic viewpoints (vista/overlook/waterfall) the park tier. A `spring` stays at the
 * compact default — it is a point-source feature, not an areal body. Matched case-insensitively so a
 * capitalized kind never silently falls through to the default (which would under-trigger it).
 */
export function radiusForKind(kind: string | null): number {
  if (!kind) return 600
  const k = kind.toLowerCase()
  if (/mountain|peak|summit|ridge|hill|pass/.test(k)) return 1500
  // `\bpoint\b` so the standalone landform matches but "viewpoint" (a park-tier scenic stop) doesn't.
  if (/lake|reservoir|bay|valley|canyon|island|peninsula|\bpoint\b|cape/.test(k)) return 1200
  if (/park|recreation area|beach|cove|meadow|historic district|waterfall|vista|viewpoint|overlook/.test(k)) return 1000
  return 600
}

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

/** Signed shortest difference a−b between two bearings, in (−180, 180] (positive = a is
 *  clockwise of b). The one place the modular wrap lives; callers that need the side/sign
 *  (e.g. left-vs-right of travel) build on this instead of re-deriving the trick. */
function signedBearingDeltaDeg(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180
}

/** Smallest absolute difference between two bearings (degrees), 0..180. */
export function angularDiffDeg(a: number, b: number): number {
  return Math.abs(signedBearingDeltaDeg(a, b))
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

// --- Route-relative helpers ---------------------------------------------------
// Pure route geometry shared by the studio pipeline's stop selection (re-exported via
// pipeline/geo.ts) and engine's own buildDrive pacing — single-sourced here so
// both place candidates on a route identically.

/** Total polyline length in meters (0 for a degenerate <2-point line). */
export function totalMeters(cumulative: number[]): number {
  return cumulative.length ? cumulative[cumulative.length - 1]! : 0
}

/**
 * The route's heading of travel (degrees, 0=N) at vertex `index` — the direction a vehicle is
 * moving as it passes that point. Uses the forward segment (index → index+1), or the trailing
 * segment at the final vertex. Returns 0 for a degenerate (<2-vertex) polyline.
 */
export function routeBearingAt(polyline: LngLat[], index: number): number {
  if (polyline.length < 2) return 0
  const i = Math.min(Math.max(index, 0), polyline.length - 1)
  const [from, to] = i < polyline.length - 1 ? [polyline[i]!, polyline[i + 1]!] : [polyline[i - 1]!, polyline[i]!]
  return bearingDeg(from, to)
}

/**
 * Convert an along-route distance to an along-route TIME (seconds), assuming the frozen total
 * drive time is spread uniformly over the route length. A linear approximation — real speed
 * varies — but accurate enough to PACE and ORDER stops, and honest to the "pace by drive time"
 * invariant. Not a precise ETA.
 */
export function timeAtAlong(alongM: number, totalRouteM: number, totalRouteSec: number): number {
  if (totalRouteM <= 0) return 0
  return (alongM / totalRouteM) * totalRouteSec
}

/**
 * Which side of the road a point sits on, relative to the direction of travel. `headingDeg` is the
 * compass heading of travel (0=N, clockwise); `from` is the on-route trigger point and `to` is the
 * off-route POI. Compass bearings increase clockwise, so a target whose bearing is clockwise of the
 * heading is on the RIGHT. Returns null when too near dead-ahead/behind to call a side confidently.
 */
export function sideOfApproach(headingDeg: number, from: LngLat, to: LngLat): 'left' | 'right' | null {
  const rel = signedBearingDeltaDeg(bearingDeg(from, to), headingDeg) // (-180, 180]
  const mag = Math.abs(rel)
  if (mag < 10 || mag > 170) return null // ~collinear with travel — no clear side
  return rel > 0 ? 'right' : 'left'
}

/**
 * How far the "where to look" anchor sits from the pin before the guard rejects it, relative to the
 * kind-aware bound — a multiplier so the ceiling reflects EDGE-to-edge, not centroid-to-edge.
 * `radiusForKind` is a centroid→road trigger floor (~a feature's radius); a speakable vantage is a
 * centroid→vantage distance, which for an elongated or off-centroid feature (a long valley, a
 * point/cape, exactly the misleading-pin case a speakable anchor exists to fix) honestly runs past
 * the bare radius. 1.5× widens the band to clear an honest edge vantage while still failing the
 * km-scale typo/hallucination this guard exists to catch.
 */
export const SPEAKABLE_ANCHOR_RADIUS_MULT = 1.5

/**
 * The ceiling (m) a curated "where to look" speakable anchor may sit from its poi's pin before the
 * coordinate is suspect. The anchor corrects a MISLEADING centroid, but a vantage is still "roughly
 * here," inside the feature's own body, never km away — so the ceiling scales with the feature's
 * kind (`radiusForKind`) times `SPEAKABLE_ANCHOR_RADIUS_MULT`. Single-sourced so the admin write
 * boundary and the corpus audit judge anchors identically.
 */
export function speakableAnchorMaxM(kind: string | null): number {
  return Math.round(SPEAKABLE_ANCHOR_RADIUS_MULT * radiusForKind(kind))
}

export interface SpeakableAnchorCheck {
  /** Great-circle pin→anchor distance, meters. */
  distanceM: number
  /** The kind-aware ceiling `distanceM` is judged against (`speakableAnchorMaxM`). */
  maxM: number
  /** False when the anchor is implausibly far from the pin (reject the write / flag in an audit). */
  ok: boolean
}

/**
 * Sanity-check a speakable "where to look" anchor against its poi's pin. `ok:false` ⇒ the anchor is
 * implausibly far (beyond the feature's own body) and is almost certainly a typo or a hallucinated
 * coordinate — the admin write boundary REJECTS it (overridable) and the corpus audit FLAGS it. Pure;
 * both callers single-source the bound here so they can never drift. `pin`/`anchor` are [lng, lat].
 */
export function checkSpeakableAnchor(pin: LngLat, anchor: LngLat, kind: string | null): SpeakableAnchorCheck {
  const distanceM = haversineMeters(pin, anchor)
  const maxM = speakableAnchorMaxM(kind)
  return { distanceM, maxM, ok: distanceM <= maxM }
}
