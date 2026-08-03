// Contrast guarantees AS TESTS — makes DESIGN.md §4 ("every text role clears 4.5:1
// on surface AND surfaceRaised in both themes") executable, so a palette tweak can't
// silently break it. This is the exact doc↔code drift an earlier review caught (the
// claim was false until inkFaint was darkened). Runs under `bun test`.
import { expect, test } from 'bun:test'
import { darkTheme, lightTheme, type Theme, type ThemeColors } from './theme'

const ch = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
function relLuminance(hex: string): number {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}
function contrast(a: string, b: string): number {
  const x = relLuminance(a)
  const y = relLuminance(b)
  const [hi, lo] = x >= y ? [x, y] : [y, x]
  return (hi + 0.05) / (lo + 0.05)
}

// Roles rendered as TEXT on the app surface + raised cards.
const TEXT_ROLES: (keyof ThemeColors)[] = [
  'ink',
  'inkDim',
  'inkFaint',
  'accent',
  'accentWarm',
  'water',
  'danger',
]
const SURFACES: (keyof ThemeColors)[] = ['surface', 'surfaceRaised']
// surfaceSunken (segmented-picker tracks, the active StopRow well) carries ONLY these text roles —
// the active row's name (ink), its sublabel + the picker labels (inkDim), and the active glyph
// (accent). The other roles dip below AA on the LIGHT sunken token (measured: inkFaint 4.30, water
// 4.12, danger 4.39, accentWarm 4.35) and must NOT be used as text there. Gate-enforcing the safe set
// stops a future paperSunken/inkDim tweak from silently breaking the pickers + active row. (audit #653, #644)
const SUNKEN_TEXT_ROLES: (keyof ThemeColors)[] = ['ink', 'inkDim', 'accent']
// Paired fill + on-fill roles (always used together) — every Badge `filled` tone is here so a tweak
// to water/rule/accent can't push a filled badge under AA unnoticed. (audit #680)
const ON_FILL: [keyof ThemeColors, keyof ThemeColors][] = [
  ['onPrimary', 'primaryFill'],
  ['onAmber', 'amberToken'],
  ['onDanger', 'danger'],
  ['onPrimary', 'accent'], // Badge tone="pine" filled (accent ≠ primaryFill in dark)
  ['onPrimary', 'water'], // Badge tone="teal" filled
  ['ink', 'rule'], // Badge tone="neutral" filled
]
const AA = 4.5

for (const theme of [lightTheme, darkTheme] as Theme[]) {
  for (const role of TEXT_ROLES)
    for (const surf of SURFACES)
      test(`${theme.name}: ${role} text on ${surf} clears ${AA}:1`, () => {
        expect(contrast(theme.colors[role], theme.colors[surf])).toBeGreaterThanOrEqual(AA)
      })
  for (const role of SUNKEN_TEXT_ROLES)
    test(`${theme.name}: ${role} text on surfaceSunken clears ${AA}:1`, () => {
      expect(contrast(theme.colors[role], theme.colors.surfaceSunken)).toBeGreaterThanOrEqual(AA)
    })
  for (const [fg, bg] of ON_FILL)
    test(`${theme.name}: ${fg} on ${bg} clears ${AA}:1`, () => {
      expect(contrast(theme.colors[fg], theme.colors[bg])).toBeGreaterThanOrEqual(AA)
    })
}


