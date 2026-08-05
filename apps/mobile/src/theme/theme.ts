// ─────────────────────────────────────────────────────────────────────────────
// Semantic color roles. Components reference ROLES, never raw hexes, so light/dark
// swap for free and contrast stays safe by construction.
//
// Contrast rules baked into the role set (the in-car legibility footgun-killers):
//   • `amberToken` is a FILL/shape color only — there is intentionally no
//     "amber text on surface" role. Warm accent TEXT uses `accentWarm`, which is
//     a burnt amber in day (~5:1 on paper) and lantern amber at dusk.
//   • `primaryFill`/`onPrimary` flip by theme: pine+cream in day (a ranger sign),
//     lantern-amber+ink at dusk (a campfire-lit button). Always pair them.
//   • Every text role on `surface`/`surfaceRaised` clears ~4.5:1.
// ─────────────────────────────────────────────────────────────────────────────
import { palette } from './tokens'

export interface ThemeColors {
  // surfaces
  surface: string // app background
  surfaceRaised: string // cards / placards
  surfaceSunken: string // inset wells (timer chips, route track bed)
  surfaceFade: string // `surface` at 0 alpha — the transparent end of scroll-edge fades
  // `surfaceRaised` at 0 alpha. A scroll-edge fade must dissolve into whatever it sits ON, and a
  // list that scrolls INSIDE a card (the itinerary) sits on the placard, not the app background —
  // fading to `surfaceFade` there would smear paper over the card and read as a rendering fault.
  surfaceRaisedFade: string
  keyline: string // bright inner rule that fakes a carved-sign edge
  // text
  ink: string // primary text
  inkDim: string // secondary (region, stop type, timers)
  inkFaint: string // tertiary hints
  // brand accents
  accent: string // pine — active bullets, icons, links, success TEXT
  accentWarm: string // contrast-safe warm accent TEXT (kickers, badges)
  // Bright amber FILL/shape ONLY — never text (there is no amber-text role, and `TextColorRole` below
  // now makes that a compile error rather than a convention).
  // ⚠ This comment used to name "meter pips", which have never existed in this app. DESIGN §4 copied
  // the phantom from here and a reviewer read the list as exhaustive — the same failure the `glow`
  // row caused the same week. So: do NOT re-list the consumers here. They move, the list rots, and a
  // rotted list is worse than none. §4 names them; `grep colors.amberToken` is the truth.
  amberToken: string
  onAmber: string // dark ink that reads on an amber fill (enamel discs/badges)
  water: string // teal — scenic/water motif
  // interactive
  primaryFill: string // primary button + active-track fill
  onPrimary: string // text/glyphs on primaryFill
  trackActive: string // traveled portion of the route trail
  trackInactive: string // dashed atlas trail (untraveled) + hairlines
  // The route drawn ON A BASEMAP — distinct from `trackInactive`, which is the trail on our OWN
  // surfaces (RouteTrack's hero motif, a marker ring) where nothing competes with it.
  // ⚠ MEASURED, not taste. `theme/mapStyle.ts` paints minor roads in `tanRule` (day) and
  // `tanRuleNight` (dusk) — the exact values `trackInactive` carries — so the route was drawn in the
  // SAME COLOUR as the roads beneath it: contrast 1.00 in BOTH themes. It did not read as faint, it
  // read as absent (mistaken for a missing polyline during a device review on 2026-08-03, and only
  // found in the accessibility tree). The dusk value is deliberately the DAYLIGHT tan: on a night
  // basemap a light atlas tan is the legible choice, and this is a route on a map, not text.
  routeTrail: string
  rule: string // dividers, card keylines, dashed rules
  // status
  danger: string
  onDanger: string
  // effects (rgba strings — used for glow/shadow/scrim overlays via boxShadow)
  glow: string // campfire-amber halo (NOW card, dusk CTA, car token)
  shadowCast: string // neutral ambient cast shadow (daylight elevation)
  scrim: string // dim behind sheets / gates
  // ── OVER A PHOTOGRAPH ──────────────────────────────────────────────────────────────────────────
  // ⚠ THE ONE PAIR THAT DOES NOT FLIP BY THEME, and that is the entire point of it existing.
  // Every other role here answers "what mood is the app in"; these answer "what is legible on top of a
  // picture", and a picture is exactly as bright at dusk as it is at noon. The system had no such
  // answer, and the gap has produced real defects: the onboarding postcard's stamp used
  // `surfaceRaised` and read as a cream stamp in day and a dark hole punched in the artwork at dusk
  // (fixed 2026-08-04 by moving it OFF the image, which is the other valid answer).
  // ⚠ So the rule this pair encodes: anything drawn ON an image either uses these, or it moves off
  // the image. Do not reach for a surface/ink role over a photograph — it cannot know what is under it.
  photoScrim: string // opaque dark, the deep end of an over-image gradient
  // `photoScrim` at 0 alpha — the transparent end. Same reason `surfaceFade` exists: a gradient must
  // dissolve into its OWN colour, and fading to a different transparent leaves a grey cast at the seam.
  photoScrimFade: string
  onPhoto: string // cream that reads on `photoScrim` in both moods
  // ⚠ `areaFill`/`areaStroke` lived here until the 1.1 sweep. They coloured a DISTRICT's convex hull
  // on the map — the AREA trigger, deleted end-to-end in 1.1 (the mode was answering "a roamer can
  // arrive from any direction", which a drive never can). The `<Polygon>` that consumed them went with
  // roam; the roles outlived it by three steps. Nothing renders a hull, so nothing needs a hull colour.
}

