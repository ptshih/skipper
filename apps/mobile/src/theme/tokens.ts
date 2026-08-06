// ─────────────────────────────────────────────────────────────────────────────
// Skipper design tokens — "Trailhead 89"
// A 1938 WPA national-park poster that learned to play audio. These are the RAW
// values + scales. Semantic, theme-aware color roles live in `theme.ts`; never
// reach past a semantic role to a raw hex inside a component.
// ─────────────────────────────────────────────────────────────────────────────
import type { TextStyle } from 'react-native'

// ── Raw palette ──────────────────────────────────────────────────────────────
// Two moods of the same park: DAY (aged map-paper) and DUSK (the park at night).
// In-car legibility note: amber is a FILL, never small text on paper (~2:1 fails).
// `theme.ts` enforces this — there is no "amber text on surface" role in light.
export const palette = {
  // Daylight / paper
  paper: '#F2E7CC', // app background — aged road-atlas paper
  paperRaised: '#FBF3DD', // ranger-placard card fill (lifts off paper)
  paperSunken: '#E7D9B5', // inset wells: timer chips, the route track bed
  paperKeyline: '#FFF8E6', // bright inner keyline that fakes a carved sign edge
  inkBrown: '#2A2014', // primary text — ~11:1 on paper, the glance workhorse
  inkFaded: '#5C4A30', // secondary text (region, stop type) — kept ~5:1 for glare
  inkFaint: '#74603E', // tertiary hints — darkened to clear 4.5:1 on paper (was #8A7550)
  pine: '#1E5B40', // primary green — CTA fill, active track, success
  // ⚠ ILLUSTRATION ONLY — the home poster's nearest ridge. It exists because the UI palette had no
  // deep green: `pine` is the mid plane and there was nothing behind it, so a landscape drawn from UI
  // roles alone came out flat. Never text, never a control (docs/designs/home-hero-poster.md).
  pineDeep: '#15402F',
  amberSunset: '#DD7A33', // bright amber — FILLS & tokens only (moving dot, glow)
  amberBurnt: '#9A4D17', // amber that survives as TEXT on paper (~5:1) — kickers
  lakeTeal: '#2C6E7E', // cool route/water accent + scenic badges
  tanRule: '#CDB988', // hairlines, dashed inactive track, dividers
  // The route line ON A BASEMAP, daylight. A deeper tan than `tanRule` for one measured reason: the
  // map style paints minor roads in `tanRule` too, so a route drawn in it scored **1.00** against the
  // roads underneath — not faint, IDENTICAL. This clears them at 3.67 and the paper at 5.76 — the 3:1 non-text bar (WCAG 2.1 SC 1.4.11), which a first cut at #967C46 missed at 2.07 and the new map-layer test caught.
  trailInk: '#6B552F',
  rustError: '#A8401F', // errors — brick-and-clay, never clinical blue-red

  // Dusk — a first-class peer, NOT the reference theme (that's day; DESIGN §2.4, founder 2026-08-03)
  night: '#14201B', // app background — deep dusk-pine, calmer than true black
  nightRaised: '#1E2B24', // raised placard at dusk
  nightSunken: '#101A15', // inset wells at dusk
  nightKeyline: '#2A3A30', // subtle lifted keyline on dark
  parchment: '#ECE0C4', // primary text — warm, NOT pure white (cuts night glare)
  parchFaded: '#A99D80', // secondary text on dark
  parchFaint: '#9A9075', // tertiary hints on dark — lifted to clear 4.5:1 (was #7C7158)
  pineGlow: '#5FA877', // pine lifted so "active" still reads on night
  // ⚠ ILLUSTRATION ONLY — the poster's mid + near ridges at dusk, and NOT `pineGlow`. That token is
  // deliberately LIFTED so an active control reads at night, which is right for a glyph and far too
  // loud as a full-width filled plane. A landscape at dusk recedes; a control does not.
  pineNight: '#2E6B4C',
  pineDeepNight: '#1B3A2B',
  lanternAmber: '#EBA351', // primary night accent — glow CTA, kicker, token
  lakeTealNight: '#5FA7B8', // cool accent lifted for dark
  tanRuleNight: '#3A4A3E', // muted-pine hairlines that read as "off"
  emberError: '#E97559', // glowing-ember error — clears 4.5:1 on raised too (was #E0664A)
} as const

