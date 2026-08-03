// useLocationPriming — the location-permission-priming orchestration SHELL shared by the
// live driving player (useDrive). It was written for two callers; roam was the other.
//
// Both consumers do the EXACT same dance before they can start a live (real-GPS) session:
//   1. A double-tap guard (a pending ref) so the status read / OS prompt can't be re-fired
//      while one is already in flight.
//   2. Read the foreground status WITHOUT prompting (`getDrivePermission`). The very first
//      time (undetermined) we show a pre-permission EXPLAINER (App Store 5.1.1(iv): no
//      "Not Now" on a pre-prompt) before iOS's one-shot prompt — `priming` drives it; its
//      CTA is `confirmLocationPrime`. Already decided → request straight through (no OS UI),
//      so a grant rolls and a denial/reduced lands on the caller's Settings gate.
//   3. The actual request (`ensureDrivePermission`), routed to the caller via callbacks.
//   4. A defensive catch: if the no-prompt status read throws, fall back to requesting
//      directly rather than HANGING; if the request itself throws, signal `onError`.
//   5. A finally that always clears the pending ref.
//
// What DIVERGES — and is therefore the caller's job via the callbacks — is how each consumer
// maps the granted / denied / reduced RESULT into its OWN state (useDrive: a `LocationBlock`
// union + derived booleans + a SYNC `beginDrive`; the removed roam caller had a `gate` object and an
// ASYNC start). `onGranted` stays `void | Promise<void>` — it costs nothing and un-picking it would
// re-couple this hook to its one remaining caller's shape.
//
// NOTE: the consumer's `start` still owns its mode gating (sim/preview vs live) and its own
// pre-flight resets (e.g. clearing a stale error/gate); this hook is ONLY the live-mode
// permission shell. Call its `start` from the live branch of the consumer's `start`.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ensureDrivePermission, getDrivePermission } from './gps'
import { decideStart, routePermission } from './location-util'

/** The non-proceed permission result, carrying everything either consumer needs to render its
 *  gate. `granted` lets useDrive keep its `!granted`-first split (denied vs granted-but-reduced);
 *  `canAskAgain`/`reduced` fed the removed roam caller's single gate object. */
export interface LocationDenial {
  /** True only on the granted-but-REDUCED (approximate accuracy) branch; false on a hard denial. */
  granted: boolean
  /** Can the OS still prompt? (false → the recovery is system Settings, not a re-prompt.) */
  canAskAgain: boolean
  /** Granted but iOS approximate location (Precise Location off) → Settings-only. */
  reduced: boolean
}

export interface UseLocationPriming {
  /** True while the pre-permission explainer is up (live, first time only) — render the prime. */
  priming: boolean
  /** Begin the live-mode permission flow: status read → prime (first time) or request-through. */
  start: () => void
  /** The explainer's single CTA: dismiss the prime and fire the OS prompt. */
  confirmLocationPrime: () => void
}

export interface UseLocationPrimingOptions {
  /** Granted + precise → proceed. May be async (the removed roam caller's start was); it's awaited. */
  onGranted: () => void | Promise<void>
  /** A hard denial OR granted-but-reduced — the caller routes this into its own gate state.
   *  `granted` distinguishes the two (false = denied, true = granted-but-reduced). */
  onDenied: (result: LocationDenial) => void
  /** `ensureDrivePermission` itself threw (misconfig / concurrent ask) — the caller surfaces a
   *  re-askable gate instead of letting the tap silently do nothing. */
  onError: () => void
}

export function useLocationPriming(opts: UseLocationPrimingOptions): UseLocationPriming {
  const { onGranted, onDenied, onError } = opts
  // True while the pre-permission explainer is up: a live session whose foreground status is
  // still UNDETERMINED, so we explain why before iOS shows its one-shot prompt.
  const [priming, setPriming] = useState(false)
  // A permission request is in flight — blocks a double-tap (the status read / OS prompt). (review #4)
  const pending = useRef(false)
  // false after unmount — guards setState/callbacks across the async permission flow. (review #4)
  const mountedRef = useRef(true)

  // Latest callbacks via a ref so the request-through closure never goes stale AND `start` /
  // `confirmLocationPrime` keep a stable identity across renders (their consumers depend on it).
  const cbRef = useRef({ onGranted, onDenied, onError })
  useEffect(() => {
    cbRef.current = { onGranted, onDenied, onError }
  })

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // ---- request the OS prompt + route the result (shared by start() and the explainer CTA) ----
  // `requestForegroundPermissionsAsync` shows NO UI when the status is already decided, so this is
  // safe on the already-determined path too: granted+precise → proceed; reduced/denied → the gate.
  const requestAndRoute = useCallback(async () => {
    try {
      const perm = await ensureDrivePermission()
      if (!mountedRef.current) return // navigated away during the dialog — don't setState/subscribe
      // Not granted, OR granted-but-approximate → hand the caller the denial so it routes its gate.
      // The rule (and why reduced counts as a denial) lives in ./location-util, where it is tested.
      const route = routePermission(perm)
      if (route.kind === 'denied') {
        cbRef.current.onDenied(route.denial)
        return
      }
      await cbRef.current.onGranted()
    } catch {
      // requestForegroundPermissionsAsync threw (misconfig / concurrent request) — let the caller
      // show a re-askable gate with a retry instead of letting the tap silently do nothing.
      if (mountedRef.current) cbRef.current.onError()
    }
  }, [])

  // ---- start: prime BEFORE the first (one-shot) OS prompt; request straight through otherwise ----
  const start = useCallback(() => {
    if (pending.current) return // ignore a double-tap while the status read / OS prompt is up (review #4)
    pending.current = true
    void (async () => {
      try {
        // Read the status WITHOUT prompting. First time (undetermined) → show the explainer; its CTA
        // (confirmLocationPrime) fires the real prompt. Already decided → request straight through
        // (no OS UI) so granted rolls and denied/reduced lands on the existing Settings gate.
        const cur = await getDrivePermission()
        if (!mountedRef.current) return
        if (decideStart(cur) === 'prime') {
          setPriming(true)
          return
        }
        await requestAndRoute()
      } catch {
        // The no-prompt status read failed — fall back to requesting directly rather than hanging.
        await requestAndRoute()
      } finally {
        pending.current = false
      }
    })()
  }, [requestAndRoute])

  // ---- the explainer's single CTA: dismiss the prime and fire the OS prompt ----
  const confirmLocationPrime = useCallback(() => {
    setPriming(false)
    if (pending.current) return
    pending.current = true
    void (async () => {
      try {
        await requestAndRoute()
      } finally {
        pending.current = false
      }
    })()
  }, [requestAndRoute])

  return { priming, start, confirmLocationPrime }
}
