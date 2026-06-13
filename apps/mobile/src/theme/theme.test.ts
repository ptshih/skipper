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
