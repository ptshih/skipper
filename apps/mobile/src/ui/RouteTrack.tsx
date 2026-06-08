// The route as a dashed ATLAS TRAIL with a little car token gliding along it —
// the signature motif. The token is the skipper's rig (not a generic dot), so
// the road-trip guide stays present inside the park aesthetic. Driven by an
// Animated.Value in [0,1]; JS-driven (percentage layout can't use the native
// driver) — keep it the only thing animating on a frame to stay smooth.
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { border } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon } from './Icon'

export interface RouteTrackProps {
  progress: Animated.Value // 0..1
  height?: number
  style?: StyleProp<ViewStyle>
}

const TOKEN = 24

export function RouteTrack({ progress, height = 6, style }: RouteTrackProps) {
  const { colors } = useTheme()
  const pct = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  })

  return (
    <View
      style={[styles.wrap, { height: TOKEN }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* dashed inactive trail bed */}
      <View
        style={[
          styles.bed,
          {
            height,
            top: (TOKEN - height) / 2,
            // square corners so the dashed border renders dashed on iOS (rounded → solid)
            borderRadius: 0,
            borderColor: colors.trackInactive,
          },
        ]}
      />
      {/* traveled portion */}
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          top: (TOKEN - height) / 2,
          height,
          width: pct,
          borderRadius: height / 2,
          backgroundColor: colors.trackActive,
        }}
      />
      {/* The car token rides a rail inset by half its width on each side, so the disc
          EDGES stay flush with the track ends instead of the disc CENTER. At 0% its left
          edge sits right at the gutter — lined up with the cards below — rather than half
          the disc hanging past it; same at 100% on the right. */}
      <View style={styles.tokenRail}>
        <Animated.View
          style={[
            styles.token,
            {
              left: pct,
              backgroundColor: colors.amberToken,
              boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 6, color: colors.glow }],
            },
          ]}
        >
          <Icon name="car" size={14} color="onAmber" />
        </Animated.View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { justifyContent: 'center' },
  // Inset the token's travel by half its width on each side so its disc EDGES (not its
  // center) stay flush with the track ends — left edge at the gutter at 0%, lined up with
  // the cards below; right edge at the far gutter at 100%.
  tokenRail: { position: 'absolute', left: TOKEN / 2, right: TOKEN / 2, top: 0, bottom: 0 },
  bed: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderWidth: border.keyline,
    borderStyle: 'dashed',
  },
  token: {
    position: 'absolute',
    width: TOKEN,
    height: TOKEN,
    marginLeft: -TOKEN / 2,
    borderRadius: TOKEN / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
