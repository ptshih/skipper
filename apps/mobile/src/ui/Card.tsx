// The ranger placard. Plain by default (glanceable). `framed` adds the carved
// double-keyline + corner screw-dots — reserve that ornament for NON-driving
// surfaces (detail headers, empty states), never dense list rows.
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { border, radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'

export interface CardProps {
  children: ReactNode
  framed?: boolean
  active?: boolean
  onPress?: () => void
  style?: StyleProp<ViewStyle>
}

export function Card({ children, framed, active, onPress, style }: CardProps) {
  const theme = useTheme()
  const { colors } = theme

  const base: ViewStyle = {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: active ? colors.accent : colors.rule,
    padding: space.lg,
  }

  const inner = (
    <View style={[base, active && { borderWidth: border.keyline }, style]}>
      {framed ? (
        <>
          <View
            pointerEvents="none"
            style={[styles.keyline, { borderColor: colors.keyline, borderRadius: radius.lg - 4 }]}
          />
          <View
            pointerEvents="none"
            style={[styles.screw, styles.screwTL, { backgroundColor: colors.rule }]}
          />
          <View
            pointerEvents="none"
            style={[styles.screw, styles.screwBR, { backgroundColor: colors.rule }]}
          />
        </>
      ) : null}
      {children}
    </View>
  )

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        // `active` doubles as the selected state (e.g. the region picker's chosen row) so a
        // screen reader announces it, not just the pine border. Undefined on plain cards =
        // no selected state announced.
        accessibilityState={{ selected: active }}
        style={({ pressed }) => pressed && styles.pressed}
      >
        {inner}
      </Pressable>
    )
  }
  return inner
}

const styles = StyleSheet.create({
  keyline: {
    position: 'absolute',
    top: 5,
    left: 5,
    right: 5,
    bottom: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  screw: { position: 'absolute', width: 4, height: 4, borderRadius: 2, opacity: 0.7 },
  screwTL: { top: 9, left: 9 },
  screwBR: { bottom: 9, right: 9 },
  pressed: { opacity: 0.9 },
})
