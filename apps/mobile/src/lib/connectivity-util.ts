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
 * ⚠ `isInternetReachable` is checked ONLY because it is a no-op on the one platform that ships.
 * expo-network's NetworkModule.swift literally returns `"isInternetReachable": isConnected` on iOS,
 * so it cannot disagree there and cannot be a second chance to be wrong. On ANDROID it is a
 * different signal — it additionally requires `NET_CAPABILITY_VALIDATED`, which goes false on a
 * captive portal AND transiently while a connection is being validated — so it is a genuine
 * false-offline trigger. If an Android target is ever added, gate on `isConnected` alone there.
 */
export function isOfflineSnapshot(s: NetworkSnapshot | null | undefined): boolean {
  if (!s) return false // never observed → unknown → assume online
  return s.isConnected === false || s.isInternetReachable === false
}
