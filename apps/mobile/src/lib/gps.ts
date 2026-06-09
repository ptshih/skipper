// The swappable GPS fix source — the one seam between the simulated drive and the
// real one. The driving player consumes a `GpsFixSource`; today only the *simulated*
// source exists (it replays `generateDrive` on a wall-clock timer, no device GPS), so
// the whole trigger→play→duck→lock-screen loop is couch-testable on the iOS Simulator.
//
// Phase 4 adds a `liveSource()` (expo-location `watchPositionAsync` → GpsFix) that
// implements the SAME `GpsFixSource` shape; the driving hook swaps which one it
// subscribes and nothing else changes. See docs/gps-player-spec.md §3.4 / §7.
import * as Location from 'expo-location'
import {
  cumulativeMeters,
  generateDrive,
  nearestOnRoute,
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

/** Subscribe to a stream of GPS fixes. `onEnd` fires when a finite source (the sim) runs out. */
export type GpsFixSource = (onFix: (fix: GpsFix) => void, onEnd?: () => void) => FixSubscription

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

// iOS (CLLocation) returns -1, NOT null, for invalid speed/heading (expo/expo#5401, sim AND
// device). The type says `number | null` but the runtime yields -1 — so `?? 0` is not enough.
const sane = (v: number | null | undefined): number => (v != null && v >= 0 ? v : 0)

/**
 * Request foreground (When-In-Use) location permission — the live drive needs it before the
 * watch can start. The caller surfaces the denied / open-Settings UX (`canAskAgain === false`
 * means the OS won't prompt again; deep-link to Settings instead). (spec §7 Phase 4)
 */
export async function ensureDrivePermission(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  const res = await Location.requestForegroundPermissionsAsync()
  return { granted: res.granted, canAskAgain: res.canAskAgain }
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
  return (onFix) => {
    let sub: Location.LocationSubscription | null = null
    let stopped = false
    let paused = false
    let startMs: number | null = null

    const onLocation = (loc: Location.LocationObject) => {
      if (stopped || paused) return // teardown-leak guard (#35925/#35926) + pause guard
      const acc = loc.coords.accuracy
      if (acc != null && acc > MAX_FIX_ACCURACY_M) return // unsettled fix — don't risk a false fire
      if (startMs === null) startMs = loc.timestamp
      const pos = nearestOnRoute(polyline, cumulative, [loc.coords.longitude, loc.coords.latitude])
      onFix({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        speedMps: sane(loc.coords.speed),
        headingDeg: sane(loc.coords.heading),
        tSec: (loc.timestamp - startMs) / 1000, // loc.timestamp = ms since epoch
        alongM: pos.alongM, // projected onto the route so the dot follows the real position
      })
    }

    const startWatch = () => {
      void Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0, timeInterval: 500 },
        onLocation,
      ).then((s) => {
        // If stop()/pause() landed while the watch was being acquired, don't keep it.
        if (stopped || paused) {
          s.remove()
          return
        }
        sub = s
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