// The roles that may be rendered as TEXT. This is what makes §4's "there is intentionally no
// amber-text-on-surface role" a COMPILE ERROR rather than a convention (2026-08-03): `Text`'s
// `color` was `keyof ThemeColors`, so `<Text color="amberToken">` — or `scrim`, or `rule`, or a
// surface — typechecked fine. It was the one §4 guarantee with nothing behind it; no call site
// had drifted yet, which is the moment to close it.
// ⚠ Derived through `Pick` rather than hand-written, so it fails in BOTH directions: a role added
// to `ThemeColors` cannot silently widen what text may use, and renaming/dropping a listed role is
// an error HERE instead of a union that quietly shrinks under the call sites.
// Membership rule = "this role's contrast is gate-enforced as a FOREGROUND" (`theme.test.ts`):
// its `TEXT_ROLES` (safe on surface/surfaceRaised) PLUS the foreground half of each `ON_FILL` pair
// — `onPrimary`/`onAmber`/`onDanger`, which Button/FilterChip/Badge already render as text on a
// fill. The two lists differ on purpose and neither is stale: that test asks "safe on the app
// surface", this asks "is a text colour at all". Everything omitted is a surface, fill, rule, or
// rgba effect, and stays reachable from `style` / `Icon` / `Glyph` / `Ridgeline`.
export type TextColorRole = keyof Pick<
  ThemeColors,
  | 'ink'
  | 'inkDim'
  | 'inkFaint'
  | 'accent'
  | 'accentWarm'
  | 'onAmber'
  | 'water'
  | 'onPrimary'
  | 'onPhoto'
  | 'danger'
  | 'onDanger'
>

export interface Theme {
  name: 'light' | 'dark'
  isDark: boolean
  colors: ThemeColors
  // statusBar content style that reads on `surface`
  statusBar: 'dark' | 'light'
}

// The same color at ZERO alpha — the fade-OUT stop for scroll-edge gradients (EdgeFade). A
// CSS `transparent` stop would interpolate RGB toward black and tint the dissolve; matching
// `surface`'s own 0-alpha keeps it clean. Derived from palette so it can't drift from surface.
const fade = (hex: string): string => alpha(hex, 0)

