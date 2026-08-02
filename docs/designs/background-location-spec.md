# Background location — When-In-Use + background updates (screen-off / pocket triggering; NO "Always")

> **Status:** BUILD-READY SPEC — **nothing built.** The deferred half of location-permission priming
> (`../decisions/location-permission-priming.md`). **Empirically gated (founder):** do NOT build until a
> real-device Tahoe drive shows foreground + `expo-keep-awake` triggering is *insufficient* on a
> locked/pocketed phone (see §The gate). Written 2026-07-24; **corrected 2026-07-24** after a source-level
> re-verification of the installed `expo-location` ~57.0.6 that overturned the old "→ Always" framing (see
> §The path is When-In-Use, NOT "Always"). Grounded in the INSTALLED SDK (`expo-location` ~57.0.6, `expo`
> SDK 57) + current Expo docs + Apple CoreLocation docs — re-verify the API against the SDK in place when
> this is picked up.

## Why / the gap

Today the live drive uses a **foreground** `Location.watchPositionAsync` (`apps/mobile/src/lib/gps.ts`
`liveSource`) at `BestForNavigation`. A foreground watch dies when the app leaves the
foreground, so the drive holds the screen awake via `expo-keep-awake` (`useDrive.ts`) — and if the screen
ever locks or the phone pockets, **audio keeps playing but GPS triggering silently stops** (the skipper
goes quiet at the next stop). `useDrive.ts` states it: *"watchPositionAsync is foreground-only."* A
background **TaskManager** task (`startLocationUpdatesAsync`) fixes that: the OS delivers location while
backgrounded, so stops keep firing screen-off — and it does so under **When-In-Use permission ALONE** (no
"Always" prompt; see §The path is When-In-Use, NOT "Always").

A second, related defect the same change fixes: a foreground `watchPositionAsync` **cannot** set
`pausesUpdatesAutomatically` (it defaults `true`), so iOS may power down GPS at a long overlook/stop —
exactly when a stop should fire. That option lives ONLY on the background task API (`LocationTaskOptions`).

## The gate — build ONLY if the real drive proves it's needed

For the MVP posture (phone dashboard-mounted, screen ON, keep-awake active) the foreground watch may be
fully sufficient — background is strictly needed only for a locked/pocketed phone. `gps.ts` already
records the founder condition: *"Verify on a real Tahoe drive; only escalate to background updates (wider
scope, founder OK) if it pauses."* The escalation is a **standard navigation-app review scope** (background
location declared to trigger drive-time audio, guideline 2.5.4) — NOT the heightened *Always* scope, because
this path never requests Always (see below). It is still a scope bump over foreground-only, and introducing
it without empirical justification (or while the first build is in review) invites friction. So: real drive
first → build this only if triggering actually fails backgrounded.

## ⚠ Correction to the old plan (TODO + the decision-doc checklist were stale)

Both previously said *"`allowsBackgroundLocationUpdates: true` on the watch (`gps.ts liveSource`)."*
**There is no such option in expo-location.** `watchPositionAsync(LocationOptions, …)` — `LocationOptions`
carries no background/`activityType`/`pausesUpdatesAutomatically`/`foregroundService` fields. Those live on
`LocationTaskOptions`, the type for **`startLocationUpdatesAsync(taskName, options)`** — the TaskManager
background API. So this is a **transport re-architecture**, not a flag flip.

## The path is When-In-Use, NOT "Always" — the load-bearing correction

The title of this spec used to read "When-In-Use → Always." **That escalation is wrong.** A source-level read
of the installed `expo-location` ~57.0.6 (verified 2026-07-24) shows `startLocationUpdatesAsync` checks
**only foreground / When-In-Use permission** — it never requests "Always." Screen-locked / pocketed delivery
needs exactly three things, none of which is Always:

1. **When-In-Use granted** — the foreground permission the app already primes for today.
2. **The `location` iOS background mode present** — added by flipping the expo-location plugin's
   `isIosBackgroundLocationEnabled: true`. That flag is ALSO why CoreLocation sets
   `allowsBackgroundLocationUpdates` on the task consumer (`EXLocationTaskConsumer.m:52`, unconditional at
   task registration).
