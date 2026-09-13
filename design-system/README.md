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

The **canonical** design system for current iOS development lives in the native app:

- `apps/ios/DESIGN.md` — presentation, native controls, accessibility and brand language.
- `apps/ios/Skipper/Design/Trailhead.swift` — semantic tokens, typography and day/dusk roles.
- `apps/ios/Skipper/Features/Shared` — native components; `apps/ios/BrandSources` — SVG masters.

This bundle predates the native conversion and is a historical visual reference. Its web
font specimens are not authoritative for the current Zilla Slab / Lora / Overpass Mono
native palette. The retained Expo workspace remains available for migration acceptance.
When a token or component differs, current native code and DESIGN.md win. Treat this as a
specimen book and a brand front door, not an importable dependency — nothing in the
app imports from `design-system/`, and it sits outside every workspace's build scope
on purpose (its `.jsx`/`.d.ts` sources are browser specimens, not RN code).
