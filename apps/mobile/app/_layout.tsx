import { useEffect, useState } from 'react'
import { Stack, useRouter, type ErrorBoundaryProps } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { SimModeProvider, readStoredSimMode } from '@/lib/sim-mode'
import { ThemeProvider, readStoredThemeMode, useAppFonts, useTheme, type ThemeMode } from '@/theme'
import { fonts } from '@/theme/tokens'
import { HeaderIconButton, StateView, VersionGate, voice } from '@/ui'

// Anchor the stack at the home route so any COLD deep link keeps `index` underneath it —
// otherwise the linked screen is the bottom of the stack, the back chevron hides, and the
// rider is stranded with no way home. (expo-router router-settings.)
export const unstable_settings = { initialRouteName: 'index' }

// App-authored error boundary — expo-router renders this when a screen (or the
// provider/VersionGate layer) throws during render, instead of whiting out the app in
// release with no recovery. `retry` re-mounts the subtree so a transient failure clears.
// expo-router renders this OUTSIDE RootLayout's returned tree, so it has NEITHER our
// ThemeProvider NOR the SafeAreaProvider — and StateView → Screen → useTheme() throws
// without them. We re-establish both here (default 'system' mood) so the boundary renders
// in our themed chrome with semantic tokens instead of cascading into a second crash.
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaProvider>
      <ThemeProvider initialMode="system">
        <StateView
          tone="danger"
          message={error.message || voice.error.generic}
          action={{ label: voice.error.retry, onPress: retry }}
        />
      </ThemeProvider>
    </SafeAreaProvider>
  )
}

// Hold the splash until the Trailhead type system is loaded, so nothing renders
// in a system font first.
SplashScreen.preventAutoHideAsync().catch(() => {})

export default function RootLayout() {
  const [fontsLoaded, fontError] = useAppFonts()
  // Also hold the splash until the persisted mood is read, so a dark-mode rider never
  // sees a frame of daylight before their saved DUSK override applies on cold start.
  const [initialMode, setInitialMode] = useState<ThemeMode | null>(null)
  // Read the persisted sim-mode flag alongside the mood (parallel; splash already held) so
  // roam/drive see the real value on their first read — no live→sim flip race on first tap.
  const [initialSimMode, setInitialSimMode] = useState<boolean | null>(null)

  useEffect(() => {
    readStoredThemeMode().then(setInitialMode)
    readStoredSimMode().then(setInitialSimMode)
  }, [])

  const ready = (fontsLoaded || fontError) && initialMode !== null && initialSimMode !== null

  // Font load FAILED — we still unblock (degrade to the system font beats holding the splash
  // forever), but make the degrade OBSERVABLE rather than silent. (telemetry hook later.)
  useEffect(() => {
    if (fontError) console.warn('[fonts] Trailhead type failed to load — degrading to system font:', fontError)
  }, [fontError])

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {})
  }, [ready])

  if (!ready) return null

  return (
    <SafeAreaProvider>
      <ThemeProvider initialMode={initialMode ?? 'system'}>
        <SimModeProvider initialSimMode={initialSimMode ?? false}>
          <ThemedStack />
        </SimModeProvider>
        {/* Launch-time update gate — floats above the whole navigator. Renders nothing
            unless the server /version floor says this build must nudge or force-update. */}
        <VersionGate />
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
          // One left-chevron back button on every pushed screen — no text label.
          // Render nothing on the root (canGoBack === false) so home stays clean.
          // headerLeft serves Android + iOS<26; on iOS 26 the *Items API below overrides
          // it so we can strip the Liquid Glass capsule (see the comment there).
          headerLeft: ({ canGoBack }) => (canGoBack ? <HeaderBack /> : null),
          // iOS 26 wraps every nav-bar button in a Liquid Glass capsule whose material we
          // can't de-contrast — on the dark DUSK bar it blows out to a glaring bright disc
          // with a washed-out glyph. hidesSharedBackground strips that capsule so we can
          // draw our OWN theme-controlled circle (HeaderIconButton) instead — and it dodges
          // the "double oval" of a self-drawn ring nested inside the native one. `unstable_`
          // = iOS-only + experimental (pinned rn-screens 4.25.2 / expo-router 56.2.9 —
          // re-check names on upgrade); no-op on Android + iOS<26.
          unstable_headerLeftItems: ({ canGoBack }) =>
            canGoBack ? [{ type: 'custom', hidesSharedBackground: true, element: <HeaderBack /> }] : [],
          // No global headerRight: the appearance control no longer rides the chrome on
          // every screen. The mood follows the phone by default (Auto); the explicit
          // Auto/Day/Dusk picker lives on Settings, reached from a gear on the home header.
        }}
      >
        {/* The "Where to?" location picker is a modal sheet (chosen over an inline expand).
            Declared here so it gets the iOS modal presentation/animation. */}
        <Stack.Screen name="regions" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  )
}

// The global back affordance: our own themed circular chip with a left-chevron
// (HeaderIconButton). We strip iOS 26's Liquid Glass capsule (hidesSharedBackground,
// above) and draw this circle ourselves so its contrast is theme-controlled — a subtle
// placard disc in both day and dusk, no dusk blowout.
function HeaderBack() {
  const router = useRouter()
  return <HeaderIconButton name="back" accessibilityLabel="Back" onPress={() => router.back()} />
}
