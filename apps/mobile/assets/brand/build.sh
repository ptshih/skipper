#!/usr/bin/env bash
# Regenerate the app icon / splash / Android adaptive-icon PNGs from the SVG sources.
# Edit badge.svg (the master enamel travel badge), then run this from apps/mobile/assets/brand.
# Needs rsvg-convert (`brew install librsvg`). Colors come from src/theme/tokens.ts.
set -euo pipefail
cd "$(dirname "$0")"

# 1) the self-contained circular badge (transparent outside the disc) — the splash mark too
rsvg-convert -w 1024 -h 1024 badge.svg -o badge-master.png
cp badge-master.png ../splash-icon.png

# 2) iOS app icon: badge on a full-bleed paper field (icon.svg embeds badge-master.png)
rsvg-convert -w 1024 -h 1024 icon.svg -o ../icon.png

# 3) Android adaptive foreground: badge in the central safe zone, transparent (bg color in app.json)
rsvg-convert -w 1024 -h 1024 adaptive-icon.svg -o ../adaptive-icon.png

echo "Regenerated ../icon.png, ../adaptive-icon.png, ../splash-icon.png (1024×1024)."