// ── Spacing (4-pt grid) ──────────────────────────────────────────────────────
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
  gutter: 16, // standard screen edge padding
} as const

// ── Radii ────────────────────────────────────────────────────────────────────
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const

// ── Borders / keylines ───────────────────────────────────────────────────────
export const border = {
  hair: 0.5, // ~StyleSheet.hairlineWidth on most devices; kept static for tokens
  thin: 1,
  keyline: 1.5, // the carved-placard double-rule
} as const

// ── Motion ───────────────────────────────────────────────────────────────────
export const duration = {
  fast: 120,
  base: 220,
  slow: 420,
  stamp: 520, // the passport-stamp "ink press"
} as const

// ── Type families (loaded in fonts.ts via @expo-google-fonts) ────────────────
// Display = constructed park-sign slab; all display sizes use 700 (the token bakes the weight in).
// Body    = calligraphic screen slab; road-notebook warmth at UI scale (Lora).
// Mono    = highway-sign / odometer numerals — every number looks stamped.
export const fonts = {
  display: 'ZillaSlab_700Bold',
  body: 'Lora_400Regular',
  bodyMedium: 'Lora_600SemiBold',
  bodyBold: 'Lora_700Bold',
  mono: 'OverpassMono_400Regular',
  monoSemiBold: 'OverpassMono_600SemiBold',
} as const

// ── Type scale (semantic variants) ───────────────────────────────────────────
// Color is applied by the <Text> component, not here. Heavy display faces are
// reserved for LARGE sizes where slab strokes aid the glance; small UI stays Lora.
export type TypeVariant =
  | 'wordmark'
  | 'display'
  | 'placardTitle'
  | 'titleXL'
  | 'title'
  | 'heading'
  | 'body'
  | 'bodyStrong'
  | 'label'
  | 'dim'
  | 'mono'
  | 'monoStrong'

export const typeScale: Record<TypeVariant, TextStyle> = {
  wordmark: { fontFamily: fonts.display, fontSize: 26, lineHeight: 30, letterSpacing: 0.2 },
  display: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36 },
  placardTitle: { fontFamily: fonts.display, fontSize: 22, lineHeight: 27, letterSpacing: 0.1 },
  titleXL: { fontFamily: fonts.bodyBold, fontSize: 24, lineHeight: 30 },
  title: { fontFamily: fonts.bodyBold, fontSize: 20, lineHeight: 26 },
  heading: { fontFamily: fonts.bodyBold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: fonts.bodyMedium, fontSize: 16, lineHeight: 24 },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12.5,
    lineHeight: 16,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  dim: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19 },
  mono: { fontFamily: fonts.mono, fontSize: 14, lineHeight: 18 },
  monoStrong: { fontFamily: fonts.monoSemiBold, fontSize: 15, lineHeight: 18, letterSpacing: 0.2 },
}

// ── Hit targets ──────────────────────────────────────────────────────────────
// In-car: thumbs, gloves, potholes. Nothing tappable below `min`; primary CTAs `cta`.
export const hit = {
  min: 48,
  cta: 60,
} as const

// ── Dynamic Type policy ──────────────────────────────────────────────────────
// Deliberate, NOT accidental: SCROLLABLE / non-driving surfaces (settings, sign-in,
// the corridor + drive lists, legal) stay UNCAPPED so they honor the full iOS Dynamic
// Type range incl. the accessibility (AX) sizes — WCAG 1.4.4 for all real content.
// The few GLANCE-CRITICAL in-car player surfaces — the flanked transport labels, the
// mono timers, the NOW-card title — cap growth here so a label can't blow out the
// fixed control row or truncate mid-word at a 60mph glance. No information is lost on
// a capped surface: those labels are short and mirrored by an icon + accessibilityLabel
// (and the timer by the scrubber's spoken accessibilityValue). 1.35 ≈ iOS's largest
// *standard* (non-accessibility) text size — generous, but bounded.
export const IN_CAR_MAX_FONT_SCALE = 1.35