const alpha = (hex: string, a: number): string => {
  const h = hex.replace('#', '')
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`
}

export const lightTheme: Theme = {
  name: 'light',
  isDark: false,
  statusBar: 'dark',
  colors: {
    surface: palette.paper,
    surfaceRaised: palette.paperRaised,
    surfaceSunken: palette.paperSunken,
    surfaceFade: fade(palette.paper),
    surfaceRaisedFade: fade(palette.paperRaised),
    keyline: palette.paperKeyline,
    ink: palette.inkBrown,
    inkDim: palette.inkFaded,
    inkFaint: palette.inkFaint,
    accent: palette.pine,
    accentWarm: palette.amberBurnt, // amber that survives as text on paper
    amberToken: palette.amberSunset,
    onAmber: palette.inkBrown, // inkBrown on amberSunset = 5.25:1
    water: palette.lakeTeal,
    primaryFill: palette.pine, // a ranger-green sign
    onPrimary: palette.paperRaised, // cream
    trackActive: palette.pine,
    trackInactive: palette.tanRule,
    routeTrail: palette.trailInk,
    rule: palette.tanRule,
    danger: palette.rustError,
    onDanger: palette.paperRaised,
    // ⚠ READ BY NOTHING IN THIS THEME (2026-08-03), and that is correct rather than an oversight. The
    // campfire halo is a DUSK effect: it composites to 1.30 against paper, so in daylight it rendered
    // nothing while still costing a shadow pass. Every consumer theme-gates it now and uses
    // `shadowCast` in day. The key stays because `ThemeColors` requires it — do NOT wire a component
    // to it to make it earn its keep.
    glow: 'rgba(221,122,51,0.30)',
    shadowCast: 'rgba(42,32,20,0.20)',
    scrim: 'rgba(42,32,20,0.42)',
    // ⚠ Identical in both themes on purpose — see the pair's note on ThemeColors.
    photoScrim: palette.inkBrown,
    photoScrimFade: fade(palette.inkBrown),
    onPhoto: palette.paperRaised,
    // lakeTeal at low alpha — the day basemap is bright paper, so the wash needs less to read
    // than it does at dusk (the same asymmetry `glow` carries at 0.30 light / 0.42 dark).
  },
}

export const darkTheme: Theme = {
  name: 'dark',
  isDark: true,
  statusBar: 'light',
  colors: {
    surface: palette.night,
    surfaceRaised: palette.nightRaised,
    surfaceSunken: palette.nightSunken,
    surfaceFade: fade(palette.night),
    surfaceRaisedFade: fade(palette.nightRaised),
    keyline: palette.nightKeyline,
    ink: palette.parchment,
    inkDim: palette.parchFaded,
    inkFaint: palette.parchFaint,
    accent: palette.pineGlow,
    accentWarm: palette.lanternAmber,
    amberToken: palette.lanternAmber,
    onAmber: palette.inkBrown, // inkBrown on lanternAmber = 7.52:1
    water: palette.lakeTealNight,
    primaryFill: palette.lanternAmber, // a campfire-lit button
    onPrimary: palette.inkBrown, // dark ink glows on amber
    trackActive: palette.pineGlow,
    trackInactive: palette.tanRuleNight,
    routeTrail: palette.tanRule,
    rule: palette.tanRuleNight,
    danger: palette.emberError,
    onDanger: palette.inkBrown,
    glow: 'rgba(235,163,81,0.42)',
    shadowCast: 'rgba(0,0,0,0.5)',
    scrim: 'rgba(0,0,0,0.55)',
    // ⚠ The SAME values as day. A dusk-darkened caption over a daylit photograph would be a
    // contrast failure that only appears at night, which is the class of bug this pair prevents.
    photoScrim: palette.inkBrown,
    photoScrimFade: fade(palette.inkBrown),
    onPhoto: palette.paperRaised,
    // lakeTealNight, lifted — over the deep-pine night basemap a 0.14 wash disappears entirely.
  },
}

export const themes = { light: lightTheme, dark: darkTheme } as const
