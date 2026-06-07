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

// Roles rendered as TEXT on a surface. (danger/water/accentWarm are scoped to
// surface + surfaceRaised; they're documented NOT to be used as text on surfaceSunken.)
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
// Paired fill + on-fill roles (always used together).
const ON_FILL: [keyof ThemeColors, keyof ThemeColors][] = [
  ['onPrimary', 'primaryFill'],
  ['onAmber', 'amberToken'],
  ['onDanger', 'danger'],
]
const AA = 4.5

for (const theme of [lightTheme, darkTheme] as Theme[]) {
  for (const role of TEXT_ROLES)
    for (const surf of SURFACES)
      test(`${theme.name}: ${role} text on ${surf} clears ${AA}:1`, () => {
        expect(contrast(theme.colors[role], theme.colors[surf])).toBeGreaterThanOrEqual(AA)
      })
  for (const [fg, bg] of ON_FILL)
    test(`${theme.name}: ${fg} on ${bg} clears ${AA}:1`, () => {
      expect(contrast(theme.colors[fg], theme.colors[bg])).toBeGreaterThanOrEqual(AA)
    })
}
