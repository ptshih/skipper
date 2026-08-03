// ONE turn in the planner conversation (1.1 step 7). The asymmetry carries the speaker —
// there is no avatar, no name label, no timestamp:
//   • SKIPPER — left, full column width, NO card material. He is the page; his words are prose
//     ON the paper, marked by a hairline-plus pine rule down the left edge, the way a WPA ranger
//     sign sets a pull-quote. Giving him a card would make him a guest on his own screen.
//   • RIDER — right-aligned, `surfaceSunken`, rounded. The rider's words pressed INTO the paper.
//
// ⚠ This component RENDERS what it is handed and NEVER buffers. The say-buffer state machine
// (sentence-boundary flushing, max-hold, the authoritative terminal frame) lives in
// `src/lib/say-buffer.ts` so it is `bun test`-able — mobile has no component renderer.
//
// ⚠ CONTRAST: the rider bubble sits on `surfaceSunken`, where ONLY `ink` / `inkDim` / `accent`
// are gate-enforced ≥4.5:1 (src/theme/theme.test.ts). DESIGN.md §4 records the measured
// light-mode misses — inkFaint 4.30, water 4.12, danger 4.39, accentWarm 4.35. Never put a hint,
// a timestamp or a retry line inside this bubble in any role but those three.
import { useEffect, useRef } from 'react'
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native'
import { radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Text } from './Text'

// The speaker rule. 2pt, not `border.keyline` (1.5): a keyline is a card EDGE and reads as one —
// this is a deliberate mark of who is talking and has to survive next to 16pt body text.
const SPEAKER_RULE_W = 2

export interface TurnBubbleProps {
  role: 'rider' | 'skipper'
  /** Already-composed display text. The bubble never appends, never holds a partial. */
  text: string
  /** A skipper turn still receiving deltas — suppresses every announce until it settles. */
  streaming?: boolean
  /** Speak this turn once when it settles. Set by the screen on the NEWEST skipper turn only, and
   *  only while that screen is FOCUSED — a planner turn outlives leaving home (the transcript is
   *  kept alive by staying mounted under a push), so an ungated announce speaks the skipper's reply
   *  over Settings or a running drive. Going false and back true HOLDS the announce rather than
   *  losing it: the one-shot ref below has not fired, so it lands on the rider's return. */
  announceOnSettle?: boolean
}

export function TurnBubble({ role, text, streaming, announceOnSettle }: TurnBubbleProps) {
  const { colors } = useTheme()

  // The settle transition: a turn that was asked to announce and is no longer streaming. A turn
  // seeded already-complete (the cold open, an example reply) settles on its first render, which
  // is correct — it appeared, so it should be spoken.
  // ⚠ AN EMPTY TURN RENDERS NOTHING, and empty is a NORMAL outcome rather than an error: the
  // planner's route turn is TOOL USE, so the model may legitimately return a `PlannedRoute` with no
  // prose at all. Rendered anyway, a skipper turn with no text left an orphaned 2pt pine rule
  // floating above the route card — and, because the row is `accessible`, an interactive element
  // with NO accessible name, which VoiceOver announces as a nameless button. Observed on device
  // 2026-08-03: every drawn route produced one.
  const isEmpty = text.trim().length === 0

  // `isEmpty` also gates the ANNOUNCE — a settled-but-empty turn would otherwise push an empty
  // string to VoiceOver, which reads as a stutter with nothing said.
  const settled = role === 'skipper' && !!announceOnSettle && !streaming && !isEmpty
  const announcedRef = useRef(false)

  useEffect(() => {
    if (!settled || announcedRef.current) return
    announcedRef.current = true
    // ⚠ iOS ONLY, and the guard is the point. `accessibilityLiveRegion` is Android-only
    // (ViewAccessibility `@platform android`), so iOS needs the active push — but Android
    // already gets the polite region below, and doing both there speaks the turn twice.
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(text)
  }, [settled, text])

  // NowCard's lesson, and this is the same shape of bug: a per-sentence flush is a ticker, and a
  // live region open across it floods TalkBack with half-sentences and buries the one announce
  // that matters. The region opens only ONCE the turn has settled — and only on the turn the
  // screen asked to announce; a polite region on every historical bubble would re-speak the whole
  // transcript on a re-render. The rider's own bubble never announces: they just typed it.
  const liveRegion = settled ? 'polite' : 'none'

  // AFTER the hooks, never before — an early return above them would change the hook order between
  // renders as a streaming turn goes from empty to its first sentence.
  if (isEmpty) return null

  if (role === 'rider') {
    return (
      <View
        accessible
        accessibilityRole="text"
        accessibilityLiveRegion="none"
        style={[styles.riderBubble, { backgroundColor: colors.surfaceSunken }]}
      >
        <Text variant="body" color="ink">
          {text}
        </Text>
      </View>
    )
  }

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLiveRegion={liveRegion}
      style={styles.skipperRow}
    >
      <View style={[styles.speakerRule, { backgroundColor: colors.accent }]} />
      <Text variant="body" color="ink" style={styles.flex}>
        {text}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  // Full column width — the skipper gets the whole measure. No maxWidth: his turns are the long
  // ones, and indenting them behind the rule is the only inset they need.
  skipperRow: { flexDirection: 'row', alignSelf: 'stretch' },
  // `alignSelf: stretch` (the row default) runs the rule the full height of however many lines he
  // takes, which is what makes it read as a pull-quote rather than a bullet.
  speakerRule: { width: SPEAKER_RULE_W, marginRight: space.md },
  flex: { flex: 1 },
  // Hugs the right edge and stops at 82% so a long typed line still reads as a bubble and not as
  // a second full-width column competing with the skipper's prose.
  riderBubble: {
    alignSelf: 'flex-end',
    maxWidth: '82%',
    borderRadius: radius.lg,
    padding: space.md,
  },
})
