// Pure, native-free GPS helpers (no expo-location import) so they unit-test under `bun test` — the
// safety-critical math every live-drive fix passes through before it can fire a stop. gps.ts (which IS
// native) wires these into the expo-location watch. Mirrors offline-util.ts's pure/native split.
//
// @skipper/engine is a pure (RN-free) package, so importing its geo math here keeps this file testable.
import { DEFAULT_TRIGGER, haversineMeters, OFF_ROUTE_MAX_M } from '@skipper/engine'
import type { LngLat } from '@skipper/engine'

// Drop a fix whose horizontal accuracy is worse than this (m) at rest/slow. A just-acquired GPS fix can
// carry 1000 m+ accuracy, and a wild fix landing near a stop would false-fire it. Driving fixes are
// normally well under 10 m, so this only rejects the unsettled ones. (gps spec §3.3)
export const MAX_FIX_ACCURACY_M = 50

// Speed-aware loosening of the accuracy gate: at speed the effective trigger radius is large (~161 m at
// 30 mph, ~322 m at 60 mph via DEFAULT_TRIGGER.leadSeconds), so a usefully-noisy fix (a granite canyon's
// ~120 m) should still DRIVE triggering rather than fail CLOSED and silently never fire a stop — while an
// unsettled ~1000 m acquisition fix is still rejected. Ceiling = a fraction of the effective radius
// (speed * leadSeconds), floored at MAX_FIX_ACCURACY_M. (gps audit #9)
export const ACCURACY_LEAD_FRACTION = 0.5

/**
 * iOS (CLLocation) returns -1, NOT null, for an invalid speed/heading (expo/expo#5401, sim AND device).
 * The type says `number | null` but the runtime yields -1 — so `?? 0` is not enough. Clamps a negative
 * or nullish value to 0. SPEED-SAFE: 0 is a sane "unknown speed". Do NOT use for heading — 0 is due-north,
 * so heading passes RAW (-1 = unknown) and the engines skip their heading gate on a negative.
 */
export function saneNonNeg(v: number | null | undefined): number {
  return v != null && v >= 0 ? v : 0
}

/** The accuracy ceiling (m) a fix must beat to be trusted, loosened with speed. Pure. */
export function accuracyCeilingM(speedMps: number): number {
  return Math.max(MAX_FIX_ACCURACY_M, speedMps * DEFAULT_TRIGGER.leadSeconds * ACCURACY_LEAD_FRACTION)
}

/**
 * Is a fix's reported accuracy good enough to trust at this speed? The choke point EVERY live fix passes
 * before it reaches the trigger engine — a regression dropping the speed-aware term rejects every fix in
 * a noisy canyon and the drive never fires a stop (the field-confirmed zero-fire failure). `null` accuracy
 * is admitted (unknown; rare — iOS always reports it); the iOS -1 sentinel (negative) is rejected.
 */
export function accuracyOk(acc: number | null | undefined, speedMps: number): boolean {
  if (acc == null) return true
  if (acc < 0) return false // iOS -1 = invalid accuracy → reject
  return acc <= accuracyCeilingM(speedMps)
}

/** iOS granted location but only at REDUCED (approximate) accuracy — the Precise Location toggle is off.
 *  Pure on the raw `ios.accuracy` value (undefined off iOS → false, so it never blocks sim/Android).
 *  Typed `string | undefined` to stay decoupled from expo's exact union — the literal 'reduced' is the
 *  contract (a value-set change must be caught here, not silently pass). */
export function isReducedAccuracy(iosAccuracy: string | undefined): boolean {
  return iosAccuracy === 'reduced'
}

/**
 * Forward-windowed nearest-vertex projection: searches [cursor, cursor+window) for the polyline vertex
 * closest to (lng,lat) and returns the new cursor index. NEVER decreases below `cursor` (monotonic), so a
 * return-leg fix on an out-and-back can't snap back to a nearby OUTBOUND vertex (which would jump the dot
 * backward AND keep alongM from ever reaching the end). Bounds per-fix work to the window. Pure.
 *
 * OFF-ROUTE REJECTION (`maxOffRouteM`): a fix that isn't near ANY vertex in the window does not advance
 * the cursor. Without this the "nearest vertex in the window" is returned no matter how absurd the
 * distance, so a rider who taps Drive from somewhere else entirely (the hotel the night before, or App
 * Review in Cupertino) walks the cursor forward on every fix — which fed `reachedRouteEnd`'s index clause
 * and fired the outro in seconds, drive over, credit spent, nothing played.
 *
 * Freezing is the SAFE failure: `alongM` feeds only the progress dot and the end predicate, while stop
 * TRIGGERING keys on raw proximity to each stop (`TriggerEngine.onFix`) — so a parked cursor can never
 * silence a stop. Rejoin the route inside the window and it simply resumes.
 */
export function projectForwardIndex(
  polyline: LngLat[],
  cursor: number,
  lng: number,
  lat: number,
  window: number,
  maxOffRouteM: number = OFF_ROUTE_MAX_M,
): number {
  const end = Math.min(polyline.length, cursor + window)
  let bestIdx = cursor
  let bestDist = haversineMeters(polyline[cursor]!, [lng, lat])
  for (let i = cursor + 1; i < end; i++) {
    const d = haversineMeters(polyline[i]!, [lng, lat])
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  // Off route → hold position rather than snap to whatever happened to be least-far away.
  return bestDist <= maxOffRouteM ? bestIdx : cursor // >= cursor → monotonic
}

/**
 * Whether a projected live position has reached the route end (→ queue the outro + finish the drive).
 * Pure mirror of liveSource's three-clause predicate: the projected alongM is within epsilon of the end,
 * OR the cursor reached the last segment AND we're actually NEAR the end, OR (fallback for a GPS gap / a
 * run of rejected fixes that left the windowed cursor short) the RAW distance to the final vertex is
 * within epsilon AND we've covered >50% of the route — the >50% guard avoids a false end at the START of
 * an out-and-back, where the final vertex ≈ the start. Returns false when the route has no length.
 *
 * ⚠ The `maxEndDistM` clamp belongs to the CURSOR clause ONLY, and deliberately not to the `alongM` one.
 * The cursor clause was a pure index test, so any cursor that reached the last segment ended the drive no
 * matter where on earth the rider stood — the false "you've arrived" seconds after starting a drive away
 * from its start. The alongM clause must stay unclamped: a rider who drives PAST the destination has a
 * legitimately complete `alongM` and a growing `rawToEndM`, and clamping it there would mean the drive
 * never finishes at all.
 */
export function reachedRouteEnd(args: {
  alongM: number
  routeEndM: number
  cursor: number
  polylineLen: number
  rawToEndM: number
  epsilonM: number
  /** How near the final vertex the rider must actually be for the CURSOR clause to count. */
  maxEndDistM?: number
}): boolean {
  const { alongM, routeEndM, cursor, polylineLen, rawToEndM, epsilonM } = args
  const maxEndDistM = args.maxEndDistM ?? OFF_ROUTE_MAX_M
  if (routeEndM <= 0) return false
  return (
    alongM >= routeEndM - epsilonM ||
    (cursor >= polylineLen - 2 && rawToEndM <= maxEndDistM) ||
    (rawToEndM <= epsilonM && alongM >= routeEndM * 0.5)
  )
}
