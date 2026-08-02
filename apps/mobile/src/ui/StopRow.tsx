// A stop in the route list — clean rows that sit UNDER the player card and echo it.
// Three states read at a glance, no fussy bullets or double-indicators:
//   upcoming — stop-type glyph + name (calm)
//   active   — a sunken "you-are-here" well (surfaceSunken) + accent glyph + bold name. Sunken
//              (not raised) so it reads BOTH on the bare screen AND inside the raised route
//              card. PINE accent, never amber — the player card owns the one amber glow.
//   passed   — dimmed, with a quiet check
import { memo, useEffect } from 'react'
import { Animated, Pressable, StyleSheet, useAnimatedValue, View } from 'react-native'
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

function StopRowBase({
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
  const stamp = useAnimatedValue(enterStamp ? 0 : 1)
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
      // Derive interactivity from the handler: a read-only row (live/sim drive, tour detail)
      // announces as plain 'text', not a tappable 'button' that does nothing, and skips the
      // press tracking + pressed dimming. Only the preview (onPress set) reads as a button.
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      // Selection state only on the INTERACTIVE (button) row — a 'text' row announcing "selected" is
      // semantically odd; the label suffix (", now playing") carries it for read-only rows. (audit #716)
      accessibilityState={onPress ? { selected: active } : undefined}
      accessibilityLabel={`${name}${sublabel ? `, ${sublabel}` : ''}${active ? ', now playing' : passed ? ', played' : ''}`}
      style={({ pressed }) => [
        styles.row,
        // active = a sunken "you-are-here" well — reads on the bare screen AND inside the raised
        // route card (where a surfaceRaised chip would vanish). No border/halo, so it stays
        // subordinate and never competes for the single amber glow.
        active && { backgroundColor: colors.surfaceSunken },
        pressed && onPress && styles.pressed,
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
          // Active row paints surfaceSunken, where inkFaint is only 4.30:1 (below AA) — use inkDim
          // (6.05:1) there; inkFaint is fine on the normal surface of upcoming/passed rows. (audit #644)
          <Text variant="dim" color={active ? 'inkDim' : 'inkFaint'} numberOfLines={1}>
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

// memo: the active-stop index changes as the car advances, re-rendering the whole itinerary; with a
// stable per-row onPress (see StopList) this re-renders only the rows whose props actually change. (audit #621)
export const StopRow = memo(StopRowBase)

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
  body: { flex: 1, gap: 1 }, // deliberate 1pt name↔sublabel gap (off-grid; a grid step is too loose)
  pressed: { opacity: 0.7 },
})
