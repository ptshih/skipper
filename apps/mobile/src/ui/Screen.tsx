// Screen container: paints the `surface` background and respects safe-area. Top
// inset is owned by the expo-router Stack header, so default edges skip 'top'.
import { type ReactNode } from 'react'
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { SafeAreaView, useSafeAreaInsets, type Edge } from 'react-native-safe-area-context'
import { space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { EdgeFade } from './EdgeFade'
import { useScrollEdgeFades } from './useScrollEdgeFades'

export interface ScreenProps {
  children: ReactNode
  scroll?: boolean
  padded?: boolean // applies the standard gutter on all sides
  center?: boolean // centers content (loading / empty / gate states)
  edges?: readonly Edge[]
  /** Soft scroll-edge fades (top + bottom) over scrolling content. On by default. */
  fadeEdges?: boolean
  style?: StyleProp<ViewStyle>
  contentContainerStyle?: StyleProp<ViewStyle>
}

export function Screen({
  children,
  scroll,
  padded,
  center,
  edges = ['left', 'right', 'bottom'],
  fadeEdges = true,
  style,
  contentContainerStyle,
}: ScreenProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const bg = { backgroundColor: theme.colors.surface }

  // Overflow-aware scroll-edge fades — the rule and the reason live in ./useScrollEdgeFades, which
  // ConversationScreen shares. Change it there.
  const { showTopFade, showBottomFade, onScroll, onLayout, onContentSizeChange } = useScrollEdgeFades(fadeEdges)

  if (scroll) {
    // The bottom safe-area inset rides the SCROLL CONTENT, never the SafeAreaView frame: a
    // frame paddingBottom turns the home-indicator strip into an opaque dead band the content
    // can't scroll under — it CLIPS the last row at that line. Instead the ScrollView fills to
    // the physical bottom edge (the strip stays "transparent" — the list scrolls through it)
    // and the inset becomes content paddingBottom so the last row clears the indicator. Added
    // to the base bottom pad (gutter when padded, the centered xxl, else 0) so it never shrinks it.
    const baseBottom = padded ? space.gutter : center ? space.xxl : 0
    return (
      <SafeAreaView edges={edges.filter((e) => e !== 'bottom')} style={[styles.flex, bg, style]}>
        {/* Relative wrapper so the EdgeFade strips overlay the scroll viewport's top/bottom
            edges (the ScrollView keeps the same flex:1 context it had directly under the frame). */}
        <View style={styles.flex}>
          <ScrollView
            contentContainerStyle={[
              padded && styles.padded,
              center && styles.center,
              { paddingBottom: baseBottom + insets.bottom },
              contentContainerStyle,
            ]}
            onLayout={onLayout}
            onContentSizeChange={onContentSizeChange}
            onScroll={onScroll}
            scrollEventThrottle={16}
          >
            {children}
          </ScrollView>
          {/* Each fade is mounted only when its edge is genuinely clipped, so a short or
              centered screen shows no dissolve at rest. */}
          {showTopFade || showBottomFade ? (
            <EdgeFade top={showTopFade} bottom={showBottomFade} />
          ) : null}
        </View>
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
    // flexGrow (not flex:1): identical layout when content fits, but inside a ScrollView it
    // lets an over-tall centered stack (e.g. the gate at large accessibility text) scroll
    // instead of clipping. The non-scroll path's wrapper still has styles.flex so it fills.
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xxl,
    gap: space.md,
  },
})
