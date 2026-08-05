// SIM MODE — a developer toggle that swaps the drive player's real-GPS source for the synthetic
// one, so the whole trigger→play→duck loop is exercisable from the couch: no car, no standing in a
// parking lot spoofing a location.
//
// ⚠ EXACTLY ONE PATH ACTS ON IT — `app/drives/[id]/play.tsx` → `useDrive`, the live drive. (The
// Developer screen reads it too, but only to draw its own switch: that is the writer.) This used to
// say it "swaps every REAL-GPS path in the app", which was true while roam was the second one; roam
// was removed in 1.1, so the live drive is the only GPS path left to swap. The anonymous PREVIEW is
// GPS-less by design, and no generation parameter is involved.
//
// ⚠ It does NOT replay a recorded drive and it does NOT exercise the mapping pipeline (the accuracy
// gate, the iOS -1 sentinels, the projection cursor): `simulatedSource` walks THIS drive's own route
// polyline and emits finished fixes. `voice.settings.developerHint` tells the admin the same thing,
// for the same reason — copy that invites trusting a desk pass more than it deserves is worse than
// no copy. docs/designs/desk-drive-harness.md.
//
// Persisted to secure-store and read at startup (see readStoredSimMode + _layout), exactly
// like the theme mood — so a sim session a tester turned on survives a cold start, and the
// value is known before the drive player can read it (no live→sim flip race on first tap).
//
// Lives behind Settings → Developer, which is admin-only (`isAdmin()`, server-set role) — so the
// toggle is already out of a real rider's reach without a __DEV__ branch or a hidden reveal.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import * as SecureStore from 'expo-secure-store'

const SIM_MODE_KEY = 'skipper.simMode'

/**
 * The default for the one boolean, in ONE expression — the read fallback below, this provider's
 * parameter default, and `_layout`'s pre-hydration fallback all read THIS. There were three copies
 * of `false` before, which is how a default drifts in silence.
 *
 * ⚠ FALSE EVERYWHERE, and `__DEV__` must NOT seed it (founder, 2026-08-05). The real drive is run
 * from a DEV BUILD on a real device, so a `__DEV__` default would silently SIMULATE it — and worse,
 * the admin `TraceRecorder` is gated on `mode === 'live'` (`useDrive.ts`), so the run would also
 * record nothing. That trace is the only copy of a drive that cannot be re-recorded.
 */
export const DEFAULT_SIM_MODE = false

/** Read the persisted sim-mode flag once at startup so the drive player sees the real value on
 *  its first read (no daylight-flash equivalent: no live→sim flip race on first paint).
 *  Falls back to DEFAULT_SIM_MODE. */
export async function readStoredSimMode(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(SIM_MODE_KEY)) === '1'
  } catch {
    return DEFAULT_SIM_MODE
  }
}

interface SimModeContextValue {
  simMode: boolean
  setSimMode: (on: boolean) => void
}

const SimModeContext = createContext<SimModeContextValue | null>(null)

export function SimModeProvider({
  children,
  initialSimMode = DEFAULT_SIM_MODE,
}: {
  children: ReactNode
  initialSimMode?: boolean
}) {
  const [simMode, setSimModeState] = useState<boolean>(initialSimMode)

  // Persist every flip so it survives a cold start. Fire-and-forget: a failed write just
  // means the next launch falls back to OFF, never a crash.
  const setSimMode = useCallback((on: boolean) => {
    setSimModeState(on)
    SecureStore.setItemAsync(SIM_MODE_KEY, on ? '1' : '0').catch(() => {})
  }, [])

  const value = useMemo<SimModeContextValue>(
    () => ({ simMode, setSimMode }),
    [simMode, setSimMode],
  )

  return <SimModeContext.Provider value={value}>{children}</SimModeContext.Provider>
}

export function useSimMode(): SimModeContextValue {
  const ctx = useContext(SimModeContext)
  if (!ctx) throw new Error('useSimMode must be used within <SimModeProvider>')
  return ctx
}
