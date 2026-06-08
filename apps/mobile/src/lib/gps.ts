// The swappable GPS fix source — the one seam between the simulated drive and the
// real one. The driving player consumes a `GpsFixSource`; today only the *simulated*
// source exists (it replays `generateDrive` on a wall-clock timer, no device GPS), so
// the whole trigger→play→duck→lock-screen loop is couch-testable on the iOS Simulator.
//
// Phase 4 adds a `liveSource()` (expo-location `watchPositionAsync` → GpsFix) that
// implements the SAME `GpsFixSource` shape; the driving hook swaps which one it
// subscribes and nothing else changes. See docs/gps-player-spec.md §3.4 / §7.
import { generateDrive, type GpsFix, type LngLat } from '@skipper/drive-core'

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

// Phase 4: liveSource() — wraps expo-location watchPositionAsync into this same
// GpsFixSource shape (LocationObject → GpsFix per spec §3.3). Not built for Phase 2:
// the simulated source proves the entire bet minus real positioning, on the simulator.
