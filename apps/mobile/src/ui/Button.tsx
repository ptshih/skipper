// Buttons. `primary` is the enamel CTA — a ranger-green sign in daylight, a
// campfire-lit (amber, glowing) button at dusk; always ≥60pt tall for the car.
// `secondary` is an outlined placard action; `ghost` is a text link.
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { border, hit, radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon, type IconName } from './Icon'
import { Text } from './Text'

export interface ButtonProps {
  title: string
  onPress?: () => void
  variant?: 'primary' | 'secondary' | 'ghost'
  icon?: IconName // leading vector icon
  disabled?: boolean
  loading?: boolean
  fullWidth?: boolean
  accessibilityLabel?: string // overrides `title` for the a11y label (icon-only buttons)
  /** Dusk primary buttons wear a campfire amber glow by default. Pass `false` to drop
   *  it (a neutral cast shadow instead) where the design system's one-amber-glow budget
   *  is already spent — e.g. the in-player play button while the NOW card is lit. */
  glow?: boolean
  style?: StyleProp<ViewStyle>
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  fullWidth = true,
  accessibilityLabel,
  glow = true,
  style,
}: ButtonProps) {
  const theme = useTheme()
  const { colors } = theme
  const isPrimary = variant === 'primary'
  const isGhost = variant === 'ghost'

  const container: ViewStyle = isPrimary
    ? {
        backgroundColor: colors.primaryFill,
        minHeight: hit.cta,
        borderRadius: radius.lg,
        // campfire glow at dusk; soft cast shadow in daylight — boxShadow so the
        // colored glow renders on Android too (iOS-only shadow* would go gray there).
        // glow=false drops the amber halo (dusk → flat; daylight keeps its neutral cast)
        // so a player play button doesn't add a second amber glow next to the NOW card.
        boxShadow:
          theme.isDark && glow
            ? [{ offsetX: 0, offsetY: 0, blurRadius: 16, color: colors.glow }]
            : theme.isDark
              ? undefined
              : [{ offsetX: 0, offsetY: 3, blurRadius: 8, color: colors.shadowCast }],
      }
    : isGhost
      ? { minHeight: hit.min, borderRadius: radius.md, backgroundColor: 'transparent' }
      : {
          minHeight: hit.cta,
          borderRadius: radius.lg,
          backgroundColor: colors.surfaceRaised,
          borderWidth: border.keyline,
          borderColor: colors.accent,
        }

  const labelColor = isPrimary ? 'onPrimary' : 'accent'

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        container,
        pressed && styles.pressed,
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {/* Keep the label MOUNTED while loading (just hidden) so the button holds its exact
          width — a `fullWidth={false}` button would otherwise collapse to the spinner's
          width and jump. The spinner overlays the hidden label, absolutely positioned. */}
      <View style={[styles.row, loading && styles.hiddenWhileLoading]}>
        {icon ? <Icon name={icon} size={18} color={labelColor} style={styles.glyph} /> : null}
        {title ? (
          <Text variant="heading" color={labelColor} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
      </View>
      {loading ? (
        <ActivityIndicator color={colors[labelColor]} style={styles.spinnerOverlay} />
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  fullWidth: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  glyph: { marginTop: -1 },
  // Label stays laid out (reserves the width) but invisible under the spinner.
  hiddenWhileLoading: { opacity: 0 },
  // Fills the button and centers the spinner over the hidden label.
  spinnerOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },
})
