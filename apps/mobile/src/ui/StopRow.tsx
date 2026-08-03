// A stop in the route list — ONE line, three states, and exactly two marks: a LEADING glyph
// that carries state-or-type and a TRAILING meta that carries length.
//   upcoming — stop-type glyph + name + its clip length (calm)
//   active   — a sunken "you-are-here" well (surfaceSunken) + accent glyph + bold name, and the
//              trailing slot says NOW. Sunken (not raised) so it reads BOTH on the bare screen
//              AND inside the raised route card. PINE accent, never amber — the player card owns
//              the one amber glow.
//   passed   — dimmed, its glyph replaced by the quiet check
//
// ⚠ WHY ONE LINE (2026-08-03). The row used to carry a `sublabel` under the name, and the player
// fed it the stop TYPE — which on a mostly-story drive printed "Tale from the trail" eight times
// down the card while the identical book glyph said it again on every row. Two lines of wallpaper
// per row also cost the list its job: at 56pt only five and a half of eight stops fit, and the
// sixth was sliced mid-glyph. The type now appears only when it ISN'T a story (`stopMeta`), and
// the second line's height went back to showing stops. The drive-detail screen never passed a
// sublabel at all — this is the two screens agreeing rather than a new opinion.
//
// The marks are split across the two ends on purpose: the check moved LEADING (a played row has
// no use for its type) so the trailing slot can stay one column of meta all the way down.
import { memo, useEffect } from 'react'
import { Animated, Pressable, StyleSheet, useAnimatedValue, View } from 'react-native'
import { hit, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon, type IconName } from './Icon'
import { Text } from './Text'
import { voice } from './voice'

// One line of `body` inside the row's padding measures under the 48pt in-car tap floor, so the
// floor IS the row height — and the player's auto-scroll math reads this same number.
export const STOP_ROW_HEIGHT = hit.min

// The row's own horizontal geometry, exported because StopList's header aligns to it: the header
// label must start on the same line as the glyphs and end on the same line as the meta, and the
// only way that survives a change to either is for both to read ONE expression.
const ROW_EDGE = space.md // margin from the card edge — also where the divider rules start
const ROW_PAD_LEFT = space.sm // clears the active tick, which sits at the row's edge
/** Card edge → a row's CONTENT (glyph, and the header label above it). */
export const STOP_ROW_INSET = ROW_EDGE + ROW_PAD_LEFT
/** Card edge → a row's trailing meta (and the header's right-hand tag). */
export const STOP_ROW_EDGE = ROW_EDGE

export type StopState = 'upcoming' | 'active' | 'passed'

export interface StopRowProps {
  name: string
  /** Trailing meta — the clip's length, prefixed by the stop type when it isn't a story
   *  ("2:10", "View · 1:12"). Suppressed on the active row, which says NOW instead. */
  meta?: string
  /** `meta` as a screen reader should hear it ("Enjoy the view, 1 minute 12 seconds"). The visible
   *  string is a glance format — mm:ss and a clipped type word both read badly aloud. */
  metaLabel?: string
  state?: StopState
  icon?: IconName // stop-type icon
  onPress?: () => void
  /** When set, the passed-state check "stamps" in (the §9 passport-stamp) after `stampDelayMs`
   *  — the drive-complete cascade. Off by default and during a normal drive; the parent
   *  also gates it on Reduce Motion. */
  enterStamp?: boolean
  stampDelayMs?: number
}

