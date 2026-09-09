// A circular header button with a theme-controlled disc and crisp ink glyph.
// AppHeader keeps these controls in the React accessibility tree on iOS 26.
// ~40pt + hitSlop keeps the in-car tap target generous.
import { Pressable, StyleSheet } from 'react-native'
import { border, radius } from '../theme/tokens'
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
    borderWidth: border.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
})
