// Theme context: resolves light/dark from the OS by default, with an in-app
// override so the header "DUSK / DAYLIGHT" toggle can force a mood (the night
// drive is the headline experience, so the toggle is first-class). The override
// is PERSISTED to secure-store so a mood set for a night drive survives a cold
// start — and is read before first paint (see readStoredThemeMode + _layout) so a
// dark car never gets a flash of daylight.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useColorScheme } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { darkTheme, lightTheme, type Theme } from './theme'

export type ThemeMode = 'system' | 'light' | 'dark'

const MODE_KEY = 'skipper.themeMode'
const isMode = (v: string | null): v is ThemeMode =>
  v === 'system' || v === 'light' || v === 'dark'

/** Read the persisted mood once at startup so the splash can be held until it's
 *  known (no daylight flash in a dark car). Falls back to 'system'. */
export async function readStoredThemeMode(): Promise<ThemeMode> {
  try {
    const stored = await SecureStore.getItemAsync(MODE_KEY)
    return isMode(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

interface ThemeContextValue {
  theme: Theme
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  toggle: () => void // flips the *resolved* mood to its opposite
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({
  children,
  initialMode = 'system',
}: {
  children: ReactNode
  initialMode?: ThemeMode
}) {
  const system = useColorScheme() // 'light' | 'dark' | null
  const [mode, setModeState] = useState<ThemeMode>(initialMode)

  // Persist every override so it survives a cold start. Fire-and-forget: a failed
  // write just means the next launch falls back to 'system', never a crash.
  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m)
    SecureStore.setItemAsync(MODE_KEY, m).catch(() => {})
  }, [])

  const value = useMemo<ThemeContextValue>(() => {
    const resolved: 'light' | 'dark' =
      mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode
    const theme = resolved === 'dark' ? darkTheme : lightTheme
    return {
      theme,
      mode,
      setMode,
      toggle: () => setMode(theme.isDark ? 'light' : 'dark'),
    }
  }, [mode, system, setMode])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>')
  return ctx.theme
}

export function useThemeMode() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useThemeMode must be used within <ThemeProvider>')
  return ctx
}
