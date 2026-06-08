// The appearance control: a three-way Auto / Day / Dusk segmented control. It lives
// on the Settings screen, NOT in global chrome — the night drive follows the phone by
// default (Auto = the OS day/night cycle, dark at dusk for free), so a rider never has
// to touch this mid-drive. Auto is a first-class, RE-SELECTABLE option: tapping Day or
// Dusk pins a mood, tapping Auto hands control back to the system. That restores the
// "follow system" path the old binary header toggle stranded (it only ever wrote
// light/dark, so once tapped 'system' was unreachable).
import { Pressable, StyleSheet, View } from 'react-native'
import { hit, radius, space } from '../theme/tokens'
import { useTheme, useThemeMode, type ThemeMode } from '../theme/ThemeProvider'
import { Icon, type IconName } from './Icon'
import { Text } from './Text'

const OPTIONS: { mode: ThemeMode; label: string; icon: IconName }[] = [
  { mode: 'system', label: 'Auto', icon: 'auto' },
  { mode: 'light', label: 'Day', icon: 'day' },
  { mode: 'dark', label: 'Dusk', icon: 'night' },
]

export function ThemeModePicker() {
  const { colors } = useTheme()
  const { mode, setMode } = useThemeMode()
  return (
    <View
      style={[styles.track, { backgroundColor: colors.surfaceSunken, borderColor: colors.rule }]}
      accessibilityRole="radiogroup"
    >
      {OPTIONS.map((opt) => {
        const selected = mode === opt.mode
        // Selection reads off a raised fill (lighter than the sunken track) plus an
        // accent glyph + ink label — no border, so swapping selection never nudges
        // layout by a hairline.
        return (
          <Pressable
            key={opt.mode}
            onPress={() => setMode(opt.mode)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${opt.label} appearance`}
            style={({ pressed }) => [
              styles.segment,
              selected && { backgroundColor: colors.surfaceRaised },
              pressed && styles.pressed,
            ]}
          >
            <Icon name={opt.icon} size={18} color={selected ? 'accent' : 'inkFaint'} />
            <Text variant="label" color={selected ? 'ink' : 'inkFaint'}>
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