function StopRowBase({
  name,
  meta,
  metaLabel,
  state = 'upcoming',
  icon,
  onPress,
  enterStamp = false,
  stampDelayMs = 0,
}: StopRowProps) {
  const { colors } = useTheme()
  const active = state === 'active'
  const passed = state === 'passed'

  // The passed-check "ink press": opacity + scale + a slight rotate settle, staggered by the
  // parent. Starts at its END state (1) unless asked to stamp in, so a normal drive shows the
  // check statically — only the drive-complete cascade animates.
  const stamp = useAnimatedValue(enterStamp ? 0 : 1)
  useEffect(() => {
    if (!enterStamp) return
    stamp.setValue(0)
    Animated.sequence([
      Animated.delay(stampDelayMs),
      Animated.spring(stamp, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }),
    ]).start()
  }, [enterStamp, stampDelayMs, stamp])

  return (
    <Pressable
      onPress={onPress}
      // Derive interactivity from the handler: a read-only row (live/sim drive, drive detail)
      // announces as plain 'text', not a tappable 'button' that does nothing, and skips the
      // press tracking + pressed dimming. Only the preview (onPress set) reads as a button.
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      // Selection state only on the INTERACTIVE (button) row — a 'text' row announcing "selected" is
      // semantically odd; the label suffix (", now playing") carries it for read-only rows. (audit #716)
      accessibilityState={onPress ? { selected: active } : undefined}
      accessibilityLabel={`${name}${metaLabel ? `, ${metaLabel}` : ''}${active ? ', now playing' : passed ? ', played' : ''}`}
      style={({ pressed }) => [styles.row, pressed && onPress && styles.pressed]}
    >
      {/* "YOU ARE HERE" is a TICK IN THE MARGIN, not a filled row.
          ⚠ The active row used to paint a rounded `surfaceSunken` well. Inside the raised route card
          that put a rounded rectangle inside a rounded rectangle — and since the active stop is the
          FIRST row for most of a drive, its corners sat directly inside the card's own, reading as
          two overlapping selections rather than one highlight (founder, 2026-08-03: "the double
          selection is still there, the highlight just looks weird"). Insetting the well shrank the
          collision without curing it, because the collision was the BOX. The row already carries
          three unambiguous cues — accent glyph, bold name, NOW — so the box was the fourth and the
          only one that had to negotiate with a container. A pine tick aligned to the divider rules'
          own inset marks the row from the margin and can never nest inside anything.
          Pine, never amber: the player card keeps the screen's one amber glow (§8). */}
      {active ? (
        <View style={[styles.activeTick, { backgroundColor: colors.accent }]} pointerEvents="none" />
      ) : null}

      {/* LEADING mark — the stop-type glyph, accent when active. A PASSED row trades it for the
          quiet check (the §9 passport-stamp): the type has stopped being useful once the stop is
          behind you, and putting the check here keeps the trailing column pure meta. */}
      {passed ? (
        <Animated.View
          style={{
            opacity: stamp,
            transform: [
              { scale: stamp.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
              {
                rotate: stamp.interpolate({ inputRange: [0, 1], outputRange: ['-16deg', '0deg'] }),
              },
            ],
          }}
        >
          <Icon name="passed" size={18} color="inkFaint" />
        </Animated.View>
      ) : icon ? (
        <Icon name={icon} size={18} color={active ? 'accent' : 'inkDim'} />
      ) : null}

      <Text
        variant={active ? 'bodyStrong' : 'body'}
        color={passed ? 'inkDim' : 'ink'}
        numberOfLines={1}
        style={styles.name}
      >
        {name}
      </Text>

      {/* TRAILING meta. The active row says NOW instead of a length — the scrubber directly below
          is already counting this clip out loud, and a frozen "2:10" beside a running timer reads
          as a contradiction. */}
      {active ? (
        <Text variant="label" color="accent">
          {voice.player.now}
        </Text>
      ) : meta ? (
        <Text variant="mono" color="inkFaint" style={styles.meta}>
          {meta}
        </Text>
      ) : null}
    </Pressable>
  )
}

// memo: the active-stop index changes as the car advances, re-rendering the whole itinerary; with a
// stable per-row onPress (see StopList) this re-renders only the rows whose props actually change. (audit #621)
export const StopRow = memo(StopRowBase)

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: STOP_ROW_HEIGHT, // minHeight, not height — survives Dynamic Type
    paddingVertical: space.sm,
    // MARGIN, not padding, matching the divider rules' own inset exactly — so the rules, the rows
    // and the active tick all start on one line, and the text lands where the old padding put it.
    marginHorizontal: ROW_EDGE,
    // Clears the active tick, which sits at the row's left edge on the rule line. Applied to EVERY
    // row, not just the active one, so a stop becoming active never nudges its own name sideways.
    paddingLeft: ROW_PAD_LEFT,
  },
  // The active tick: a pine rule in the row's left margin. Absolute so it costs the row no layout
  // and the other rows keep their glyph alignment (a reserved column would indent all eight).
  activeTick: { position: 'absolute', left: 0, top: space.sm, bottom: space.sm, width: 3, borderRadius: 2 },
  name: { flex: 1, minWidth: 0 }, // the meta is fixed-width; the NAME is what truncates
  meta: { flexShrink: 0 },
  pressed: { opacity: 0.7 },
})
