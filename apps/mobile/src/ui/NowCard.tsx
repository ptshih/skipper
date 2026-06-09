// The PLAYER CARD — the one contained, elevated surface that holds the now-playing
// content, the scrubber (or a body line), AND the transport as a single grounded unit.
// It's the one surface that earns the campfire-amber glow (DESIGN §8), and only while a
// clip is actively playing (`glow`) — paused / rolling / ready / done it sits flat and
// the route track owns the glow.
//
// Top → bottom: header row (warm kicker + optional badge) → big placard title (with an
// optional mono timer beside it) → a state-dependent MIDDLE slot (a body line in
// ready/done, the Scrubber while driving) → the transport row. Used by the live driving
// player and the preview, both via app/tours/[id]/play.tsx.
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { IN_CAR_MAX_FONT_SCALE, border, radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Text } from './Text'

export interface NowCardProps {
  kicker: string // e.g. "NOW PLAYING · STORY"
  title: string // the stop name
  timer?: string // mono, e.g. "~2.3 mi" (the rolling-leg distance) — sits beside the title
  glow?: boolean // the amber halo (on only while a clip is actively playing)
  right?: ReactNode // a stop-type badge in the header row
  /** The state-dependent middle: a body line (ready/done) or the Scrubber (driving). */
  children?: ReactNode
  /** The transport row — rendered at the bottom of the card. */
  transport?: ReactNode
  liveRegion?: boolean // announce kicker/title changes to Android screen readers
}

export function NowCard({
  kicker,
  title,
  timer,
  glow = true,
  right,
  children,
  transport,
  liveRegion,
}: NowCardProps) {
  const theme = useTheme()
  const { colors } = theme
  return (
    <View
      accessibilityLiveRegion={liveRegion ? 'polite' : 'none'}
      style={[
        styles.card,
        {
          backgroundColor: colors.surfaceRaised,
          borderColor: glow ? colors.amberToken : colors.rule,
          // boxShadow renders the amber halo on both platforms; off = genuinely flat
          boxShadow: glow
            ? [{ offsetX: 0, offsetY: 0, blurRadius: 16, color: colors.glow }]
            : undefined,
        },
      ]}
    >
      <View style={styles.head}>
        <Text variant="label" color="accentWarm" style={styles.flex}>
          {kicker}
        </Text>
        {right}
      </View>
      <View style={styles.titleRow}>
        <Text
          variant="placardTitle"
          color="ink"
          numberOfLines={2}
          maxFontSizeMultiplier={IN_CAR_MAX_FONT_SCALE}
          style={styles.flex}
        >
          {title}
        </Text>
        {timer ? (
          <Text variant="mono" color="inkDim" maxFontSizeMultiplier={IN_CAR_MAX_FONT_SCALE}>
            {timer}
          </Text>
        ) : null}
      </View>
      {children}
      {transport ? <View style={styles.transport}>{transport}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: border.keyline,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    gap: space.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // Title left, the optional mono timer hugged to the right and baseline-aligned-ish.
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  flex: { flex: 1 },
  // A little breathing room above the transport so it reads as its own zone in the card.
  transport: { marginTop: space.xs },
})
