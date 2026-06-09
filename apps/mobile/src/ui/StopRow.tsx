// A stop in the route list — clean rows that sit UNDER the player card and echo it.
// Three states read at a glance, no fussy bullets or double-indicators:
//   upcoming — stop-type glyph + name (calm)
//   active   — a subtle RAISED chip (surfaceRaised, like the card) + accent glyph + bold
//              name. PINE accent, never amber — the player card owns the one amber glow.
//   passed   — dimmed, with a quiet check
import { Pressable, StyleSheet, View } from 'react-native'
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
}

export function StopRow({ name, sublabel, state = 'upcoming', icon, onPress }: StopRowProps) {
  const { colors } = useTheme()
  const active = state === 'active'
  const passed = state === 'passed'

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${name}${sublabel ? `, ${sublabel}` : ''}${active ? ', now playing' : passed ? ', played' : ''}`}
      style={({ pressed }) => [
        styles.row,
        // active = a raised chip echoing the player card (surfaceRaised); no border/halo so it
        // stays subordinate to the card and never competes for the single amber glow.
        active && { backgroundColor: colors.surfaceRaised },
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
      {passed ? <Icon name="passed" size={16} color="inkFaint" /> : null}
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
