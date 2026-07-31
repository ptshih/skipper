// CONNECTIVITY — one app-wide answer to "does this device have a network right now?".
//
// Why the app needs it at all: without it, "you're offline" is indistinguishable from a 500, and
// every dead-zone fallback in the app is triggered by a FAILED fetch, so it only fires after the
// full REQUEST_TIMEOUT_MS. Cold start in a Tahoe dead zone was ~15 s of skeletons, then the saved
// drives; tap one, ~15 s more. Knowing the answer up front turns both into instant disk reads and
// lets every failure surface say the honest thing.
//
// ⚠ THE ONE RULE: a false OFFLINE verdict is CATASTROPHIC (every request short-circuits and the app
// is bricked with signal in hand); a false ONLINE verdict costs only the request timeout we already
// pay today. Every choice below is that asymmetry.
//
// ⚠ We deliberately NEVER call expo-network's `getNetworkStateAsync()`. Read its iOS source
// (NetworkModule.swift): with no path in hand it spins up a TEMPORARY NWPathMonitor and blocks a
// global-queue thread on a semaphore for up to 5 seconds — and on TIMEOUT it returns
// `isConnected: false`. That is a call that can both stall and FABRICATE an offline verdict, which
// is precisely the failure this module exists to make impossible. Push events only.
//
// So: the verdict comes ONLY from `addNetworkStateListener` events, which the native module emits
// from a real NWPath. Until one arrives the answer is "unknown" → assume ONLINE. That is what makes
// a missing/broken native module degrade to exactly today's behaviour rather than to a dead app.
//
// ⚠ The subscription is registered ONCE and NEVER removed, and it is armed as early as the app can
// arm it (apps/mobile/index.js, beside the expo-network import). Two reasons, both native:
//   1. The module starts NWPathMonitor in `OnStartObserving` and CANCELS it in `OnStopObserving`,
//      and a cancelled NWPathMonitor is final — `setupNetworkMonitoring()` restarting the same
//      `let monitor` instance is a no-op. So losing the stream once loses it for the process.
//   2. `removeAllListeners` in expo-modules-core fires `stopObserving` whenever the prior listener
//      count was >= 1 — NOT only when it reaches zero (common/cpp/EventEmitter.cpp; contrast
//      `removeListener`, which correctly checks for zero). @better-auth/expo registers its own
//      network listener and tears it down on session-refresh cleanup, so arming FIRST and holding
//      the count above zero is what keeps someone else's teardown from taking our stream with it.
// For the same reason, don't call expo-network's own `useNetworkState()` hook in a component: mount
// /unmount IS an add/remove cycle.
//
// And because none of that is guaranteed, the verdict is SELF-HEALING rather than trusted forever —
// see `shouldSkipRequest` and `noteNetworkReachable`.

import { useSyncExternalStore } from 'react'
import { addNetworkStateListener } from 'expo-network'
import { isOfflineSnapshot, type NetworkSnapshot } from './connectivity-util'

/** The last state the OS PUSHED us. Null = never observed → unknown → assume online. */
let snapshot: NetworkSnapshot | null = null
/** When that push landed. A verdict with no recent evidence behind it gets probed, not trusted. */
let observedAt = 0
/** When we last let a request through to TEST a stale offline verdict. */
let probedAt = 0

/**
 * How long an OFFLINE verdict is trusted without fresh evidence. Past it, the next request is let
 * through as a PROBE rather than short-circuited.
 *
 * This is the guard against the module's one catastrophic failure: an event stream that dies (see
 * the header — a cancelled monitor is final, and someone else's `removeAllListeners` can cancel it)
 * while the last thing it said was "offline". Without a probe that verdict would stand until the
 * process was killed, and every request in the app would short-circuit with full bars.
 *
 * ⚠ It is a PROBE, not an expiry. A plain "distrust anything older than N" would be worse than
 * useless here: parked in a dead zone no new events arrive, so the verdict would go stale and stay
 * stale, and the feature would switch itself off exactly where it earns its keep. Instead a lapsed
 * window buys ONE real attempt, then re-arms — so a genuinely offline rider pays at most one
 * timeout per window (and only when they tap something), while a lying stream is corrected by the
 * first request that succeeds.
 */
const OFFLINE_TRUST_MS = 90_000

const subscribers = new Set<() => void>()
function notify(): void {
  for (const fn of subscribers) fn()
}

let armed = false
/** Register the app-lifetime listener. Idempotent; safe to call from anywhere, any number of times. */
export function armConnectivity(): void {
  if (armed) return
  armed = true
  try {
    // NEVER `.remove()` this — see the header note on OnStopObserving cancelling the monitor.
    addNetworkStateListener((state) => {
      if (__DEV__ && observedAt === 0) {
        // First push. A monitor that never emits is invisible in production (the verdict just stays
        // "unknown" and the app behaves as it always did), so this is the one cheap way to notice
        // in dev that the stream is alive at all.
        console.log('[connectivity] first network state', state)
      }
      snapshot = state
      observedAt = Date.now()
      probedAt = 0 // real evidence outranks any probe bookkeeping
      notify()
    })
  } catch {
    // No native module (a misconfigured build, a future web target): stay permanently "unknown",
    // which reads as ONLINE everywhere. The app behaves exactly as it did before this file existed.
  }
}

// Armed on IMPORT too, so "imported = watching" even if the early call in index.js is ever dropped.
armConnectivity()

/**
 * Is the device definitively offline RIGHT NOW? Synchronous and PURE (no clock, no bridge call), so
 * it is safe both on a hot path and as a `useSyncExternalStore` snapshot. False whenever we don't
 * know — see the asymmetry note at the top.
 *
 * This is the UI's verdict. The REQUEST gate is `shouldSkipRequest`, which is deliberately stricter:
 * being wrong here costs a line of copy, being wrong there costs a request that never happens.
 */
export function isOfflineNow(): boolean {
  return isOfflineSnapshot(snapshot)
}

/**
 * Should this request be skipped instead of attempted? Same verdict as {@link isOfflineNow}, plus
 * the staleness probe: once OFFLINE_TRUST_MS has passed with no fresh event, ONE request is allowed
 * through to test whether the event stream is still telling the truth.
 *
 * ⚠ Not pure — it records the probe. Never use it as a render-time read.
 */
export function shouldSkipRequest(): boolean {
  if (!isOfflineNow()) return false
  const now = Date.now()
  if (now - Math.max(observedAt, probedAt) <= OFFLINE_TRUST_MS) return true
  probedAt = now // spend the probe; the window re-arms from here
  return false
}

/**
 * A request just completed against the real network. If we believed we were offline, that belief is
 * provably wrong — the event stream is stale or dead — so drop it and go back to "unknown" (which
 * reads as online). This is what makes a killed monitor recoverable within one probe instead of
 * lasting the whole process.
 */
export function noteNetworkReachable(): void {
  if (!isOfflineSnapshot(snapshot)) return
  snapshot = null
  observedAt = 0
  probedAt = 0
  notify()
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

/** The React view of {@link isOfflineNow} — re-renders the caller when connectivity flips. */
export function useIsOffline(): boolean {
  return useSyncExternalStore(subscribe, isOfflineNow, () => false)
}
