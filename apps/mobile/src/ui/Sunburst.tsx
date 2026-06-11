// The WPA travel-poster sunburst — a faint radiating watermark behind the home masthead.
// Tapered rays (wide at the rim, a point at the center), drawn with plain Views (border
// triangles) so it needs no SVG dependency. Decorative only: low opacity, pointer-events
// off, no a11y surface. Color is a theme ROLE so it swaps day/dusk like everything else.
import { StyleSheet, View } from 'react-native'
import { useTheme } from '../theme/ThemeProvider'
import type { ThemeColors } from '../theme/theme'

export interface SunburstProps {
  size?: number
  rays?: number
  opacity?: number
  color?: keyof ThemeColors
}

export function Sunburst({ size = 168, rays = 18, opacity = 0.09, color = 'amberToken' }: SunburstProps) {
  const { colors } = useTheme()
  const w = Math.max(1, size * 0.022) // half-width of a ray's base at the rim
  return (
    <View style={{ width: size, height: size, opacity }} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: rays }).map((_, i) => (
        <View key={i} style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${(360 / rays) * i}deg` }] }]}>
          {/* a down-pointing triangle: base (2w) at the rim (top), apex at the center */}
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: size / 2 - w,
              width: 0,
              height: 0,
              borderLeftWidth: w,
              borderRightWidth: w,
              borderTopWidth: size / 2,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderTopColor: colors[color],
            }}
          />
        </View>
      ))}
    </View>
  )
}
