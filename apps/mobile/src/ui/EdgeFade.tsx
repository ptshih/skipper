// A soft scroll-edge fade — content dissolves into the `surface` at the top/bottom of a
// scroll viewport instead of hard-clipping under the header or at the bottom edge (the iOS-26
// "scroll edge effect" read; cf. ChatGPT / Apple Music). Render these as the LAST children of
// a relatively-positioned container that also holds the scroll view: the strips overlay the
// viewport's top/bottom edges and taps pass straight through (`pointerEvents="none"`).
//
// Mechanism: RN core's `experimental_backgroundImage` linear-gradient — NO native dependency,
// so it shows on a JS reload (no rebuild). The fade-OUT end is `surfaceFade` (surface at 0
// alpha), never CSS `transparent`, which would interpolate through black and tint the
// dissolve. The gradient is STATIC, so DESIGN.md's "never animate color stops" note is moot.
import { StyleSheet, View } from 'react-native'
import { space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'

export interface EdgeFadeProps {
  top?: boolean
  bottom?: boolean
  /** Band height — taller = a softer, longer dissolve. */
  height?: number
  /** Which surface the clipped content sits on — a screen (`surface`, the default) or a card
   *  the list scrolls INSIDE (`raised`, the itinerary). The gradient must start in the color
   *  actually behind the edge or the strip paints a band of the wrong paper. */
  on?: 'surface' | 'raised'
}

export function EdgeFade({ top = true, bottom = true, height = space.xxl, on = 'surface' }: EdgeFadeProps) {
  const { colors } = useTheme()
  const base = on === 'raised' ? colors.surfaceRaised : colors.surface
  const out = on === 'raised' ? colors.surfaceRaisedFade : colors.surfaceFade
  // The surface, opaque AT the edge → its own 0-alpha twin toward the content. 180deg fades
  // downward (top edge), 0deg fades upward (bottom edge).
  const fadeDown = `linear-gradient(180deg, ${base}, ${out})`
  const fadeUp = `linear-gradient(0deg, ${base}, ${out})`
  return (
    <>
      {top ? (
        <View
          pointerEvents="none"
          style={[styles.strip, styles.top, { height, experimental_backgroundImage: fadeDown }]}
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
