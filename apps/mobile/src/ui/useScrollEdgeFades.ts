// Overflow-aware scroll-edge fades — the measurement half of <EdgeFade>.
//
// ⚠ WHY A HOOK RATHER THAN A COPY IN EACH SCREEN. A fade must appear ONLY where content is genuinely
// clipped; showing one over a short, non-overflowing screen dissolves real content at rest, which
// reads as a rendering bug rather than a flourish. That rule is three measurements and three
// comparisons, and it was written out twice — verbatim, down to the 1px slack and the round-to-whole-px
// setState guards — in `Screen.tsx` and `ConversationScreen.tsx`. Thirteen screens faded from one copy
// and the conversation from the other, so a slack or throttle fix could land in one and no test would
// notice: these are visual rules, and `bun test` cannot see a gradient.
//
// The rounding is not cosmetic. `onScroll` fires at 60fps; rounding to whole px and bailing on an
// unchanged value collapses that stream into at most a couple of setStates per edge crossing, which is
// what keeps a fade from re-rendering its whole screen every frame the rider drags.

import { useCallback, useRef, useState } from 'react'
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native'

/** How often the scroll view may report an offset. See `scrollProps` for why it lives here. */
const SCROLL_THROTTLE_MS = 16

export interface ScrollEdgeFades {
  /** Scrolled past the top AND the content overflows. */
  showTopFade: boolean
  /** More content remains below AND the content overflows. */
  showBottomFade: boolean
  /** Attach to the ScrollView, or call from a wrapper that also does its own per-event work. */
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
  onLayout: (e: LayoutChangeEvent) => void
  onContentSizeChange: (w: number, h: number) => void
  /**
   * Where a PROGRAMMATIC scroll should land — ask for a target, get back the offset the content can
   * actually reach, and scroll to THAT. It is recorded here in the same breath, which is the point.
   *
   * ⚠ ONLY A LIST THAT SCROLLS ITSELF NEEDS THIS, and only because its fade is overflow-GATED: a
   * card-internal list must not dissolve its first row when nothing is clipped, so the fade has to
   * know where the scroll is. (A SCREEN's header fade needs no such thing — it is static paper over
   * paper. Do not reach for this to fix one.) A `scrollTo` delivers no `onScroll` this hook can rely
   * on, so without it the itinerary's fades freeze at the last DRAG while the drive auto-follows the
   * car down the list. The clamp is the other half: `scrollTo` past the end is not corrected for you
   * when the content is shorter than the viewport.
   */
  noteScrollTo: (y: number) => number
  /**
   * The whole wiring, ready to spread onto a scroll view: `<ScrollView {...fades.scrollProps}>`.
   *
   * ⚠ THE THROTTLE IS PART OF THE CONTRACT, not a caller's taste — it is what collapses a 60fps
   * event stream into the couple of setStates this hook's rounding is built around. It was written
   * out beside the three handlers in all four scroll views, which is four places to forget it and
   * no test that could see the omission (a fade simply stops tracking). A caller that needs its own
   * per-event work spreads this FIRST and overrides the one handler it wraps.
   */
  scrollProps: {
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
    onLayout: (e: LayoutChangeEvent) => void
    onContentSizeChange: (w: number, h: number) => void
    scrollEventThrottle: number
  }
}

/**
 * Track viewport/content/offset and derive which edges are genuinely clipped.
 *
 * `enabled` is the caller's own opt-out (`Screen`'s `fadeEdges` prop). The measurements still run when
 * it is false — they are cheap, and gating the STATE on a prop would make the first frame after a
 * flip report a stale geometry.
 */
export function useScrollEdgeFades(enabled = true): ScrollEdgeFades {
  const [viewportH, setViewportH] = useState(0)
  const [contentH, setContentH] = useState(0)
  const [scrollY, setScrollY] = useState(0)
  // Ref mirrors of the two measurements, read only by `noteScrollTo` — see the ⚠ there.
  const viewportRef = useRef(0)
  const contentRef = useRef(0)

  const overflows = contentH > viewportH + 1
  // 1px slack absorbs sub-pixel rounding so the bottom fade clears cleanly at the true end.
  const showTopFade = enabled && overflows && scrollY > 1
  const showBottomFade = enabled && overflows && scrollY + viewportH < contentH - 1

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = Math.round(e.nativeEvent.contentOffset.y)
    setScrollY((prev) => (prev === y ? prev : y))
  }
  const onLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height)
    viewportRef.current = h
    setViewportH((prev) => (prev === h ? prev : h))
  }
  const onContentSizeChange = (_w: number, h: number) => {
    const rounded = Math.round(h)
    contentRef.current = rounded
    setContentH((prev) => (prev === rounded ? prev : rounded))
  }
  // ⚠ Clamped against the REFS, not the state above: a follow-scroll is requested in the same tick
  // the geometry changes, one render before it reaches state, and clamping against the previous
  // content height would collapse every target to zero.
  const noteScrollTo = useCallback((y: number) => {
    const max = Math.max(0, contentRef.current - viewportRef.current)
    const landed = Math.round(Math.min(Math.max(y, 0), max))
    setScrollY((prev) => (prev === landed ? prev : landed))
    return landed
  }, [])

  return {
    showTopFade,
    showBottomFade,
    onScroll,
    onLayout,
    onContentSizeChange,
    noteScrollTo,
    scrollProps: { onScroll, onLayout, onContentSizeChange, scrollEventThrottle: SCROLL_THROTTLE_MS },
  }
}
