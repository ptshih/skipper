// A segmented control — a sunken track holding 2+ mutually-exclusive options; the selected one lifts to
// a raised enamel segment. Used for the drive-detail List⇄Map view toggle. Icon-optional, token-clean.
// (This is the placard/settings-style toggle; an eyes-on-road surface wants a floating icon button.)
import { StyleSheet, View, Pressable, type StyleProp, type ViewStyle } from 'react-native'
import { border, radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon, type IconName } from './Icon'
import { Text } from './Text'

export interface SegmentedOption<K extends string> {
  key: K
  label: string
  icon?: IconName
}

export interface SegmentedProps<K extends string> {
  options: SegmentedOption<K>[]
  value: K
  onChange: (key: K) => void
  /** Screen-reader group label (e.g. "Route view"). */
  accessibilityLabel?: string
  style?: StyleProp<ViewStyle>
}

export function Segmented<K extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  style,
}: SegmentedProps<K>) {
  const { colors } = useTheme()
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[styles.track, { backgroundColor: colors.surfaceSunken }, style]}
    >
      {options.map((opt) => {
        const selected = opt.key === value
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={opt.label}
            style={({ pressed }) => [
              styles.segment,
              selected && {
                backgroundColor: colors.surfaceRaised,
                // A subtle lift so the selected enamel segment reads above the sunken track.
                boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 4, color: colors.shadowCast }],
              },
              pressed && !selected && styles.pressed,
            ]}
          >
            {opt.icon ? (
              <Icon name={opt.icon} size={16} color={selected ? 'accent' : 'inkDim'} />
            ) : null}
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
    padding: 3, // thin inset gutter around the segments (between 2 and xs=4; optical, not a grid step)
    borderRadius: radius.md,
    gap: 3,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    minHeight: 40, // clears the ≥44 with the track inset; comfortable non-in-car tap target
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    borderWidth: border.hair,
    borderColor: 'transparent', // keeps the selected/unselected box metrics identical (no layout shift)
  },
  pressed: { opacity: 0.6 },
})
