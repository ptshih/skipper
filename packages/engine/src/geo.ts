// Geometry for the drive simulator — pure functions, no deps.
//
// Mirrors @skipper/studio's geo helpers (kept local so the sim + the eventual
// player core stay decoupled from the studio pipeline). [lng, lat] axis order throughout,
// matching drives.polyline.

export type LngLat = [number, number]

/** Mean Earth radius (m), IUGG. Exported because `cluster.ts`'s equirectangular projector needs the
 *  SAME sphere: `clusterTrigger` re-measures its projected result with `haversineMeters` to keep the
 *  projection honest, and two Earth models would make that check quietly compare against a different
 *  planet. One home for the constant, per CLAUDE.md — point here, don't restate the number. */
export const EARTH_RADIUS_M = 6_371_008.8
export const MPH_TO_MPS = 0.44704
/** Meters per statute mile (exact) — the one constant for every meters→miles display. */
export const METERS_PER_MILE = 1609.344
/** A POI farther off the road than this isn't honestly "along the drive" — it has no
 *  trustworthy trigger point. The SINGLE source for the off-route floor: the studio pipeline's
 *  selection floor (`OFF_ROUTE_MAX_M`, re-exported from config), the sim, and the live
 *  player all read THIS, so "a stop the studio pipeline accepts will trigger" holds by construction. */
export const OFF_ROUTE_MAX_M = 700

/**
 * Kind-aware proximity radius (m) for an UN-ANCHORED pin. Such a pin is the raw POI centroid —
 * nothing snapped it to a road — so an areal place needs a floor that
 * matches its body: a peak's pin is its SUMMIT, a lake's is open water, while a building sits
 * near the curb. Measured on the first live drive: at a flat 250 m only 8 of 77 basin pins were
 * reachable from the highway. The client's speed-adaptive lead still extends these at speed.
 * Single-sourced here so every consumer's trigger radii can't drift apart.
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

/**
 * A road-snapped (anchored) trigger point sits ON the road, so the centroid→road inflation that
 * `radiusForKind` bakes into the areal tiers (1000–1500 m) is no longer needed — its whole purpose was
 * to bridge an un-snapped centroid out to the highway, and an anchor already IS on the highway. A fat
 * floor around an on-road center fires EARLY and imprecisely (the "Harrah's trigger really far" build-11
 * complaint), so an anchored point gets this tight, kind-independent floor instead. The client's
 * speed-adaptive lead still extends it at speed (`max(floor, speed·leadSeconds)`), so this only governs
 * the low-speed case. CONSERVATIVE start — the final number is NOT desk-tunable; it's pinned on the next
 * on-device Tahoe re-drive against the POIs that failed (Edgewood, Harrah's, Van Sickle, Zephyr Cove).
 * trigger-precision-spec.md §2.
 */
export const ANCHORED_TRIGGER_RADIUS_M = 250

/**
 * The trigger floor (m) for a drive pin, CONDITIONAL on whether that pin is a road-snapped anchor.
 * Anchored ⇒ the tight `ANCHORED_TRIGGER_RADIUS_M` (center's on the road; no inflation needed).
 * Un-anchored ⇒ the kind-aware `radiusForKind` floor stays — a tight radius around an OFF-road centroid
 * would never fire, regressing the ~99 Tahoe POIs that have no anchor (trigger-precision §2: "NOT a
 * blanket shrink"). This is the TRIGGER path's view of the radius only; `speakableAnchorMaxM` /
 * `checkSpeakableAnchor` deliberately keep reading the un-conditional `radiusForKind`, so anchor
 * VALIDITY at the admin write boundary + the corpus audit is judged by the feature's body, never by
 * this trigger floor (the two concerns must not couple).
 */
