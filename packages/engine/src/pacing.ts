// Route pacing primitives — shared by the studio pipeline's stop selection (pipeline/select.ts) and
// engine's own buildDrive (drive-select.ts). Pure, zero-dep, RN-safe: the server paces a
// drive AND the device can re-pace one offline with the same math.

import {
  cumulativeMeters,
  nearestOnRoute,
  routeBearingAt,
  timeAtAlong,
  totalMeters,
  type LngLat,
} from './geo'

// Drive pacing — mirrors the studio pipeline's "standard" bucket (config.ts PACING.standard): a 3-min
// floor between stops, with the cap scaled to the route's length (~1 stop / 4 min, capped at 24).
export const DRIVE_MIN_GAP_SEC = 180
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
