#!/usr/bin/env bash
# Regenerate the app icon / splash / Android adaptive-icon PNGs from the SVG sources.
# The mark is the "switchback S" — a drawn S whose dashed centre line makes it a road.
# Text-free, day & dusk. Edit the sources below, then run this from apps/mobile/assets/brand.
# Needs rsvg-convert (`brew install librsvg`). Colors come from src/theme/tokens.ts.
#
# ⚠ Three constraints the shapes below are built around; don't undo them by eye:
#   · iOS derives the TINTED and CLEAR appearances by LUMINANCE, not hue. Amber sits
#     mid-value against both pine (2.63:1) and paper (2.47:1), under the 3:1 non-text
#     bar — so the amber head dot is decorative and the mark never depends on it.
#   · The splash needs TWO assets. expo-splash-screen renders one image over paper in
#     light and night in dark; a bare letterform can't serve both (pine on night is
#     2.10:1). app.json's splash `dark.image` must stay pointed at splash-icon-dark.png.
#   · The iOS icons are opaque with NO alpha channel; the splash + adaptive ones are
#     transparent on purpose. Don't "fix" either.
set -euo pipefail
cd "$(dirname "$0")"

# 1) iOS app icon — full-bleed, opaque, no rounded corners (the OS masks it).
#    tinted is a fully opaque GRAYSCALE rendition: iOS applies the user's tint to it,
#    and omitting the slot makes it tint the full-colour artwork instead.
rsvg-convert -w 1024 -h 1024 icon.svg        -o ../icon.png
rsvg-convert -w 1024 -h 1024 icon-dark.svg   -o ../icon-dark.png
rsvg-convert -w 1024 -h 1024 icon-tinted.svg -o ../icon-tinted.png

# 2) Android adaptive foreground: mark in the central 66% safe zone, transparent
#    (the pine background color is set in app.json android.adaptiveIcon.backgroundColor)
rsvg-convert -w 1024 -h 1024 adaptive-icon.svg -o ../adaptive-icon.png

# 3) Splash marks, transparent — one per ground (see the constraint note above)
rsvg-convert -w 1024 -h 1024 splash-icon.svg      -o ../splash-icon.png
rsvg-convert -w 1024 -h 1024 splash-icon-dark.svg -o ../splash-icon-dark.png

# 4) In-app enamel travel badge (the home-hero mark) — a SEPARATE asset from the launcher
#    icon; kept as the source of truth for DESIGN §9. Not wired into the launcher/splash.
rsvg-convert -w 1024 -h 1024 badge.svg -o badge-master.png

echo "Regenerated ../icon.png, ../icon-dark.png, ../icon-tinted.png, ../adaptive-icon.png,"
echo "../splash-icon.png, ../splash-icon-dark.png + badge-master.png (1024×1024)."
