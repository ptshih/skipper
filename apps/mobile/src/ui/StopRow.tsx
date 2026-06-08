// A stop in the route list. Three states read at a glance:
//   upcoming — hollow bullet, dim name, ▶
//   active   — amber edge-bar + tinted bed, bold name, ♪
//   passed   — filled bullet, "stamped" mark (the passport-stamp beat)
// Optional stop-type glyph keeps story/scenic/break legible without color alone.
import { Pressable, StyleSheet, View } from 'react-native'
import { radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon, type IconName } from './Icon'
import { Text } from './Text'

export const STOP_ROW_HEIGHT = 60

export type StopState = 'upcoming' | 'active' | 'passed'

export interface StopRowProps {
  name: string
  sublabel?: string
  state?: StopState
  icon?: IconName // stop-type icon
  onPress?: () => void
}

export function StopRow({ name, sublabel, state = 'upcoming', icon, onPress }: StopRowProps) {
  const { colors } = useTheme()
  const active = state === 'active'
  const passed = state === 'passed'

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${name}${sublabel ? `, ${sublabel}` : ''}${active ? ', now playing' : passed ? ', played' : ''}`}
      style={({ pressed }) => [
        styles.row,
        active && { backgroundColor: colors.surfaceRaised },
        pressed && styles.pressed,
      ]}
    >
      {/* active edge-bar — PINE, not amber: amber is reserved for the NOW glow +
          car token so only one amber element glows per phase (DESIGN §8) */}
      <View style={[styles.edge, { backgroundColor: active ? colors.accent : 'transparent' }]} />

      {/* bullet */}
      <View
        style={[
          styles.bullet,
          {
            borderColor: passed || active ? colors.accent : colors.trackInactive,
            backgroundColor: passed || active ? colors.accent : 'transparent',
          },
        ]}
      />

      <View style={styles.body}>
        <View style={styles.nameRow}>
          {icon ? <Icon name={icon} size={16} color={passed ? 'inkDim' : 'ink'} /> : null}
          <Text
            variant={active ? 'bodyStrong' : 'body'}
            color={active ? 'ink' : passed ? 'inkDim' : 'ink'}
            numberOfLines={1}
            style={styles.name}
          >
            {name}
          </Text>
        </View>
        {sublabel ? (
          <Text variant="dim" color="inkFaint">
            {sublabel}
          </Text>
        ) : null}
      </View>

      <Icon
        name={active ? 'nowPlaying' : passed ? 'passed' : 'upcoming'}
        size={16}
        color={active ? 'accent' : 'inkFaint'}
        style={styles.trailing}
      />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: STOP_ROW_HEIGHT, // minHeight, not height — survives Dynamic Type
    paddingVertical: space.sm,
    paddingHorizontal: space.gutter,
    borderRadius: radius.sm,
  },
  edge: {
    width: 4,
    alignSelf: 'stretch',
    marginVertical: space.sm,
    borderRadius: 2,
    marginLeft: -space.sm,
  },
  bullet: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  body: { flex: 1, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  name: { flexShrink: 1 },
  trailing: { width: 22, textAlign: 'center' },
  pressed: { opacity: 0.7 },
})
