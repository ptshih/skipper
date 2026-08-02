# Location permission priming (explainer before the OS prompt)

**Status:** ✅ **BUILT 2026-06-13** (When-In-Use priming); **NARROWED and strengthened by 1.1
(2026-08-02).** A pre-permission explainer precedes iOS's one-shot location prompt. It used to guard
two surfaces — the live drive AND free-roam; roam is gone, so `LocationGate` now has exactly ONE
consumer, `app/drives/[id]/play.tsx`. That is a reinforcement, not a retreat: 1.1 makes it an
acceptance criterion that **no location permission is asked until "Let's roll"** — planning a drive,
hearing the sample, and seeing the proposed route are all location-free. The "which mode the rider
hits first" branching below is therefore moot; there is one path. **Phased decision
(founder, 2026-06-13):** ship the explainer in front of the *existing When-In-Use* prompt now
(pure JS/UI, no native rebuild); the **Always/background** escalation is DEFERRED to its own
pass (see §Deferred + `TODO.md`). The explainer copy/architecture is written to survive that
escalation without a rewrite.

## Why

The live drive (and roam) used to fire the iOS location prompt **cold** — no in-app rationale
first. iOS gives exactly **one shot** at that prompt, and a denial is sticky (recovery only via
Settings). A cold ask the rider doesn't understand gets denied, and then the in-car product is
dead until they hunt through Settings. The fix is the standard **pre-permission priming**
pattern: a short, in-character screen explaining *why* the skipper needs location, shown the
moment the rider commits to a drive, whose only action leads straight into the OS prompt.

## Hard constraint — App Store Guideline 5.1.1(iv)

A pre-permission screen **must not** carry a "Not Now"/"Maybe later"/dismiss button. Apple has
rejected apps for exactly this; their verbatim objection: *"The user should always proceed to
the permission request after the message."* (Apple Developer Forums thread 817672, 2025.) So
the priming card has a **single CTA** that invokes the OS prompt. The rider can still abandon
*before* the prompt by navigating back via the nav-bar chevron (a nav-level back, not an
in-content dismiss) — that's pre-prompt abandonment and is allowed.

## How it works (built)

Shown **only when the foreground permission status is `undetermined`** — i.e. exactly when iOS
is actually about to prompt. Already `granted` → drive immediately; already `denied`/`reduced`
→ the existing Settings gate. Net: the explainer appears once, the first time, for whichever
mode (tour drive or roam) the rider hits first; never again.

- `getDrivePermission()` (`apps/mobile/src/lib/gps.ts`) now also returns `undetermined` (a
  no-prompt status read via `getForegroundPermissionsAsync`).
- `useDrive`/`useRoam` `start()`: live mode reads status without prompting → `undetermined`
  sets the new `'locationPrime'` phase; otherwise it requests straight through (no OS UI when
  already decided) and routes to drive or the Settings gate. A `confirmLocationPrime()` CTA
  fires the real `requestForegroundPermissionsAsync()` and re-uses the same post-prompt routing.
- UI: `apps/mobile/src/ui/LocationPrime.tsx` (a "smart" composite like `AccountGate`) — Screen +
  framed Card + a single primary Button, **no dismiss**. Copy: `voice.drive.locationPrime*`.

## Deferred — When-In-Use → background updates (screen-off / pocket triggering; NO "Always")

Not built. Enables screen-off / phone-in-pocket triggering (today foreground location dies on
lock, so the drive keeps the screen awake via `expo-keep-awake`; if the screen ever locks, audio
keeps playing but GPS triggering silently stops). Native + review work, hence its own pass.
**Build-ready detail:
[`../designs/background-location-spec.md`](../designs/background-location-spec.md)**, empirically gated
behind a real-device drive (build only if foreground + `expo-keep-awake` triggering fails
locked/pocketed). Shape: flip the `expo-location` plugin's `isIosBackgroundLocationEnabled: true`
(adds `UIBackgroundModes += location`), swap the foreground `watchPositionAsync` for a
`startLocationUpdatesAsync` + TaskManager task, add App Store review notes, native rebuild.
⚠ CORRECTED 2026-07-24 (source-level re-verification of the installed `expo-location` ~57.0.6): this
path is **When-In-Use ONLY — it does NOT request "Always."** `startLocationUpdatesAsync` checks only
foreground permission (deliberate; expo PR #33617), so KEEP the Always usage strings FALSE and NEVER
call `requestBackgroundPermissionsAsync` — requesting Always would be a 5.1.1 data-minimization
liability. (Two now-dead stale claims: *"`allowsBackgroundLocationUpdates` on the watch"* — no such
option; and *"→ Always escalation"* — the correct grant is When-In-Use.) ⚠ Do NOT declare the
`location` background mode without shipping the task in the SAME build (documented 2.5.4 rejection).
Full proof chain + citations in the spec.
