# Native rebuild + verify — SDK 57 & PostHog Stage 2 (turnkey checklist)

> **Status:** guide (2026-07-24) — the ONE build that validates the stack of things stacked up behind a
> native rebuild: Expo SDK 56→57 (RN 0.86) actually running on-device, PostHog Stage 2 native-crash
> capture, and the Create-a-Drive empty-corpus fix. Everything static is already green; this is the human
> pass. **One-time validation** — prune this file once the pass is done (the durable player/GPS/audio
> checks live in `device-verification-runbook.md`, the PostHog specifics in `TODO.md`).

## Why one build clears everything

A native rebuild (`expo prebuild --clean` + EAS) is the shared gate for four queued things — do them in
one sitting: **(1)** SDK 57 / RN 0.86 boots + runs on a device (the big unverified dep bump); **(2)**
PostHog Stage 2 links the native crash module + runs the symbol-upload build phase; **(3)** the
Create-a-Drive empty-corpus copy (Tahoe's corpus is empty = the live state); **(4)** the M1 player / real
GPS / audio confirms that only a device can judge.

## §0 — Pre-build state — DONE FOR YOU (2026-07-24, verified)

No action; this is what's already green so you don't re-derive it:

- ✅ Tree **aligned to SDK 57's current patch set** (`expo install --check` = "up to date"; commit d256bff).
- ✅ `bun run prebuild:ios` exits 0 (Finished prebuild + CocoaPods) WITH the `posthog-react-native/expo`
  plugin in `app.json` and `metro.config.js` wrapped by `getPostHogExpoConfig` (release JS symbolication).
- ✅ `expo config` resolves all plugins; `expo-doctor` 19/20 — the ONLY failure is the known-benign bun
  isolated-linker "duplicate dependencies" check (same versions under hashed store paths; do NOT "fix" it
  by force-hoisting — see `../decisions/` + memory). Ignore it.
- ✅ Root + mobile `bun run check` green.

## §1 — The ONE gate to confirm BEFORE you build

- [ ] **PostHog symbol-upload secrets exist on the EAS project.** Native-crash *symbolication* is uploaded
      by a build phase that authenticates with `POSTHOG_CLI_API_KEY` (the secret `phx_…` key) +
      `POSTHOG_CLI_PROJECT_ID` (`517151`). These are **EAS-secret-only** — NOT in `eas.json` (verified) — so
      confirm they're set for the profile you build: `eas env:list --environment production` (and
      `preview`), or the EAS dashboard. **If missing, the build still succeeds but native crashes arrive
      UN-symbolicated** (raw addresses) — the exact thing Stage 2 exists to fix. Runtime analytics use the
      public `phc_…` key already baked in `eas.json`, so JS analytics work regardless.

## §2 — Cut the build

Signing: Apple team **L24UJYJ5DK** (Manoa, Inc.), bundle **fm.skipper.app**, ASC app **6778946770**
(`eas.json`); full EAS setup in `eas-setup.md`.

- **For the PostHog native-crash test you need a RELEASE build with the upload phase.** A local
  `expo run:ios --device` dev-client links the native module but **skips** the symbol-upload phase, so a
  raw dev build proves the module loads but NOT symbolication. Use an EAS Release profile:
  - [ ] **Fast internal (recommended for verifying):** `cd apps/mobile && eas build --platform ios --profile preview`
        — internal distribution, prod API, no App Store review.
  - [ ] **TestFlight:** `bun run testflight` (= `eas build --profile production --auto-submit`) when you want it on TestFlight.
- **SDK-57 boot smoke only** (no symbolication needed): a local dev build is fine + fastest —
  `cd apps/mobile && EXPO_PUBLIC_API_URL=https://api.skipper.fm bun run ios` (Metro required for a dev build).

## §3 — Verify: the upgrade-specific NEW surface

- [ ] **SDK 57 / RN 0.86 boots clean.** Launch the build. Expect: past the splash to home, no redbox, no
      native link error; talk to the planner on home, open a drive detail, play one clip. Watch-for: any RN 0.86 / new-arch
      regression (the whole app is new-arch now), a missing native module, audio not starting.
- [ ] **PostHog Stage 2 — SYMBOLICATED native crash.** On the **Release** build (§2), force a native crash
      (a deliberate native-fault dev affordance, or the documented test path), reopen the app so the report
      flushes, and confirm a crash with a **symbolicated** stack lands in PostHog project **517151**.
      Watch-for: report arrives but stack is raw addresses → the upload secrets (§1) weren't set for this
      profile. (TODO.md "PostHog telemetry — Stage 2" remaining items; `apps/mobile/src/lib/analytics.tsx`.)
- [ ] **Create-a-Drive empty-corpus (fix 287780d).** Open "Create a Drive" in Tahoe (its curated-Places
      feed is EMPTY until the founder-gated paid `/places` curation run — so this is the live 1.0.0 state).
      Expect: the FROM/TO pickers are **disabled** and a warm line reads *"No curated stops in this region
      yet — check back soon"* — NOT the generic "No matching places" dead-end, and no way to start a drive
      you can't finish. (`apps/mobile/app/create.tsx`.)

## §4 — Verify: the carried-over device confirms (run from the existing runbook — don't re-derive here)

- [ ] **Audio pause+resume** (rider's Spotify/Apple Music pauses for narration, resumes after) —
      `device-verification-runbook.md` §6 (the RESUME is the unverified bit).
- [ ] **Drive-music bed audible UNDER V2 drives** (static trace says it should; needs an ear) — TODO.md
      "Drive music bed — CONFIRM-ON-DEVICE" + runbook §6.
- [ ] **Real GPS in motion + clean teardown** — runbook §7. **This is the M1 climax: the real drive.**
- [ ] **Offline airplane-mode** (download → drive with zero network) — runbook §8.

## §5 — After the build (don't forget)

- [ ] **OTA caveat.** Native crash symbols are fixed at build time. After any `eas update` (OTA JS), run
      `posthog-cli hermes upload --directory dist` or the new JS stack traces won't symbolicate. Wire it into
      a release script only if you use OTA channels. (TODO.md.)

## Refs
`apps/mobile/eas.json` (profiles + baked env) · `apps/mobile/app.json` (config plugins) ·
`apps/mobile/metro.config.js` (PostHog wrap) · `eas-setup.md` (EAS build/install) ·
`device-verification-runbook.md` (§6 audio / §7 GPS / §8 offline) · `../../TODO.md` (PostHog Stage 2/3).
