# `apps/mobile` — design system ("Trailhead 89")

`apps/mobile` has a real design system; **don't hand-roll styles or hardcode values.** Source of truth:
`src/theme/` (raw tokens → semantic light/dark color ROLES), `src/ui/` (primitives + "smart" composites like
`AccountGate`/`StateView`), `apps/mobile/DESIGN.md` (the language: WPA national-park aesthetic,
**dark-mode-first**, glanceable/in-car). Screens compose `@/ui` + semantic roles (`color="ink"`) — NEVER a
raw hex/rgba/`fontFamily`; colors live only in `src/theme`.

- **Enforced:** `bun run lint:tokens` fails on a raw color/font in `app/` or `src/ui/`; a contrast unit test
  asserts every text role clears 4.5:1 in both themes. (mobile `bun run check` = lint:tokens + **lint** +
  typecheck + test.)
- **ESLint (`eslint-config-expo`, adopted 2026-08-02) — here for `react-hooks`, not for style.** The hooks
  (`useDrive`, `useRoutePreview`, `useStopPreview`, `useLocationPriming`) import `expo-audio`, so `bun test`
  structurally cannot reach them; this is the only tool that reads that code. ⚠ **Pin ESLint to 9.x** —
  `eslint-plugin-react` (transitive via the Expo config) peers at `^9.7` max and ESLint 10 crashes it
  outright (`contextOrFilename.getFilename is not a function`). ⚠ It is NOT a formatter and must not become
  one: if a rule starts rewriting prose or import order, turn the RULE off — a repo-wide auto-fixer is
  banned (root CLAUDE.md, shared tree).
- **`eslint-suppressions.json` is a BACKLOG, not a mute button.** 47 pre-existing Rules-of-React errors
  (`react-hooks/refs`, `set-state-in-effect`, `immutability`) are baselined so NEW ones fail immediately.
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
- **`bun run doctor` (`expo-doctor`) is deliberately NOT in `check`:** it needs the network, and it reports
  a FALSE "node_modules may be corrupted / multiple copies" against bun's isolated linker. Run it when
  touching dependencies, and read the version table, not the duplicate warning.
- **Icons are VECTOR** (`@expo/vector-icons` via `src/ui/Icon.tsx`) — NOT emoji (no color-emoji fallback;
  emoji render as tofu).
- `*.test.ts` run under `bun test`; the app `tsc` excludes them (mobile has no `@types/bun`).

⚠ This file loads only when an agent works with files under `apps/mobile`. The root `CLAUDE.md` keeps the
pointer here plus the rule that touching `apps/mobile` means running `bun run check` in this workspace too
(the real delta is `lint:tokens`). Player/audio/GPS landmines stay in the root file — they span
`@skipper/engine` as well.
