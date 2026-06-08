// The player transport controls — ⟲15 · play/pause · 15⟳ — with a single-button mode
// (the pre-drive "ready" Play / completed "done" Restart) and an optional low-emphasis
// secondary (End drive). Extracted so the live drive and the preview share ONE control
// layout; they had drifted (different skip-button styles, different strip stabilization).
// The center play/pause stays glow-less on purpose: the lit NOW card or the gliding car
// token owns the single amber glow (DESIGN §8) — never a second one down here.
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { IN_CAR_MAX_FONT_SCALE, space } from '../theme/tokens'
import { Button } from './Button'
import type { IconName } from './Icon'
import { voice } from './voice'

export interface TransportBarProps {
  /** One full-width CTA instead of the transport row — the "ready" (Play) and "done"
   *  (Restart) states. Keeps its default amber CTA glow (it's the only control shown). */
  single?: { icon?: IconName; title: string; onPress: () => void }
  /** Transport-row state: drives the center icon + label. */
  playing?: boolean
  onPlayPause?: () => void
  /** Stopped-state center label — defaults to the start CTA; pass `voice.cta.resume`
   *  for a mid-drive pause. */
  playLabel?: string
  onSeekBack?: () => void
  onSeekForward?: () => void
  canSeek?: boolean
  /** Low-emphasis action beneath the row (End drive). A ghost, off the easy-reach center —
   *  rare/destructive actions don't sit under the thumb. */
  secondary?: { title: string; onPress: () => void }
  style?: StyleProp<ViewStyle>
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
  return (
    <View style={[styles.controls, style]}>
      {single ? (
        <Button icon={single.icon} title={single.title} onPress={single.onPress} />
      ) : (
        <>
          {/* Flanked transport row: cap label growth so a long resume label can't
              truncate between the two ±15 buttons at large Dynamic Type (each button
              also carries an icon + accessibilityLabel, so nothing is lost). */}
          <View style={styles.row}>
            <Button
              variant="secondary"
              icon="back15"
              title="15"
              accessibilityLabel="Rewind 15 seconds"
              fullWidth={false}
              disabled={!canSeek}
              onPress={onSeekBack}
              maxFontScale={IN_CAR_MAX_FONT_SCALE}
              style={styles.skip}
            />
            <Button
              icon={playing ? 'pause' : 'play'}
              title={playing ? voice.cta.pause : playLabel}
              onPress={onPlayPause}
              glow={false}
              maxFontScale={IN_CAR_MAX_FONT_SCALE}
              style={styles.flex}
            />
            <Button
              variant="secondary"
              icon="forward15"
              title="15"
              accessibilityLabel="Forward 15 seconds"
              fullWidth={false}
              disabled={!canSeek}
              onPress={onSeekForward}
              maxFontScale={IN_CAR_MAX_FONT_SCALE}
              style={styles.skip}
            />
          </View>
          {secondary ? (
            <Button variant="ghost" title={secondary.title} onPress={secondary.onPress} />
          ) : null}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  controls: { paddingHorizontal: space.gutter, marginTop: space.lg, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  // ±15 buttons: trim the wide CTA side-padding so the flanked center label keeps room
  // (it would otherwise truncate to "All a…" on a 320pt phone / large Dynamic Type), while
  // holding a floor width for the in-car tap target.
  skip: { paddingHorizontal: space.sm, minWidth: 64 },
})
