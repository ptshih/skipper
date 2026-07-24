# Background location — When-In-Use → Always (screen-off / pocket triggering)

> **Status:** BUILD-READY SPEC — **nothing built.** The deferred half of location-permission priming
> (`../decisions/location-permission-priming.md`). **Empirically gated (founder):** do NOT build until a
> real-device Tahoe drive shows foreground + `expo-keep-awake` triggering is *insufficient* on a
> locked/pocketed phone (see §The gate). Written 2026-07-24; grounded in the INSTALLED SDK
> (`expo-location` ~57.0.6, `expo` SDK 57) + current Expo docs — re-verify the API against the SDK in
> place when this is picked up.

## Why / the gap

Today the live drive + roam use a **foreground** `Location.watchPositionAsync` (`apps/mobile/src/lib/gps.ts`
`liveSource`/`liveRoamSource`) at `BestForNavigation`. A foreground watch dies when the app leaves the
foreground, so the drive holds the screen awake via `expo-keep-awake` (`useDrive.ts`) — and if the screen
ever locks or the phone pockets, **audio keeps playing but GPS triggering silently stops** (the skipper
goes quiet at the next stop). `useDrive.ts` states it: *"watchPositionAsync is foreground-only."* Always +
a background task fixes that: the OS delivers location while backgrounded, so stops keep firing screen-off.

A second, related defect the same change fixes: a foreground `watchPositionAsync` **cannot** set
`pausesUpdatesAutomatically` (it defaults `true`), so iOS may power down GPS at a long overlook/stop —
exactly when a stop should fire. That option lives ONLY on the background task API (`LocationTaskOptions`).

## The gate — build ONLY if the real drive proves it's needed

For the MVP posture (phone dashboard-mounted, screen ON, keep-awake active) the foreground watch may be
fully sufficient — background is strictly needed only for a locked/pocketed phone. `gps.ts` already
records the founder condition: *"Verify on a real Tahoe drive; only escalate to background updates (wider
scope, founder OK) if it pauses."* Always/background is a **heightened App Store review scope**; introducing
it without empirical justification (and while the first build is in review) invites friction. So: real drive
first → build this only if triggering actually fails backgrounded.

## ⚠ Correction to the old plan (TODO + the decision-doc checklist were stale)

Both previously said *"`allowsBackgroundLocationUpdates: true` on the watch (`gps.ts liveSource`)."*
**There is no such option in expo-location.** `watchPositionAsync(LocationOptions, …)` — `LocationOptions`
carries no background/`activityType`/`pausesUpdatesAutomatically`/`foregroundService` fields. Those live on
`LocationTaskOptions`, the type for **`startLocationUpdatesAsync(taskName, options)`** — the TaskManager
background API. So this is a **transport re-architecture**, not a flag flip.

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
- **Graceful degradation:** a rider who grants only "While Using" (denies Always) still gets foreground
  delivery from the same task → no worse than today. VERIFY on device that a foreground-only task delivers
  with When-In-Use alone.

`startLocationUpdatesAsync` options (a driving session):
`accuracy: BestForNavigation`, `activityType: ActivityType.AutomotiveNavigation` (=2),
`pausesUpdatesAutomatically: false` (kills the overlook auto-pause), `showsBackgroundLocationIndicator: true`
(iOS blue bar — honest + expected by review), `foregroundService: { notificationTitle, notificationBody }`
(Android — a background location service requires it). ⚠ **Leave all `deferredUpdates*` at 0/off** — deferred
batching DELAYS fixes, which defeats speed-adaptive triggering (a car at 60 mph can't wait for a batched
update). Real-time delivery is mandatory here.

## Build checklist

- [ ] **Dep:** `npx expo install expo-task-manager` — **not currently installed** (not in
      `apps/mobile/package.json`). New native module ⇒ part of why a rebuild is required.
