import { useEffect, useState } from 'react'
import { Stack, useRouter, type ErrorBoundaryProps } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ActionSheetProvider } from '@expo/react-native-action-sheet'
import { AnalyticsProvider, captureError, track } from '@/lib/analytics'
import { useAnonymousMint } from '@/lib/anon-session'
import { sweepOrphanClips } from '@/lib/offline'
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
  // Report the render crash to telemetry. This boundary renders OUTSIDE the provider tree (above),
  // so it must use the module-singleton captureError — a hook would have no PostHog context here.
  useEffect(() => {
    captureError(error, { boundary: 'root' })
  }, [error])
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
  // the drive player sees the real value on its first read — no live→sim flip race on first tap.
  const [initialSimMode, setInitialSimMode] = useState<boolean | null>(null)

  useEffect(() => {
    readStoredThemeMode().then(setInitialMode)
    readStoredSimMode().then(setInitialSimMode)
  }, [])

  const ready = (fontsLoaded || fontError) && initialMode !== null && initialSimMode !== null

  // Font load FAILED — we still unblock (degrade to the system font beats holding the splash
  // forever), but make the degrade OBSERVABLE rather than silent. (telemetry hook later.)
  useEffect(() => {
    if (fontError) {
      console.warn('[fonts] Trailhead type failed to load — degrading to system font:', fontError)
      track('font_load_failed', { message: String(fontError) })
    }
  }, [fontError])

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {})
  }, [ready])

  // Launch-time disk reclamation, deliberately AFTER `ready` so it cannot delay first paint.
  //
  // The shared clip store's orphans. Clip bytes are keyed by SUBJECT and shared across drives, so
  // no per-drive delete may remove one; the sweep is the ONLY path allowed to, and it is a
  // mark-and-sweep re-derived from every saved manifest (fail-closed: an unreadable manifest or an
  // in-flight download frees nothing this pass). ⚠ It must run at LAUNCH and not only after a
  // delete: a drive removed on the SERVER is dropped locally on its 404 without any sweep of its
  // own, so launch is the only pass that ever reclaims its exclusive subjects. Leaving it out
  // strands bytes nothing can find and nothing can free — see the tombstone in `lib/offline.ts`
  // for the case that taught it.
  //
  // (A second reclaim ran here until 2026-08-02, for the deleted roam mode's offline pack. Removed
  // on a founder call: no install ever shipped roam's Save path, so it could never fire.)
  //
  // ⚠ The v4→v5 store MIGRATION is not INVOKED here — it is lazy inside `loadManifest`, where every
  // reader already funnels, so no reader can observe a half-migrated drive. But be clear about what
  // that means in practice: the sweep reads every drive's manifest through that same door, so on the
  // first launch after an update THIS effect is what actually drives the whole re-key, synchronously,
  // for every saved drive. That is deliberate (nothing can read a v4 afterwards) and it is what makes
  // the sweep safe to run in the same breath — but it is a real first-paint cost for a rider with
  // several long drives, and it is UNMEASURED on a device. Do not read "not here" as "not now".
  useEffect(() => {
    if (!ready) return
    sweepOrphanClips()
  }, [ready])

  if (!ready) return null

  return (
    <AnalyticsProvider>
      <SafeAreaProvider>
        <ThemeProvider initialMode={initialMode ?? 'system'}>
          {/* Action sheets (the region picker; the drive ⋯ menu when it moves here). INSIDE
              ThemeProvider because the sheet is themed per call — `useTheme().isDark` picks iOS's
              `userInterfaceStyle` and supplies the Android sheet's own colors. It delegates to the
              real `ActionSheetIOS` on iOS and renders a scrollable sheet on Android, which is why
              it is here at all: `Alert` caps at THREE buttons on Android (RN docs), so a region
              list of any length silently lost rows on that path. */}
          <ActionSheetProvider>
            <SimModeProvider initialSimMode={initialSimMode ?? false}>
              <ThemedStack />
            </SimModeProvider>
          </ActionSheetProvider>
          {/* Launch-time update gate — floats above the whole navigator. Renders nothing
              unless the server /version floor says this build must nudge or force-update. */}
          <VersionGate />
          {/* D16's anonymous mint. Its OWN leaf beside VersionGate — the app-root side-effect slot —
              so a $sessionSignal tick re-renders this and not the navigator. It sits inside the
              `if (!ready)` gate above and that is correct, not a compromise: nothing a rider can do
              in the first frames needs a session (POST /drives/plan sends no cookie at all, /sample
              is anonymous), and the splash is already held for the fonts. */}
          <AnonymousMint />
        </ThemeProvider>
      </SafeAreaProvider>
    </AnalyticsProvider>
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
          // = iOS-only + experimental (pinned rn-screens 4.25.2 / expo-router 56.2.10 —
          // re-check names on upgrade); no-op on Android + iOS<26.
          unstable_headerLeftItems: ({ canGoBack }) =>
            canGoBack ? [{ type: 'custom', hidesSharedBackground: true, element: <HeaderBack /> }] : [],
          // No global headerRight: the appearance control no longer rides the chrome on
          // every screen. The mood follows the phone by default (Auto); the explicit
          // Auto/Day/Dusk picker lives on Settings, reached from a gear on the home header.
        }}
      />
      {/* No explicit <Stack.Screen> children: every screen is file-based (app/*). The old
          "regions" modal picker was removed with the V1 region-filter catalog (429d328). */}
    </>
  )
}

/** Renders nothing. It exists only so the mint's `useSession()` subscription is scoped to a leaf
 *  instead of to RootLayout, whose re-render would drag the whole navigator along for free — but for
 *  nothing. The rule it fires lives in src/lib/anon-session-util.ts; the call is one line up. */
function AnonymousMint() {
  useAnonymousMint()
  return null
}

// The global back affordance: our own themed circular chip with a left-chevron
// (HeaderIconButton). We strip iOS 26's Liquid Glass capsule (hidesSharedBackground,
// above) and draw this circle ourselves so its contrast is theme-controlled — a subtle
// placard disc in both day and dusk, no dusk blowout.
function HeaderBack() {
  const router = useRouter()
  return <HeaderIconButton name="back" accessibilityLabel="Back" onPress={() => router.back()} />
}
