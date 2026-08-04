// The conversation's shell — a scroll region with a pinned, keyboard-aware footer.
//
// Deliberately NOT a `keyboard` flag on Screen: Screen has thirteen call sites whose contract is
// "paints `surface`, owns safe-area" (Screen.tsx:1-2), and none of them want a footer slot, a scroll
// ref, or an auto-scroll state machine. This shell's contract is the other one — "a scroll region
// with a pinned composer that survives the keyboard". The scroll-edge fade rule is NOT forked — both
// shells call the same `useScrollEdgeFades` and feed the same standalone EdgeFade; this one only
// layers auto-scroll pinning on top of those events.
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
import { HEADER_FLOATS, useScreenPadding } from './screenInsets'
import { useScrollEdgeFades } from './useScrollEdgeFades'

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

  // Overflow-aware scroll-edge fades — SHARED with Screen.tsx (./useScrollEdgeFades), which is where
  // the rule and its rounding guards live. This screen only layers auto-scroll pinning on top of the
  // same events; the fade measurements themselves are not its business.
  const fades = useScrollEdgeFades()
  const { showTopFade, showBottomFade } = fades

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
    // Measured off THIS event, not off the fade hook's rounded state: that exists for the fades and
    // lags by a render, and a one-frame-stale pin decision reads as a stutter mid-stream.
    pinnedRef.current =
      contentSize.height - layoutMeasurement.height - contentOffset.y <= CONVERSATION_STICK_PX
    fades.onScroll(e)
  }

  const onContentSizeChange = (w: number, h: number) => {
    fades.onContentSizeChange(w, h)
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

  // The chrome's insets, from the shared rule (./screenInsets.ts). `homeIndicator` is FALSE whenever
  // there is a footer: the composer already sits on that strip, so the content must not pay for it
  // twice — with no footer (the offline home drops the composer entirely) nothing else does.
  const contentPadding = useScreenPadding({
    top: space.gutter,
    bottom: space.gutter,
    homeIndicator: !footer,
  })

  return (
    // 'top' belongs to the Stack header; 'bottom' belongs to the footer below.
    <SafeAreaView
      edges={['left', 'right']}
      style={[styles.flex, { backgroundColor: colors.surface }]}
    >
      {/* ⚠ THE OFFSET IS A FUNCTION OF WHERE THIS VIEW STARTS — which is why it is no longer one
          value. The installed KeyboardAvoidingView.js computes its inset from a PARENT-RELATIVE
          layout frame against a SCREEN-coordinate keyboard frame, so the offset owed is the gap
          between those two origins. Under an OPAQUE bar the navigator insets the screen below it and
          that gap is the header + status bar, i.e. exactly `useHeaderHeight()` (the shipped value,
          unchanged). Under a FLOATING one this view already starts at the physical top, the origins
          coincide, and passing the header height would lift the composer clear of the keys.
          VERIFIED on the simulator for the floating case (2026-08-04, iOS 26.5): keyboard up, the
          composer sits flush on the keys. The opaque case is the shipped value, unchanged.
          THE CHECK, and a typecheck can never see it: raise the keyboard and look at the composer's
          top edge. Flush on the keyboard = correct. Floating ~100pt high = the offset is
          double-counted. Buried ~100pt under the keyboard = it isn't reaching the KAV. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={HEADER_FLOATS ? 0 : headerHeight}
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
              { paddingHorizontal: space.gutter },
              contentPadding,
              contentContainerStyle,
            ]}
            // ⚠ SPREAD FIRST, then override: this shell wraps two of the handlers (the pin
            // decision rides the same events), and the throttle it must not forget comes with them.
            {...fades.scrollProps}
            onContentSizeChange={onContentSizeChange}
            onScroll={onScroll}
          >
            {children}
          </ScrollView>
          <EdgeFade top={showTopFade} bottom={showBottomFade} underHeader />
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
