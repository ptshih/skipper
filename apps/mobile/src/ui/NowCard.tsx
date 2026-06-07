// The NOW-PLAYING placard — the one surface that earns the campfire-amber glow.
// kicker (warm label) → big placard title → optional mono timer. Used by the
// preview player and (later) the live driving player.
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { border, radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Text } from './Text'

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
      <Text variant="placardTitle" color="ink" numberOfLines={2}>
        {title}
      </Text>
      {timer ? (
        <Text variant="mono" color="inkDim">
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
