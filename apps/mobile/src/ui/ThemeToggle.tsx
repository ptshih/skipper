// Header affordance to flip Daylight ⇄ Dusk. The night drive is the headline
// experience, so the mood toggle is a first-class, always-reachable control.
import { Pressable, StyleSheet } from 'react-native'
import { space } from '../theme/tokens'
import { useThemeMode } from '../theme/ThemeProvider'
import { Icon } from './Icon'
import { Text } from './Text'

export function ThemeToggle() {
  const { theme, toggle } = useThemeMode()
  return (
    <Pressable
      onPress={toggle}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={theme.isDark ? 'Switch to daylight mode' : 'Switch to night mode'}
      style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
    >
      <Icon name={theme.isDark ? 'night' : 'day'} size={14} color="inkDim" />
      <Text variant="label" color="inkDim">
        {theme.isDark ? 'DUSK' : 'DAY'}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // A header action: borderless icon + label. No pill border/fill of its own — a
  // self-drawn pill nests INSIDE the nav bar-button affordance and reads as a
  // double oval ("oval inside oval"). Let the header's own touch affordance stand.
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.xs,
    paddingVertical: space.xs,
  },
  pressed: { opacity: 0.6 },
})
