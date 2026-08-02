// The "he's about to say something" beat — three dots that breathe while a planner turn is in
// flight (1.1 step 7). Deliberately the quietest animation in the app:
//   • ONE shared opacity loop on the wrapper, not three staggered dots. A travelling wave is
//     three moving elements and would compete with the hero's parked-rig glow (DESIGN §8) — and
//     by the time this shows, that glow is the only other motion on screen.
//   • `inkFaint`, never amber. It sits on `surface` (uncapped there, unlike surfaceSunken), and
//     the screen's one amber budget belongs to the route card's MIN badge.
//   • Reduce Motion holds a static mid-opacity instead of breathing — Skeleton's pattern.
//
// ⚠ It NEVER announces. It is one accessibility node carrying a STATIC label
// (voice.plan.thinkingA11y) with the live region explicitly off: a pulsing element inside an open
// region is the NowCard flooding lesson in miniature, and it would bury the announce the settled
// skipper turn makes a moment later. The VISIBLE "Chewing on that…" line (voice.plan.thinking) is
// the screen's to render beside this — kept out so this node's label can't start changing.
import { useEffect } from 'react'
import { Animated, StyleSheet, useAnimatedValue } from 'react-native'
import { radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { useReducedMotion } from '../theme/useReducedMotion'

// A shade quicker than Skeleton's ~1.4s breath: that one says "content is arriving", this one
// says "someone is about to speak", and speech has a faster pulse than loading. Not a `duration`
// token — those cap at the snappy end (slow=420) for real UI transitions.
const PULSE_MS = 560
const DOT = 6

export interface TypingDotsProps {
  /** Static screen-reader label. ⚠ Must not change while a turn streams (see the header). */
  label: string
}

export function TypingDots({ label }: TypingDotsProps) {
  const { colors } = useTheme()
  const reduced = useReducedMotion()
  const pulse = useAnimatedValue(0)

  useEffect(() => {
    if (reduced) return
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: PULSE_MS, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [reduced, pulse])

  // Reduce Motion: the pulse's resting middle, held.
  const opacity = reduced ? 0.6 : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] })

  return (
    <Animated.View
      style={[styles.row, { opacity }]}
      accessible
      accessibilityLabel={label}
      accessibilityLiveRegion="none"
      accessibilityState={{ busy: true }}
    >
      <Animated.View style={[styles.dot, { backgroundColor: colors.inkFaint }]} />
      <Animated.View style={[styles.dot, { backgroundColor: colors.inkFaint }]} />
      <Animated.View style={[styles.dot, { backgroundColor: colors.inkFaint }]} />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  // Left-aligned under the skipper's column: the dots stand in for the turn he is about to take.
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start' },
  dot: { width: DOT, height: DOT, borderRadius: radius.pill },
})
