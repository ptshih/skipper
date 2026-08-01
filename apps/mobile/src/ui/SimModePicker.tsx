// The sim-mode control — Real GPS / Simulated, the DEVELOPER toggle that swaps every
// real-GPS path in the app (the live drive) for the simulated drive source.
// Same visual family as ThemeModePicker: a sunken track, raised selected segment, no
// border-swap layout nudge. Prop-driven — Settings wires it to the persisted
// useSimMode() context.
import { Pressable, StyleSheet, View } from 'react-native'
import { hit, radius, space } from '../theme/tokens'
import { useTheme } from '../theme'
import { Icon, type IconName } from './Icon'
import { Text } from './Text'
import { voice } from './voice'

const OPTIONS: { on: boolean; label: string; icon: IconName }[] = [
  { on: false, label: voice.settings.simModeReal, icon: 'locate' },
  { on: true, label: voice.settings.simModeSimulated, icon: 'car' },
]

export interface SimModePickerProps {
  value: boolean
  onChange: (on: boolean) => void
}

export function SimModePicker({ value, onChange }: SimModePickerProps) {
  const { colors } = useTheme()
  return (
    <View
      style={[styles.track, { backgroundColor: colors.surfaceSunken, borderColor: colors.rule }]}
      accessibilityRole="radiogroup"
      accessibilityLabel={voice.settings.simModeA11y}
    >
      {OPTIONS.map((opt) => {
        const selected = value === opt.on
        return (
          <Pressable
            key={String(opt.on)}
            onPress={() => onChange(opt.on)}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={opt.label}
            style={({ pressed }) => [
              styles.segment,
              selected && { backgroundColor: colors.surfaceRaised },
              pressed && styles.pressed,
            ]}
          >
            {/* Unselected uses inkDim (6.05:1 light / 6.62:1 dark on the sunken track), NOT
                inkFaint: inkFaint on surfaceSunken is 4.30:1 in daylight — under the 4.5:1
                floor, in the one spot the contrast unit test doesn't cover (it checks
                surface + surfaceRaised only). Don't "match" the inkFaint hint text used
                elsewhere here. (Same guard as ThemeModePicker.) */}
            <Icon name={opt.icon} size={18} color={selected ? 'accent' : 'inkDim'} />
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
    gap: space.xs,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
  },
  pressed: { opacity: 0.7 },
})
