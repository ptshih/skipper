// The conversation's shell — a scroll region with a pinned, keyboard-aware footer.
//
// Deliberately NOT a `keyboard` flag on Screen: Screen has thirteen call sites whose contract is
// "paints `surface`, owns safe-area" (Screen.tsx:1-2), and none of them want a footer slot, a scroll
// ref, or an auto-scroll state machine. This shell's contract is the other one — "a scroll region
// with a pinned composer that survives the keyboard". The scroll-edge fade rule is NOT forked: the
// overflow bookkeeping below is Screen.tsx's, copied, feeding the same standalone EdgeFade.
//
// It knows NOTHING about the planner — no transcript, no streaming, no network. It is handed
// children and a footer.
//
// ⚠ MUST render inside a Stack screen. `useHeaderHeight()` THROWS outside a header context
// (expo-router/build/react-navigation/elements/Header/useHeaderHeight.js — it `use()`s
// HeaderHeightContext and throws when it is undefined). The native stack mounts that provider
// around every screen's children, so home is fine; a bare-modal or gate-chrome caller is not.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useHeaderHeight } from 'expo-router/react-navigation'
import { space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { EdgeFade } from './EdgeFade'

/**
 * How close to the bottom the rider must be for a growing turn to keep scrolling itself into view.
 * Big enough to survive a sub-pixel resting offset and a one-line flush, small enough that a rider
 * who scrolled up to re-read an earlier turn is unambiguously "away".
 */
export const CONVERSATION_STICK_PX = 48

export interface ConversationScreenProps {
  children: ReactNode
  /** Pinned above the keyboard. The composer, or the wrap-up bar. Omit for no footer at all. */
  footer?: ReactNode
  /** Follow content growth while the rider is within CONVERSATION_STICK_PX of the bottom. */
  stickToBottom?: boolean
  /** Bump to request ONE animated scroll-to-end. A discrete rider ACTION, never a stream flush. */
  scrollSignal?: number
  contentContainerStyle?: StyleProp<ViewStyle>
}

export function ConversationScreen({
  children,
  footer,
  stickToBottom = true,
  scrollSignal = 0,
  contentContainerStyle,
}: ConversationScreenProps) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const headerHeight = useHeaderHeight()
  const keyboardVisible = useKeyboardVisible()
  const scrollRef = useRef<ScrollView | null>(null)

  // Overflow-aware scroll-edge fades — the rule is Screen.tsx:45-69 verbatim, including the
  // round-to-whole-px setState guards that collapse a 60fps onScroll stream into a couple of
  // setStates per edge crossing. A fade must only appear where content is genuinely clipped.
  const [viewportH, setViewportH] = useState(0)
  const [contentH, setContentH] = useState(0)
  const [scrollY, setScrollY] = useState(0)
  const overflows = contentH > viewportH + 1
  const showTopFade = overflows && scrollY > 1
  const showBottomFade = overflows && scrollY + viewportH < contentH - 1

  // ── Auto-scroll, and how it must not fight the rider ────────────────────────────────────────
  // Seeded FALSE, which is a deliberate departure from the design's "starts `true`". At cold open
  // the hero, the example chips and MY DRIVES already overflow, and the very first
  // onContentSizeChange would then yank a first-timer past all three before they read a word. The
  // rider's own actions re-pin via `scrollSignal`, so nothing is lost: send → pin → the stream
  // follows. Content that grows on its own (MY DRIVES resolving on focus) must NOT steal the view.
  const pinnedRef = useRef(false)
  const lastSignalRef = useRef(scrollSignal)

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
    // Measured off THIS event, not off the rounded state above: those exist for the fades and lag
    // by a render, and a one-frame-stale pin decision reads as a stutter mid-stream.
    pinnedRef.current =
      contentSize.height - layoutMeasurement.height - contentOffset.y <= CONVERSATION_STICK_PX
    const y = Math.round(contentOffset.y)
    setScrollY((prev) => (prev === y ? prev : y))
  }

  const onLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height)
    setViewportH((prev) => (prev === h ? prev : h))
  }

  const onContentSizeChange = (_w: number, h: number) => {
    const rounded = Math.round(h)
    setContentH((prev) => (prev === rounded ? prev : rounded))
    // ⚠ NEVER re-pin here. A rider who scrolled up to re-read turn 2 while turn 9 streams must stay
    // put — that is the whole rule. This branch only ACTS on a pin that a rider action already set.
    if (!stickToBottom || !pinnedRef.current) return
    // `animated: false` on growth: a streaming turn flushes 5-15 times per turn and fifteen queued
    // animated scrolls stutter. The animated one is reserved for `scrollSignal` (one per action).
    // `y: h` over-scrolls by a viewport; RN clamps to the true maximum offset.
    scrollRef.current?.scrollTo({ y: h, animated: false })
  }

  useEffect(() => {
    // Skips the mount pass (the ref is seeded from the same prop), so a cold open never scrolls.
    if (scrollSignal === lastSignalRef.current) return
    lastSignalRef.current = scrollSignal
    // An explicit rider action always re-pins, regardless of where they had scrolled to.
    pinnedRef.current = true
    scrollRef.current?.scrollToEnd({ animated: true })
  }, [scrollSignal])

  // With no footer (the offline home drops the composer entirely) nothing else pays the home
  // indicator, so the inset rides the scroll CONTENT — never the SafeAreaView frame, whose
  // paddingBottom would turn the strip into an opaque dead band that clips the last row
  // (Screen.tsx:72-78 records the full autopsy).
  const contentBottom = space.gutter + (footer ? 0 : insets.bottom)

  return (
    // 'top' belongs to the Stack header; 'bottom' belongs to the footer below.
    <SafeAreaView
      edges={['left', 'right']}
      style={[styles.flex, { backgroundColor: colors.surface }]}
    >
      {/* ⚠ ASSUMED, not device-verified: `keyboardVerticalOffset={headerHeight}`. Derived from the
          installed KeyboardAvoidingView.js, which computes its inset from a PARENT-RELATIVE layout
          frame against a SCREEN-coordinate keyboard frame — the constant difference is the header +
          status bar, i.e. exactly `useHeaderHeight()`. THE ON-DEVICE CHECK, do it first: raise the
          keyboard and look at the composer's top edge. Flush on the keyboard = correct. Floating
          ~100pt high = the offset is double-counted, use 0. Buried ~100pt under the keyboard = the
          offset isn't reaching the KAV. It is a one-token fix and a typecheck can never see it. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={headerHeight}
      >
        {/* Relative wrapper so the EdgeFade strips overlay the scroll viewport's edges. */}
        <View style={styles.flex}>
          <ScrollView
            ref={scrollRef}
            // ⚠ THE two-tap bug. The RN default is 'never' (ScrollView.d.ts:671), which eats the
            // first tap on every example chip and every "Make this drive" while the keyboard is up
            // — i.e. on the highest-intent controls in the app. 'handled' rather than 'always' so a
            // tap on inert prose still dismisses the keyboard.
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            // ⚠ Do NOT add `automaticallyAdjustKeyboardInsets` — iOS-only, and it insets for the
            // same keyboard the KAV is already padding for. ⚠ Do NOT add
            // `maintainVisibleContentPosition` — it anchors on PREPEND; a conversation appends.
            contentContainerStyle={[
              { padding: space.gutter, paddingBottom: contentBottom },
              contentContainerStyle,
            ]}
            onLayout={onLayout}
            onContentSizeChange={onContentSizeChange}
            onScroll={onScroll}
            scrollEventThrottle={16}
          >
            {children}
          </ScrollView>
          {showTopFade || showBottomFade ? (
            <EdgeFade top={showTopFade} bottom={showBottomFade} />
          ) : null}
        </View>
        {footer ? (
          <View
            style={[
              styles.footer,
              {
                // Load-bearing fill: without it the transcript scrolls BEHIND the composer at full
                // opacity. (The bottom EdgeFade dissolves the scroll edge; it does not hide it.)
                backgroundColor: colors.surface,
                // While the keyboard is up the home indicator is underneath it, so its inset must
                // go to zero or the composer floats above the keys.
                paddingBottom: keyboardVisible ? space.sm : space.sm + insets.bottom,
              },
            ]}
          >
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

/**
 * Module-private: is the software keyboard up? Used only for the footer's safe-area inset.
 * Mirrors RN's own platform split (KeyboardAvoidingView.js:198-214) — `will*` on iOS so the inset
 * changes in the same frame the KAV animates its padding, `did*` on Android, which has no `will*`.
 */
function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(() => Keyboard.isVisible())
  useEffect(() => {
    const isIOS = Platform.OS === 'ios'
    const subs = [
      Keyboard.addListener(isIOS ? 'keyboardWillShow' : 'keyboardDidShow', () => setVisible(true)),
      Keyboard.addListener(isIOS ? 'keyboardWillHide' : 'keyboardDidHide', () => setVisible(false)),
    ]
    return () => subs.forEach((s) => s.remove())
  }, [])
  return visible
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  footer: { paddingHorizontal: space.gutter, paddingTop: space.sm },
})
