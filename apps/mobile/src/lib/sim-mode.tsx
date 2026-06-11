// SIM MODE — a developer toggle that swaps every REAL-GPS path in the app for the
// simulated drive source. When ON: free-roam (`useRoam`) and the tour drive player
// (`useDrive`) replay a recorded Tahoe drive through the SAME engines a real car would
// feed, so the whole trigger→play→duck loop is exercisable from the couch — no car, no
// standing in a parking lot spoofing a location. It does NOT touch the anonymous PREVIEW
// drive (that's already GPS-less by design) or any generation parameter.
//
// Persisted to secure-store and read at startup (see readStoredSimMode + _layout), exactly
// like the theme mood — so a sim session a tester turned on survives a cold start, and the
// value is known before roam/drive can read it (no live→sim flip race on first tap).
//
// showDiag is a companion developer flag (Settings → Developer) that makes the roam
// diagnostics line visible on TestFlight-live field drives — same UI family, but NOT
// read at startup (no GPS-source race; a brief flash of hidden→shown is acceptable).
//
// Lives behind Settings → Developer. Safe to ship visible today (zero real users); gate on
// __DEV__ or a hidden reveal before GA if it ever needs hiding from real riders.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import * as SecureStore from 'expo-secure-store'

const SIM_MODE_KEY = 'skipper.simMode'
const SHOW_DIAG_KEY = 'skipper.showDiag'

/** Read the persisted sim-mode flag once at startup so roam/drive see the real value on
 *  their first read (no daylight-flash equivalent: no live→sim flip race on first paint).
 *  Falls back to OFF. */
export async function readStoredSimMode(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(SIM_MODE_KEY)) === '1'
  } catch {
    return false
  }
}

interface SimModeContextValue {
  simMode: boolean
  setSimMode: (on: boolean) => void
  showDiag: boolean
  setShowDiag: (on: boolean) => void
}

const SimModeContext = createContext<SimModeContextValue | null>(null)

export function SimModeProvider({
  children,
  initialSimMode = false,
}: {
  children: ReactNode
  initialSimMode?: boolean
}) {
  const [simMode, setSimModeState] = useState<boolean>(initialSimMode)
  // showDiag doesn't block the splash (no GPS-source race); read from store on mount.
  const [showDiag, setShowDiagState] = useState<boolean>(false)

  useEffect(() => {
    SecureStore.getItemAsync(SHOW_DIAG_KEY)
      .then((v) => setShowDiagState(v === '1'))
      .catch(() => {})
  }, [])

  // Persist every flip so it survives a cold start. Fire-and-forget: a failed write just
  // means the next launch falls back to OFF, never a crash.
  const setSimMode = useCallback((on: boolean) => {
    setSimModeState(on)
    SecureStore.setItemAsync(SIM_MODE_KEY, on ? '1' : '0').catch(() => {})
  }, [])

  const setShowDiag = useCallback((on: boolean) => {
    setShowDiagState(on)
    SecureStore.setItemAsync(SHOW_DIAG_KEY, on ? '1' : '0').catch(() => {})
  }, [])

  const value = useMemo<SimModeContextValue>(
    () => ({ simMode, setSimMode, showDiag, setShowDiag }),
    [simMode, setSimMode, showDiag, setShowDiag],
  )

  return <SimModeContext.Provider value={value}>{children}</SimModeContext.Provider>
}

export function useSimMode(): SimModeContextValue {
  const ctx = useContext(SimModeContext)
  if (!ctx) throw new Error('useSimMode must be used within <SimModeProvider>')
  return ctx
}
