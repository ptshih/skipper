// The NATIVE half of what the two one-clip preview players share (`useStopPreview`, `useRoutePreview`).
//
// ⚠ THE AUDIO SESSION IS NO LONGER HERE. Taking exclusive focus and handing it back are the SAME
// rule the driving player obeys, and they lived in both places with two copies of the reasoning —
// `./audio-session` owns them now. This module keeps what is genuinely preview-only: the watchdog.
//
// ⚠ WHY THIS IS NOT IN `./preview-util`. That module is deliberately native-free — no react, no
// expo-audio — precisely so the pure decisions run under `bun test`. Everything here needs one or the
// other, so it cannot live there; and leaving it inline in the hooks is what produced the fork that
// module's header documents. Same split, one layer down: preview-util owns the RULES, this owns the
// side effects those rules are useless without.
//
// ⚠ NOTHING HERE IS REACHABLE BY `bun test` (it imports expo-audio, like the hooks). ESLint's
// react-hooks pass is the only tool that reads it — see apps/mobile/CLAUDE.md.

import { useCallback, useRef } from 'react'

/**
 * The PRE-START WATCHDOG both preview surfaces arm when a clip is handed to the player.
 *
 * ⚠ IT IS WHAT MAKES A DEAD CLIP REACH A TERMINAL STATE WITHOUT VENDOR COOPERATION. `replace()` and
 * `play()` both succeed on an expired presign; the 403 arrives asynchronously via `status.error` — IF
 * expo-audio populates it for a remote source at all, which is DEVICE-UNVERIFIED. Until 2026-08-02
 * neither hook even read that, so an expired url left a row highlighted "now playing", silent,
 * forever. A timer needs no cooperation from anyone. `useDrive` has always had one — it is the same
 * clip over the same kind of url.
 *
 * `arm` clears any prior timer first, so a later tap re-arming is always safe; the caller's own
 * "is this still the active clip" guard inside `onStall` is what makes a superseded timer harmless if
 * it fires first.
 */
export function useStartWatchdog(): { arm: (delayMs: number, onStall: () => void) => void; clear: () => void } {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const arm = useCallback(
    (delayMs: number, onStall: () => void) => {
      clear()
      timer.current = setTimeout(() => {
        timer.current = null
        onStall()
      }, delayMs)
    },
    [clear],
  )

  return { arm, clear }
}
