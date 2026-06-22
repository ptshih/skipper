// The swappable GPS fix source — the one seam between the simulated drive and the
// real one. The driving player consumes a `GpsFixSource`. Two implementations exist:
// the *simulated* source (replays `generateDrive` on a wall-clock timer, no device GPS),
// so the whole trigger→play→duck→lock-screen loop is couch-testable on the iOS Simulator;
// and the live `liveSource()` / `liveRoamSource()` (expo-location `watchPositionAsync` →
// GpsFix), which implement the SAME `GpsFixSource` shape — the hooks swap which one they
// subscribe and nothing else changes. See docs/specs/gps-player-spec.md §3.4 / §7.
import * as Location from 'expo-location'
import { cumulativeMeters, generateDrive, haversineMeters, type GpsFix, type LngLat } from '@skipper/engine'
import {
  accuracyOk,
  isReducedAccuracy,
  projectForwardIndex,
  reachedRouteEnd,
  saneNonNeg,
} from './gps-util'

/**
 * A controller for an active fix stream. `stop()` ends it for good; `pause()`/`resume()`
 * suspend and continue emission (the simulator can freeze the road so you can inspect a
 * stop — a real GPS source maps these to stopping/restarting the watch, or no-ops them).
 *
 * This is a deliberate superset of the spec's bare `(onFix) => () => void` seam: the extra
 * lifecycle is what lets the on-device drive *simulator* pause without losing position.
 */
export interface FixSubscription {
  stop: () => void
  pause: () => void
  resume: () => void
}

/**
 * Subscribe to a stream of GPS fixes.
 * - `onEnd` fires when the route is done — a finite source (the sim) running out of fixes, or the
 *   live source's position reaching the final vertex. It's what queues the outro + finishes the drive.
 * - `onError` fires when the source fails to produce fixes at all (e.g. the live watch can't acquire);
 *   the consumer surfaces it instead of hanging silently.
 */
export type GpsFixSource = (
  onFix: (fix: GpsFix) => void,
  onEnd?: () => void,
  onError?: (err: unknown) => void,
) => FixSubscription

export interface SimSourceOptions {
  /** Constant drive speed (mph), passed to `generateDrive`. Default 60. */
  mph?: number
  /** Fix rate (Hz), passed to `generateDrive` — real GPS at BestForNavigation is ~1–4 Hz. Default 4. */
  tickHz?: number
  /**
   * Wall-clock compression for couch testing. 1 = real time (fixes spaced 1/tickHz s, so a
   * 30-min drive takes 30 min); 8 = 8× faster (same fix DATA, emitted 8× sooner) so you can
   * watch a whole drive trigger in a few minutes. Does NOT change speeds the trigger sees —
   * each GpsFix still reports its real `speedMps`/`tSec`; only the delivery cadence compresses.
   */
  timeScale?: number
}

/**
 * The simulated `GpsFixSource`: pre-generates the fix stream with `generateDrive` (a
 * constant-speed walk along the polyline) and replays it on a timer at the route's real
 * cadence (or compressed via `timeScale`). The fix DATA is identical to what a real drive
 * at this speed would produce, so the trigger engine behaves exactly as it will on the road.
 */
export function simulatedSource(polyline: LngLat[], opts: SimSourceOptions = {}): GpsFixSource {
  const { mph = 60, tickHz = 4, timeScale = 1 } = opts
  return (onFix, onEnd, onError) => {
    let fixes: GpsFix[]
    try {
      fixes = generateDrive(polyline, { mph, tickHz })
    } catch (e) {
      // generateDrive throws synchronously on a bad polyline — route it to the same 'error' phase the
      // live source uses (onError) instead of an uncaught throw to beginDrive's caller. (audit #942)
      onError?.(e)
      return { stop: () => {}, pause: () => {}, resume: () => {} }
    }
    // Real spacing between fixes is 1/tickHz seconds; compress by timeScale for testing.
    const dtMs = Math.max(1, 1000 / tickHz / Math.max(0.0001, timeScale))
    let i = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let halted = false

    const tick = () => {
      timer = null
      if (halted) return
      if (i >= fixes.length) {
        onEnd?.()
        return
      }
      onFix(fixes[i]!)
      i++
      timer = setTimeout(tick, dtMs)
    }

    const arm = () => {
      if (timer === null && !halted) timer = setTimeout(tick, dtMs)
    }
    const clear = () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }

    // Kick off on the next tick so the subscriber's first render settles first.
    timer = setTimeout(tick, 0)

    return {
      stop: () => {
        halted = true
        clear()
      },
      pause: () => {
        halted = true
        clear()
      },
      resume: () => {
        if (halted) {
          halted = false
          arm()
        }
      },
    }
  }
}

