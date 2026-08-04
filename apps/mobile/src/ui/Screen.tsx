// Screen container: paints the `surface` background and respects safe-area. Top
// inset is owned by the expo-router Stack header, so default edges skip 'top' — but "owned by the
// header" now means one of two things (an opaque bar the navigator insets below, or a floating one
// the content pays for itself), and BOTH insets are resolved in ./screenInsets.ts rather than here.
// This shell only says what its own layout pads.
import { type ReactNode } from 'react'
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { SafeAreaView, type Edge } from 'react-native-safe-area-context'
import { space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { EdgeFade } from './EdgeFade'
import { useFloatingHeaderInset, useScreenPadding } from './screenInsets'
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
  const headerInset = useFloatingHeaderInset()
  const bg = { backgroundColor: theme.colors.surface }

  // This layout's OWN pad, before the chrome's insets are added to it (./screenInsets.ts owns those,
  // and the reasons they are content padding rather than frame padding).
  const basePad = padded ? space.gutter : center ? space.xxl : 0
  const contentPadding = useScreenPadding({ top: basePad, bottom: basePad })

  // Overflow-aware scroll-edge fades — the rule and the reason live in ./useScrollEdgeFades, which
  // ConversationScreen shares. Change it there.
  const { showTopFade, showBottomFade, onScroll, onLayout, onContentSizeChange } = useScrollEdgeFades(fadeEdges)

  if (scroll) {
    return (
      <SafeAreaView edges={edges.filter((e) => e !== 'bottom')} style={[styles.flex, bg, style]}>
        {/* Relative wrapper so the EdgeFade strips overlay the scroll viewport's top/bottom
            edges (the ScrollView keeps the same flex:1 context it had directly under the frame). */}
        <View style={styles.flex}>
          <ScrollView
            contentContainerStyle={[
              // The scroll CONTENT fills the viewport even when it doesn't need to, so the
              // scrollable area is the whole usable height rather than a short box with dead paper
              // under it (founder, 2026-08-04 — applied to every scrolling shell). Layout is
              // unchanged: content still stacks from the top, there is just no gap that belongs to
              // nothing. `center` already grew for its own reasons and is unaffected.
              styles.grow,
              padded && styles.padded,
              center && styles.center,
              contentPadding,
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
              centered screen shows no dissolve at rest. `underHeader`: this IS the screen's top
              edge, so where the bar floats the strip grows to cover it (see ./EdgeFade). */}
          <EdgeFade top={showTopFade} bottom={showBottomFade} underHeader />
        </View>
      </SafeAreaView>
    )
  }

  // The non-scrolling path pays the TOP inset too — a floating bar overlaps a map or a centred gate
  // exactly as readily as it overlaps a list. Not the bottom one: this path has no scroll content to
  // ride, so the frame's own safe-area `edges` still handle it as they always have.
  return (
    <SafeAreaView edges={edges} style={[styles.flex, bg, style]}>
      <View
        style={[
          styles.flex,
          padded && styles.padded,
          center && styles.center,
          headerInset > 0 && { paddingTop: basePad + headerInset },
        ]}
      >
        {children}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // flexGrow, never flex:1 — inside a ScrollView the latter caps the content at one viewport and a
  // long screen stops scrolling entirely. (Same reason `center` uses flexGrow; see its note.)
  grow: { flexGrow: 1 },
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
