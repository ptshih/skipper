// The swappable GPS fix source — the one seam between the simulated drive and the
// real one. The driving player consumes a `GpsFixSource`; today only the *simulated*
// source exists (it replays `generateDrive` on a wall-clock timer, no device GPS), so
// the whole trigger→play→duck→lock-screen loop is couch-testable on the iOS Simulator.
//
// Phase 4 adds a `liveSource()` (expo-location `watchPositionAsync` → GpsFix) that
// implements the SAME `GpsFixSource` shape; the driving hook swaps which one it
// subscribes and nothing else changes. See docs/specs/gps-player-spec.md §3.4 / §7.
import * as Location from 'expo-location'
import {
  cumulativeMeters,
  generateDrive,
  haversineMeters,
  type GpsFix,
  type LngLat,
} from '@skipper/drive-core'

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
  return (onFix, onEnd) => {
    const fixes = generateDrive(polyline, { mph, tickHz })
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

// Drop a fix whose horizontal accuracy is worse than this (m). A just-acquired GPS fix can
// carry 1000 m+ accuracy, and a wild fix landing near a stop would false-fire it. Driving fixes
// are normally well under 10 m, so this only rejects the unsettled ones. (spec §3.3)
const MAX_FIX_ACCURACY_M = 50

// Fire onEnd once the projected position is within this of the final route vertex (m). (review #1)
const ROUTE_END_EPSILON_M = 25

// Forward search window for the monotonic projection, in polyline vertices (~13 m apart → ~5 km).
// Big enough to span a multi-second GPS gap without an O(n) full-polyline scan per fix. (review #10/#12)
const PROJECT_WINDOW_VERTS = 400

// iOS (CLLocation) returns -1, NOT null, for invalid speed/heading (expo/expo#5401, sim AND
// device). The type says `number | null` but the runtime yields -1 — so `?? 0` is not enough.
// SPEED ONLY: 0 is a sane "unknown speed", but 0 heading is due-north — heading passes RAW
// (-1 = unknown) and the engines skip their heading gate on a negative (the sentinel contract).
const sane = (v: number | null | undefined): number => (v != null && v >= 0 ? v : 0)

// True when iOS granted location but only at REDUCED (approximate) accuracy — the Precise Location
// toggle is off. Such fixes land ~1–3 km wide, so the watch's accuracy gate (MAX_FIX_ACCURACY_M)
// would reject EVERY fix → the drive silently never triggers a stop. SDK 56 has no
// `requestTemporaryFullAccuracyAsync`, so there's no in-app upgrade — we must send the rider to
// Settings. `res.ios?.accuracy` is undefined off iOS, so this is false there (never blocks sim/Android).
const isReduced = (res: Location.LocationPermissionResponse): boolean => res.ios?.accuracy === 'reduced'

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
export async function getDrivePermission(): Promise<{ granted: boolean; reduced: boolean }> {
  const res = await Location.getForegroundPermissionsAsync()
  return { granted: res.granted, reduced: isReduced(res) }
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
/**
 * The FREE-ROAM live `GpsFixSource`: the same expo-location watch as `liveSource`, with
 * NO polyline — roam has no route, so there is no along-route projection (`alongM` stays 0;
 * the RoamEngine works from raw proximity + heading) and no end-of-route signal (a roam
 * session ends only when the rider ends it). Same accuracy gate, -1 sanitization, and
 * teardown-leak guard as the tour source.
 */
export function liveRoamSource(): GpsFixSource {
  return (onFix, _onEnd, onError) => {
    let sub: Location.LocationSubscription | null = null
    let stopped = false
    let paused = false
    let startMs: number | null = null

    const onLocation = (loc: Location.LocationObject) => {
      if (stopped || paused) return // teardown-leak guard (#35925/#35926) + pause guard
      const acc = loc.coords.accuracy
      if (acc != null && (acc < 0 || acc > MAX_FIX_ACCURACY_M)) return
      if (startMs === null) startMs = loc.timestamp
      onFix({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        speedMps: sane(loc.coords.speed),
        // RAW course, NOT sane(): iOS uses -1 for "unknown", and the RoamEngine treats a
        // negative heading as unknown → skips the heading gate (proximity-only). sane()'s
        // -1→0 would read as a REAL northbound heading and gate out every other direction
        // — the first live drive's zero-fire bug. (The tour path now shares this sentinel
        // contract: liveSource passes raw course and TriggerEngine skips the gate on it.)
        headingDeg: loc.coords.heading ?? -1,
        tSec: (loc.timestamp - startMs) / 1000,
        alongM: 0, // no route to be along
      })
    }

    const startWatch = () => {
      void Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0, timeInterval: 500 },
        onLocation,
      )
        .then((s) => {
          if (stopped || paused) {
            s.remove()
            return
          }
          sub = s
        })
        .catch((err) => {
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

export function liveSource(polyline: LngLat[]): GpsFixSource {
  const cumulative = cumulativeMeters(polyline)
  const routeEndM = cumulative[cumulative.length - 1] ?? 0
  return (onFix, onEnd, onError) => {
    let sub: Location.LocationSubscription | null = null
    let stopped = false
    let paused = false
    let startMs: number | null = null
    let ended = false
    // Monotonic projection cursor. A plain nearest-VERTEX scan (geo.nearestOnRoute) snaps return-leg
    // fixes to nearby OUTBOUND vertices on an out-and-back route — the dot jumps backward AND alongM
    // never reaches the end, so end-of-route detection below would never fire. Searching FORWARD from
    // the cursor keeps alongM monotonic and bounds the per-fix work to the window ahead. (review #1/#10/#12)
    let cursor = 0

    const projectAlongM = (lng: number, lat: number): number => {
      const end = Math.min(polyline.length, cursor + PROJECT_WINDOW_VERTS)
      let bestIdx = cursor
      let bestDist = haversineMeters(polyline[cursor]!, [lng, lat])
      for (let i = cursor + 1; i < end; i++) {
        const d = haversineMeters(polyline[i]!, [lng, lat])
        if (d < bestDist) {
          bestDist = d
          bestIdx = i
        }
      }
      cursor = bestIdx // never decreases → monotonic
      return cumulative[bestIdx] ?? 0
    }

    const onLocation = (loc: Location.LocationObject) => {
      if (stopped || paused) return // teardown-leak guard (#35925/#35926) + pause guard
      const acc = loc.coords.accuracy
      // Drop unsettled fixes. iOS reports a NEGATIVE accuracy (-1) when invalid — the same sentinel
      // as speed/heading — so reject acc < 0 too, else the worst fixes slip past the gate. (review #2)
      if (acc != null && (acc < 0 || acc > MAX_FIX_ACCURACY_M)) return
      if (startMs === null) startMs = loc.timestamp
      const alongM = projectAlongM(loc.coords.longitude, loc.coords.latitude)
      onFix({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        speedMps: sane(loc.coords.speed),
        // RAW course (same sentinel contract as liveRoamSource above): -1 = unknown, and
        // the TriggerEngine skips the heading gate on a negative heading. sane()'s -1→0
        // would read as due-north and gate out every non-north stop — roam's field-confirmed
        // zero-fire bug, ported here rather than re-learned on a tour drive.
        headingDeg: loc.coords.heading ?? -1,
        tSec: (loc.timestamp - startMs) / 1000, // loc.timestamp = ms since epoch
        alongM, // projected onto the route so the dot follows the real position
      })
      // Live GPS has no fix-stream end like the sim, so signal end-of-route ourselves once the
      // projected position reaches the final vertex — that's what queues the outro + finishes. (review #1)
      if (!ended && routeEndM > 0 && alongM >= routeEndM - ROUTE_END_EPSILON_M) {
        ended = true
        onEnd?.()
      }
    }

    const startWatch = () => {
      void Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0, timeInterval: 500 },
        onLocation,
      )
        .then((s) => {
          // If stop()/pause() landed while the watch was being acquired, don't keep it.
          if (stopped || paused) {
            s.remove()
            return
          }
          sub = s
        })
        // watchPositionAsync rejects if Location Services are off at the OS level, permission was
        // revoked, or on a native error — surface it instead of letting the drive hang silently. (review #3)
        .catch((err) => {
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
