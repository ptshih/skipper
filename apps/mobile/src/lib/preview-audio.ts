// The NATIVE half of what the two one-clip preview players share (`useStopPreview`, `useRoutePreview`).
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
import { setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio'

/**
 * Take EXCLUSIVE audio focus for a pre-drive preview clip, foreground-only.
 *
 * ⚠ D35 (1.1, founder): pre-drive skipper audio takes exclusive focus exactly like a drive — the
 * skipper never talks over the rider's own music, on ANY surface. Both hooks argued the OPPOSITE
 * ("a couch preview is POLITE… mixWithOthers") until 1.1 step 8. Do not soften it back:
 * docs/decisions/drive-audio-exclusive-focus.md scoped itself to the DRIVING player and therefore
 * never settled these surfaces, and its rationale (the drive supplies its own curated soundtrack, so
 * there is nothing of the rider's left to duck) does not transfer to a single clip with no bed under
 * it. That doc is now amended to cover every surface the skipper speaks on; CLAUDE.md's "In-car
 * player landmines" audio line is the authority.
 *
 * ⚠ CALL THIS ON EVERY play(), NOT ONCE ON MOUNT, and do not delete the re-assert as redundant now
 * that both modes agree. It is no longer undoing a drive's `doNotMix` — it is undoing the drive's
 * `shouldPlayInBackground: true`, which `useDrive` sets PROCESS-WIDE from a screen that PUSHES over a
 * still-mounted preview surface. Drop the re-assert and a preview clip keeps talking after the rider
 * leaves the app. `setAudioModeAsync` is process-wide and LAST WRITER WINS, which is also why a
 * mount-only reset is not enough.
 *
 * ⚠ Module-level, not a `useCallback` — it closes over nothing, so a stable identity is free and it
 * does not belong in any dependency array.
 */
export function applyPreviewAudioMode(): void {
  setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    interruptionMode: 'doNotMix',
  }).catch(() => {})
}

/**
 * Hand the audio session back to whatever the rider was playing.
 *
 * ⚠ THE OBLIGATION THAT PAIRS WITH `applyPreviewAudioMode`. Under `doNotMix` a clip that ends, fails,
 * or is dismissed has STOPPED the rider's own music; without this they are left staring at a screen
 * with nothing playing and no control that restarts it. A clip that failed took the session just as
 * surely as one that played, which is why the failure paths call it too.
 *
 * Always fire-and-forget: a rejection here is never worth surfacing over whatever already went wrong.
 */
export function releasePreviewAudioSession(): void {
  void setIsAudioActiveAsync(false).catch(() => {})
}

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
