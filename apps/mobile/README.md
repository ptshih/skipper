# @skipper/mobile — Expo app (the phone player; CarPlay deferred)

> **Status (2026-08-02):** the **M1 phone player is BUILT** — background audio, a continuous
> foreground GPS watch, speed-adaptive triggering, the couch drive simulator, offline download and
> lock-screen Now Playing all ship in this app, and it runs on real device builds (EAS dev +
> TestFlight), not just the iOS Simulator. **Home is the planner CONVERSATION** (1.1): roam is
> removed entirely and the region-picker form went with it. **CarPlay is deferred past the MVP** —
> the phone plays through a mount / Bluetooth, and CarPlay is revisited only after the phone player
> proves the bet. SDK / RN / native pins live in `package.json` (bump them via `expo install`, never
> by hand — see `apps/mobile/CLAUDE.md`).
>
> For the screen-by-screen shape (every screen, hook and store, with the reasoning) read
> `docs/guides/mobile-internals.md`. This file is the **workspace + wire-contract** view: how the app
> builds inside the monorepo and what it says to the API.

## What's wired

- **Expo Router** app (`app/`) — the routes that exist on disk:

  | Route | What it is |
  |---|---|
  | `app/_layout.tsx` | The shell: providers, splash, fonts, startup janitors, `VersionGate` |
  | `app/index.tsx` | **Home = the planner conversation** + MY DRIVES (the archive) below it |
  | `app/sample.tsx` | The one ungated sample clip + its postcard |
  | `app/sign-in.tsx` | Where the account wall sends the rider |
  | `app/settings.tsx` | Theme, sim mode, account, in-app deletion |
  | `app/legal.tsx` | Sources & licenses (bundled — must render in a dead zone) |
  | `app/developer.tsx` | Admin-only dev affordances (sim GPS) |
  | `app/drives/[id]/index.tsx` | Drive detail + the native per-stop **mini-preview** (List/Map, tap a stop to hear one clip) |
  | `app/drives/[id]/play.tsx` | The live, GPS-triggered **player** (`?mode=live` / dev `sim`) |

  ⚠ There is **no `app/create.tsx`**. The region/endpoint picker was deleted in 1.1 along with
  `GET /drives/anchors`; the rider now describes the drive they want and the planner resolves it.
- **Auth:** Better Auth Expo client (`src/lib/auth.ts`) — sessions in `expo-secure-store`, scheme
  `skipper` (matches the server `trustedOrigins` and the `expo()` plugin in `apps/api/src/auth.ts`).
  ⚠ A truthy `session` is **not** "signed in" — every rider carries an anonymous one. Use the
  `isSignedIn` helper.
- **API client:** `src/lib/api.ts` — typed against `@skipper/shared` DTOs, with the timeout /
  offline pre-flight / `ContractError` envelope every screen depends on. The planner is the one
  call that does **not** go through it: `src/lib/planner.ts` reads an SSE stream and is
  cookie-less by construction.
- **Gating — the anonymous front door is the PLANNER, and the wall is one route.**
  Anonymous riders get `POST /drives/plan` (the conversation), `POST /drives/propose` (the route
  preview), the **one** presigned preview clip that rides on the propose response, and `GET /sample`.
  The wall lands at **`POST /drives`** — "Make this drive" — which spends a credit; a 401 there
  surfaces `AccountGate`. The saved-drive routes (`GET /drives`, `GET /drives/:id`,
  `POST /drives/:id/assets/sign`, `DELETE /drives/:id`) are owner-scoped and 401 the same way.
  ⚠ **This bullet used to say the opposite** — "anonymous can only ROAM… everything under `/drives*`
  is account-gated… there is no anonymous preview fetch in the client" — and that reading is exactly
  the regression to avoid: on the server `requireAccount` sits on the **five owner routes
  individually**, never on the `driveRoutes.use('*', …)` mount, because re-mounting it there silently
  re-walls the whole preview and reads like an auth bug rather than a routing one.
- **No paid tier.** Premium is CREDITS, not a plan (`docs/decisions/cut-tiers.md`), so every account
  is `free` and the server returns a `credits` balance for all of them; the client's only null is an
  older server that predates the field.

## Bring it up

`apps/mobile` is a **member of the root bun workspace** (every `apps/*` + `packages/*`). One root
`bun install` installs everything; bun's isolated node_modules symlinks each workspace package into
its consumers' own `node_modules`.

```sh
bun install    # at the repo root — installs the whole workspace
bun run check  # in apps/mobile: lint:tokens + lint + typecheck + test
```

It consumes `@skipper/shared` and `@skipper/engine` via `workspace:*` (both export `.ts` source).
Metro resolves them through the symlinked layout (`metro.config.js` sets
`watchFolders`/`nodeModulesPaths` to the monorepo root).

For the **backend deploy**, keep the Expo/RN tree out of the api image. NOTE:
`bun install --filter '@skipper/api'` does NOT prune — it still installs the whole workspace
(verified empirically: react-native + expo included; bun has no `turbo prune` equivalent yet —
oven-sh/bun#28600). Instead TRIM the root `workspaces` to the api's closure before installing —
that drops the install to a fraction of the tree with zero react-native. `apps/api/Dockerfile` does
exactly that (it owns the closure list) and launches the server through dotenvx.

## Deferred (post-MVP) — CarPlay

CarPlay is **no longer a hard gate**. Revisit only after the phone player proves the bet. When you do:

- [ ] Custom dev build that includes the CarPlay fork (Expo Go can't run it).
- [ ] Add **`@g4rb4g3/react-native-carplay`** + config plugin; verify it links under the
      **New Architecture** and shows a **Now Playing** template in the Xcode CarPlay simulator.
- [ ] Convert iOS to **UIScene/Scenes** (`CPTemplateApplicationScene` + phone).
- [ ] File the **`carplay-audio`** Apple entitlement (slow Apple review — can be started in the
      background anytime; nothing blocks on it).
- [ ] CarPlay Now Playing wired to the same `expo-audio` player state.

## Build constraints that still bite

- **New Architecture is MANDATORY** (SDK 55+ removed the opt-out). Every native dep — including a
  future CarPlay fork — must be Fabric/TurboModule-ready.
- **No Expo Go** — a custom dev client / EAS build is required (the player needs native audio +
  location).
- **bun + Expo/EAS/Metro was the load-bearing unknown; it is settled.** bun's **default isolated**
  linker works: `bunx expo export` bundles cleanly and device builds run. ⚠ Do **not** "fix" a
  resolution failure by forcing `linker = "hoisted"` — that already papered over an undeclared
  `expo-font` import the isolated linker had correctly flagged. Fix the missing declaration instead.
- **A native rebuild is required** after any `app.json` / `app.config.ts` change — both bake into
  the Info.plist / AndroidManifest at prebuild time and are not read at JS runtime.

## Backend endpoints consumed

From `src/lib/api.ts` and `src/lib/planner.ts`:

| Endpoint | Access |
|---|---|
| `POST /drives/plan` (SSE) | anonymous — the planner conversation |
| `POST /drives/propose` | anonymous — route preview + the one preview clip; costs no credit |
| `POST /drives` | **the wall** — account required; spends a credit |
| `GET /drives` · `GET /drives/:id` · `POST /drives/:id/assets/sign` · `DELETE /drives/:id` | owner-scoped, account required |
| `GET /regions` | anonymous |
| `GET /sample` | anonymous — the one curated taste clip |
| `GET /version` | anonymous — the launch-time update gate |
| `POST /api/auth/*` | Better Auth (incl. the anonymous session mint) |