// The accuracy gate (accuracyOk), the iOS -1 sentinel sanitize (saneNonNeg), the monotonic forward
// projection (projectForwardIndex), and the end-of-route predicate (reachedRouteEnd) are the pure,
// safety-critical cores — extracted to gps-util.ts so they unit-test without mocking expo-location.

// Fire onEnd once the projected position is within this of the final route vertex (m). (review #1)
const ROUTE_END_EPSILON_M = 25

// Forward search window for the monotonic projection, in polyline vertices (~13 m apart → ~5 km).
// Big enough to span a multi-second GPS gap without an O(n) full-polyline scan per fix. (review #10/#12)
const PROJECT_WINDOW_VERTS = 400

// True when iOS granted location but only at REDUCED (approximate) accuracy — the Precise Location
// toggle is off. Such fixes land ~1–3 km wide, so the accuracy gate would reject EVERY fix → the drive
// silently never triggers a stop. SDK 56 has no `requestTemporaryFullAccuracyAsync`, so there's no in-app
// upgrade — we send the rider to Settings. `res.ios?.accuracy` is undefined off iOS → false (never blocks
// sim/Android). The pure core (isReducedAccuracy) is tested in gps-util. (audit #499)
const isReduced = (res: Location.LocationPermissionResponse): boolean => isReducedAccuracy(res.ios?.accuracy)

/**
 * Request foreground (When-In-Use) location permission — the live drive needs it before the
 * watch can start. The caller surfaces the denied / open-Settings UX (`canAskAgain === false`
 * means the OS won't prompt again; deep-link to Settings instead) AND the `reduced`-accuracy
 * case (granted but approximate → also Settings-only). (spec §7 Phase 4)
 */
export async function ensureDrivePermission(): Promise<{
  granted: boolean
  canAskAgain: boolean
  reduced: boolean
}> {
  const res = await Location.requestForegroundPermissionsAsync()
  return { granted: res.granted, canAskAgain: res.canAskAgain, reduced: isReduced(res) }
}

/**
 * Read the current foreground-permission status WITHOUT prompting — used to re-check after the rider
 * returns from system Settings (the `canAskAgain === false` AND the reduced-accuracy recovery paths). (review #5)
 */
export async function getDrivePermission(): Promise<{
  granted: boolean
  canAskAgain: boolean
  reduced: boolean
  /** True when the OS has never been asked → the next request shows the (one-shot) prompt. Lets the
   *  caller put a priming explainer in front of that first prompt and skip it once it's decided. */
  undetermined: boolean
}> {
  const res = await Location.getForegroundPermissionsAsync()
  return {
    granted: res.granted,
    canAskAgain: res.canAskAgain,
    reduced: isReduced(res),
    undetermined: res.status === Location.PermissionStatus.UNDETERMINED,
  }
}

/**
 * The FREE-ROAM live `GpsFixSource`: the same expo-location watch as `liveSource`, with
 * NO polyline — roam has no route, so there is no along-route projection (`alongM` stays 0;
 * the RoamEngine works from raw proximity + heading) and no end-of-route signal (a roam
 * session ends only when the rider ends it). Same accuracy gate, -1 sanitization, and
 * teardown-leak guard as the drive source.
 */
