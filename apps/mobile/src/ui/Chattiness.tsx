// The chattiness control — Quiet / Normal / Talkative, the free-roam SELECTION knob:
// it changes which/how-many encounters fire (the RoamEngine's min-gap governor), never
// what a telling says (delivery is baked at generation time — nothing here
// re-generates at playback). Same visual family as ThemeModePicker: a sunken track,
// raised selected segment, no border-swap layout nudge.
import { Pressable, StyleSheet, View } from 'react-native'
import { hit, radius, space } from '../theme/tokens'
import { useTheme } from '../theme'
import { Text } from './Text'
import { voice } from './voice'

export type ChattinessLevel = 'quiet' | 'normal' | 'talkative'

const OPTIONS: { level: ChattinessLevel; label: string }[] = [
  { level: 'quiet', label: voice.roam.chattiness.quiet },
  { level: 'normal', label: voice.roam.chattiness.normal },
  { level: 'talkative', label: voice.roam.chattiness.talkative },
]

export interface ChattinessProps {
  value: ChattinessLevel
  onChange: (level: ChattinessLevel) => void
}

export function Chattiness({ value, onChange }: ChattinessProps) {
  const { colors } = useTheme()
  return (
    <View
      style={[styles.track, { backgroundColor: colors.surfaceSunken, borderColor: colors.rule }]}
      accessibilityRole="radiogroup"
      accessibilityLabel={voice.roam.chattiness.a11y}
    >
      {OPTIONS.map((opt) => {
        const selected = value === opt.level
        return (
          <Pressable
            key={opt.level}
            onPress={() => onChange(opt.level)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={opt.label}
            style={({ pressed }) => [
              styles.segment,
              selected && { backgroundColor: colors.surfaceRaised },
              pressed && styles.pressed,
            ]}
          >
            <Text variant="label" color={selected ? 'ink' : 'inkDim'}>
              {opt.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.xs,
    gap: space.xs,
  },
  segment: {
    flex: 1,
    minHeight: hit.min,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    paddingVertical: space.sm,
  },
  pressed: { opacity: 0.7 },
})
