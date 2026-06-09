// A stop in the route list — clean rows that sit UNDER the player card and echo it.
// Three states read at a glance, no fussy bullets or double-indicators:
//   upcoming — stop-type glyph + name (calm)
//   active   — a sunken "you-are-here" well (surfaceSunken) + accent glyph + bold name. Sunken
//              (not raised) so it reads BOTH on the bare screen AND inside the raised route
//              card. PINE accent, never amber — the player card owns the one amber glow.
//   passed   — dimmed, with a quiet check
import { useEffect, useRef } from 'react'
import { Animated, Pressable, StyleSheet, View } from 'react-native'
import { radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon, type IconName } from './Icon'
import { Text } from './Text'

export const STOP_ROW_HEIGHT = 56

export type StopState = 'upcoming' | 'active' | 'passed'

export interface StopRowProps {
  name: string
  sublabel?: string
  state?: StopState
  icon?: IconName // stop-type icon
  onPress?: () => void
  /** When set, the passed-state check "stamps" in (the §9 passport-stamp) after `stampDelayMs`
   *  — the drive-complete cascade. Off by default and during a normal drive; the parent
   *  also gates it on Reduce Motion. */
  enterStamp?: boolean
  stampDelayMs?: number
}

export function StopRow({
  name,
  sublabel,
  state = 'upcoming',
  icon,
  onPress,
  enterStamp = false,
  stampDelayMs = 0,
}: StopRowProps) {
  const { colors } = useTheme()
  const active = state === 'active'
  const passed = state === 'passed'

  // The passed-check "ink press": opacity + scale + a slight rotate settle, staggered by the
  // parent. Starts at its END state (1) unless asked to stamp in, so a normal drive shows the
  // check statically — only the drive-complete cascade animates.
  const stamp = useRef(new Animated.Value(enterStamp ? 0 : 1)).current
  useEffect(() => {
    if (!enterStamp) return
    stamp.setValue(0)
    Animated.sequence([
      Animated.delay(stampDelayMs),
      Animated.spring(stamp, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }),
    ]).start()
  }, [enterStamp, stampDelayMs, stamp])

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${name}${sublabel ? `, ${sublabel}` : ''}${active ? ', now playing' : passed ? ', played' : ''}`}
      style={({ pressed }) => [
        styles.row,
        // active = a sunken "you-are-here" well — reads on the bare screen AND inside the raised
        // route card (where a surfaceRaised chip would vanish). No border/halo, so it stays
        // subordinate and never competes for the single amber glow.
        active && { backgroundColor: colors.surfaceSunken },
        pressed && styles.pressed,
      ]}
    >
      {/* The single leading marker — the stop-type glyph. Accent when active, faded when passed. */}
      {icon ? (
        <Icon name={icon} size={18} color={active ? 'accent' : passed ? 'inkFaint' : 'inkDim'} />
      ) : null}

      <View style={styles.body}>
        <Text
          variant={active ? 'bodyStrong' : 'body'}
          color={active ? 'ink' : passed ? 'inkDim' : 'ink'}
          numberOfLines={1}
        >
          {name}
        </Text>
        {sublabel ? (
          <Text variant="dim" color="inkFaint" numberOfLines={1}>
            {sublabel}
          </Text>
        ) : null}
      </View>

      {/* Only the PASSED state earns a trailing mark (a quiet check) — upcoming/active stay
          clean (the raised chip is the active cue; an upcoming row needs no affordance noise). */}
      {passed ? (
        <Animated.View
          style={{
            opacity: stamp,
            transform: [
              { scale: stamp.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
              {
                rotate: stamp.interpolate({ inputRange: [0, 1], outputRange: ['-16deg', '0deg'] }),
              },
            ],
          }}
        >
          <Icon name="passed" size={16} color="inkFaint" />
        </Animated.View>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: STOP_ROW_HEIGHT, // minHeight, not height — survives Dynamic Type
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  body: { flex: 1, gap: 1 },
  pressed: { opacity: 0.7 },
})
