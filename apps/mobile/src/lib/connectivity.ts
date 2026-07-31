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
// ⚠ The subscription is registered ONCE and NEVER removed. The native module starts NWPathMonitor in
// `OnStartObserving` and CANCELS it in `OnStopObserving` — and a cancelled NWPathMonitor is in a
// final state, so a remove/re-add cycle risks permanently killing the event stream. Don't call
// expo-network's own `useNetworkState()` hook in a component either: it adds a listener on mount and
// removes it on unmount, which is that same cycle. Read this module instead.

import { useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import { addNetworkStateListener } from 'expo-network'
import { isOfflineSnapshot, type NetworkSnapshot } from './connectivity-util'

/** The last state the OS PUSHED us. Null = never observed → unknown → assume online. */
let snapshot: NetworkSnapshot | null = null

/**
 * After the app returns to the foreground we distrust a held OFFLINE verdict for this long. While
 * the app was suspended the queue that delivers path updates wasn't running, so a network that came
 * back may not have been reported yet. Cleared EARLY by the first pushed event (the normal case —
 * a pending update is delivered within milliseconds of resume), so this is a ceiling, not a wait.
 * Without it, a rider who backgrounds the app in a dead zone and reopens it in town could hold a
 * stale "offline" and short-circuit requests that would have worked.
 */
const RESUME_GRACE_MS = 1_500
let unconfirmedUntil = 0

const subscribers = new Set<() => void>()
function notify(): void {
  for (const fn of subscribers) fn()
}

function apply(next: NetworkSnapshot): void {
  snapshot = next
  unconfirmedUntil = 0 // a real event outranks the resume grace
  notify()
}

let armed = false
/** Register the app-lifetime listener. Idempotent; safe to call from anywhere. */
function arm(): void {
  if (armed) return
  armed = true
  try {
    // NEVER `.remove()` this — see the header note on OnStopObserving cancelling the monitor.
    addNetworkStateListener((state) => apply(state))
  } catch {
    // No native module (a misconfigured build, a future web target): stay permanently "unknown",
    // which reads as ONLINE everywhere. The app behaves exactly as it did before this file existed.
  }
  try {
    AppState.addEventListener('change', (s) => {
      if (s !== 'active') return
      if (!isOfflineSnapshot(snapshot)) return // a stale ONLINE costs nothing — don't churn
      unconfirmedUntil = Date.now() + RESUME_GRACE_MS
      notify()
      setTimeout(() => {
        // Skip if an event already cleared it (=== 0), or a later resume pushed the window out
        // (its own timer owns that one).
        if (unconfirmedUntil === 0 || Date.now() < unconfirmedUntil) return
        unconfirmedUntil = 0
        notify()
      }, RESUME_GRACE_MS)
    })
  } catch {}
}

// Armed on IMPORT so "imported = watching" — there is no ordering bug where a screen reads the
// verdict before someone remembered to start the monitor. api.ts imports this, so the listener is
// registered as early as anything in the app touches the network.
arm()

/**
 * Is the device definitively offline RIGHT NOW? Synchronous (no bridge call, no await), so it is
 * safe on any hot path. False whenever we don't know — see the asymmetry note at the top.
 */
export function isOfflineNow(): boolean {
  if (unconfirmedUntil !== 0 && Date.now() < unconfirmedUntil) return false
  return isOfflineSnapshot(snapshot)
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
