// The diagnostics-overlay control — Show / Hide, the DEVELOPER toggle that makes the
// roam canvas diagnostics line (pin count · GPS fix age · nearest pin) visible on
// TestFlight-live field drives. Same visual family as SimModePicker / ThemeModePicker.
import { Pressable, StyleSheet, View } from 'react-native'
import { hit, radius, space } from '../theme/tokens'
import { useTheme } from '../theme'
import { Icon, type IconName } from './Icon'
import { Text } from './Text'
import { voice } from './voice'

const OPTIONS: { on: boolean; label: string; icon: IconName }[] = [
  { on: false, label: voice.settings.showDiagHide, icon: 'eyeOff' },
  { on: true, label: voice.settings.showDiagShow, icon: 'eye' },
]

export interface DiagnosticsPickerProps {
  value: boolean
  onChange: (on: boolean) => void
}

export function DiagnosticsPicker({ value, onChange }: DiagnosticsPickerProps) {
  const { colors } = useTheme()
  return (
    <View
      style={[styles.track, { backgroundColor: colors.surfaceSunken, borderColor: colors.rule }]}
      accessibilityRole="radiogroup"
      accessibilityLabel={voice.settings.showDiagA11y}
    >
      {OPTIONS.map((opt) => {
        const selected = value === opt.on
        return (
          <Pressable
            key={String(opt.on)}
            onPress={() => onChange(opt.on)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={opt.label}
            style={({ pressed }) => [
              styles.segment,
              selected && { backgroundColor: colors.surfaceRaised },
              pressed && styles.pressed,
            ]}
          >
            {/* Unselected uses inkDim (not inkFaint) — same contrast guard as SimModePicker:
                inkFaint on surfaceSunken is 4.30:1 in daylight, below the 4.5:1 floor. */}
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
