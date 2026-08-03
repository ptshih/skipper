// Buttons. `primary` is the enamel CTA — a ranger-green sign in daylight, a
// campfire-lit (amber, glowing) button at dusk; always ≥60pt tall for the car.
// `secondary` is an outlined placard action; `ghost` is a text link.
import {
  ActivityIndicator,
  PixelRatio,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { IN_CAR_MAX_FONT_SCALE, border, hit, radius, space } from '../theme/tokens'
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

  // One line, EXCEPT past the standard Dynamic Type range, where a second is allowed instead of
  // a truncation: "Make this drive" — the conversion CTA — otherwise reads "Make this…" at AX
  // sizes, and DESIGN §8 makes AX a supported configuration on every scrollable surface, not an
  // edge case. The clamp itself is right and is KEPT for the glance-critical in-car controls: §8
  // caps those at IN_CAR_MAX_FONT_SCALE, so the same constant is the ceiling of everything they
  // can render — below it nothing here changes, and above it no in-car surface exists. Gating on
  // the boundary rather than adding a per-caller prop keeps the one rule in one place instead of
  // asking ~30 call sites to remember which side of it they're on.
  // ⚠ The button GROWS, never clips: `minHeight: hit.cta` + paddingVertical, so a wrapped label
  // makes a taller ≥60pt target rather than a cropped one.
  const labelLines = PixelRatio.getFontScale() > IN_CAR_MAX_FONT_SCALE ? 2 : 1

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
          <Text
            variant="heading"
            color={labelColor}
            numberOfLines={labelLines}
            align="center"
            style={styles.label}
          >
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
  // RN defaults flexShrink to 0, which lets a label out-measure the row and overflow instead of
  // wrapping. A no-op on a label that fits. (Its `align="center"` is here for the same reason:
  // a wrapped second line hanging left under a centered first reads as a layout bug.)
  label: { flexShrink: 1 },
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