3. **A TaskManager task STARTED while the app is in the FOREGROUND** (`startLocationUpdatesAsync`). The
   foreground-start is load-bearing: under When-In-Use, a session started in the foreground keeps delivering
   after the app backgrounds / the screen locks; a session you try to START while already backgrounded FAILS.
   A drive is always begun by an explicit foreground tap, so this is satisfied.

Proof (installed native source — cite these when the SDK is re-verified):
- `startLocationUpdatesAsync` (`node_modules/expo-location/ios/LocationModule.swift:227-244`) checks only
  `ensureForegroundLocationPermissions` + services-enabled + significant-change availability +
  `hasBackgroundModeEnabled("location")`. Its own comment (228-232): a user-initiated foreground service does
  NOT require the background-location permission. Contrast `startGeofencingAsync`
  (`LocationModule.swift:261`), which DOES call `ensureBackgroundLocationPermissions` — proving the
  foreground-only check on updates is deliberate, not an oversight.
- `EXForegroundPermissionRequester.m:40-43` treats BOTH `WhenInUse` and `Always` as Granted → When-In-Use
  satisfies the gate.
- The only path to an Always prompt is `requestBackgroundPermissionsAsync` →
  `EXBackgroundLocationPermissionRequester` → `requestAlwaysAuthorization`
  (`EXBackgroundLocationPermissionRequester.m:35,64`); `startLocationUpdatesAsync` **never** invokes it.
- Apple CoreLocation confirms the runtime contract: with `allowsBackgroundLocationUpdates = true` +
  `UIBackgroundModes` containing `location`, updates STARTED in the foreground "continue even if the app
  subsequently enters the background," and When-In-Use is an accepted authorization for this
  (developer.apple.com `allowsBackgroundLocationUpdates` + `requestWhenInUseAuthorization()`).
- This foreground-only behavior is **intentional and reaffirmed** by expo PR #33617 ("[iOS]
  startLocationUpdatesAsync should not require background permissions"; historical #12594 / #12456) — so it is
  unlikely a future SDK "fixes" it away, but RE-VERIFY on each SDK bump.

⚠ **Docs-vs-code divergence to expect:** the Expo Location *docs* say background location "must be granted
with the `Always` option using `requestBackgroundPermissionsAsync`." The installed *code* does not enforce
that for `startLocationUpdatesAsync`. This spec deliberately relies on the proven, intentional CODE behavior,
not the docs' Always recommendation — because requesting Always here would be a 5.1.1 data-minimization
liability (see §App Store review pre-mortem) for a feature that provably works without it. When-In-Use is the
correct, minimal grant.

**What "Always" would actually buy — and why we don't need it:** Always is required only to (a) START updates
while already backgrounded, or (b) survive app termination and be relaunched by a significant-change /
region-monitoring wake-up. A Skipper drive is foreground-started and runs for the drive's duration with the
phone locked/pocketed — neither (a) nor (b) applies. If the app is force-killed mid-drive, updates stop and
will NOT relaunch it; that is an accepted limitation of the minimal path, not a reason to request Always.

### ⚠ Do NOT declare the `location` background mode — or request Always — without the shipping code path

Two distinct, documented rejection triggers bracket this feature. Ship the config and the code in the SAME
build, never one without the other:

