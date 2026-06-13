// The "your music" status row for free-roam: three little activity bars + a dim label. Roam now
// PAUSES the rider's own audio while the skipper talks (pause+resume, founder 2026-06-11) — NOT
// ducking — and the LABEL (passed in) says so. The bars are an activity cue: they pulse while the
// skipper is talking (active) and sit static otherwise; under Reduce Motion they never animate (the
// design's "static bars" rule) — state reads from color. (audit #251)
import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import { space } from '../theme/tokens'
import { useReducedMotion, useTheme } from '../theme'
import { Icon } from './Icon'
import { Text } from './Text'

export interface DuckProps {
  label: string
  /** True while an encounter clip is playing (the rider's audio is ducked). */
  active?: boolean
}

const BAR_COUNT = 3
const BAR_PERIOD_MS = 700

export function Duck({ label, active = false }: DuckProps) {
  const { colors } = useTheme()
  const reducedMotion = useReducedMotion()
  const anims = useRef(Array.from({ length: BAR_COUNT }, () => new Animated.Value(0.4))).current

  useEffect(() => {
    if (!active || reducedMotion) {
      anims.forEach((a) => a.setValue(0.4))
      return
    }
    const loops = anims.map((a, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * (BAR_PERIOD_MS / BAR_COUNT)),
          Animated.timing(a, { toValue: 1, duration: BAR_PERIOD_MS / 2, useNativeDriver: true }),
          Animated.timing(a, { toValue: 0.35, duration: BAR_PERIOD_MS / 2, useNativeDriver: true }),
        ]),
      ),
    )
    loops.forEach((l) => l.start())
    return () => loops.forEach((l) => l.stop())
  }, [active, reducedMotion, anims])

  // Bars scale from their feet (flex-end) via transform-only animation (native driver);
  // the fill color is a SEMANTIC role from the provider — no raw hex in a component.
  const fill = active ? colors.accent : colors.inkFaint
  return (
    <View style={styles.row}>
      <Icon name="music" size={14} color={active ? 'accent' : 'inkFaint'} />
      <View style={styles.bars}>
        {anims.map((a, i) => (
          <Animated.View
            key={i}
            style={[styles.bar, { backgroundColor: fill, transform: [{ scaleY: a }] }]}
          />
        ))}
      </View>
      <Text variant="dim" color={active ? 'inkDim' : 'inkFaint'}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 12 },
  bar: { width: 3, height: 12, borderRadius: 1.5 },
})
