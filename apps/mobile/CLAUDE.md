# `apps/mobile` — design system ("Trailhead 89")

`apps/mobile` has a real design system; **don't hand-roll styles or hardcode values.** Source of truth:
`src/theme/` (raw tokens → semantic light/dark color ROLES), `src/ui/` (primitives + "smart" composites like
`AccountGate`/`StateView`), `apps/mobile/DESIGN.md` (the language: WPA national-park aesthetic,
**dark-mode-first**, glanceable/in-car). Screens compose `@/ui` + semantic roles (`color="ink"`) — NEVER a
raw hex/rgba/`fontFamily`; colors live only in `src/theme`.

- **Enforced:** `bun run lint:tokens` fails on a raw color/font in `app/` or `src/ui/`; a contrast unit test
  asserts every text role clears 4.5:1 in both themes. (mobile `bun run check` = lint:tokens + typecheck + test.)
- **Icons are VECTOR** (`@expo/vector-icons` via `src/ui/Icon.tsx`) — NOT emoji (no color-emoji fallback;
  emoji render as tofu).
- `*.test.ts` run under `bun test`; the app `tsc` excludes them (mobile has no `@types/bun`).

⚠ This file loads only when an agent works with files under `apps/mobile`. The root `CLAUDE.md` keeps the
pointer here plus the rule that touching `apps/mobile` means running `bun run check` in this workspace too
(the real delta is `lint:tokens`). Player/audio/GPS landmines stay in the root file — they span
`@skipper/engine` as well.
