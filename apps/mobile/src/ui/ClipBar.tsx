// The pinned preview-clip transport (1.1 step 8). It rides ConversationScreen's `footer` slot so a
// clip that has scrolled out of the transcript can still be paused — roam paid for that lesson: a
// running clip with its only control off-screen strands the rider with no way out short of killing
// the app. Whenever a clip is loaded, this bar is on screen.
//
// PURE PRESENTATION. It owns no player, no url, no state — app/index.tsx holds useRoutePreview() and
// passes the four values down, same rule as every other primitive in here.
//
// Harvested in SHAPE from the live player's map peek bar (app/drives/[id]/play.tsx) — disc, kicker,
// name, hairline progress — but deliberately FLAT: no amber keyline, no cast, no glow. DESIGN §8
// allows exactly ONE amber glow on screen and the proposal card's "Make this drive" CTA plus its MIN
// badge already spend the amber budget; a second lit surface below them turns the wall into a
// competition. This is a utility strip, and it should read as one.
import { Pressable, StyleSheet, View } from 'react-native'
import { cleanPlaceName } from '@/lib/labels'
import { border, hit, radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon } from './Icon'
import { Text } from './Text'
import { voice } from './voice'

// The disc and the dismiss both clear the in-car tap floor (hit.min, DESIGN's ≥48pt rule) even
// though this surface is used parked — the rider is one tap from a drive and the habit is the point.
const DISC = hit.min

// The position track's height, named so the fully-rounded cap DERIVES from it (`TRACK_H / 2`) the
// way Scrubber's bed does, instead of a raw `borderRadius: 2` that silently stops matching the day
// the bar gets thicker. §3's radius scale starts at 8 and has no business on a 4pt rule.
const TRACK_H = 4

export interface ClipBarProps {
  playing: boolean
  /** The stop the loaded clip belongs to. Raw API name — cleaned here at the view boundary. */
  name: string
  /** 0..1. Clamped below: a status tick can report currentTime past a rounded duration. */
  progress: number
  onToggle: () => void
  /** Stop + unload. The bar disappears with the audio — it is never a paused ghost. */
  onDismiss: () => void
}

export function ClipBar({ playing, name, progress, onToggle, onDismiss }: ClipBarProps) {
  const { colors } = useTheme()
  // `|| 0` catches the NaN a 0-duration divide produces before the first status tick lands.
  const pct = Math.max(0, Math.min(1, progress || 0)) * 100

  return (
    <View style={[styles.bar, { backgroundColor: colors.surfaceRaised, borderColor: colors.rule }]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={playing ? voice.proposal.clipPauseA11y : voice.proposal.clipPlayA11y}
        style={({ pressed }) => [
          styles.disc,
          { backgroundColor: colors.primaryFill },
          pressed && styles.pressed,
        ]}
      >
        <Icon name={playing ? 'pause' : 'play'} size={22} color="onPrimary" />
      </Pressable>

      <View style={styles.text}>
        <Text variant="label" color="accentWarm">
          {voice.proposal.clipBarKicker}
        </Text>
        <Text variant="bodyStrong" color="ink" numberOfLines={1}>
          {cleanPlaceName(name)}
        </Text>
        {/* Position, not a scrubber: this is a taste, and a seek target 4pt tall in a footer above a
            keyboard is a mis-tap generator. The full transport lives on the drive itself. */}
        <View style={[styles.track, { backgroundColor: colors.surfaceSunken }]}>
          <View style={[styles.fill, { backgroundColor: colors.trackActive, width: `${pct}%` }]} />
        </View>
      </View>

      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={voice.proposal.clipBarDismissA11y}
        style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
      >
        <Icon name="close" size={20} color="inkFaint" />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingLeft: space.md,
    // No right padding: the dismiss target absorbs it, so the ✕ sits optically at the edge while
    // its 48pt box still reaches past it.
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    borderWidth: border.hair,
  },
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // minWidth: 0 lets the name actually truncate instead of shoving the dismiss off the row.
  text: { flex: 1, minWidth: 0, gap: space.xs },
  dismiss: {
    width: hit.min,
    height: hit.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // No marginTop: the raw 2 that used to sit here stacked on the raw 3 gap for ~5pt of air. The
  // grid `gap` above now owns the whole stack's rhythm — one number, on the scale.
  track: { height: TRACK_H, borderRadius: TRACK_H / 2, overflow: 'hidden' },
  fill: { height: '100%' },
  pressed: { opacity: 0.85 },
})
