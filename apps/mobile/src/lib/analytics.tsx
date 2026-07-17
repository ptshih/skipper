// PostHog wiring — product analytics + crash telemetry (JS-level AND native). Closes two audit gaps
// at once: zero analytics + zero crash telemetry.
//
// Coverage:
//   • JS crashes — uncaught exceptions + unhandled rejections, captured with no native module.
//   • NATIVE crashes (the app killed by a native fault) — via @posthog/react-native-plugin +
//     `errorTracking.autocapture.nativeCrashes` below + the `posthog-react-native/expo` config plugin
//     (app.json) that uploads iOS dSYMs / source maps at build time so reports are symbolicated. That
//     build-time upload authenticates via EAS env vars POSTHOG_CLI_API_KEY (a SECRET personal key) +
//     POSTHOG_CLI_PROJECT_ID (517151) — set on the EAS project, never committed. Requires a NATIVE
//     REBUILD to link, and symbolication only validates against a RELEASE build (the dev client
//     doesn't run the upload phase). See TODO.md "PostHog telemetry".
//   • Session replay — a native module + a recording-privacy call; still DEFERRED (Stage 3, TODO.md).
//
// The client is a MODULE SINGLETON (not only the usePostHog hook) deliberately: expo-router renders
// its ErrorBoundary OUTSIDE the provider tree (see app/_layout.tsx's comment), so a render crash can
// only be reported through a plain function — captureError() — never a hook. Env-gated: with no key
// the whole thing is inert (undefined client, no-op helpers), so a machine without the key tracks
// nothing and never throws.
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { usePathname } from 'expo-router'
import { PostHog, PostHogProvider } from 'posthog-react-native'

// The exact JSON-safe properties shape the SDK accepts, derived FROM the client so we never import
// @posthog/core's internal JsonType directly (a value import of a transitive dep would trip the
// isolated linker's phantom-dep check; deriving keeps it type-only).
type EventProps = Parameters<PostHog['capture']>[1]

const KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY
// US vs EU is a data-residency choice fixed at project creation; ours lives in US, the SDK default.
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'

export const posthog: PostHog | undefined = KEY
  ? new PostHog(KEY, {
      host: HOST,
      // Crash capture. `uncaughtExceptions` hooks ErrorUtils.setGlobalHandler and `unhandledRejections`
      // the rejection tracker (both JS-level, no native module). `nativeCrashes` forwards app-killed
      // native faults through @posthog/react-native-plugin — a no-op until a native rebuild links it.
      // `console:false` keeps our own console.warn/error degradations (font fallback, audio hiccups)
      // from each becoming a phantom "exception"; we want crashes, not log lines.
      errorTracking: {
        autocapture: {
          uncaughtExceptions: true,
          unhandledRejections: true,
          console: false,
          nativeCrashes: true,
        },
      },
    })
  : undefined

// Tag every event with the build environment so dev noise filters out of the launch dashboards. Dev
// builds report to the same US project ON PURPOSE — it's how you confirm the pipe end-to-end before
// TestFlight. (If dev volume ever gets annoying, gate the client on !__DEV__ instead.)
if (posthog) void posthog.register({ app_env: __DEV__ ? 'development' : 'production' })

/** Report a caught error — e.g. the root render ErrorBoundary, which sits outside the provider tree.
 *  No-op when analytics is unconfigured. */
export function captureError(error: unknown, context?: EventProps): void {
  posthog?.captureException(error, context)
}

/** Fire a product-analytics event. No-op when unconfigured. */
export function track(event: string, properties?: EventProps): void {
  posthog?.capture(event, properties)
}

// expo-router runs on react-navigation v7, whose container PostHog's `captureScreens` can't auto-hook
// (the SDK docs say to disable it and send screens from the route path instead). This does exactly
// that — one $screen event per path change.
function ScreenTracker(): null {
  const pathname = usePathname()
  useEffect(() => {
    if (pathname) void posthog?.screen(pathname)
  }, [pathname])
  return null
}

/** Wraps the app in the PostHog context (+ manual screen tracking). A pure passthrough when analytics
 *  is unconfigured, so the tree renders identically with or without a key. `flex:1` so the provider's
 *  wrapper View fills — layout value, not a themed token. */
export function AnalyticsProvider({ children }: { children: ReactNode }) {
  if (!posthog) return <>{children}</>
  return (
    <PostHogProvider
      client={posthog}
      autocapture={{ captureScreens: false, captureTouches: false }}
      style={{ flex: 1 }}
    >
      <ScreenTracker />
      {children}
    </PostHogProvider>
  )
}
