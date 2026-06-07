# @skipper/mobile — Expo app (backend wiring scaffolded; native/CarPlay gated)

> **Status:** the JS/TS app is scaffolded and wired to the M2 backend (browse,
> auth, gated tour fetch). The **native build, Metro/EAS, and CarPlay/player are
> NOT done** and are NOT verifiable from CI — they belong to the CarPlay day-1
> gate. Version pins below are **candidates** (SDK 56); reconcile them with
> `bunx expo install --fix` when you materialize the app.

## What's wired (works against the M2 API)

- **Expo Router** app (`app/`): corridor browse (`index`), `sign-in` (email/
  password), and `tour/[id]` (gated fetch + presign).
- **Auth:** Better Auth Expo client (`src/lib/auth.ts`) — sessions in
  `expo-secure-store`, scheme `skipper` (matches the server `trustedOrigins` and
  the `expo()` server plugin in `apps/api/src/auth.ts`).
- **API client:** `src/lib/api.ts` — typed against `@skipper/shared` DTOs
  (`corridorList`/`tourDetail`/`signedAudio`); auth via `authClient.getCookie()`.
- **Gating:** anonymous can open only the preview tour; other tours return 401 →
  the screen prompts for a free account.

## Materialize it (first steps at the gate)

`apps/mobile` is **deliberately excluded from the root bun workspace** (root
`workspaces` = `apps/api` + `packages/*`) so RN/Expo don't bloat or destabilize
the backend install. To bring it up:

```sh
cd apps/mobile
bun install              # or npm/yarn if bun fights Expo/EAS (see caveat below)
bunx expo install --fix  # align expo/react-native/expo-* to the real SDK 56 pins
bun run typecheck
```

`@skipper/shared` is referenced via `link:../../packages/shared` and resolved by
Metro (`metro.config.js` sets `watchFolders`/`nodeModulesPaths` to the monorepo
root). It exports `.ts` source, which Metro transpiles.

## Still TODO — the gate (decides the SDK pin) + the player

### M0 — CarPlay gate

- [ ] Confirm the SDK 56 pin (or whatever `expo install --fix` resolves) + RN.
- [ ] Custom dev build via **EAS** (Expo Go can't run the CarPlay fork).
- [ ] Add **`@g4rb4g3/react-native-carplay`** + config plugin; verify it links
      under the **New Architecture** and shows a **Now Playing** template in the
      Xcode CarPlay simulator.
- [ ] Convert iOS to **UIScene/Scenes** (`CPTemplateApplicationScene` + phone).
- [ ] **GATE DECISION** → finalize the SDK pin + commit native config.

### M1 — Player (replaces the placeholder in `tour/[id]`)

- [ ] **`expo-audio`** background playback (`enableBackgroundPlayback`), duck the
      user's music at a trigger.
- [ ] **`expo-location`** + **`expo-task-manager`**: continuous high-rate
      FOREGROUND service (NOT fixed-radius background polling).
- [ ] **Drive simulator** — replay a corridor polyline at configurable speed.
- [ ] Speed-adaptive trigger lead time, heading gate >~5 mph, debounce/queue.
- [ ] CarPlay Now Playing wired to the `expo-audio` player state.

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

> **Missing for a full browse→play flow:** there is no corridor→tour route yet
> (you fetch a tour by id). Add `GET /corridors/:id/tours` or an assemble route
> when generated tours exist.
