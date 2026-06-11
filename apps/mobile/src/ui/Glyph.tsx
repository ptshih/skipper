// Renders an icon/emoji glyph in the SYSTEM font. The custom faces (Lora, Zilla
// Slab, Overpass Mono) carry no emoji/symbol glyphs and a custom-font text run
// does NOT fall back, so a glyph placed in a themed <Text> renders as tofu (□ / ?).
// Glyph keeps glyphs on the system font, where emoji + geometric symbols resolve.
// Decorative by default (hidden from the a11y tree — the parent carries the label).
// Placeholder until the SVG enamel-badge set lands (DESIGN §9).
import { Text as RNText, type StyleProp, type TextStyle } from 'react-native'
import { useTheme } from '../theme/ThemeProvider'
import type { ThemeColors } from '../theme/theme'

export interface GlyphProps {
  glyph: string
  size?: number
  color?: keyof ThemeColors
  style?: StyleProp<TextStyle>
}

export function Glyph({ glyph, size = 16, color = 'ink', style }: GlyphProps) {
  const { colors } = useTheme()
  return (
    <RNText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      allowFontScaling={false}
      style={[{ fontSize: size, lineHeight: size * 1.25, color: colors[color] }, style]}
    >
      {glyph}
    </RNText>
  )
}
