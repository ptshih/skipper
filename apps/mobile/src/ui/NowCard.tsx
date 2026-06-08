// The NOW-PLAYING placard — the one surface that earns the campfire-amber glow.
// kicker (warm label) → big placard title → optional mono timer. Used by the
// preview player and (later) the live driving player.
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { IN_CAR_MAX_FONT_SCALE, border, radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Text } from './Text'

/** Reserved height (pt) for the player's NOW-content slot. Sized to a two-line NowCard
 *  (the tallest in-drive now-content) so the transport controls + stop list below hold a
 *  stable position when the content swaps to the shorter rolling strip. The scrubber's
 *  height is reserved separately (it stays mounted, just hidden, between stops).
 *  Stays valid under Dynamic Type because the title/timer below cap at
 *  IN_CAR_MAX_FONT_SCALE — a capped two-line title still fits this reserve. */
export const NOW_AREA_RESERVE = 136

export interface NowCardProps {
  kicker: string // e.g. "NOW PLAYING · STORY"
  title: string // the stop name
  timer?: string // mono, e.g. "0:48 / 1:22"
  glow?: boolean // the amber halo (on for an active clip)
  right?: ReactNode
  liveRegion?: boolean // announce kicker/title changes to Android screen readers
}

export function NowCard({ kicker, title, timer, glow = true, right, liveRegion }: NowCardProps) {
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
      <Text
        variant="placardTitle"
        color="ink"
        numberOfLines={2}
        maxFontSizeMultiplier={IN_CAR_MAX_FONT_SCALE}
      >
        {title}
      </Text>
      {timer ? (
        <Text variant="mono" color="inkDim" maxFontSizeMultiplier={IN_CAR_MAX_FONT_SCALE}>
          {timer}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: border.keyline,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    gap: space.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
})
