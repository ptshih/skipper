#!/usr/bin/env bash
# Render retained Skipper SVG masters into the native asset destinations.
# rsvg-convert comes from librsvg; https://gnome.pages.gitlab.gnome.org/librsvg/
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
output="$repo_root/apps/ios/Skipper/Resources"
if [[ $# -gt 0 ]]; then
  if [[ $# -ne 2 || "$1" != "--output" ]]; then
    echo 'Usage: scripts/ios-brand.sh [--output <resource-directory>]' >&2
    exit 2
  fi
  output="$2"
fi
command -v rsvg-convert >/dev/null || { echo 'Install librsvg to provide rsvg-convert.' >&2; exit 1; }
source_dir="$repo_root/apps/ios/BrandSources"
icon_dir="$output/Assets.xcassets/AppIcon.appiconset"
mkdir -p "$icon_dir"
# iOS masks opaque, square masters. Tinted is grayscale so system tint remains legible.
for name in icon icon-dark icon-tinted; do
  rsvg-convert --width 1024 --height 1024 "$source_dir/$name.svg" --output "$icon_dir/$name.png"
done
rsvg-convert --width 1024 --height 1024 "$source_dir/badge.svg" --output "$output/badge.png"
echo 'Rendered three native app icons and the in-app badge. Asset catalog metadata is unchanged.'