1. **Declaring `location` in `UIBackgroundModes` without a user-facing background-location feature = a
   documented rejection.** Apple, verbatim: *"Your app still declares support for location in the
   UIBackgroundModes key in your Info.plist file but does not have any features that require persistent
   location."* (Guideline 2.5.4 — Performance — Software Requirements). Flipping
   `isIosBackgroundLocationEnabled: true` is what ADDS that key, so it must land in the same build as the
   working `startLocationUpdatesAsync` task — never as a speculative config flip ahead of the code. Expo hit
   exactly this and had to STOP auto-adding the key for task-manager/background-fetch users (expo/expo
   PR #13888: *"if an app uses these packages but does not require persistent location it can lead to App
   Store rejection for apps including the capability without user-facing feature requiring location"*).
2. **Requesting Always (`requestBackgroundPermissionsAsync`) without an Always-only feature = a 5.1.1
   data-minimization liability.** This app has no region-monitoring / significant-change / terminated-relaunch
   feature — the only things Always exists for — so asking for it collects a broader grant than the feature
   needs. Do NOT call `requestBackgroundPermissionsAsync`; do NOT set the Always usage strings. When-In-Use is
   the correct grant.

## Architecture — swap the transport, keep the engine

Replace the foreground `watchPositionAsync` with **one** `startLocationUpdatesAsync` task for the whole live
session (it delivers in BOTH foreground and background — no two-source handoff seam). Keep everything
downstream intact — the accuracy gate, the iOS -1 sentinel, polyline projection (`alongM`), `onEnd`, and the
`stopped`/`paused` guards — by routing the task's batched `locations` through the existing `onLocation`
mapper via a tiny **module-level bridge**:

- A new module (e.g. `apps/mobile/src/lib/gps-bg-task.ts`) defines the task at **top-level module scope** and
  is **imported at app startup** (from `apps/mobile/index.js`, alongside the eager `import 'expo-network'`).
  ⚠ iOS can relaunch the app in the background to deliver location; the task MUST be defined on every JS load,
  or a background relaunch drops fixes. (Same class of trap as the Metro-lazy dynamic-import gotcha.)
  ```ts
  TaskManager.defineTask(LOCATION_TASK_NAME, ({ data, error }) => {
    if (error) { bridge.error(error); return }
    if (data) for (const loc of (data as { locations: Location.LocationObject[] }).locations) bridge.push(loc)
  })
  ```
- `bridge` is a 1-subscriber pub/sub (module singleton): `liveSource`/`liveRoamSource` subscribe their
  existing `onLocation` to it instead of owning a `LocationSubscription`. `stop()` → `stopLocationUpdatesAsync`
  (guard with `hasStartedLocationUpdatesAsync`); `pause()`/`resume()` → the same paused flag as today (or
  stop/restart the task). The batch is iterated in order so per-fix projection is unchanged.
- **When-In-Use IS the target grant (not a degradation):** the same task delivers in foreground AND — once
  started in the foreground — in the background under "While Using" alone; there is no separate Always ask to
  deny. VERIFY on device that a foreground-started task keeps delivering after lock with When-In-Use only.

`startLocationUpdatesAsync` options (a driving session):
`accuracy: BestForNavigation`, `activityType: ActivityType.AutomotiveNavigation` (=2),
`pausesUpdatesAutomatically: false` (kills the overlook auto-pause), `showsBackgroundLocationIndicator: true`
(iOS blue bar — honest + expected by review; note that under When-In-Use the bar is FORCED regardless of this
flag, which only toggles the Always case), `foregroundService: { notificationTitle, notificationBody }`
(Android — a background location service requires it). ⚠ **Leave all `deferredUpdates*` at 0/off** — deferred
batching DELAYS fixes, which defeats speed-adaptive triggering (a car at 60 mph can't wait for a batched
update). Real-time delivery is mandatory here.

## Build checklist

- [ ] **Dep:** `npx expo install expo-task-manager` — **not currently installed** (not in
      `apps/mobile/package.json`). New native module ⇒ part of why a rebuild is required.
- [ ] **Config** (`apps/mobile/app.json`, expo-location plugin): flip **ONLY**
      `isIosBackgroundLocationEnabled: true` (auto-adds `location` to iOS `UIBackgroundModes` — verify the
      prebuilt Info.plist has BOTH `audio` + `location`, and that it ships in the SAME build as the task per
      the rejection warning above). **KEEP `locationAlwaysPermission` and `locationAlwaysAndWhenInUsePermission`
      FALSE / unset** — the Always usage strings must NOT be added (this path never requests Always). Today the
      app already has these false, so `EXBackgroundLocationPermissionRequester` cannot even prompt for Always —
      that is the desired state; do not change it. Android: `isAndroidBackgroundLocationEnabled: true` (adds
      `ACCESS_BACKGROUND_LOCATION`) IF/when Android is targeted; verify the manifest also gets
      `FOREGROUND_SERVICE_LOCATION` (Android 14+) — today it has `FOREGROUND_SERVICE` +
      `FOREGROUND_SERVICE_MEDIA_PLAYBACK` only. iOS is the MVP target; Android can trail (Android background
      location is a heavier review scope — defer it).
- [ ] **Transport** (`gps.ts` + `gps-bg-task.ts`): the task + bridge above; delete the `watchPositionAsync`
      path (or keep it as a fallback only if a device test demands it).
- [ ] **Permission sequence** (`useLocationPriming.ts`): **NO background/Always request.** After foreground
      `onGranted` (When-In-Use) you're done — `startLocationUpdatesAsync` needs only foreground permission. Do
      **NOT** call `Location.requestBackgroundPermissionsAsync()` (that is the Always prompt; see the rejection
      warning). Keep the existing `'locationPrime'` phase / When-In-Use one-shot exactly as built. VERIFY on
      device that a foreground-started task keeps delivering after lock with When-In-Use alone (it should, per
      the source read — confirm). Handle the **"Allow Once" / provisional grant**: an "Allow Once" When-In-Use
      reverts to Not-Determined once the app is no longer in use, so a later drive re-prompts — route a
      not-granted state to the existing reduced/denied Settings gate rather than hanging.
- [ ] **Copy** (`voice.ts`): the current `locationPrimeReassure` — *"Parked, I'm off the clock — no tracking"*
      — is When-In-Use-scoped, which stays CORRECT (this path is When-In-Use only). If anything, extend it to
      be honest that during an active drive stops keep calling with the screen off / phone pocketed (the blue
      indicator is on), and ONLY during a drive. This is a small honesty tweak, NOT an Always-rationale rewrite.
- [ ] **keep-awake:** KEEP `expo-keep-awake` initially (screen-on mounted is still the primary posture;
      background is the safety net). Revisit dropping it only after the drive shows background triggering is
      reliable enough to stand alone.
- [ ] **App Store Review notes:** state background location is used *solely to trigger GPS-anchored audio
      during an active drive*, the rider starts each drive explicitly (foreground-started), the app requests
      **When-In-Use only (never Always)**, and the iOS blue background indicator is on the whole time. The
      privacy manifest already declares `PreciseLocation` for `AppFunctionality` (`app.json`) — no change.
- [ ] **Native rebuild** (dev build / EAS) — new dep + Info.plist/manifest baked at prebuild, not JS runtime.
      Then re-run the device-verification runbook's background/lock case.

## App Store review pre-mortem

Ranked review-rejection / friction risks, and the posture that defuses each:

- **No cold Always, no provisional Always.** The app never calls `requestBackgroundPermissionsAsync`, so it
  never shows an Always prompt (cold or upgraded) and never carries the Always usage strings. Reviewers see a
  standard When-In-Use nav pattern, not a broad always-on tracker — this removes the single biggest 5.1.1 flag.
- **5.1.1 data-minimization.** Requesting only When-In-Use for a feature that provably works on When-In-Use is
  the data-minimization-correct choice; requesting Always for it would be over-collection. Same logic gates the
  `location` UIBackgroundMode: ship it *with* its code path and nothing more (see the rejection warning).
- **iOS 26 "downgrade" nudge.** iOS periodically nudges users toward the most-restrictive location grant and
  surfaces background-location usage; a design that DEPENDS on Always would break the moment a rider accepts
  the nudge to downgrade to When-In-Use. The minimal path is immune — it already lives at When-In-Use, so an OS
  nudge changes nothing. (Re-verify the exact iOS 26 nudge wording/behavior on device; treat as a UX note.)
- **Forced blue bar is a feature, not a bug.** With `allowsBackgroundLocationUpdates` on + When-In-Use, iOS
  FORCES the blue background-location indicator (no opt-out via `showsBackgroundLocationIndicator` in the
  When-In-Use case). That constant, honest disclosure is exactly what a reviewer wants for a drive-time
  triggering feature — lean into it in the review notes rather than trying to suppress it.
- **Declare-mode-without-code = documented rejection.** Covered above (PR #13888 + Apple verbatim). The guard
  is process, not code: never flip the config flag in a build that doesn't also ship the working task.

## Gotchas

- The task callback runs OUTSIDE the React tree — it can't touch component state directly; the bridge is the
  only legal channel. Anything the task needs (the active polyline for projection) must be reachable at module
  scope or passed when the session starts.
- "Allow Once" / provisional When-In-Use: an "Allow Once" grant reverts to Not-Determined once the app is no
  longer in use, so a subsequent drive re-prompts — don't cache the first grant as permanent; re-check
  `getForegroundPermissionsAsync` at each drive start. (We do NOT request Always, so there is no
  upgrade-to-Always system prompt to reason about.)
- Battery: `BestForNavigation` + no deferral is power-hungry by design (correct for an active drive); ensure
  `stopLocationUpdatesAsync` fires on every teardown path (mirror today's `stopped`-guard discipline;
  expo/expo #35925/#35926 — a leaked watch/task keeps draining).

## Sources

**Installed native source (the load-bearing proof that this is When-In-Use, not Always) — re-verify on SDK bump:**
- `apps/mobile/node_modules/expo-location/ios/LocationModule.swift:227-244` — `startLocationUpdatesAsync`
  checks foreground permission only (comment 228-232); `:261` — `startGeofencingAsync` checks background,
  proving the contrast is deliberate.
- `apps/mobile/node_modules/expo-location/ios/LocationUtils.swift:98-108` — `ensureForegroundLocationPermissions`
  vs the separate (unused) `ensureBackgroundLocationPermissions`.
- `.../ios/Requesters/EXForegroundPermissionRequester.m:40-43` — both WhenInUse and Always count as Granted.
- `.../ios/Requesters/EXBackgroundLocationPermissionRequester.m:35,64` — the only `requestAlwaysAuthorization`
  path; never invoked by updates.
- `.../ios/TaskConsumers/EXLocationTaskConsumer.m:52,76-77` — `allowsBackgroundLocationUpdates = YES`
  unconditionally, then `startUpdatingLocation` + `startMonitoringSignificantLocationChanges`.
- `.../plugin/src/withLocation.ts:41-51,217-219` — `isIosBackgroundLocationEnabled` only adds the `location`
  `UIBackgroundMode`; it does NOT set Always or the usage strings.
- `.../build/Location.js:428-431` — JS `startLocationUpdatesAsync` does no permission gating.
- Installed type defs (`Location.d.ts`, `Location.types.d.ts`): `startLocationUpdatesAsync`/
  `LocationTaskOptions`, `requestBackgroundPermissionsAsync`, `LocationActivityType.AutomotiveNavigation`.
- Current-state facts (the app is foreground-only TODAY): `apps/mobile/ios/Skipper/Info.plist` (UIBackgroundModes
  = `[audio]` only — no `location`); `apps/mobile/app.json` (expo-location plugin:
  `isIosBackgroundLocationEnabled: false`, `isAndroidBackgroundLocationEnabled: false`, Always strings false);
  `apps/mobile/package.json` (`expo-location` ~57.0.6, **no** `expo-task-manager`); `apps/mobile/src/lib/gps.ts:156,344`
  (foreground `requestForegroundPermissionsAsync` + `watchPositionAsync` only);
  `apps/mobile/android/app/src/main/AndroidManifest.xml` (COARSE/FINE only, no `ACCESS_BACKGROUND_LOCATION`).

**Apple CoreLocation (the runtime contract for backgrounded delivery under When-In-Use):**
- `developer.apple.com` — `CLLocationManager.allowsBackgroundLocationUpdates` ("Updates continue even if the
  app subsequently enters the background"; a `true` value WITHOUT `UIBackgroundModes` `location` is a fatal
  error that terminates the app), `requestWhenInUseAuthorization()` ("Attempts to start location updates while
  your app runs in the background will fail"), and "Handling location updates in the background" (whenInUse is
  a valid authorization; create the session in the foreground).

**Expo (docs + the intentional-behavior PRs):**
- Expo docs (docs.expo.dev, SDK-latest, read 2026-07-24): TaskManager background-location pattern
  (`TaskManager.defineTask` at module scope). ⚠ The docs RECOMMEND Always (`requestBackgroundPermissionsAsync`)
  — the installed code does not enforce it; this spec follows the code.
- expo/expo PR #33617 ("[iOS] startLocationUpdatesAsync should not require background permissions"; historical
  #12594, #12456) — the foreground-only behavior is intentional.
- expo/expo PR #13888 — removed the auto-added `location` UIBackgroundMode from task-manager/background-fetch
  eject config precisely because declaring it without a user-facing feature "can lead to App Store rejection."
- App Store Review Guideline 2.5.4 — Apple verbatim rejection: *"Your app still declares support for location
  in the UIBackgroundModes key in your Info.plist file but does not have any features that require persistent
  location."* (developer.apple.com forums, e.g. thread/771202).

- `../decisions/location-permission-priming.md` (the When-In-Use half, BUILT + the 5.1.1(iv) constraint),
  `../guides/device-verification-runbook.md` (the on-device gate), `apps/mobile/src/lib/gps.ts` (the current
  foreground transport + the founder escalation condition).