export function liveRoamSource(): GpsFixSource {
  return (onFix, _onEnd, onError) => {
    let sub: Location.LocationSubscription | null = null
    let stopped = false
    let paused = false
    let startMs: number | null = null
    let acquiring = false // a watch acquisition is in flight (re-entry guard) (audit #490)

    const onLocation = (loc: Location.LocationObject) => {
      if (stopped || paused) return // teardown-leak guard (#35925/#35926) + pause guard
      if (!accuracyOk(loc.coords.accuracy, saneNonNeg(loc.coords.speed))) return // speed-aware gate (audit #9)
      if (startMs === null) startMs = loc.timestamp
      onFix({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        speedMps: saneNonNeg(loc.coords.speed),
        // RAW course, NOT saneNonNeg(): iOS uses -1 for "unknown", and the RoamEngine treats a
        // negative heading as unknown → skips the heading gate (proximity-only). saneNonNeg()'s
        // -1→0 would read as a REAL northbound heading and gate out every other direction
        // — the first live drive's zero-fire bug. (The tour path now shares this sentinel
        // contract: liveSource passes raw course and TriggerEngine skips the gate on it.)
        headingDeg: loc.coords.heading ?? -1,
        tSec: (loc.timestamp - startMs) / 1000,
        alongM: 0, // no route to be along
      })
    }

    const startWatch = () => {
      if (acquiring || sub) return // already watching/acquiring — don't stack a second native watch (audit #490)
      acquiring = true
      void Location.watchPositionAsync(
        // timeInterval is ANDROID-ONLY (iOS cadence is accuracy-driven, ~1 Hz); harmless floor there.
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0, timeInterval: 500 },
        onLocation,
      )
        .then((s) => {
          acquiring = false
          if (stopped || paused) {
            s.remove()
            return
          }
          sub = s
        })
        .catch((err) => {
          acquiring = false
          if (!stopped) onError?.(err)
        })
    }

    startWatch()

    return {
      stop: () => {
        stopped = true
        sub?.remove()
        sub = null
      },
      pause: () => {
        paused = true
        sub?.remove()
        sub = null
      },
      resume: () => {
        if (stopped || !paused) return
        paused = false
        startWatch()
      },
    }
  }
}

/**
 * The live `GpsFixSource`: wraps expo-location `watchPositionAsync` into the SAME
 * `FixSubscription` the simulated source returns, so the driving hook swaps one for the other
 * and nothing else changes. Maps each `LocationObject → GpsFix` (spec §3.3): sanitizes the iOS
 * -1, gates on accuracy, projects the fix onto `polyline` so the route dot's `alongM` tracks the
 * real position (a live fix has no intrinsic along-route distance), and derives `tSec` from the
 * first fix's timestamp.
 *
 * ASSUMES foreground permission is already granted — call `ensureDrivePermission()` first.
 *
 * ⚠️ `watchPositionAsync`'s `.remove()` can fail to stop updates (expo/expo #35925/#35926, both
 * platforms). A `stopped` guard drops any fix arriving after `stop()`, so a leaked native watch
 * is harmless to the engine + UI — but it still drains battery, so verify GPS actually stops on
 * unmount during the on-device test. (spec §5)
 */
