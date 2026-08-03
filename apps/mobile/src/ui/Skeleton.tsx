// Loading placeholders — the "content shape is arriving" cue that replaces a bare spinner
// on a blank screen (the home drive list, the drive placard). A `Skeleton` is one inert
// `surfaceSunken` block (the same inset-well tone an empty field wears); a `SkeletonGroup`
// wraps a silhouette of them and breathes the WHOLE thing as ONE element — a single shared
// opacity pulse, so the screen never shows "a field of" animating blocks (DESIGN §8: at most
// one moving element). Neutral, never amber, so it doesn't spend the one-glow budget. The
// pulse is gated on Reduce Motion (falls back to a static mid-opacity), like the player's
// celebratory beats.
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { Animated, useAnimatedValue, type StyleProp, type ViewStyle, type DimensionValue } from 'react-native'
import { radius as radii } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { useReducedMotion } from '../theme/useReducedMotion'

// A slow breath (~1.4s round trip) — calmer than a UI transition; reads as "working", not
// "flashing". Not a `duration` token: those cap at the snappy end (slow=420) for real UI.
const PULSE_MS = 720

export interface SkeletonProps {
  /** Block width — a number (px) or a `'70%'` string. Defaults to fill the row. */
  width?: DimensionValue
  /** Block height in px. Defaults to a single text line. */
  height?: number
  /** Corner radius role (defaults to `sm`). */
  radius?: keyof typeof radii
  style?: StyleProp<ViewStyle>
}

/** One inert placeholder block. Animation lives on the enclosing `SkeletonGroup`, not here. */
export function Skeleton({ width = '100%', height = 14, radius = 'sm', style }: SkeletonProps) {
  const { colors } = useTheme()
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radii[radius], backgroundColor: colors.surfaceSunken },
        style,
      ]}
    />
  )
}

export interface SkeletonGroupProps {
  children: ReactNode
  /** Spoken once by VoiceOver (the persona loading line) — the subtree is otherwise silent. */
  accessibilityLabel?: string
  style?: StyleProp<ViewStyle>
}

/**
 * Wraps a skeleton silhouette and pulses it as a single element. Collapses to one
 * accessibility node ("busy") so the reader announces the loading line once, not every block.
 */
export function SkeletonGroup({ children, accessibilityLabel, style }: SkeletonGroupProps) {
  const reduced = useReducedMotion()
  const pulse = useAnimatedValue(0)

  useEffect(() => {
    if (reduced) return
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: PULSE_MS, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [reduced, pulse])

  // Reduce Motion: hold a static mid-opacity (the pulse's resting middle) instead of breathing.
  const opacity = reduced
    ? 0.6
    : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] })

  return (
    <Animated.View
      style={[{ opacity }, style]}
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: true }}
    >
      {children}
    </Animated.View>
  )
}
