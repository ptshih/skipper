// A pressable enamel TOGGLE chip: pine-OUTLINED when idle, pine-FILLED when active — using
// accent + onPrimary, the SAME contrast-safe pairing Badge's pine tone uses (day: pine fill
// + cream; dusk: light-pine fill + ink), so it reads "selected" in both themes. Pine, NEVER
// amber: the home's lone amber glow stays the hero's parked rig (DESIGN §8). Used as a
// segmented selector on Create (region, one-way/round-trip) — a tap SELECTS directly (no
// picker opens), so it carries NO trailing chevron: that caret read as a dropdown affordance
// it doesn't have, and looked cramped in the pill. The real "opens a picker" fields are the
// START/END PickerFields (a right-aligned chevron), not this chip.
//
// The pill shape is reused for the planner's example asks, but its TYPE is not: `variant`+`wrap`
// exist so a chip carrying a whole sentence isn't forced through the small-caps label scale
// (2026-08-03 — see the defaults' rationale below).
import { Pressable, StyleSheet } from 'react-native'
import { border, radius, space, type TypeVariant } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Text } from './Text'

export interface FilterChipProps {
  label: string
  active?: boolean
  onPress: () => void
  accessibilityLabel?: string
  /** Type scale for the chip's text. `label` (Lora 600 · 12.5 UPPER) by default because a
   *  SELECTOR chip is a short noun, which is exactly what DESIGN §5 assigns that variant.
   *  A chip whose text is a SENTENCE passes something readable instead — uppercase small caps
   *  at 12.5 read as a category tag, not as speech, and are the hardest text on the screen to
   *  parse in §2's half-second glance. */
  variant?: TypeVariant
  /** Let the text wrap to as many lines as it needs. Off by default — a one-word selector that
   *  wraps looks broken. ⚠ A wrapping chip is UNCAPPED on purpose (no `numberOfLines`): its host
   *  is a scrollable surface, so §8 says it grows through the AX Dynamic Type sizes rather than
   *  clipping a sentence the rider is being invited to say. */
  wrap?: boolean
}

export function FilterChip({
  label,
  active,
  onPress,
  accessibilityLabel,
  variant = 'label',
  wrap,
}: FilterChipProps) {
  const { colors } = useTheme()
  const content = active ? 'onPrimary' : 'accent'
  return (
    <Pressable
      onPress={onPress}
      // A one-line `label` chip is only ~34pt tall; hitSlop lifts the touch target past the 48pt
      // in-car minimum (§2.5/§8). ⚠ Keep the slop even for the taller text variants — a `body`
      // chip clears 48pt on its own, but the slop is what keeps the SHORT selector chips legal,
      // and it is the same constant either way, so there is nothing here to double up.
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
      <Text variant={variant} color={content} numberOfLines={wrap ? undefined : 1}>
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
