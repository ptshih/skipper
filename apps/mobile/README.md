# @skipper/mobile — DEFERRED

> Native app **DEFERRED** until the CarPlay day-1 gate settles the SDK pin.
>
> This directory is an intentional placeholder. There is **no `package.json`,
> `app.json`, `metro.config.js`, `eas.json`, or native project here yet** — they
> are written only once the SDK version is locked. Do not scaffold the native
> app before the gate decision.
>
> NOTE: it has no `package.json`, so it is intentionally **excluded** from the
> bun workspace globs until it's scaffolded.

## Why it's deferred

The day-1 product requirement is **Apple CarPlay**. CarPlay support comes from
`@g4rb4g3/react-native-carplay` (a config-plugin fork that requires a custom
dev/EAS build — it does **not** run in Expo Go), and its New-Architecture
compatibility must be confirmed against a specific Expo SDK / React Native
version **before** we commit. So the SDK pin is a downstream decision of the
CarPlay gate, not the other way around.

Target at time of writing: **Expo SDK 56** (current latest stable; `expo` npm
`latest` = `56.0.9`). Treat that as the *candidate*, not a commitment.

Key SDK 56 facts to design against:

- **New Architecture is MANDATORY.** SDK 55+ removed the opt-out; the legacy
  architecture is gone. Every native dep (incl. the CarPlay fork) must be
  New-Arch (Fabric/TurboModules) ready.
- **Node floor `>=20.19.4`.** (Dev/CI on Node 24.13.0 — satisfies it.)
- **No Expo Go.** A custom dev client / development build (via EAS) is required.
- **`expo-*` versions are SDK-managed.** Install every Expo module with
  `npx expo install <pkg>` so versions stay aligned with the pinned SDK.

## Build-out checklist

### M0 — CarPlay gate (decides the SDK pin)

- [ ] Pin **Expo SDK 56** (candidate) + the matching React Native version.
- [ ] Scaffold the app (e.g. `bunx create-expo-app --template default@sdk-56`)
      and confirm it boots as a **custom dev build via EAS** (Expo Go is not usable).
- [ ] Add **`@g4rb4g3/react-native-carplay`** + its Expo config plugin; verify
      it builds and links under the **New Architecture** on the pinned SDK and
      shows a **Now Playing** template in the **Xcode CarPlay simulator**.
- [ ] Convert the iOS app to **UIScene / Scenes** (`UIApplicationSceneManifest`
      with a CarPlay `CPTemplateApplicationScene` + the phone scene).
- [ ] **GATE DECISION:** only after the above proves out do we finalize the SDK
      pin and write the committed native config.

### M1 — Player

- [ ] **`expo-audio`** with config-plugin `enableBackgroundPlayback: true`
      (background audio + lock-screen controls; Android: `setActiveForLockScreen`).
- [ ] **`expo-location`** + **`expo-task-manager`** for a continuous high-rate
      foreground location service (NOT fixed-radius background polling).
- [ ] **Drive simulator** — replay a GPX track / corridor polyline through the
      location layer at configurable speed (M1 non-negotiable; test at the desk).
- [ ] Triggering: speed-adaptive lead time, heading gate >~5 mph, debounce/queue.
- [ ] **CarPlay Now Playing template** wired to the `expo-audio` player state.

---

## Monorepo notes (bun + Turborepo + Metro)

We use **bun** for package management. Observed in this repo: bun installs into a
central `node_modules/.bun` store with **per-package symlinked `node_modules`**
(an isolated-style layout — closer to pnpm than to npm's flat hoist). So the
Expo-autolinking / Metro-resolution caveats that bite symlinked layouts **may
still apply**. Do **not** assume bun's layout is automatically Metro-friendly.

⚠️ **Verify at the gate, do not assume:** bun-as-package-manager with
Expo/EAS/Metro is the load-bearing unknown. RN/Metro run on **Node** regardless
of the package manager, and **EAS Build**'s bun support + Expo prebuild + Metro
resolution under bun's symlinked layout must be confirmed on a real build before
committing the mobile app to bun. If bun fights Expo/EAS, fall back to a
Node-based package manager **for `apps/mobile` only** (the backend + tooling stay
on bun) — the workspace can tolerate that. (If you keep bun, `bun pm`'s
`--linker hoisted` or Metro `watchFolders` + `nodeModulesPaths` overrides are the
likely levers.)

### `metro.config.js` (when scaffolded)

SDK 52+ (so 56) auto-configures Metro for monorepos via `expo/metro-config`:

```js
// metro.config.js (apps/mobile) — SDK 56 auto-configures the monorepo
const { getDefaultConfig } = require('expo/metro-config')

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname)

module.exports = config
```

If a workspace package still won't resolve, set `config.watchFolders` to the
monorepo root and add it to `config.resolver.nodeModulesPaths` — but try the
default first.

### Turborepo

When scaffolded, add the app's `start` / `prebuild` / EAS scripts to the
pipeline and mark Metro / native builds as **non-cacheable** (they're stateful).
