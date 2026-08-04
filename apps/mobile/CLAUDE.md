# `apps/mobile` — design system ("Trailhead 89")

`apps/mobile` has a real design system; **don't hand-roll styles or hardcode values.** Source of truth:
`src/theme/` (raw tokens → semantic light/dark color ROLES), `src/ui/` (primitives + "smart" composites like
`AccountGate`/`StateView`), `apps/mobile/DESIGN.md` (the language: WPA national-park aesthetic,
glanceable/in-car, **day as the reference theme with dusk a first-class peer** — founder 2026-08-03
reversed "night is the headline drive"; that changed what gets designed and measured FIRST, not the
runtime, where Auto still follows the phone). Screens compose `@/ui` + semantic roles (`color="ink"`) — NEVER a
raw hex/rgba/`fontFamily`; colors live only in `src/theme`.

- **Enforced:** `bun run lint:tokens` fails on a raw color/font in `app/` or `src/ui/`; a contrast unit test
  asserts every text role clears 4.5:1 in both themes. (mobile `bun run check` = lint:tokens + **lint** +
  typecheck + test.)
- **ESLint (`eslint-config-expo`, adopted 2026-08-02) — here for `react-hooks`, not for style.** The hooks
  (`useDrive`, `useRoutePreview`, `useStopPreview`, `useLocationPriming`) each sit behind a native module
  `bun test` cannot load — `expo-audio` for the first three, `expo-location` (via `./gps`) for priming — so
  this is the only tool that reads that code. ⚠ **Pin ESLint to 9.x** —
  `eslint-plugin-react` (transitive via the Expo config) peers at `^9.7` max and ESLint 10 crashes it
  outright (`contextOrFilename.getFilename is not a function`). ⚠ It is NOT a formatter and must not become
  one: if a rule starts rewriting prose or import order, turn the RULE off — a repo-wide auto-fixer is
  banned (root CLAUDE.md, shared tree).
- **`eslint-suppressions.json` is a BACKLOG, not a mute button.** It baselines the Rules-of-React errors
  that pre-dated adoption (today all `react-hooks/set-state-in-effect` + `refs`) so NEW ones fail
  immediately; the file itself is the tally — don't quote a count here, it drifts the moment one is fixed.
  Burn them down with judgement — several are the deliberate ref-mirrors-state pattern — then
  `bun run lint:suppress` prunes what you fixed. Never re-run a blanket `--suppress-all`.
- **Three deps are pinned EXACT on purpose — `react`, `react-native`, `react-native-maps` — and
  loosening any of them is a regression, not tidying.** They are `expo install`'s output: Expo's
  `bundledNativeModules.json` for the SDK specifies each version, and for `react-native-maps` it
  specifies an EXACT `1.27.2` where `react-native-screens` and `react-native-safe-area-context` get
  `~`. That asymmetry is Expo's judgement about which native modules break on a patch bump, not ours.
  ⚠ An unexplained exact pin reads like a scar from a bad upgrade — it isn't one here (one commit,
  `dda5dc9`, never bumped), and reading it that way already cost one wrong migration proposal. Bump
  these only via `expo install` / an SDK upgrade, and let `bun run doctor` tell you the target.
- **⛔ `react-native-maps` → `expo-maps` was REJECTED (2026-08-02) on CAPABILITY, not effort — do not
  re-propose without re-checking these three.** The prize is real and still wanted (drop
  `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`, its billing surface, and the whole `react-native-maps` plugin
  block in `app.config.ts`), which is exactly why the blockers are written down rather than the verdict:
  1. **Custom React marker views are unsupported — image icons only.** The puck is a `<Marker>` wrapping
     a halo, a `rotate(${heading}deg)` wedge and a dot; stop markers are styled views keyed to remount
     on passed/active/upcoming. A rotating heading wedge cannot be an image icon at GPS rates without
     pre-rendering a sprite per heading.
  2. **`setCameraPosition()` animation duration is unsupported on iOS.** `DriveMap` animates the camera
     throttled to 1/sec; losing the tween turns camera-follow into a hard jump-cut every second *while
     the rider is driving* — a regression exactly where the product is least forgiving.
  3. **It is ALPHA**, in Expo's own words, "will frequently experience breaking changes". Also lost:
     `mapStyle.ts`'s dusk tint — custom JSON styling is Android-only there; AppleMaps gets `colorScheme`
     and `mapType`, nothing more.
  ⚠ **What would reopen it:** expo-maps leaving alpha AND either custom marker views or an animated iOS
  camera landing. Until then the open question is only whether `react-native-maps` renders correctly on
  SDK 57 on a DEVICE (expo/expo#43288 is SDK 55, so the risk may be theoretical) — a ten-minute check,
  not a migration.
- **`bun run doctor` (`expo-doctor`) is deliberately NOT in `check`:** it needs the network, and it reports
  a FALSE "node_modules may be corrupted / multiple copies" against bun's isolated linker. Run it when
  touching dependencies, and read the version table, not the duplicate warning.
- **Icons are VECTOR** (`@expo/vector-icons` via `src/ui/Icon.tsx`) — NOT emoji (no color-emoji fallback;
  emoji render as tofu).
- `*.test.ts` run under `bun test`; the app `tsc` excludes them (mobile has no `@types/bun`).
- **⚠ Kill the dev-client FAB before ANY visual review.** `expo-dev-client`'s floating "Tools" gear parks
  itself over the home header's settings gear, and it is NOT an `app.json` option — it is a UserDefaults
  preference, so the fix is per-simulator and ships nothing:
  `xcrun simctl spawn <udid> defaults write fm.skipper.app EXDevMenuShowFloatingActionButton -bool NO`.
  Worth the line because it does not merely look untidy: on 2026-08-03 it read as a DUPLICATE settings
  control to two independent reviewers, who filed it as a real defect against `unstable_headerRightItems`
  (which is correct — it is the documented iOS-26 fallback pair, see `app/_layout.tsx`). A dev artifact
  that manufactures plausible bug reports costs more than it looks like.

⚠ This file loads only when an agent works with files under `apps/mobile`. The root `CLAUDE.md` keeps the
pointer here plus the rule that touching `apps/mobile` means running `bun run check` in this workspace too
(the real delta is `lint:tokens`). Player/audio/GPS landmines stay in the root file — they span
`@skipper/engine` as well.
