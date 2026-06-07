// Theme context: resolves light/dark from the OS by default, with an in-app
// override so the header "DUSK / DAYLIGHT" toggle can force a mood (the night
// drive is the headline experience, so the toggle is first-class). The override
// is in-memory for v1; persisting it to secure-store is a trivial follow-up.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import { darkTheme, lightTheme, type Theme } from './theme'

export type ThemeMode = 'system' | 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  toggle: () => void // flips the *resolved* mood to its opposite
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme() // 'light' | 'dark' | null
  const [mode, setMode] = useState<ThemeMode>('system')

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
  }, [mode, system])

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