export function triggerRadiusForKind(kind: string | null, anchored: boolean): number {
  return anchored ? ANCHORED_TRIGGER_RADIUS_M : radiusForKind(kind)
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

/**
 * Initial bearing (degrees, 0=N, 90=E) when traveling from `a` to `b`.
 *
 * ⚠ COINCIDENT POINTS RETURN 0 — atan2(0,0), a FABRICATED due north, not a signal that the bearing
 * is undefined. There is no in-band way to say "no answer", so a caller within GPS noise of `to`
 * must gate on DISTANCE first; trust this only with real separation. Read as a real heading it
 * silently turns "is it ahead of me?" into a question about north — which is exactly how a stop
 * sitting on the route's first vertex fired only for northbound drives (TriggerOptions.bearingFloorM).
 */
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
// Pure route geometry for engine's own buildDrive pacing (drive-select.ts) — single-sourced
// here so the server and the on-device re-pace place candidates on a route identically.

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

// `sideOfApproach` (which side of the road a POI sits on) lived here until 2026-07-15. It was wired
// live by 6cb88d1 under the PHASE-2 tour model, where a narration was tour-owned and could bake a
// side; 3b95785 deleted that pipeline and stranded it. V2 doesn't just not-use it — it BANS what it
// computed: a narration is the shared atom (one telling reused by every drive, from any
// approach direction), so naming a side is an ungrounded place-claim, fail-closed by the laterality
// gate (studio eval/laterality.ts). Kept as a guarded helper it would read as blessed and current —
// a trap pointing at the one thing that must never ship. If laterality ever returns it needs a
// per-telling direction, not this. (Deleted with the pin-vs-anchor bearing audit.)

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

/* -------------------------------------------------------------------------- */
/*  Region bbox — ONE parser (1.1 sweep)                                        */
/* -------------------------------------------------------------------------- */

/**
 * A region's discovery box, parsed. `regions.bbox` is stored as the string
 * `"lng_min,lat_min,lng_max,lat_max"` — south-west corner first, LONGITUDE first within each corner.
 *
 * ⚠ THE AXIS ORDER IS THE WHOLE REASON THIS IS SHARED. Until the 1.1 sweep there were FOUR
 * independently-written parsers of that one string — in the API's anchor loader, the API's
 * example-anchor picker, the studio's region resolver and the admin server — that agreed only by
 * luck: one trimmed whitespace and three did not, and they disagreed on whether to call the corners
 * sw/ne or min/max. A region is a BBOX and never a stored FK (geometry-first), so this string is the
 * only thing standing between a poi and the region it belongs to; two readers disagreeing about it
 * silently move places between regions.
 */
export interface RegionBbox {
  swLng: number
  swLat: number
  neLng: number
  neLat: number
}

/**
 * Parse `regions.bbox`. Null for absent or malformed input — never a throw and never a partial box,
 * because every caller's honest answer to "I cannot read this region's extent" is "match nothing",
 * not "match everything".
 *
 * ⚠ Trims each field. The admin's parser did and the other three did not, so a bbox hand-entered with
 * a space after a comma resolved in the console and matched zero pois everywhere else.
 */
export function parseRegionBbox(raw: string | null | undefined): RegionBbox | null {
  if (!raw) return null
  const p = raw.split(',').map((s) => Number(s.trim()))
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return null
  return { swLng: p[0]!, swLat: p[1]!, neLng: p[2]!, neLat: p[3]! }
}

/**
 * Is a point inside the box? INCLUSIVE on all four edges.
 *
 * ⚠ Inclusive matters and is not arbitrary: the admin's region poi-count and the pois view's region
 * column are read by an operator as the same number, so an edge case decided differently in one place
 * surfaces as two screens disagreeing about one poi. The API's anchor query uses SQL `between`, which
 * is also inclusive — that agreement is what makes this function and that query interchangeable.
 */
export function pointInRegionBbox(box: RegionBbox, lat: number, lng: number): boolean {
  return lat >= box.swLat && lat <= box.neLat && lng >= box.swLng && lng <= box.neLng
}
