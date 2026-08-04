// A soft scroll-edge fade — content dissolves into the `surface` at the top/bottom of a
// scroll viewport instead of hard-clipping under the header or at the bottom edge (the iOS-26
// "scroll edge effect" read; cf. ChatGPT / Apple Music). Render these as the LAST children of
// a relatively-positioned container that also holds the scroll view: the strips overlay the
// viewport's top/bottom edges and taps pass straight through (`pointerEvents="none"`).
//
// `underHeader` is the SCREEN-TOP variant: where the nav bar floats, this strip is what actually
// dissolves the content passing under it, so it spans the whole bar and a stretch past it instead of
// a scroll edge's short band. Its numbers come from ./screenInsets.ts — the caller asks for the fade.
//
// ⚠ AND IT IS STATIC — mounted always, never gated on a scroll position, which is the opposite of
// every other fade here and the entire point. It is paper drawn over paper: at rest the content
// starts BELOW the bar, so the strip covers nothing but background and cannot be seen, and the
// instant anything passes underneath it dissolves. So it does not need to know where the scroll is,
// and once it stopped asking, a whole class of defect went with the question (founder, 2026-08-04:
// "my hunch is it has to do with your custom scroll position calculations"). Everything that made
// the header fade wrong — a programmatic scroll delivering no event, an auto-scroll over-shooting a
// short transcript, the keyboard resizing the viewport under a remembered offset — was a wrong
// answer to a question this strip should never have asked.
//
// Mechanism: RN core's `experimental_backgroundImage` linear-gradient — NO native dependency,
// so it shows on a JS reload (no rebuild). The fade-OUT end is `surfaceFade` (surface at 0
// alpha), never CSS `transparent`, which would interpolate through black and tint the
// dissolve. The gradient is STATIC, so DESIGN.md's "never animate color stops" note is moot.
import { StyleSheet, View } from 'react-native'
import { space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { useHeaderFade } from './screenInsets'

export interface EdgeFadeProps {
  top?: boolean
  bottom?: boolean
  /** Band height — taller = a softer, longer dissolve. */
  height?: number
  /** This strip is the SCREEN's top edge, under the nav bar. Where that bar floats, the top band
   *  becomes the BAR's own dissolve — see the header note above for why it is static. Off for an
   *  edge INSIDE the page (the itinerary's list, which has no bar above it and would get a
   *  card-sized band of paper). The geometry is not a prop on purpose: a caller asks for the fade,
   *  never for its numbers — see `useHeaderFade` in ./screenInsets.ts. */
  underHeader?: boolean
  /** Which surface the clipped content sits on — a screen (`surface`, the default) or a card
   *  the list scrolls INSIDE (`raised`, the itinerary). The gradient must start in the color
   *  actually behind the edge or the strip paints a band of the wrong paper. */
  on?: 'surface' | 'raised'
}

export function EdgeFade({
  top = true,
  bottom = true,
  height = space.xxl,
  underHeader = false,
  on = 'surface',
}: EdgeFadeProps) {
  const { colors } = useTheme()
  const headerFade = useHeaderFade()
  const base = on === 'raised' ? colors.surfaceRaised : colors.surface
  const out = on === 'raised' ? colors.surfaceRaisedFade : colors.surfaceFade
  // Null unless this strip is a screen's top edge AND the bar above it floats — so an inner list
  // keeps the plain band, and every platform with an opaque bar keeps exactly what it had.
  const overBar = underHeader ? headerFade : null
  const topH = overBar?.height ?? height
  // The surface, opaque AT the edge → its own 0-alpha twin toward the content. 180deg fades
  // downward (top edge), 0deg fades upward (bottom edge).
  //
  // Over a floating bar the ramp gets ONE extra landmark: paper stays solid to the bottom of the
  // STATUS bar — nothing may show behind the clock — and dissolves from there. Which means the
  // visible dissolve happens across the NAV BAR and finishes below it, rather than being crammed
  // above it (founder, 2026-08-04: "it should be fading behind the nav bar", "it should start
  // fading earlier"). Expressed as a percentage of the band, so it cannot drift from the height the
  // strip is actually given.
  const solidPct = overBar ? Math.min(100, Math.max(0, (overBar.solid / topH) * 100)) : 0
  const fadeDown = overBar
    ? `linear-gradient(180deg, ${base} 0%, ${base} ${solidPct}%, ${out} 100%)`
    : `linear-gradient(180deg, ${base}, ${out})`
  const fadeUp = `linear-gradient(0deg, ${base}, ${out})`
  return (
    <>
      {/* `overBar` renders unconditionally — it is the BAR's dissolve, not a scroll edge's. */}
      {overBar || top ? (
        <View
          pointerEvents="none"
          style={[styles.strip, styles.top, { height: topH, experimental_backgroundImage: fadeDown }]}
        />
      ) : null}
      {bottom ? (
        <View
          pointerEvents="none"
          style={[styles.strip, styles.bottom, { height, experimental_backgroundImage: fadeUp }]}
        />
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  strip: { position: 'absolute', left: 0, right: 0 },
  top: { top: 0 },
  bottom: { bottom: 0 },
})