// ─────────────────────────────────────────────────────────────────────────────
// MARKS ON THE BASEMAP — the gap that produced three bugs before anyone measured it.
//
// Everything above asks "does this text read on one of OUR surfaces". Nothing asked whether a mark
// reads on the MAP, which we do not control: `theme/mapStyle.ts` paints it from the same palette, so
// a brand colour and a basemap layer can land on the SAME HEX and no test notices. Three instances,
// every one found by eye rather than by CI:
//   1. water LABELS at ~1:1 on the lake (fixed by hiding them — audit #662)
//   2. the ROUTE line drawn in the roads' own colour — contrast 1.00 in BOTH themes. It read as a
//      MISSING polyline on device, not a faint one (fixed 2026-08-03, the `routeTrail` role)
//   3. `passed` stop markers, pine at 1.05 on the lake and STILL 1.05 under simulated deuteranopia
//      and protanopia — so hue did not rescue it (fixed 2026-08-03 with the ring its siblings had)
//
// ⚠ THRESHOLD IS 3:1, NOT 4.5 — these are graphical objects, so WCAG 2.1 SC 1.4.11 applies, not the
// text ratio. Using 4.5 here would fail honest marks and teach the next person to baseline it away.
//
// ⚠ THE RULE IS A DISJUNCTION, and getting that wrong is instructive enough to record: the first cut
// asserted that the `surface` separator must clear EVERY layer, which failed six honest pairs. A mark
// survives if EITHER its own colour clears the layer OR its `surface` casing/ring does. Pine on water
// is 1.05 and survives on its dark ring; pine on a road needs no ring because the pine already reads.
// Demanding both is not a stricter guarantee, it is a wrong one.
//
// ⚠ AND NO SINGLE FLAT COLOUR CAN PASS ALONE. Dusk land is #14201B and dusk water is #5FA7B8 —
// opposite ends — so the tan scoring 4.97 on land scores 1.24 on the lake. That is WHY marks carry a
// separator at all, and why one value (`surface`) silently carries the whole guarantee.
const MAP_LAYERS = (t: Theme): Record<string, string> => ({
  land: t.isDark ? '#14201B' : '#F2E7CC',
  water: t.isDark ? '#5FA7B8' : '#2C6E7E',
  roadMajor: t.isDark ? '#2A3A30' : '#E7D9B5',
  roadMinor: t.isDark ? '#3A4A3E' : '#CDB988',
  park: t.isDark ? '#163326' : '#DDE3C9',
})
// The brand colours DriveMap paints onto the basemap, each drawn with a `colors.surface` casing (the
// route line) or ring (every marker fill).
// ⚠ SCOPE, STATED RATHER THAN SILENT: `amberToken` (the active marker + the puck) is NOT here. It
// fails this rule on the DAYLIGHT basemap — #DD7A33 on paper is ~2.5, and its `surface` ring cannot
// help because `surface` IS the land. That is a REAL open finding, recorded in TODO.md, not a pair
// this rule gets wrong: a saturated orange on cream separates by hue for most riders, which is
// precisely the reassurance a low-vision rider does not get. It is excluded because fixing it means
// changing the LIVE DRIVE's puck, which is deliberately frozen until the first real drive — not
// because it passes. Add it here the moment that ships.
const MAP_MARKS: (keyof ThemeColors)[] = ['routeTrail', 'trackActive']
const NON_TEXT_AA = 3

for (const theme of [lightTheme, darkTheme] as Theme[]) {
  const layers = MAP_LAYERS(theme)
  for (const mark of MAP_MARKS)
    for (const [layer, hex] of Object.entries(layers))
      test(`${theme.name}: ${mark} is separable on map ${layer}`, () => {
        const own = contrast(theme.colors[mark], hex)
        const ring = contrast(theme.colors.surface, hex)
        expect(Math.max(own, ring)).toBeGreaterThanOrEqual(NON_TEXT_AA)
      })

  // The route line additionally has to carry ITSELF against the roads. A road runs underneath it for
  // the route's whole length, so a collision there is the one case a casing cannot fix — the ring
  // would be tracing the same road the line is lost in. This is instance #2's regression test, and it
  // is what caught `trailInk`'s first cut (2.07 on the daylight roads, under the 3:1 bar).
  for (const road of ['roadMajor', 'roadMinor'] as const)
    test(`${theme.name}: routeTrail clears ${NON_TEXT_AA}:1 on map ${road} unaided`, () => {
      expect(contrast(theme.colors.routeTrail, layers[road]!)).toBeGreaterThanOrEqual(NON_TEXT_AA)
    })

  // ⚠ `surface` IS the basemap's land colour, deliberately (mapStyle draws land from the same token).
  // That is why a ring vanishes ON land and does not need to be there — the mark itself contrasts
  // land. Asserted so the relationship is a FACT rather than a coincidence: retint land away from
  // `surface` and the sentence above stops being true, loudly, here.
  test(`${theme.name}: basemap land is exactly \`surface\``, () => {
    expect(layers.land).toBe(theme.colors.surface)
  })
}
