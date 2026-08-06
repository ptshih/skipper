// The home cold-open background — a WPA park poster: three ridge planes, a small lake, and the rig
// on a switchback road that ENDS at a cabin. Decorative only; it hides the moment the conversation
// starts. Spec + the seven render rounds behind the shape: docs/designs/home-hero-poster.md.
//
// ⚠ IT REPLACED `Ridgeline`, which was a 472×56 hairline — visible on device only if you went
// looking for it, which is why "the home screen looks stale" came back three days after it shipped.
// DESIGN §2 allows ONE signature move per screen, so the two cannot coexist: a poster already
// contains a ridge. Recover `Ridgeline` from git if this is ever reverted.
//
// ⚠ WHY SVG, in an app whose only other decoration is built from rotated Views. Rotated Views can
// draw the ridge planes (straight diagonal edges) and nothing else here: a winding road, a shaped
// lake and a car are not rectangles. `react-native-svg` is in Expo SDK 57's own
// `bundledNativeModules.json` (15.15.4), so `expo install` pins it and SDK upgrades carry it. The
// alternative considered and rejected was two bundled PNGs — see the spec §3.6; the deciding factor
// was that a raster cannot re-lay-out for the 375×667 → 440×956 device range, and iOS size classes
// cannot even distinguish those (docs/research/fitting-one-screen-across-iphone-sizes.md §1).
//
// ⚠ EVERY COLOUR IS A ROLE, so day/dusk is a palette swap rather than a second piece of artwork.
// The road is `onPhoto` — the one pair that deliberately does NOT flip by theme — because it lies on
// a dark plane in both moods. A draft stroked it in `surface`, which at dusk IS the night
// background, and the road silently vanished; `theme.test.ts` now asserts that pair.
import { memo, useMemo } from 'react'
import { View } from 'react-native'
import Svg, { Circle, G, Path, Rect } from 'react-native-svg'
import { useTheme } from '../theme/ThemeProvider'

// The artwork's own coordinate space, and the ONLY place these numbers live. They are the box the
// composition was designed and judged in (`assets/brand/explore-poster/gen.py`, variant D1): 1320
// wide by 803 tall, which is the free strip below the ask cards on a 1320×2868 screen. `viewBox`
// does every bit of scaling from here, so nothing below is device-specific.
const VB_W = 1320
const VB_H = 803
/** Where the composer bar starts, in artwork coordinates — the road's lower bound. */
const FLOOR = 505

/** Aspect of the artwork box. Exported so the caller can size a container without guessing. */
export const HOME_POSTER_ASPECT = VB_H / VB_W

export interface HomePosterProps {
  /** Full screen width. Height follows from the artwork's aspect unless `maxHeight` clamps it. */
  width: number
  /**
   * Optional ceiling. On a short phone the artwork would otherwise take a larger SHARE of the
   * screen than it does on a tall one (its height tracks WIDTH, not height). Clamping crops from
   * the top via `slice`, which is the right end to lose — the sky is the emptiest part.
   */
  maxHeight?: number
}

/** Three points make a ridge plane's top edge; the band then closes to the bottom of the box. */
function plane(index: number, tilt: number): string {
  const base = FLOOR * (0.1 + 0.17 * index)
  const pts: string[] = []
  for (let k = 0; k <= 8; k++) {
    const x = (VB_W * k) / 8
    pts.push(`${x.toFixed(1)},${(base + tilt * (0.5 - k / 8)).toFixed(1)}`)
  }
  return `M${pts.join(' L')} L${VB_W},${VB_H} L0,${VB_H} Z`
}

export interface RoadShape {
  d: string
  end: { x: number; y: number }
  car: { x: number; y: number; angle: number }
}

/**
 * The road, sampled as a polyline so the rig can be placed anywhere along it.
 *
 * ⚠ The wiggle is ENVELOPED by sin(pi*t) so it vanishes at both ends. Without that the sine was
 * still near its peak when the road finished, so the end point drifted and the cabin landed off the
 * edge of the artwork. ⚠ And it stays a SINE: a draft drew this as straight switchback legs and it
 * read as a lightning bolt. More bend comes from curvature, never from angle.
 */
