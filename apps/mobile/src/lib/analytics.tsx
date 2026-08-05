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
//
// ⚠ THAT INERTNESS IS ALSO THE TRAP THIS FILE IS BUILT AROUND. track() is `posthog?.capture(...)`,
// so on a machine with no EXPO_PUBLIC_POSTHOG_KEY a hand-check of "did the event fire?" passes by
// doing nothing, and a missing emitter looks identical to a working one. The only real check is
// whether a call site EXISTS:
//     grep -rn '\btrack(' apps/mobile/app apps/mobile/src | grep -v analytics
// An event in the map below with no line in that output is not instrumented — it is a type.
//
// ⚠ THE PRIVACY CONTRACT IS ENFORCED HERE, IN TYPES AND SDK CONFIG — not in review. Two rules:
//   1. NO identify(), ever. See `personProfiles: 'never'` below for why it is a wire-level ban.
//   2. NO property that could carry a person. See AnalyticsEventProps below, which is the entire
//      vocabulary track() accepts.
// Both are asserted to Apple on the App Privacy label; see docs/guides/app-store-submission.md §8.
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

// ⚠ NOT EXPORTED, and that is the contract, not tidiness. An exported raw client makes the typed
// track() below optional — any file could `posthog.capture('whatever', { text })` and bypass both
// the event map and the identify ban in one line. AnalyticsProvider/captureError/track are the whole
// public surface; if something genuinely needs the client, it belongs in THIS file next to the rules.
const posthog: PostHog | undefined = KEY
  ? new PostHog(KEY, {
      host: HOST,
      // ⚠ THE identify() BAN, ENFORCED AT THE SDK RATHER THAN BY COMMENT. Under 'never' the core
      // client's _requirePersonProcessing gate turns identify / alias / group / groupIdentify /
      // createPersonProfile / setPersonProperties / unsetPersonProperties into logged no-ops, and
      // every captured event carries $process_person_profile:false — so no person profile can be
      // created even by a future call site that ignores the rule. (Verified in the installed
      // @posthog/core source, not from docs.)
      //
      // WHY the ban exists — it is a product invariant, not a privacy nicety. Better Auth's anonymous
      // plugin HARD-DELETES the anonymous user row at link-to-account and mints a fresh user id, so no
      // server-side id survives the signup wall. PostHog's per-device distinct_id is the ONLY spine
      // that spans `wall_shown → signup_completed → drive_created`, which IS the funnel 1.1 exists to
      // measure. An identify() would split that device's history across two people and destroy it.
      //
      // WHY it is also not ours to relax: the App Privacy label already filed with Apple declares
      // Product Interaction "Linked = No", and its Device ID justification reads in so many words that
      // PostHog gets no identify() call anywhere in the app. Adding one falsifies a filed claim.
      // A source-text tripwire in analytics.test.ts fails the build if `.identify(` reappears.
      personProfiles: 'never',
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

// ⚠ THERE IS DELIBERATELY NO posthog.reset() — not at sign-out, not at account deletion (founder
// call). reset() is NOT gated by personProfiles: 'never' (it clears persisted properties directly),
// so it would really work — and what it would really do is wipe the device's distinct_id, i.e. the
// one spine the funnel above runs on. The instinct to add it comes from the 5.1.1(v) erasure promise,
// but that promise is about ACCOUNT data — drives, credit_entries, auth rows — which purgeUserData
// already deletes in `beforeDelete`. With no identify() there is nothing account-scoped in PostHog to
// erase: it holds anonymous per-device counters that were never linked to the account being deleted.
// So a reset() would pay nothing and cost the measurement.

// Tag every event with the build environment so dev noise filters out of the launch dashboards. Dev
// builds report to the same US project ON PURPOSE — it's how you confirm the pipe end-to-end before
// TestFlight. (If dev volume ever gets annoying, gate the client on !__DEV__ instead.)
if (posthog) void posthog.register({ app_env: __DEV__ ? 'development' : 'production' })

/** Report a caught error — e.g. the root render ErrorBoundary, which sits outside the provider tree.
 *  No-op when analytics is unconfigured.
 *  ⚠ `context` is free-form because crash metadata can't be enumerated ahead of the crash — but the
 *  no-person rule spelled out on AnalyticsEventProps applies to it identically. Pass a fixed label
 *  (`{ boundary: 'root' }`), never a caught value that might be a response body or rider input. */
export function captureError(error: unknown, context?: EventProps): void {
  posthog?.captureException(error, context)
}

/** An event that carries no properties. `Record<string, never>` accepts `{}` and nothing else, so
 *  `track('drive_created', { driveId })` is a type error rather than a silent privacy regression. */
type EmptyProps = Record<string, never>

/** Where a rider hit the free-account wall. A CLOSED union on purpose: `source: string` is an open
 *  channel for whatever text happened to be in scope at the call site, which is exactly how prose
 *  leaks into analytics. A new wall surface is a deliberate edit HERE — never a free-form string. */
export type WallSource =
  /** The one tap that spends a credit: `POST /drives` 401'd (home's create card). The funnel's wall. */
  | 'create_drive'
  /** `POST /drives/propose` 401'd. Anonymous today, so this should be unreachable — worth knowing if
   *  it ever fires, because it would mean the preview front door quietly walled itself (INV: never
   *  mount requireAccount on the driveRoutes wildcard). */
  | 'propose'
  /** Opening a saved drive's detail screen without an account. */
  | 'drive_detail'
  /** Pressing play on a saved drive without an account. */
  | 'drive_play'

/** Which clock drove the drive. On every drive-scoped event, never just `drive_started`: the couch
 *  SIMULATOR is a dev/demo path, and one drive event that can't be filtered lets simulated drives
 *  masquerade as real ones on the launch dashboard (`app_env` tags the BUILD, not the clock). */
type DriveMode = 'sim' | 'live'

/** Why a stop resolved to SILENCE — the closed union that is the entire point of `stop_skipped`.
 *  Every hole in the player is silent BY CONSTRUCTION (the watchdog skips a clip with no note; the
 *  rider just drives past a stop hearing nothing), so from the outside every cause looks identical.
 *  Each member below is a DISTINCT branch in useDrive, and the fix for each is a different fix —
 *  collapsing them back into one "skipped" number throws away the only thing worth knowing. */
export type StopSkipReason =
  /** The url map had no clip for this stop. `loadPlayback` deliberately serves a PARTIAL local map
   *  rather than error-walling a rider holding 39 of 40 stops (offline.ts) — this is that gap
   *  actually being driven through, the same one the ready card's missingClipCount warns about
   *  while the rider is still parked. */
  | 'no_audio'
  /** The clip HAD a local file and never produced audio before the pre-start watchdog fired. ONE
   *  pass, not two: playback is disk-only, a file on disk cannot expire, and there is nothing to
   *  re-sign. So this now means only a truncated or undecodable download — "our audio is broken",
   *  never "no network here". */
  | 'load_timeout'
  /** The clip STARTED and then froze mid-telling (call / Siri / a Bluetooth handoff / buffer death)
   *  and the one resume attempt didn't take. The rider heard PART of this stop — a materially
   *  different defect from the two above, which are silence from the first second. */
  | 'stalled_mid_clip'
  /** Never armed at all: the stop's snapped trigger point sat further off the route than
   *  OFF_ROUTE_MAX_M, so beginDrive never handed it to the engine. Silence decided before the
   *  wheels turn, and invisible in every other signal — a stop that never triggers is absent from
   *  firedSeqs exactly like a road not yet reached. */
  | 'off_route'

/** The shape the two per-stop events share, so `fired` and `skipped` stay directly comparable.
 *  ⚠ `stop_index` is the stop's ORDINAL within this drive's own itinerary — NOT a narration id and
 *  not a seq that means anything off this drive. An ordinal describes the drive's SHAPE (were the
 *  holes at the front? did it die after stop 3?); an id names a place. */
type DriveStopProps = {
  mode: DriveMode
  /** Seconds since the drive began. In sim FAST mode this may be compressed 8× along with everything
   *  else — "may" because the in-player speed knob moves that factor mid-drive; `mode` is what tells
   *  you not to read it as wall-clock pacing. */
  elapsed_sec: number
  stop_index: number
  /** The clip's treatment. A CLOSED union with an explicit fallback rather than the wire string:
   *  the manifest's form is `driveClipForm` today, and 'other' is what keeps a future widened wire
   *  value from becoming an open text channel here (the WallSource rule, restated). */
  stop_form: 'story' | 'scenic' | 'break' | 'other'
}

/** THE ANALYTICS VOCABULARY — the founder-approved 1.1 funnel (D31), one entry per event, and the
 *  only properties that may ever be sent. Adding an event or a property is an edit here first.
 *
 *  ⚠ READ BEFORE ADDING A PROPERTY. An analytics property that could carry a person is a privacy-label
 *  violation, not a nit: no rider prose, no message text, no typed input, no place NAME, no
 *  coordinate, no URL (a preview clip url is a presigned R2 url), and no drive id or user id — a
 *  drive id sits beside `drives.user_id` and is therefore joinable to a person server-side. This
 *  client has already had to close exactly that leak once; see sanitizeScreenPath below. Every value
 *  in this map is a number, a boolean, or a closed union — shapes that cannot carry a person.
 *
 *  ⚠ Both of track()'s parameters are typed off this map, deliberately. A name-only union of event
 *  names still lets `track('plan_turn_sent', { text: riderInput })` compile, and that — not the
 *  event name — is where the leak would actually enter. */
type AnalyticsEventProps = {
  /** The planner is genuinely usable (regions loaded, no outage) — the funnel's denominator. GATED on
   *  readiness rather than on mount on purpose: a rider staring at the offline/outage card never had
   *  a planner, and counting them as the denominator makes every downstream rate look worse than it
   *  is while hiding the outage itself. */
  planner_ready: EmptyProps
  /** One rider turn sent to `POST /drives/plan`. `turn_index` is the rider's turn ORDINAL — a count
   *  of turns, never a syllable of what was typed — and it is what turns "riders who planned" into a
   *  drop-off curve. `retry` marks a resend of the same turn after a transport failure, so a flaky
   *  network doesn't read as rider persistence. */
  plan_turn_sent: { turn_index: number; retry: boolean }
  /** A materialized route came back from `POST /drives/propose` and is on screen — the beat where a
   *  rider first sees their own drive. `has_clip` tracks whether the one presigned preview clip was
   *  offered, which is the anonymous front door's whole bet.
   *  ⚠ `stop_count` PRESERVES null. The server's `estStopCount` is nullish-able and null means
   *  UNKNOWN, not zero; collapsing it to 0 would inflate the "quiet road" rate that drive selection
   *  gets tuned against. The screen already guards this with a strict `=== 0` — keep the pair honest. */
  proposal_shown: {
    stop_count: number | null
    duration_min: number
    round_trip: boolean
    has_clip: boolean
  }
  /** The ONE presigned preview clip from the rider's OWN proposed route. Deliberately distinct from
   *  sample_played: this answers "did their drive land", the sample answers "did the voice land". */
  preview_clip_played: { completed: boolean }
  /** `GET /sample` — the curated postcard, a SEPARATE surface from the route preview clip above.
   *  ⚠ It carried an `autoplay` boolean until 2026-08-04, when the postcard became the first screen of
   *  ONBOARDING and stopped auto-starting (it takes exclusive `doNotMix` focus, so autoplaying at it
   *  would stop a stranger's podcast as the app's opening move). Every play is now a deliberate tap, so
   *  the field could only ever report `false` — and a property with one possible value is noise that
   *  reads like a signal. The rate this event exists to produce is now simply: of the installs that saw
   *  onboarding, how many pressed play, and how many heard it out. */
  sample_played: { completed: boolean }
  /** The free-account wall was shown. Numerator of the funnel's single most important rate. */
  wall_shown: { source: WallSource }
  /** A NEW account was created. ⚠ Sign-UP only — never fire this for an existing-account sign-in. The
   *  wall's conversion rate is the number this funnel exists to produce, and a returning rider is not
   *  a conversion; mixing them in makes the wall look like it works. */
  signup_completed: EmptyProps
  /** `POST /drives` succeeded — the credit is spent and is never refunded.
   *  ⚠ No driveId, deliberately: it is joinable to `drives.user_id`. */
  drive_created: EmptyProps
  /** Playback started. `sim` vs `live` because the simulator is a dev/demo path, and folding it into
   *  the same number would let simulated drives masquerade as real ones on the launch dashboard. */
  drive_started: { mode: DriveMode }
  /** A stop's audio ACTUALLY BEGAN — the drive's heartbeat, and the denominator every skip rate is
   *  read against. Emitted on the FRESHNESS edge (the clock advanced past the clip's head), never on
   *  expo-audio's `playing`, which flips on the play() INTENT while a stream buffers forever: that
   *  number would count stops the rider never heard, which is the failure this whole event set
   *  exists to make visible. A rider-tapped REPLAY is deliberately not one of these — it is the same
   *  stop being re-heard, and counting it would inflate the heartbeat with rewinds. */
  stop_fired: DriveStopProps
  /** A stop resolved to SILENCE. THE reason this instrumentation was built: the funnel ended at
   *  `drive_started`, so the one thing a drive could do wrong — quietly skip the stops it exists to
   *  play — produced no signal at all, on either side of the wire. */
  stop_skipped: DriveStopProps & { reason: StopSkipReason }
  /** The drive reached the end of its road (the fix source ran out AND the fire-queue drained).
   *  ⚠ NOT a rider "Pull over" / back-out: that is an ABANDON, and folding it in here would make
   *  the number that says "the bet works" unable to tell finishing from quitting.
   *  `stops_played + stops_skipped` against `stops_total` leaves a remainder — stops that never
   *  triggered at all, which is a trigger/route signal rather than an audio one. */
  drive_completed: {
    mode: DriveMode
    elapsed_sec: number
    stops_total: number
    stops_played: number
    stops_skipped: number
  }
  /** Trailhead type failed to load and the app degraded to the system font. Predates the 1.1 funnel.
   *  `message` is `String(fontError)` — an SDK/asset error, never rider input. */
  font_load_failed: { message: string }
}

/** Every event name the app may emit. */
export type AnalyticsEvent = keyof AnalyticsEventProps

/** Fire a product-analytics event. No-op when unconfigured.
 *  ⚠ `properties` is REQUIRED even for the no-property events (`track('drive_created', {})`). An
 *  optional second parameter would let `track('proposal_shown')` compile — a half-instrumented event
 *  that reports nothing and looks instrumented, which is the failure mode this whole file guards.
 *
 *  ⚠ TOTAL — IT CANNOT THROW, AND THAT IS A PRODUCT GUARANTEE, NOT TIDINESS. The optional chain only
 *  covers an ABSENT client; `capture` itself throwing would propagate into whatever branch emitted.
 *  Since the drive events (`stop_fired`/`stop_skipped`/`drive_completed`) fire from inside the audio
 *  path — `stop_skipped` sits immediately BEFORE the `onClipDone` that advances the drive — a throw
 *  here would stall a rider at a silent stop, i.e. telemetry causing the exact failure it exists to
 *  measure, in a dead zone, with the stall watchdog's own note saying nothing. Analytics may never be
 *  load-bearing for playback. Swallowed silently on purpose: there is no rider-facing remedy for a
 *  dropped metric, and INV-13 forbids logging the payload. */
export function track<E extends AnalyticsEvent>(
  event: E,
  properties: AnalyticsEventProps[E],
): void {
  try {
    posthog?.capture(event, properties)
  } catch {}
}

// expo-router runs on react-navigation v7, whose container PostHog's `captureScreens` can't auto-hook
// (the SDK docs say to disable it and send screens from the route path instead). This does exactly
// that — one $screen event per path change.

/** Collapse the ids out of a RESOLVED route path so `$screen` is a route SHAPE, not a record locator.
 *  `usePathname()` returns the resolved path, so `/drives/<uuid>` shipped a real `drives.id` — joinable
 *  to `drives.user_id` server-side, which quietly contradicts both the "not linked to your account"
 *  line in the privacy policy and the `ProductInteraction: Linked = No` row on the App Privacy label.
 *  Grouping by screen was always the analytic intent; the id was never wanted. */
export function sanitizeScreenPath(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)
        ? ':id'
        : /^\d+$/.test(seg)
          ? ':n'
          : seg,
    )
    .join('/')
}

function ScreenTracker(): null {
  const pathname = usePathname()
  useEffect(() => {
    if (pathname) void posthog?.screen(sanitizeScreenPath(pathname))
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
