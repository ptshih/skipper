# @skipper/mobile — Expo app (backend wiring scaffolded; phone player TODO, CarPlay deferred)

> **Status:** the JS/TS app is scaffolded and wired to the M2 backend (browse
> drives + roam, auth, gated drive fetch/sign), and a **native per-stop mini-preview** (tap a stop —
> List row or Map pin — to hear one clip over `expo-audio`) lives on the drive-detail page
> (`app/drives/[id]/index.tsx`; the old `?mode=preview` couch "simulated drive" was cut — see
> `docs/decisions/detail-page-mini-preview.md`). A local iOS
> **simulator build compiles** (`xcodebuild` succeeds with `expo-audio` linked),
> but there is **no EAS build, no device run, and no LIVE GPS-triggered phone
> player yet** — that work (offline download, on-device triggering, lock-screen
> Now Playing, a real drive) is the M1 phone player still TODO below. **CarPlay is
> deferred past the MVP — no longer a hard gate**; the MVP plays through the phone
> (mount / Bluetooth), and the phone player's EAS build is what decides the SDK pin.
> Version pins below are **candidates** (SDK 56); reconcile them with
> `bunx expo install --fix` when you materialize the app.

## What's wired (works against the M2 API)

- **Expo Router** app (`app/`): drive browse (`index`), `sign-in` (email/password),
  `drives/[id]` (gated detail fetch + presign + the per-stop **mini-preview**: List/Map, tap a stop
  to hear it), and the live GPS **player** (`drives/[id]/play`, `?mode=live` / dev `sim`).
- **Auth:** Better Auth Expo client (`src/lib/auth.ts`) — sessions in
  `expo-secure-store`, scheme `skipper` (matches the server `trustedOrigins` and
  the `expo()` server plugin in `apps/api/src/auth.ts`).
- **API client:** `src/lib/api.ts` — typed against `@skipper/shared` DTOs
  (`driveList`/`driveManifest`/`signedDriveAudio`, plus `roamManifest`/`regionList`);
  auth via `authClient.getCookie()`.
- **Gating:** anonymous can only ROAM — `GET /roam` (`getRoamManifest`, sent
  anonymously) is the open front door. Everything under `/drives*` (list, detail,
  propose/create, asset sign) is account-gated, so an anonymous call returns 401 →
  the screen prompts to sign up (`AccountGate`). There is no anonymous per-tour
  preview fetch/sign in the client.

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

It consumes `@skipper/shared` and `@skipper/engine` via `workspace:*` (both
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

### M1 — Phone player (`drives/[id]/play`)

- [ ] Custom dev build via **EAS** (Expo Go can't run the native player); this
      build confirms the SDK 56 pin (or whatever `expo install --fix` resolves) + RN.
- [ ] **`expo-audio`** background playback (`enableBackgroundPlayback`), duck the
      user's music at a trigger.
- [ ] **`expo-location`** + **`expo-task-manager`**: continuous high-rate
      FOREGROUND service (NOT fixed-radius background polling).
- [ ] **Drive simulator** — replay a tour's polyline at configurable speed.
      (The trigger core + a headless drive sim live in **`@skipper/engine`**,
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

- `GET /drives` (the caller's saved drives) · `GET /drives/:id` + `POST /drives/:id/assets/sign`
  · `POST /drives/propose` + `POST /drives` (create) · `GET /regions` · `GET /roam` (anon) ·
  `POST /api/auth/*` (Better Auth). Create-a-Drive is account-gated; roam is the anonymous front door.

> **Browse→play flow is wired:** `GET /drives` and `GET /drives/:id` are
> consumed by `app/drives/[id]/*` (drive detail → gated player); the region picker is
> `app/create.tsx`. The remaining gap is the LIVE phone player itself (see TODO above).
