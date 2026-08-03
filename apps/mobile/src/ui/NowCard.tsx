// The PLAYER CARD — the one contained, elevated surface that holds the now-playing
// content, the scrubber (or a body line), AND the transport as a single grounded unit.
// It's the one surface that earns the campfire-amber glow (DESIGN §8), and only while a
// clip is actively playing (`glow`) — paused / rolling / ready / done it sits flat and
// the route track owns the glow.
//
// Top → bottom: header row (warm kicker + optional badge) → big placard title (with an
// optional mono timer beside it) → a state-dependent MIDDLE slot (a body line in
// ready/done, the Scrubber while driving) → the transport row. Used by the live driving
// player, via app/drives/[id]/play.tsx.
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
      style={[
        styles.card,
        {
          backgroundColor: colors.surfaceRaised,
          borderColor: glow ? colors.amberToken : colors.rule,
          // ⚠ THEME-GATED, the way `Button` already does it — and it was not, until 2026-08-03.
          // The campfire halo is a NIGHT effect: measured, `glow` composites to 2.45 against the dusk
          // surface and **1.30** against paper, i.e. in daylight it rendered nothing at all while
          // still costing a shadow pass. Day gets `shadowCast` instead, which is what §4 calls it —
          // "neutral ambient cast shadow (daylight elevation)". A lantern glows at dusk; a painted
          // ranger sign in the sun casts a shadow. Same signal, told the way each mood tells it.
          // (The amber BORDER above already carried the day signal on its own, which is why nothing
          // looked broken — the halo was simply absent, not missed.)
          boxShadow: !glow
            ? undefined
            : theme.isDark
              ? [{ offsetX: 0, offsetY: 0, blurRadius: 16, color: colors.glow }]
              : [{ offsetX: 0, offsetY: 3, blurRadius: 10, color: colors.shadowCast }],
        },
      ]}
    >
      {/* The polite live region is scoped to JUST the kicker+title block — the part that
          changes ONCE per stop. Wrapping the whole card (incl. the Scrubber, whose time
          label/value ticks every ~500ms) would flood TalkBack and bury the one-shot
          stop-transition announce. */}
      <View accessibilityLiveRegion={liveRegion ? 'polite' : 'none'} style={styles.titleBlock}>
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
      </View>
      {/* The middle slot (Scrubber/body/buffering) explicitly opts OUT of the live region:
          the Scrubber already exposes an adjustable role carrying its own spoken value, so a
          per-tick announce here is noise. */}
      {children != null ? (
        <View accessibilityLiveRegion="none" style={styles.middle}>
          {children}
        </View>
      ) : null}
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
  // The kicker+title block (the once-per-stop content). Keeps the original card gap
  // between the header row and the placard title now that they share a wrapper.
  titleBlock: { gap: space.md },
  // The state-dependent middle slot (Scrubber/body/buffering). Its own gap keeps a body
  // line + a buffering note stacked the way the flat card used to.
  middle: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // Title left, the optional mono timer hugged to the right and baseline-aligned-ish.
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  flex: { flex: 1 },
  // A little breathing room above the transport so it reads as its own zone in the card.
  transport: { marginTop: space.xs },
})
