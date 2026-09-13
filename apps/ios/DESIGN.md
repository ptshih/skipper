# Trailhead 89 on iOS

Preserve the Skipper's voice, park-sign typography, paper/pine palette, and distinctive
driving presentation. Ordinary navigation, forms, sheets, menus, and alerts use native
controls. Day is the visual reference; dusk remains an equal supported theme.

`Skipper/Design/Trailhead.swift` owns semantic colors and typography. Screens must use
these roles rather than raw color literals. Amber tokens are fills; day small text uses
`accentWarm`. Zilla Slab is the display voice, Lora is editorial body text, and Overpass
Mono is route/time information. Ordinary system controls can retain system typography.
Fonts are bundled with their licenses and use Dynamic Type-relative sizes.

Honor full Dynamic Type on ordinary screens, native VoiceOver semantics, Reduce Motion,
and safe areas. Driving controls need at least 48-point targets (primary actions 60).
Use native Google Maps with readable route contrast and unobscured Google attribution.
Use theme choice Auto/Day/Dusk, persisted through the migration owner; do not replace
legacy stored preference values `system`, `light`, and `dark`.

Architecture, offline/auth guarantees, and release acceptance live in the conversion plan;
this file owns presentation guidance only.

Brand artwork sources are retained in `BrandSources/`; `scripts/ios-brand.sh` regenerates
`Skipper/Resources/Assets.xcassets/AppIcon.appiconset` and `Skipper/Resources/badge.png`.
Keep iOS icon masters opaque and square; the system supplies masking, and the tinted
variant uses grayscale for legible system tint. The badge is a separate in-app mark.
