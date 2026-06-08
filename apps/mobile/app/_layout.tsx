import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ThemeProvider, readStoredThemeMode, useAppFonts, useTheme, type ThemeMode } from '@/theme'
import { fonts } from '@/theme/tokens'
import { ThemeToggle } from '@/ui'

// Hold the splash until the Trailhead type system is loaded, so nothing renders
// in a system font first.
SplashScreen.preventAutoHideAsync().catch(() => {})

export default function RootLayout() {
  const [fontsLoaded, fontError] = useAppFonts()
  // Also hold the splash until the persisted mood is read, so a dark-mode rider never
  // sees a frame of daylight before their saved DUSK override applies on cold start.
  const [initialMode, setInitialMode] = useState<ThemeMode | null>(null)

  useEffect(() => {
    readStoredThemeMode().then(setInitialMode)
  }, [])

  const ready = (fontsLoaded || fontError) && initialMode !== null

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {})
  }, [ready])

  if (!ready) return null

  return (
    <SafeAreaProvider>
      <ThemeProvider initialMode={initialMode ?? 'system'}>
        <ThemedStack />
      </ThemeProvider>
    </SafeAreaProvider>
  )
}

// Stack chrome reads from the theme so native headers match the paper/dusk surface.
function ThemedStack() {
  const theme = useTheme()
  const { colors } = theme
  return (
    <>
      <StatusBar style={theme.statusBar} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontFamily: fonts.bodyBold, color: colors.ink },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.surface },
          // Dusk/Daylight toggle reachable on every screen (night drives need it most)
          headerRight: () => <ThemeToggle />,
        }}
      />
    </>
  )
}
