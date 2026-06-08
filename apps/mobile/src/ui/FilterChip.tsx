// A pressable enamel filter chip for THE DRIVES filter bar. Pine-OUTLINED when idle,
// pine-FILLED when a filter is active — using accent + onPrimary, the SAME contrast-safe
// pairing Badge's pine tone uses (day: pine fill + cream; dusk: light-pine fill + ink), so
// it reads "selected" in both themes. Pine, NEVER amber: the home's lone amber glow stays
// the hero's parked rig (DESIGN §8). The trailing chevron reads "opens a picker". This is
// the extension point — future filters (duration, interests, joke level) are just more
// chips in the same bar.
import { Pressable, StyleSheet } from 'react-native'
import { border, radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon } from './Icon'
import { Text } from './Text'

export interface FilterChipProps {
  label: string
  active?: boolean
  onPress: () => void
  accessibilityLabel?: string
}

export function FilterChip({ label, active, onPress, accessibilityLabel }: FilterChipProps) {
  const { colors } = useTheme()
  const content = active ? 'onPrimary' : 'accent'
  return (
    <Pressable
      onPress={onPress}
      // ~32pt visual chip; hitSlop lifts the touch target past the 48pt in-car minimum.
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: colors.accent, backgroundColor: active ? colors.accent : 'transparent' },
        pressed && styles.pressed,
      ]}
    >
      <Text variant="label" color={content} numberOfLines={1}>
        {label}
      </Text>
      <Icon name="expand" size={14} color={content} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: border.keyline,
    alignSelf: 'flex-start',
  },
  pressed: { opacity: 0.7 },
})