- [ ] **Config** (`apps/mobile/app.json`, expo-location plugin): `isIosBackgroundLocationEnabled: true`
      (auto-adds `location` to iOS `UIBackgroundModes` — verify the prebuilt Info.plist has BOTH `audio` +
      `location`) + `locationAlwaysAndWhenInUsePermission: "<skipper Always string>"`. Android:
      `isAndroidBackgroundLocationEnabled: true` (adds `ACCESS_BACKGROUND_LOCATION`); verify the manifest
      also gets `FOREGROUND_SERVICE_LOCATION` (Android 14+) — today it has `FOREGROUND_SERVICE` +
      `FOREGROUND_SERVICE_MEDIA_PLAYBACK` only. iOS is the MVP target; Android can trail.
- [ ] **Transport** (`gps.ts` + `gps-bg-task.ts`): the task + bridge above; delete the `watchPositionAsync`
      path (or keep it as a fallback only if a device test demands it).
- [ ] **Permission sequence** (`useLocationPriming.ts`): after foreground `onGranted`, call
      `Location.requestBackgroundPermissionsAsync()` (you CANNOT ask for Always cold — foreground first, per
      the canonical Expo flow). Handle the **"Allow Once" / silent-fail**: a same-session background request
      can return denied with NO prompt (and on Android 11+ it opens system Settings) → route to the existing
      reduced/denied Settings gate rather than hanging. Reuse the `'locationPrime'` phase.
- [ ] **Copy** (`voice.ts`): the current `locationPrimeReassure` — *"Parked, I'm off the clock — no tracking"*
      — is When-In-Use-scoped. Rewrite for Always: honest that stops keep calling with the screen off /
      phone pocketed, and ONLY during an active drive. Keep the universal base; this is an Always-rationale
      rewrite, not reuse.
- [ ] **keep-awake:** KEEP `expo-keep-awake` initially (screen-on mounted is still the primary posture;
      background is the safety net). Revisit dropping it only after the drive shows background triggering is
      reliable enough to stand alone.
- [ ] **App Store Review notes:** state background location is used *solely to trigger GPS-anchored audio
      during an active drive*, the rider starts each drive explicitly, and the iOS background indicator is on.
      The privacy manifest already declares `PreciseLocation` for `AppFunctionality` (`app.json`) — no change.
- [ ] **Native rebuild** (dev build / EAS) — new dep + Info.plist/manifest baked at prebuild, not JS runtime.
      Then re-run the device-verification runbook's background/lock case.

## Gotchas

- The task callback runs OUTSIDE the React tree — it can't touch component state directly; the bridge is the
  only legal channel. Anything the task needs (the active polyline for projection) must be reachable at module
  scope or passed when the session starts.
- iOS "provisional Always": iOS often grants When-In-Use first and later shows its own system upgrade-to-Always
  prompt after real background use — don't treat the immediate background-request result as final.
- Battery: `BestForNavigation` + no deferral is power-hungry by design (correct for an active drive); ensure
  `stopLocationUpdatesAsync` fires on every teardown path (mirror today's `stopped`-guard discipline;
  expo/expo #35925/#35926 — a leaked watch/task keeps draining).

## Sources

- Installed `apps/mobile/node_modules/expo-location@57.0.6` type defs (`Location.d.ts`,
  `Location.types.d.ts`): `startLocationUpdatesAsync`/`LocationTaskOptions`,
  `requestBackgroundPermissionsAsync`, `LocationActivityType.AutomotiveNavigation`.
- Expo docs (docs.expo.dev, SDK-latest, read 2026-07-24): TaskManager background-location pattern
  (`TaskManager.defineTask` at module scope; foreground→background permission order; Android 11+
  `requestBackgroundPermissionsAsync` opens Settings).
- `../decisions/location-permission-priming.md` (the When-In-Use half, BUILT + the 5.1.1(iv) constraint),
  `../guides/device-verification-runbook.md` (the on-device gate), `apps/mobile/src/lib/gps.ts` (the current
  foreground transport + the founder escalation condition).
