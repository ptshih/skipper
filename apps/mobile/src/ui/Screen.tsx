// Screen container: paints the `surface` background and respects safe-area. Top
// inset is owned by the expo-router Stack header, so default edges skip 'top'.
import type { ReactElement, ReactNode } from 'react'
import {
  ScrollView,
  StyleSheet,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView, type Edge } from 'react-native-safe-area-context'
import { space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'

export interface ScreenProps {
  children: ReactNode
  scroll?: boolean
  padded?: boolean // applies the standard gutter on all sides
  center?: boolean // centers content (loading / empty / gate states)
  edges?: readonly Edge[]
  refreshControl?: ReactElement<RefreshControlProps>
  style?: StyleProp<ViewStyle>
  contentContainerStyle?: StyleProp<ViewStyle>
}

export function Screen({
  children,
  scroll,
  padded,
  center,
  edges = ['left', 'right', 'bottom'],
  refreshControl,
  style,
  contentContainerStyle,
}: ScreenProps) {
  const theme = useTheme()
  const bg = { backgroundColor: theme.colors.surface }

  if (scroll) {
    return (
      <SafeAreaView edges={edges} style={[styles.flex, bg, style]}>
        <ScrollView
          contentContainerStyle={[
            padded && styles.padded,
            center && styles.center,
            contentContainerStyle,
          ]}
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView edges={edges} style={[styles.flex, bg, style]}>
      <View style={[styles.flex, padded && styles.padded, center && styles.center]}>
        {children}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padded: { padding: space.gutter },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xxl,
    gap: space.md,
  },
})
