# @skipper/mobile — Expo app (backend wiring scaffolded; phone player TODO, CarPlay deferred)

> **Status:** the JS/TS app is scaffolded and wired to the M2 backend (browse,
> auth, gated tour fetch), and a **map-less couch preview player** (simulated
> drive over `expo-audio`) is the `?mode=preview` branch of `app/drive/[id].tsx`
> (the unified player; the standalone `app/preview/[id].tsx` was folded in). A local iOS
> **simulator build compiles** (`xcodebuild` succeeds with `expo-audio` linked),
> but there is **no EAS build, no device run, and no LIVE GPS-triggered phone
> player yet** — that work (offline download, on-device triggering, lock-screen
> Now Playing, a real drive) is the M1 phone player still TODO below. **CarPlay is
> deferred past the MVP — no longer a hard gate**; the MVP plays through the phone
> (mount / Bluetooth), and the phone player's EAS build is what decides the SDK pin.
> Version pins below are **candidates** (SDK 56); reconcile them with
> `bunx expo install --fix` when you materialize the app.

## What's wired (works against the M2 API)

- **Expo Router** app (`app/`): corridor browse (`index`), corridor detail
  (`corridor/[id]`), `sign-in` (email/password), `tour/[id]` (gated fetch +
  presign), and a working **couch preview player** (`drive/[id]?mode=preview`).
- **Auth:** Better Auth Expo client (`src/lib/auth.ts`) — sessions in
  `expo-secure-store`, scheme `skipper` (matches the server `trustedOrigins` and
  the `expo()` server plugin in `apps/api/src/auth.ts`).
- **API client:** `src/lib/api.ts` — typed against `@skipper/shared` DTOs
  (`corridorList`/`tourDetail`/`signedAudio`); auth via `authClient.getCookie()`.
- **Gating:** anonymous can open only the preview tour; other tours return 401 →
  the screen prompts for a free account.

## Materialize it (first steps toward the phone player)

`apps/mobile` is a **member of the root bun workspace** (`workspaces` = `apps/api`
+ `apps/mobile` + `packages/*`). One root `bun install` installs everything; bun's
isolated node_modules symlinks each workspace package into its consumers' own
`node_modules`. To bring it up:

```sh
bun install              # at the repo root — installs the whole workspace
bunx expo install --fix  # align expo/react-native/expo-* to the real SDK 56 pins
bun run check            # in apps/mobile: lint:tokens + typecheck + test
```

It consumes `@skipper/shared` and `@skipper/drive-core` via `workspace:*` (both
export `.ts` source). Metro resolves them through the symlinked layout
(`metro.config.js` sets `watchFolders`/`nodeModulesPaths` to the monorepo root) —
verified: `bunx expo export` bundles cleanly through bun's isolated node_modules
(a device `expo run:ios` build is the final word).

For the **backend deploy**, keep the Expo/RN tree out of the api image. NOTE:
`bun install --filter '@skipper/api'` does NOT prune — it still installs the whole
workspace (verified empirically: 1161 packages, react-native + expo included; bun
has no `turbo prune` equivalent yet — oven-sh/bun#28600). Instead TRIM the root
`workspaces` to the api closure (`apps/api` + `packages/db` + `packages/shared`)
before installing, which yields ~90 packages and zero react-native. `apps/api/Dockerfile`
does exactly that and launches the server through dotenvx.

## Still TODO — the phone player (the MVP)

### M1 — Phone player (replaces the placeholder in `tour/[id]`)

- [ ] Custom dev build via **EAS** (Expo Go can't run the native player); this
      build confirms the SDK 56 pin (or whatever `expo install --fix` resolves) + RN.
- [ ] **`expo-audio`** background playback (`enableBackgroundPlayback`), duck the
      user's music at a trigger.
- [ ] **`expo-location`** + **`expo-task-manager`**: continuous high-rate
      FOREGROUND service (NOT fixed-radius background polling).
- [ ] **Drive simulator** — replay a corridor polyline at configurable speed.
      (The trigger core + a headless drive sim live in **`@skipper/drive-core`**,
      now imported directly by the app; this is the on-device player driving
      against it / live GPS.)
- [ ] Speed-adaptive trigger lead time, heading gate >~5 mph, debounce/queue.
      Each tour stop now carries a precomputed **trigger point**
      (`trigger_lat`/`trigger_lng`) + **`approach_heading_deg`**, so the player
      triggers as the car passes the POI's point on the road without re-snapping.
- [ ] **Lock-screen Now Playing** (phone) wired to the `expo-audio` player state.

### Deferred (post-MVP) — CarPlay

CarPlay is **no longer a hard gate**. Revisit only after the phone player proves
the bet. When you do:

- [ ] Custom dev build that includes the CarPlay fork (Expo Go can't run it).
- [ ] Add **`@g4rb4g3/react-native-carplay`** + config plugin; verify it links
      under the **New Architecture** and shows a **Now Playing** template in the
      Xcode CarPlay simulator.
- [ ] Convert iOS to **UIScene/Scenes** (`CPTemplateApplicationScene` + phone).
- [ ] File the **`carplay-audio`** Apple entitlement (slow Apple review — can be
      started in the background anytime; nothing blocks on it).
- [ ] CarPlay Now Playing wired to the same `expo-audio` player state.

## Caveats carried from the original deferral

- **New Architecture is MANDATORY** (SDK 55+ removed the opt-out). Every native
  dep (incl. the CarPlay fork) must be Fabric/TurboModule-ready.
- **No Expo Go** — a custom dev client / EAS build is required.
- **bun + Expo/EAS/Metro is the load-bearing unknown.** bun's isolated
  `node_modules/.bun` symlink layout may bite Metro/autolinking. Verify on a real
  EAS build; if bun fights Expo, use a Node package manager **for `apps/mobile`
  only** (backend stays on bun) — the workspace tolerates that. Levers: `bun pm`
  `--linker hoisted`, or Metro `watchFolders` + `nodeModulesPaths` (already set).

## Backend endpoints consumed

- `GET /corridors` (anon) · `GET /tours/:id` + `POST /tours/:id/assets/sign`
  (preview-only for anon, else free account) · `POST /api/auth/*` (Better Auth).

> **Browse→play flow is wired:** `GET /corridors/:id/tours` exists in the M2 API
> and is consumed by `app/corridor/[id].tsx` (corridor list → tours → gated tour
> detail). The remaining gap is the LIVE phone player itself (see TODO above).
