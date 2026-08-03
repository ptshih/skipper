// The NATIVE half of the GPS seam: location permissions + `liveSource`, the expo-location watch.
// Everything pure — the `GpsFixSource` contract, `simulatedSource`, `replaySource`, the headless
// replay — lives in `gps-source.ts` so `bun test` can reach it, and is re-exported below so call sites
// keep importing from one place. See docs/designs/gps-player-spec.md §3.4 / §7 and
// docs/designs/desk-drive-harness.md.
import * as Location from 'expo-location'
import type { LngLat } from '@skipper/engine'
import { createFixMapper, isReducedAccuracy, type RawFix } from './gps-util'
import type { GpsFixSource } from './gps-source'

export {
  replayHeadless,
  replaySource,
  simulatedSource,
  type FixSubscription,
  type GpsFixSource,
  type ReplaySourceOptions,
  type SimSourceOptions,
} from './gps-source'
export type { RawFix } from './gps-util'

// The accuracy gate (accuracyOk), the iOS -1 sentinel sanitize (saneNonNeg), the monotonic forward
// projection (projectForwardIndex), the end-of-route predicate (reachedRouteEnd) AND the pipeline that
// composes them (createFixMapper) are the pure, safety-critical cores — they live in gps-util.ts so
// they unit-test without mocking expo-location. `liveSource` below is now ONLY the watch: acquire,
// hand each LocationObject to the shared mapper, tear down. Everything else it used to do is the
// mapper, which a replayed trace runs identically. (docs/designs/desk-drive-harness.md §4.1)

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
 * The live `GpsFixSource`: wraps expo-location `watchPositionAsync` into the SAME
 * `FixSubscription` the pure sources return, so the driving hook swaps one for the other and
 * nothing else changes.
 *
 * ⚠ **The `LocationObject → GpsFix` mapping is NOT here any more — it is `createFixMapper` in
 * gps-util.ts**, which `replaySource` runs identically. That is deliberate and load-bearing: while
 * this function owned the mapping privately, a simulated drive could not reach the accuracy gate, the
 * -1 sentinels, the projection cursor or the end predicate, which is exactly where the field-confirmed
 * failures have been. Do not re-inline it. (docs/designs/desk-drive-harness.md §4.1)
 *
 * What genuinely belongs here, and all that is left: acquiring the watch, the re-entry guard, the
 * pause/resume re-acquisition, and the teardown-leak guard.
 *
 * ASSUMES foreground permission is already granted — call `ensureDrivePermission()` first.
 *
 * ⚠️ `watchPositionAsync`'s `.remove()` can fail to stop updates (expo/expo #35925/#35926, both
 * platforms). A `stopped` guard drops any fix arriving after `stop()`, so a leaked native watch
 * is harmless to the engine + UI — but it still drains battery, so verify GPS actually stops on
 * unmount during the on-device test. (spec §5)
 */
export function liveSource(polyline: LngLat[], onRaw?: (raw: RawFix) => void): GpsFixSource {
  return (onFix, onEnd, onError) => {
    let sub: Location.LocationSubscription | null = null
    let stopped = false
    let paused = false
    let acquiring = false // a watch acquisition is in flight (re-entry guard) (audit #490)
    const accept = createFixMapper(polyline, { onFix, onEnd })

    const onLocation = (loc: Location.LocationObject) => {
      if (stopped || paused) return // teardown-leak guard (#35925/#35926) + pause guard
      // ⚠ The recorder tap sits BEFORE the mapper, on purpose: a trace is only useful for tuning if it
      // contains the fixes the accuracy gate THREW AWAY. Recording post-gate would silently produce a
      // trace that always replays clean, which is the one result that proves nothing.
      onRaw?.(loc)
      accept(loc)
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
