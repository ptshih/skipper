// WHAT THE CHROME COSTS THE CONTENT — the top and bottom insets every screen shell owes the bars
// around it, and the single home of both rules.
//
// ⚠ IT IS ONE MODULE BECAUSE THE BOTTOM RULE WAS ALREADY A COPY. `Screen`, `ScreenList` and
// `ConversationScreen` each carried the home-indicator rule in full — comment, reasoning and
// arithmetic — and the floating bar was on its way to making the TOP rule a third copy as well. Same
// defect the repo keeps paying for (a fix lands in one copy, no test can see the other), so both
// rules resolve here and the shells ask for a number.
//
// THE TWO RULES:
//
//   · BOTTOM — the safe-area inset rides the scroll CONTENT, never the shell's frame. A frame
//     `paddingBottom` turns the home-indicator strip into an opaque dead band the content cannot
//     scroll under, which CLIPS the last row at that line. So the scroll view fills to the physical
//     bottom edge (the strip stays "transparent" — the list scrolls through it) and the inset becomes
//     content padding, ADDED to whatever pad the layout already has so it never shrinks it.
//     ⚠ A shell whose own footer already sits on the indicator (the conversation's composer) must
//     pass `homeIndicator: false`, or the content pays for a strip something else is already covering.
//
//   · TOP — a FLOATING bar overlaps the screen instead of sitting above it, so the content pays the
//     bar's height back as padding or its first row renders under the title. Zero when the bar is
//     opaque, where the navigator has already inset the screen below it.
//
// WHY THE BAR FLOATS ON SOME PLATFORMS ONLY, and why WE draw the dissolve rather than the OS.
// iOS 26 gives a scroll view its own "scroll edge effect", but that effect is not a standalone fade:
// it MODULATES THE BAR'S MATERIAL, and react-native-screens can only build two bars — transparent
// (`configureWithTransparentBackground`, no material at all) or opaque/blurred
// (`configureWithOpaqueBackground` + `appearance.backgroundEffect`). It never calls
// `configureWithDefaultBackground`, so the system Liquid Glass is unreachable (react-native-screens
// #4021). Both alternatives were tried ON DEVICE and rejected: `headerBlurEffect` gives a cool grey
// chrome bar with a HARD cut, foreign against paper; a transparent bar with `scrollEdgeEffects:
// {top:'soft'}` dims almost nothing, because there is no material to dim into — the conversation
// stayed fully legible against the title. So the transparent bar is the only one that lets content
// through, and the dissolve is OURS (src/ui/EdgeFade `underHeader`). On older iOS a transparent bar
// is merely transparent and Android has no equivalent, so both keep the opaque bar they always had.
// That is why this is a CONSTANT, not a setting: it asks what the OS can draw, which cannot change
// while the app runs.
import { use } from 'react'
import { Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { space } from '../theme/tokens'
// ⚠ The CONTEXT, not `useHeaderHeight()` — that hook THROWS outside a header context, and `Screen`
// legitimately renders in one: the root ErrorBoundary (app/_layout.tsx) mounts StateView → Screen
// OUTSIDE the navigator entirely, so a throwing read there would turn any render crash into a second
// crash with no recovery. Undefined simply means "no header above me", i.e. no inset to pay.
import { HeaderHeightContext } from 'expo-router/react-navigation'

/** Is the nav bar transparent, with the content running under it? */
export const HEADER_FLOATS =
  Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 26

/** The floating bar's full height, status bar included. Zero when the bar is opaque. */
export function useFloatingHeaderInset(): number {
  const headerHeight = use(HeaderHeightContext)
  return HEADER_FLOATS ? (headerHeight ?? 0) : 0
}

/** How far PAST the bar's bottom edge the dissolve runs. The whole point of the tail: the fade has
 *  to begin while the content is still in the open, so it is already dissolving as it reaches the
 *  nav bar rather than hitting it at full strength (founder, 2026-08-04: "it should start fading
 *  earlier"). Raise this to start the dissolve lower down the screen — it is the one knob. */
const FADE_TAIL = space.xxxl

/**
 * Geometry for the fade over a floating bar, or null when the bar is opaque and the plain
 * scroll-edge fade applies. Three landmarks, each a real edge rather than a tuned fraction, so this
 * stays right on a phone with a different notch, in landscape, and against whatever height the
 * navigator gives the bar:
 *
 *   `solid` — the STATUS bar's bottom. Paper is opaque to here; nothing shows behind the clock.
 *   `height`— the nav bar's bottom plus the tail, where paper reaches zero. So the visible dissolve
 *             spans the NAV BAR and finishes just below it, rather than being crammed above it.
 *
 * ⚠ It layers OVER the OS's own scroll-edge effect rather than replacing it, and both halves earn
 * their place: the blur alone left content far too legible under the bar, and paper alone dissolves
 * a headline into a flat wash instead of softening it.
 *
 * Read by `EdgeFade` itself (`underHeader`) — a shell asks for the fade, never for its numbers.
 */
export function useHeaderFade(): { height: number; solid: number } | null {
  const headerHeight = useFloatingHeaderInset()
  const insets = useSafeAreaInsets()
  if (headerHeight <= 0) return null
  return { height: headerHeight + FADE_TAIL, solid: insets.top }
}

export interface ScreenPaddingArgs {
  /** The layout's own top pad, before the bar's height is added to it. */
  top: number
  /** The layout's own bottom pad, before the home indicator is added to it. */
  bottom: number
  /** False when the shell's own footer already covers the indicator strip. Defaults to true. */
  homeIndicator?: boolean
}

/** The content padding a scroll shell owes the chrome around it — see the two rules up top. */
export function useScreenPadding({
  top,
  bottom,
  homeIndicator = true,
}: ScreenPaddingArgs): { paddingTop: number; paddingBottom: number } {
  const insets = useSafeAreaInsets()
  const headerInset = useFloatingHeaderInset()
  return {
    paddingTop: top + headerInset,
    paddingBottom: bottom + (homeIndicator ? insets.bottom : 0),
  }
}
