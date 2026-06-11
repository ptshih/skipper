#!/usr/bin/env bash
# Regenerate the app icon / splash / Android adaptive-icon PNGs from the SVG sources.
# The launcher icon + splash are the locked "M1 — Compass porthole" mark (text-free,
# day & dusk). Edit the M1 sources below, then run this from apps/mobile/assets/brand.
# Needs rsvg-convert (`brew install librsvg`). Colors come from src/theme/tokens.ts.
set -euo pipefail
cd "$(dirname "$0")"

# 1) iOS app icon — full-bleed pine, opaque (icon.svg / icon-dark.svg are self-contained)
rsvg-convert -w 1024 -h 1024 icon.svg      -o ../icon.png
rsvg-convert -w 1024 -h 1024 icon-dark.svg -o ../icon-dark.png

# 2) Android adaptive foreground: M1 mark in the central 66% safe zone, transparent
#    (the pine background color is set in app.json android.adaptiveIcon.backgroundColor)
rsvg-convert -w 1024 -h 1024 adaptive-icon.svg -o ../adaptive-icon.png

# 3) Splash mark: the M1 pine disc, transparent corners (works on paper by day, night at dusk)
rsvg-convert -w 1024 -h 1024 splash-icon.svg -o ../splash-icon.png

# 4) In-app enamel travel badge (the home-hero mark) — a SEPARATE asset from the launcher
#    icon; kept as the source of truth for DESIGN §9. Not wired into the launcher/splash.
rsvg-convert -w 1024 -h 1024 badge.svg -o badge-master.png

echo "Regenerated ../icon.png, ../icon-dark.png, ../adaptive-icon.png, ../splash-icon.png + badge-master.png (1024×1024)."
