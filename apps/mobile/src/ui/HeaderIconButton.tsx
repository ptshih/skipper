// A circular header button — OUR OWN themed disc. We strip iOS 26's Liquid Glass
// capsule (hidesSharedBackground, see app/_layout.tsx) because its material can't be
// de-contrasted and blows out to a glaring bright disc on the dark DUSK bar. Drawing
// the circle ourselves means full theme control: a subtle ranger-placard chip that
// reads the same in day and dusk, with a crisp ink glyph (ink-on-raised clears 4.5:1).
// ~40pt + hitSlop keeps the in-car tap target generous.
import { Pressable, StyleSheet } from 'react-native'
import { radius } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon, type IconName } from './Icon'

export interface HeaderIconButtonProps {
  name: IconName
  onPress: () => void
  accessibilityLabel: string
}

export function HeaderIconButton({ name, onPress, accessibilityLabel }: HeaderIconButtonProps) {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: colors.surfaceRaised, borderColor: colors.rule },
        pressed && styles.pressed,
      ]}
    >
      <Icon name={name} size={20} color="ink" />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
})
