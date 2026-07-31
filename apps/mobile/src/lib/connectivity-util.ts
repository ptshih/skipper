// Pure, native-free connectivity predicates (no expo-network / api imports) so they
// unit-test under `bun test`. connectivity.ts (which IS native) re-uses these.

/** The subset of expo-network's `NetworkState` we judge on. EVERY field is optional there —
 *  an absent field means "the platform didn't say", never "no". */
export interface NetworkSnapshot {
  isConnected?: boolean
  isInternetReachable?: boolean
}

/**
 * Is this snapshot a DEFINITE "no network"?
 *
 * The asymmetry here is the whole point. A false OFFLINE verdict is catastrophic — every request
 * short-circuits and the app is bricked with signal in hand — while a false ONLINE verdict costs
 * only the 15 s request timeout we already have today. So this reads offline ONLY on an explicit
 * `false`: an `undefined` field (the platform didn't report, the very first render before any event
 * lands) is UNKNOWN, and unknown always means "go ahead and try".
 *
 * Both fields are checked because they diverge off iOS: Android reports a captive portal as
 * connected-but-not-reachable, which is genuinely un-fetchable. On iOS they are the SAME value —
 * expo-network's NetworkModule.swift literally returns `"isInternetReachable": isConnected` — so
 * the second check is free there rather than a second chance to be wrong.
 */
export function isOfflineSnapshot(s: NetworkSnapshot | null | undefined): boolean {
  if (!s) return false // never observed → unknown → assume online
  return s.isConnected === false || s.isInternetReachable === false
}
