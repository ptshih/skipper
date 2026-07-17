// A pressable enamel TOGGLE chip: pine-OUTLINED when idle, pine-FILLED when active — using
// accent + onPrimary, the SAME contrast-safe pairing Badge's pine tone uses (day: pine fill
// + cream; dusk: light-pine fill + ink), so it reads "selected" in both themes. Pine, NEVER
// amber: the home's lone amber glow stays the hero's parked rig (DESIGN §8). Used as a
// segmented selector on Create (region, one-way/round-trip) — a tap SELECTS directly (no
// picker opens), so it carries NO trailing chevron: that caret read as a dropdown affordance
// it doesn't have, and looked cramped in the pill. The real "opens a picker" fields are the
// START/END PickerFields (a right-aligned chevron), not this chip.
import { Pressable, StyleSheet } from 'react-native'
import { border, radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
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
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: border.keyline,
    alignSelf: 'flex-start',
  },
  pressed: { opacity: 0.7 },
})