export function liveSource(polyline: LngLat[]): GpsFixSource {
  const cumulative = cumulativeMeters(polyline)
  const routeEndM = cumulative[cumulative.length - 1] ?? 0
  return (onFix, onEnd, onError) => {
    let sub: Location.LocationSubscription | null = null
    let stopped = false
    let paused = false
    let startMs: number | null = null
    let ended = false
    let acquiring = false // a watch acquisition is in flight (re-entry guard) (audit #490)
    // Monotonic projection cursor. A plain nearest-VERTEX scan (geo.nearestOnRoute) snaps return-leg
    // fixes to nearby OUTBOUND vertices on an out-and-back route — the dot jumps backward AND alongM
    // never reaches the end, so end-of-route detection below would never fire. Searching FORWARD from
    // the cursor keeps alongM monotonic and bounds the per-fix work to the window ahead. (review #1/#10/#12)
    let cursor = 0

    const projectAlongM = (lng: number, lat: number): number => {
      cursor = projectForwardIndex(polyline, cursor, lng, lat, PROJECT_WINDOW_VERTS) // monotonic
      return cumulative[cursor] ?? 0
    }

    const onLocation = (loc: Location.LocationObject) => {
      if (stopped || paused) return // teardown-leak guard (#35925/#35926) + pause guard
      // Speed-aware accuracy gate: reject the iOS -1 sentinel + unsettled ~1000 m acquisition fixes,
      // but admit usefully-noisy fixes when the effective trigger radius is large at speed. (audit #9, review #2)
      if (!accuracyOk(loc.coords.accuracy, saneNonNeg(loc.coords.speed))) return
      if (startMs === null) startMs = loc.timestamp
      const alongM = projectAlongM(loc.coords.longitude, loc.coords.latitude)
      onFix({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        speedMps: saneNonNeg(loc.coords.speed),
        // RAW course (same sentinel contract as liveRoamSource above): -1 = unknown, and
        // the TriggerEngine skips the heading gate on a negative heading. saneNonNeg()'s -1→0
        // would read as due-north and gate out every non-north stop — roam's field-confirmed
        // zero-fire bug, ported here rather than re-learned on a tour drive.
        headingDeg: loc.coords.heading ?? -1,
        tSec: (loc.timestamp - startMs) / 1000, // ms since epoch; wall-clock since the first fix (incl. pause time) — reporting-only, triggering doesn't use it (audit #951)
        alongM, // projected onto the route so the dot follows the real position
      })
      // Live GPS has no fix-stream end like the sim, so signal end-of-route ourselves once the
      // projected position reaches the final vertex — that's what queues the outro + finishes. (review #1)
      // Fallback (audit #332): if the windowed cursor lagged (a GPS gap / a run of rejected fixes in
      // the final stretch left alongM short), also complete when the raw distance to the final vertex
      // is within epsilon AND we've covered most of the route — the >50% guard avoids a false end at
      // the start of an out-and-back where the final vertex ≈ the start. (A TOTAL fix dropout in the
      // final stretch still can't auto-complete — no fix arrives to evaluate; documented limitation.)
      const rawToEndM = haversineMeters(
        [loc.coords.longitude, loc.coords.latitude],
        polyline[polyline.length - 1]!,
      )
      if (
        !ended &&
        reachedRouteEnd({
          alongM,
          routeEndM,
          cursor,
          polylineLen: polyline.length,
          rawToEndM,
          epsilonM: ROUTE_END_EPSILON_M,
        })
      ) {
        ended = true
        onEnd?.()
      }
    }

    const startWatch = () => {
      if (acquiring || sub) return // already watching/acquiring — don't stack a second native watch (audit #490)
      acquiring = true
      void Location.watchPositionAsync(
        // NOTE: a FOREGROUND watch — watchPositionAsync can't set pausesUpdatesAutomatically (default
        // true → iOS may pause GPS at a long stop/overlook, exactly when a stop should fire) or
        // activityType; those live only on the background startLocationUpdatesAsync API. Verify on a
        // real Tahoe drive; only escalate to background updates (wider scope, founder OK) if it pauses.
        // timeInterval is ANDROID-ONLY (iOS cadence is accuracy-driven, ~1 Hz). (audit #8, nit)
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0, timeInterval: 500 },
        onLocation,
      )
        .then((s) => {
          // If stop()/pause() landed while the watch was being acquired, don't keep it.
          acquiring = false
          if (stopped || paused) {
            s.remove()
            return
          }
          sub = s
        })
        // watchPositionAsync rejects if Location Services are off at the OS level, permission was
        // revoked, or on a native error — surface it instead of letting the drive hang silently. (review #3)
        .catch((err) => {
          acquiring = false
          if (!stopped) onError?.(err)
        })
    }

    startWatch()

    return {
      stop: () => {
        stopped = true
        sub?.remove()
        sub = null
      },
      pause: () => {
        paused = true
        sub?.remove() // free the GPS while held (battery); re-acquired on resume
        sub = null
      },
      resume: () => {
        if (stopped || !paused) return
        paused = false
        startWatch()
      },
    }
  }
}
