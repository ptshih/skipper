import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ThemeProvider, useAppFonts, useTheme } from '@/theme'
import { fonts } from '@/theme/tokens'
import { ThemeToggle } from '@/ui'

// Hold the splash until the Trailhead type system is loaded, so nothing renders
// in a system font first.
SplashScreen.preventAutoHideAsync().catch(() => {})

export default function RootLayout() {
  const [fontsLoaded, fontError] = useAppFonts()

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {})
  }, [fontsLoaded, fontError])

  if (!fontsLoaded && !fontError) return null

  return (
    <SafeAreaProvider>
      <ThemeProvider>
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
