// A faint ridge line behind the top of the home screen — the WPA park poster's horizon, and the
// motif that actually names the country this app is about.
//
// ⚠ A STROKE, NOT A SILHOUETTE, and that is the whole design. The first cut filled the peaks, which
// gave the shape a hard flat BASELINE cutting across the screen behind the question — it read as a
// tinted band rather than scenery. There is no gradient dependency in this app (and no SVG), so the
// base could not be faded out; drawing only the RIDGE removes the problem instead of hiding it, and
// a contour line is closer to the atlas idiom than a solid mass anyway.
//
// Built from rotated Views — the same no-dependency technique the deleted `Sunburst` used (2026-08-05;
// recover it from git if a radiating watermark is ever wanted again). Decorative only: low
// opacity, pointer-events off, no a11y surface, colour from a theme ROLE so it swaps day/dusk.
//
// ⚠ Why a horizon rather than the sunburst it replaced: a burst is a radial object with a centre, so
// wherever it sits it reads as a decal ON the screen and its rays get cropped by the edges. A ridge
// is an EDGE — it belongs against the top the way a horizon belongs at the top of a poster, and it
// runs off both sides instead of being cut off by them.
import { memo, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '../theme/ThemeProvider'
import type { ThemeColors } from '../theme/theme'

export interface RidgelineProps {
  width: number
  /** Height of the band the ridge is drawn in. The line itself only ever occupies part of it. */
  height?: number
  opacity?: number
  color?: keyof ThemeColors
  /** Stroke weight. Hairlines vanish at this opacity; this wants to read as a drawn line. */
  stroke?: number
}

// Ridge vertices as fractions: `x` across the width, `y` UP from the band's bottom. Hand-placed, not
// generated — an even rhythm reads as a bar chart and a random one reads as noise. Starts and ends
// mid-height so the line runs off both edges rather than landing on them.
// ⚠ The full 0–1 range is used deliberately. A shallow version of this profile read as a LINE GRAPH
// rather than a skyline — on a park-poster surface that is the wrong association entirely, and the
// fix is amplitude, not height: deeper valleys inside the same band rather than a taller band
// crowding the question below it.
const POINTS: readonly { x: number; y: number }[] = [
  { x: -0.02, y: 0.2 },
  { x: 0.13, y: 0.7 },
  { x: 0.25, y: 0.3 },
  { x: 0.43, y: 1 },
  { x: 0.57, y: 0.34 },
  { x: 0.69, y: 0.78 },
  { x: 0.83, y: 0.22 },
  { x: 1.02, y: 0.62 },
]

function RidgelineBase({
  width,
  height = 56,
  opacity = 0.16,
  color = 'accent',
  stroke = 2,
}: RidgelineProps) {
  const { colors } = useTheme()

  // ⚠ GEOMETRY MEMOIZED APART FROM PAINT. Seven `hypot`/`atan2` pairs is nothing on its own — the
  // point is that it is nothing SEVEN TIMES per render, for a decoration whose shape has never once
  // changed after mount. Keyed on the band's dimensions only: the colour is applied below, so a theme
  // change repaints without re-solving the ridge.
  const segments = useMemo(
    () =>
      POINTS.slice(1).flatMap((p, i) => {
        const a = POINTS[i]
        if (!a) return []
        const x1 = a.x * width
        const y1 = height - a.y * height
        const x2 = p.x * width
        const y2 = height - p.y * height
        const len = Math.hypot(x2 - x1, y2 - y1)
        return [
          {
            // Positioned by its CENTRE then rotated, because a View rotates about its own centre —
            // anchoring by the left end would swing each segment away from its neighbour and open
            // gaps at every vertex.
            left: (x1 + x2) / 2 - len / 2,
            top: (y1 + y2) / 2 - stroke / 2,
            width: len,
            height: stroke,
            rotate: `${(Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI}deg`,
          },
        ]
      }),
    [width, height, stroke],
  )

  return (
    <View
      style={{ width, height, opacity }}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {segments.map((s, i) => (
        <View
          key={i}
          style={[
            styles.seg,
            {
              left: s.left,
              top: s.top,
              width: s.width,
              height: s.height,
              backgroundColor: colors[color],
              transform: [{ rotate: s.rotate }],
            },
          ]}
        />
      ))}
    </View>
  )
}

/** ⚠ MEMOIZED, and at the only call site every prop is a literal — so this now renders ONCE per
 *  mount instead of riding along with every screen render (which, while a preview clip plays, means
 *  twice a second for a line that cannot move).
 *
 *  ⚠ This does NOT freeze it against a theme change: `useTheme` is a context read, and React
 *  re-renders a memoized component when a context it consumes changes, regardless of props. Day/dusk
 *  still repaints — verified in both themes. */
export const Ridgeline = memo(RidgelineBase)

const styles = StyleSheet.create({
  seg: { position: 'absolute', borderRadius: 1 },
})
