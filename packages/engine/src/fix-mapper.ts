// THE LIVE FIX PIPELINE — every rule a raw GPS fix passes before it can fire a stop.
//
// ⚠ This lives in @skipper/engine, not in the app, for the reason the engine exists at all: the
// simulator has to agree with the car. While this logic sat privately inside `apps/mobile`'s
// expo-location watch, NOTHING outside the phone could run it — not `bun test`, not the drive
// simulator, not the parameter sweep — so the accuracy gate, the iOS -1 sentinels, the projection
// cursor and the end predicate were verified by inspection and by driving, and nothing else. That is
// where the field-confirmed failures came from. docs/designs/desk-drive-harness.md.
//
// `isReducedAccuracy` deliberately did NOT come along: it reads expo's `ios.accuracy` string, which is
// a platform permission detail rather than geometry, and it stays in apps/mobile/src/lib/gps-util.ts.

import { cumulativeMeters, haversineMeters, OFF_ROUTE_MAX_M } from './geo'
import type { LngLat } from './geo'
import { DEFAULT_TRIGGER } from './trigger'
import type { GpsFix } from './trigger'

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

// Fire onEnd once the projected position is within this of the final route vertex (m). (review #1)
export const ROUTE_END_EPSILON_M = 25

// Forward search window for the monotonic projection, in polyline vertices (~13 m apart → ~5 km).
// Big enough to span a multi-second GPS gap without an O(n) full-polyline scan per fix. (review #10/#12)
export const PROJECT_WINDOW_VERTS = 400

/**
 * The subset of expo-location's `LocationObject` the live pipeline actually reads.
 *
 * Declared STRUCTURALLY rather than imported, and that is the whole point: it keeps this file
 * native-free (so `bun test` can reach it), and it makes a recorded or synthesised fix *the same
 * shape* as one off the radio — which is what lets a desk drive run the real pipeline instead of a
 * parallel one. See docs/designs/desk-drive-harness.md §4.1.
 *
 * ⚠ `speed`/`heading`/`accuracy` are `number | null` in expo's types and **-1 at runtime on iOS**
 * (expo/expo#5401). Both spellings must survive a round-trip through a serialised trace, so do not
 * "clean" them at the recorder — the sentinels ARE the data.
 */
export interface RawFix {
  coords: {
    latitude: number
    longitude: number
    accuracy: number | null
    speed: number | null
    heading: number | null
  }
  /** ms since epoch, as `LocationObject.timestamp`. */
  timestamp: number
}

export interface FixMapperOptions {
  onFix: (fix: GpsFix) => void
  onEnd?: () => void
  epsilonM?: number
  windowVerts?: number
  maxOffRouteM?: number
}

/**
 * The live path's `LocationObject → GpsFix` pipeline, as a reusable unit.
 *
 * ⚠ **This is the code a simulated drive used to skip entirely**, and it is where the failures
 * historically live: the speed-aware accuracy gate, the iOS -1 sentinel handling, the monotonic
 * projection cursor with off-route rejection, and the three-clause end predicate. Extracting it means
 * `liveSource` (the expo-location watch) and `replaySource` (a recorded or synthesised trace) run the
 * SAME mapping — so a desk drive can now reach every branch above. The alternative, which is what we
 * had, is two code paths that agree only by inspection.
 *
 * Stateful per subscription (cursor, first-fix clock, end-latch), so build one per drive and throw it
 * away with the drive. Returns the accept function; a rejected fix returns `false` so a caller that
 * cares (the harness, the recorder's stats) can count what the gate dropped.
 */
export function createFixMapper(polyline: LngLat[], opts: FixMapperOptions): (raw: RawFix) => boolean {
  const { onFix, onEnd } = opts
  const epsilonM = opts.epsilonM ?? ROUTE_END_EPSILON_M
  const windowVerts = opts.windowVerts ?? PROJECT_WINDOW_VERTS
  const maxOffRouteM = opts.maxOffRouteM ?? OFF_ROUTE_MAX_M
  const cumulative = cumulativeMeters(polyline)
  const routeEndM = cumulative[cumulative.length - 1] ?? 0
  let cursor = 0
  let startMs: number | null = null
  let ended = false

  return (raw: RawFix): boolean => {
    const { latitude: lat, longitude: lng } = raw.coords
    // Speed-aware accuracy gate: reject the iOS -1 sentinel + unsettled ~1000 m acquisition fixes,
    // but admit usefully-noisy fixes when the effective trigger radius is large at speed. (audit #9, review #2)
    if (!accuracyOk(raw.coords.accuracy, saneNonNeg(raw.coords.speed))) return false
    if (startMs === null) startMs = raw.timestamp
    cursor = projectForwardIndex(polyline, cursor, lng, lat, windowVerts, maxOffRouteM) // monotonic
    const alongM = cumulative[cursor] ?? 0
    onFix({
      lat,
      lng,
      speedMps: saneNonNeg(raw.coords.speed),
      // ⚠ RAW course, NOT saneNonNeg(): iOS reports -1 for "unknown", and the TriggerEngine
      // treats a negative heading as unknown and skips the heading gate entirely. Running it
      // through saneNonNeg() maps -1→0, which reads as a REAL due-north heading and gates out
      // every stop the car is not driving north toward — a FIELD-CONFIRMED zero-fire bug, found
      // on a real drive, not reasoned about.
      headingDeg: raw.coords.heading ?? -1,
      tSec: (raw.timestamp - startMs) / 1000, // wall-clock since the first fix (incl. pause time) — reporting-only (audit #951)
      alongM, // projected onto the route so the dot follows the real position
    })
    // Live GPS has no fix-stream end like the sim, so signal end-of-route ourselves once the
    // projected position reaches the final vertex — that's what queues the outro + finishes. (review #1)
    // Fallback (audit #332): if the windowed cursor lagged, also complete when the RAW distance to the
    // final vertex is within epsilon AND we've covered most of the route.
    if (!ended) {
      const rawToEndM = haversineMeters([lng, lat], polyline[polyline.length - 1]!)
      if (
        reachedRouteEnd({ alongM, routeEndM, cursor, polylineLen: polyline.length, rawToEndM, epsilonM })
      ) {
        ended = true
        onEnd?.()
      }
    }
    return true
  }
}
