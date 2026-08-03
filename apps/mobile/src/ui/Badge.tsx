// Enamel travel badge — a small pill for stop types and drive length.
// Outlined by default; `filled` for a solid enamel disc. Tone maps to a
// contrast-safe text color (note: amber text uses the burnt/lantern accent, never
// the bright fill amber, so it survives on paper).
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { border, radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import type { Theme } from '../theme/theme'
import { Glyph } from './Glyph'
import { Text } from './Text'

export type BadgeTone = 'pine' | 'amber' | 'teal' | 'rust' | 'neutral'

export interface BadgeProps {
  label?: string
  glyph?: string
  tone?: BadgeTone
  filled?: boolean
  style?: StyleProp<ViewStyle>
}

function toneColors(theme: Theme, tone: BadgeTone): { fg: string; solid: string; onSolid: string } {
  const c = theme.colors
  switch (tone) {
    case 'pine':
      return { fg: c.accent, solid: c.accent, onSolid: c.onPrimary }
    case 'amber':
      return { fg: c.accentWarm, solid: c.amberToken, onSolid: c.onAmber }
    case 'teal':
      return { fg: c.water, solid: c.water, onSolid: c.onPrimary }
    case 'rust':
      return { fg: c.danger, solid: c.danger, onSolid: c.onDanger }
    case 'neutral':
      return { fg: c.inkDim, solid: c.rule, onSolid: c.ink }
  }
}

export function Badge({ label, glyph, tone = 'neutral', filled, style }: BadgeProps) {
  const theme = useTheme()
  const { fg, solid, onSolid } = toneColors(theme, tone)
  const container: ViewStyle = filled
    ? { backgroundColor: solid }
    : { backgroundColor: 'transparent', borderWidth: border.thin, borderColor: fg }

  return (
    <View style={[styles.pill, container, style]}>
      {glyph ? <Glyph glyph={glyph} size={12} style={{ color: filled ? onSolid : fg }} /> : null}
      {label ? (
        <Text variant="label" style={[styles.label, { color: filled ? onSolid : fg }]}>
          {label}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 3, // intentional optical tuning for the pill (between xs=4 and 2); not a grid value
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  // Case is caller-controlled: short status pills pass UPPER, phrase labels Title.
  label: { textTransform: 'none' },
})
