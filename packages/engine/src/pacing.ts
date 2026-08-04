// Route pacing primitives — used by engine's buildDrive (drive-select.ts) and the sim/trigger/preview
// path. Pure, zero-dep, RN-safe: the server paces a drive AND the device can re-pace one offline with
// the same math.

import {
  cumulativeMeters,
  nearestOnRoute,
  routeBearingAt,
  timeAtAlong,
  totalMeters,
  type LngLat,
} from './geo'

// Drive pacing — a floor between consecutive stops, with the cap scaled to the route's length
// (~1 stop / 4 min, capped at 24). The two are different guards and only one of them binds in
// practice: the FLOOR is what real drives hit, the CAP has never been reached on a saved drive.
//
// ⚠ Was 180 s until 2026-08-03. Measured across the four saved Tahoe drives, the floor — not the cap,
// and not the reachability filter — was the binding constraint on half of them: at 180 s the set
// selected 31 stops, at 120 s it selects 35, while lifting the cap entirely changed nothing at all
// and widening the trigger reach to its 700 m ceiling bought 2. A 2-minute floor is still well clear
// of the ~90-second tellings the corpus actually holds; the FIFO lag drop (`DRIVE_MAX_LAG_SEC`) is
// what stops a run of long clips from stacking up, so this number does not have to do that job too.
export const DRIVE_MIN_GAP_SEC = 120
export const DRIVE_MAX_STOPS_CAP = 24
export const driveMaxStops = (totalSec: number): number =>
  Math.max(3, Math.min(DRIVE_MAX_STOPS_CAP, Math.round(totalSec / 240)))

/** A point snapped to a route: its along-route time, off-route distance, the trigger point it
 *  snaps to, and the route's heading of travel there. */
export interface RouteSnap {
  /** Along-route time (seconds) at the snapped point. */
  alongSec: number
  /** How far the point sits off the road (meters). */
  offRouteM: number
  /** The nearest route point ([lat]) — the trigger point. */
  triggerLat: number
  triggerLng: number
  /** Route heading of travel (deg, 0=N) at the trigger point. */
  approachHeadingDeg: number
}

/**
 * Build a snapper for a frozen polyline + total drive time. Returns a function that snaps any
 * [lng, lat] to its along-route time, off-route distance, trigger point, and approach heading.
 * Precomputes the cumulative distances ONCE so snapping many candidates stays cheap.
 */
export function buildRouteSnapper(polyline: LngLat[], totalSec: number): (p: LngLat) => RouteSnap {
  const cumulative = cumulativeMeters(polyline)
  const totalM = totalMeters(cumulative)
  return (p) => {
    const pos = nearestOnRoute(polyline, cumulative, p)
    return {
      alongSec: timeAtAlong(pos.alongM, totalM, totalSec),
      offRouteM: pos.offRouteM,
      triggerLat: pos.lat,
      triggerLng: pos.lng,
      approachHeadingDeg: Math.round(routeBearingAt(polyline, pos.index)) % 360,
    }
  }
}

// (projectQueueLag was removed 2026-06-19 — it had no production caller; buildDrive's step-4 FIFO
//  walk inlines the lag projection because it also DROPS laggards mid-pass, which this could not.)
