// The player transport controls — an ICON-FORWARD media row: a large, prominent
// center play/pause flanked by smaller ⟲15 · 15⟳ jog buttons. Also a single-button
// mode (the pre-drive "ready" Play / completed "done" Restart CTA) and an optional
// low-emphasis ghost secondary (End drive). Extracted so the live drive and the preview
// share ONE control layout.
//
// The center play/pause stays GLOW-LESS on purpose: the lit player card (its amber
// halo) or the gliding car token owns the single amber glow (DESIGN §8) — never a
// second one down here. The center button is a sized enamel disc (primaryFill, no
// glow); the ±15 jogs are outlined placard discs.
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { border, hit, radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Button } from './Button'
import { Icon, type IconName } from './Icon'
import { Text } from './Text'
import { voice } from './voice'

// Sizes for the icon-forward row. The center disc is the visual focus; the jogs are
// smaller but still clear the ≥44pt in-car tap floor. Glyphs scale with their disc.
const CENTER = 72
const JOG = 56

export interface TransportBarProps {
  /** One full-width CTA instead of the transport row — the "ready" (Play) and "done"
   *  (Restart) states. Glows by default (it's the only control shown); pass `glow: false`
   *  where another element owns the screen's one amber glow (e.g. the lit done card). An
   *  optional low-emphasis ghost sits beneath (e.g. "Back to the trailhead" at done). */
  single?: {
    icon?: IconName
    title: string
    onPress: () => void
    glow?: boolean
    secondary?: { title: string; onPress: () => void }
  }
  /** Transport-row state: drives the center icon. */
  playing?: boolean
  onPlayPause?: () => void
  /** Stopped-state accessibility label — defaults to the start CTA; pass `voice.cta.resume`
   *  for a mid-drive pause. The icon-forward center drops the visible text label, so this
   *  rides only on the accessibilityLabel. */
  playLabel?: string
  onSeekBack?: () => void
  onSeekForward?: () => void
  canSeek?: boolean
  /** Low-emphasis action beneath the row (End drive). A ghost, off the easy-reach center —
   *  rare/destructive actions don't sit under the thumb. */
  secondary?: { title: string; onPress: () => void }
  style?: StyleProp<ViewStyle>
}

/** A round jog button — outlined enamel disc with a ±15s glyph + a stamped "15". */
function Jog({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: IconName
  label: string
  onPress?: () => void
  disabled?: boolean
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.jog,
        {
          backgroundColor: colors.surfaceRaised,
          borderColor: colors.accent,
        },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Icon name={icon} size={20} color="accent" />
      <Text variant="mono" color="accent" maxFontSizeMultiplier={1}>
        15
      </Text>
    </Pressable>
  )
}

export function TransportBar({
  single,
  playing = false,
  onPlayPause,
  playLabel = voice.cta.play,
  onSeekBack,
  onSeekForward,
  canSeek = false,
  secondary,
  style,
}: TransportBarProps) {
  const { colors } = useTheme()

  if (single) {
    return (
      <View style={[styles.wrap, style]}>
        <Button
          icon={single.icon}
          title={single.title}
          onPress={single.onPress}
          glow={single.glow}
        />
        {single.secondary ? (
          <Button variant="ghost" title={single.secondary.title} onPress={single.secondary.onPress} />
        ) : null}
      </View>
    )
  }

  return (
    <View style={[styles.wrap, style]}>
      {/* Icon-forward transport: ⟲15 · [big play/pause] · 15⟳, centered + evenly spaced. */}
      <View style={styles.row}>
        <Jog
          icon="back15"
          label="Rewind 15 seconds"
          onPress={onSeekBack}
          disabled={!canSeek}
        />
        <Pressable
          onPress={onPlayPause}
          accessibilityRole="button"
          accessibilityLabel={playing ? voice.cta.pause : playLabel}
          // The center disc is the enamel CTA color but GLOW-LESS — the card's halo is
          // the one amber glow on screen (DESIGN §8). A neutral cast gives it lift.
          style={({ pressed }) => [
            styles.center,
            {
              backgroundColor: colors.primaryFill,
              boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 8, color: colors.shadowCast }],
            },
            pressed && styles.pressed,
          ]}
        >
          <Icon name={playing ? 'pause' : 'play'} size={34} color="onPrimary" />
        </Pressable>
        <Jog
          icon="forward15"
          label="Forward 15 seconds"
          onPress={onSeekForward}
          disabled={!canSeek}
        />
      </View>
      {secondary ? (
        <Button variant="ghost" title={secondary.title} onPress={secondary.onPress} />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xl,
  },
  center: {
    width: CENTER,
    height: CENTER,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jog: {
    width: JOG,
    height: JOG,
    minWidth: hit.min,
    minHeight: hit.min,
    borderRadius: radius.pill,
    borderWidth: border.keyline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },
})