function road(carAt: number): RoadShape {
  const N = 72
  const y0 = FLOOR - 30
  const y1 = FLOOR * 0.52
  const xs: number[] = []
  const ys: number[] = []
  for (let k = 0; k < N; k++) {
    const t = k / (N - 1)
    xs.push(VB_W * (0.07 + 0.77 * t + 0.13 * Math.sin(t * Math.PI * 2.6) * Math.sin(t * Math.PI)))
    ys.push(y0 - (y0 - y1) * t)
  }
  const d = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${(ys[i] ?? 0).toFixed(1)}`).join(' ')

  // ⚠ Heading is taken across i±2, not from the adjacent point. Adjacent points on a sampled curve
  // give a jittery angle, and at a bend it splayed the body and cabin apart until the rig read as an
  // orange cross. ⚠ `carAt` is likewise not free — it must land on a FLAT stretch (0.60 today), and
  // the flat stretches move if the wiggle above changes.
  const i = Math.max(2, Math.min(N - 3, Math.round(carAt * (N - 1))))
  const ax = xs[i - 2] ?? 0
  const ay = ys[i - 2] ?? 0
  const bx = xs[i + 2] ?? 0
  const by = ys[i + 2] ?? 0
  return {
    d,
    end: { x: xs[N - 1] ?? 0, y: ys[N - 1] ?? 0 },
    car: {
      x: xs[i] ?? 0,
      y: ys[i] ?? 0,
      angle: (Math.atan2(by - ay, bx - ax) * 180) / Math.PI,
    },
  }
}

function HomePosterBase({ width, maxHeight }: HomePosterProps) {
  const { colors } = useTheme()
  const height = Math.min(width * HOME_POSTER_ASPECT, maxHeight ?? Number.POSITIVE_INFINITY)

  // Geometry memoized apart from paint: the shape never changes after mount, so a theme swap
  // repaints without re-solving 72 road samples and three ridge bands.
  const { planes, r } = useMemo(() => {
    const tilt = 0.16 * FLOOR
    return { planes: [plane(0, tilt), plane(1, tilt), plane(2, tilt)], r: road(0.6) }
  }, [])

  const lakeW = VB_W * 0.28
  const lakeH = 105
  const lx = VB_W * 0.2
  const ly = FLOOR - 235
  // A shaped body, never an ellipse and never a full-width band: a flat teal plane spanning the
  // artwork was the loudest stripe in the composition, and a lake drawn BEHIND a ridge for depth got
  // clipped to its crown and read as a blue hill.
  const lake =
    `M${lx - lakeW * 0.5},${ly}` +
    ` C${lx - lakeW * 0.42},${ly - lakeH * 0.62} ${lx - lakeW * 0.1},${ly - lakeH * 0.58} ${lx + lakeW * 0.12},${ly - lakeH * 0.3}` +
    ` C${lx + lakeW * 0.34},${ly - lakeH * 0.04} ${lx + lakeW * 0.52},${ly + lakeH * 0.1} ${lx + lakeW * 0.44},${ly + lakeH * 0.34}` +
    ` C${lx + lakeW * 0.3},${ly + lakeH * 0.62} ${lx - lakeW * 0.22},${ly + lakeH * 0.6} ${lx - lakeW * 0.5},${ly} Z`

  const ROAD_W = 26

  return (
    <View style={{ width, height, overflow: 'hidden' }} pointerEvents="none">
      <Svg width={width} height={height} viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMax slice">
        <Path d={planes[0] ?? ''} fill={colors.posterFar} />
        <Path d={planes[1] ?? ''} fill={colors.posterMid} />
        <Path d={planes[2] ?? ''} fill={colors.posterNear} />
        <Path d={lake} fill={colors.water} />
        <Path
          d={r.d}
          fill="none"
          stroke={colors.onPhoto}
          strokeWidth={ROAD_W}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d={r.d}
          fill="none"
          stroke={colors.posterNear}
          strokeWidth={ROAD_W * 0.18}
          strokeLinecap="round"
          strokeDasharray={[ROAD_W * 0.8, ROAD_W]}
          opacity={0.5}
        />
        {/* The rig. ⚠ Wheels are `posterNear` and sit INSIDE the cream road stroke — drawn on the
            plane instead they were the same value as the ground and read as holes bitten out of the
            car. ⚠ Sized to the ROAD, not the screen: a 106pt car on a 26pt road is a bar. */}
        <G transform={`translate(${r.car.x},${r.car.y}) rotate(${r.car.angle})`}>
          <Circle cx={-19} cy={0} r={7.5} fill={colors.posterNear} />
          <Circle cx={19} cy={0} r={7.5} fill={colors.posterNear} />
          <Rect x={-33} y={-17} width={66} height={15} rx={5} fill={colors.amberToken} />
          <Path d="M-16,-17 L-13,-29 Q-12,-31 -9,-31 L6,-31 Q9,-31 10,-29 L14,-17 Z" fill={colors.amberToken} />
        </G>
        {/* The cabin the drive ARRIVES at — the road used to run off the edge, which reads as
            stopping rather than getting somewhere. The app icon already ends its switchback S with a
            marker on the stroke, so a terminus is the icon's grammar, not a new idea. */}
        <G transform={`translate(${r.end.x},${r.end.y - 4})`}>
          <Rect x={-40.5} y={-60} width={81} height={60} fill={colors.onPhoto} />
          <Path d="M-50.2,-60 L0,-105 L50.2,-60 Z" fill={colors.onPhoto} />
          <Rect x={-13.8} y={-43.2} width={27.6} height={24} fill={colors.amberToken} />
        </G>
      </Svg>
    </View>
  )
}

/** Decorative cold-open backdrop. Renders nothing interactive and carries no a11y surface. */
export const HomePoster = memo(HomePosterBase)

// Referenced so the unused-export lint sees the shape type as part of the surface.
export type { RoadShape as HomePosterRoadShape }
