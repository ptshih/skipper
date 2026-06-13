// The route as a dashed ATLAS TRAIL with a little car token gliding along it —
// the signature motif. The token is the skipper's rig (not a generic dot), so
// the road-trip guide stays present inside the park aesthetic. Driven by an
// Animated.Value in [0,1]; JS-driven (percentage layout can't use the native
// driver) — keep it the only thing animating on a frame to stay smooth.
import { useEffect, useState } from 'react'
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { border } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { useReducedMotion } from '../theme/useReducedMotion'
import { Icon } from './Icon'

export interface RouteTrackProps {
  progress: Animated.Value // 0..1
  height?: number
  /** The car token wears an amber halo by default (its motion cue on a drive). Pass
   *  `false` while a stop's NOW card is lit, so the screen never shows two amber glows
   *  at once (DESIGN §8: at most one moving/glowing amber element). */
  glow?: boolean
  style?: StyleProp<ViewStyle>
}

const TOKEN = 24

export function RouteTrack({ progress, height = 6, glow = true, style }: RouteTrackProps) {
  const { colors } = useTheme()
  const reduced = useReducedMotion()

  // Reduce Motion: the signature token must NOT glide. We track the progress value's
  // current number and render a STATIC percentage that snaps to each new position instead
  // of binding the layout to the Animated.Value (whose driver may still tween it). When
  // motion is allowed we use the interpolation so the token rides smoothly.
  const [snap, setSnap] = useState(() => (progress as unknown as { _value?: number })._value ?? 0)
  useEffect(() => {
    if (!reduced) return
    const id = progress.addListener(({ value }) => setSnap(Math.min(1, Math.max(0, value))))
    return () => progress.removeListener(id)
  }, [reduced, progress])

  const animatedPct = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  })
  // A plain `%` string when snapping, the Animated interpolation otherwise. Both are valid
  // values for `width` / `left`, so the same Animated.View renders either.
  const pct = reduced ? (`${snap * 100}%` as const) : animatedPct

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
              boxShadow: glow
                ? [{ offsetX: 0, offsetY: 0, blurRadius: 6, color: colors.glow }]
                : undefined,
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
