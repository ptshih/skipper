# Skipper Design System — "Trailhead 89" (browsable reference)

A self-contained, browsable HTML mirror of Skipper's design system. Exported from
[Claude Design](https://claude.ai/design) on 2026-06-10 and committed here so the
repo carries a visual, navigable record of the system — tokens, type, spacing,
color (day **and** dusk), the 14 components, the brand marks, and an end-to-end
prototype of the app.

## How to view

It's plain static HTML/CSS/JS — no build step. Either open the front door directly:

```
open design-system/index.html      # macOS
```

…or serve the folder (recommended — the front door loads the specimen previews as
same-origin iframes, and the component cards transpile JSX via Babel-standalone,
both of which want a real origin):

```bash
cd design-system && python3 -m http.server 8080   # then visit http://localhost:8080
```

`index.html` is the **front door**: a hero plus live, scaled previews of every
specimen, grouped Color · Type · Spacing · Components · Brand · The app, with a
day/dusk toggle that propagates into the previews. Click any tile to open that
specimen full size.

## What's in here

| Path | What |
| --- | --- |
| `index.html` | the front door (start here) |
| `styles.css` + `tokens/` | the global token manifest: colors, fonts, typography, spacing |
| `guidelines/*.html` | foundation specimens — color, type, spacing, brand voice/motif/badge |
| `components/**/*.card.html` | component specimen cards (buttons, chips, badges, cards, the player) |
| `components/**/*.jsx` + `_ds_bundle.js` | the component sources + the assembled browser bundle the cards load (`window.Skipper`) |
| `ui_kits/skipper-app/` | the composed app prototype (home → regions → tour detail → live player → sign-in → gate → settings, day & dusk) |
| `assets/` | the enamel badge + app icons |
| `scraps/` | design-exploration ephemera (a napkin sketch, a kit-detail crop) |

## Relationship to the app — this is a MIRROR, the code is the source of truth

The **canonical** design system lives in the mobile app, not here:

- `apps/mobile/DESIGN.md` — the design language (the words: the WPA-poster aesthetic,
  dark-mode-first, the priority principles, the contrast guarantee).
- `apps/mobile/src/theme/` — the real tokens + day/dusk themes.
- `apps/mobile/src/ui/` — the real primitives screens compose.

This bundle was generated *from* that system as a visual reference. Per repo doctrine,
**code wins**: if a token or component here disagrees with `apps/mobile/src/theme`
or `src/ui`, the native code is right and this mirror is stale. Treat it as a
specimen book and a brand front door, not an importable dependency — nothing in the
app imports from `design-system/`, and it sits outside every workspace's build scope
on purpose (its `.jsx`/`.d.ts` sources are browser specimens, not RN code).
