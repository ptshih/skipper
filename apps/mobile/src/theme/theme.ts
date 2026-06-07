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
  keyline: string // bright inner rule that fakes a carved-sign edge
  // text
  ink: string // primary text
  inkDim: string // secondary (region, stop type, timers)
  inkFaint: string // tertiary hints
  // brand accents
  accent: string // pine — active bullets, icons, links, success TEXT
  accentWarm: string // contrast-safe warm accent TEXT (kickers, badges)
  amberToken: string // bright amber FILL/shape only (moving token, meter pips)
  onAmber: string // dark ink that reads on an amber fill (enamel discs/badges)
  water: string // teal — scenic/water motif
  // interactive
  primaryFill: string // primary button + active-track fill
  onPrimary: string // text/glyphs on primaryFill
  trackActive: string // traveled portion of the route trail
  trackInactive: string // dashed atlas trail (untraveled) + hairlines
  rule: string // dividers, card keylines, dashed rules
  // status
  danger: string
  onDanger: string
  // effects (rgba strings — used for glow/shadow/scrim overlays via boxShadow)
  glow: string // campfire-amber halo (NOW card, dusk CTA, boat token)
  shadowCast: string // neutral ambient cast shadow (daylight elevation)
  scrim: string // dim behind sheets / gates
}

export interface Theme {
  name: 'light' | 'dark'
  isDark: boolean
  colors: ThemeColors
  // statusBar content style that reads on `surface`
  statusBar: 'dark' | 'light'
}

export const lightTheme: Theme = {
  name: 'light',
  isDark: false,
  statusBar: 'dark',
  colors: {
    surface: palette.paper,
    surfaceRaised: palette.paperRaised,
    surfaceSunken: palette.paperSunken,
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
    rule: palette.tanRule,
    danger: palette.rustError,
    onDanger: palette.paperRaised,
    glow: 'rgba(221,122,51,0.30)',
    shadowCast: 'rgba(42,32,20,0.20)',
    scrim: 'rgba(42,32,20,0.42)',
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
    rule: palette.tanRuleNight,
    danger: palette.emberError,
    onDanger: palette.inkBrown,
    glow: 'rgba(235,163,81,0.42)',
    shadowCast: 'rgba(0,0,0,0.5)',
    scrim: 'rgba(0,0,0,0.55)',
  },
}

export const themes = { light: lightTheme, dark: darkTheme } as const
