// DISPLAY-ONLY route simplification — Ramer–Douglas–Peucker over a [lng, lat] polyline.
//
// ⚠ THE STORED ROUTE IS NEVER TOUCHED, AND THAT IS THE WHOLE POINT. `materializeRoute` asks Google for
// `polylineQuality: 'HIGH_QUALITY'` on purpose — its comment says the route is frozen and used for
// speed-adaptive trigger geofencing and the drive simulator, "prefer more points over fewer". This
// module exists so the MAP can draw fewer points WITHOUT the engine seeing fewer. Anything that
// projects, triggers or simulates must keep reading the full polyline.
//
// Measured on a real drive (Zephyr Cove → Reno, 90.7 km, saved manifest, 2026-08-05):
//   4559 vertices, mean spacing 19.9 m, median 14.1 m
//   ε=2m → 728 kept (16.0%)   ε=5m → 449 (9.8%)   ε=10m → 303 (6.6%)
// So even the most conservative ε is a ~6x reduction; the curve is very flat past that, which is why
// this file does not chase a smaller number.
//
// ⚠ WHY THIS IS NOT THE FIX FOR THE DASHED-LINE BUG (2026-08-05). It looks like one — the dashes broke
// because a 6-point dash spanned a hundred-plus vertices — but the route line is SOLID now
// (see DriveMap), and a solid stroke renders correctly at any density. This is purely about the cost
// of shipping thousands of coordinates across the JS↔native bridge, over and over, during a drive.

/** Metres per degree of latitude. Longitude is scaled by cos(lat) at the call site — the same
 *  correction `DriveMap`'s cumulative-distance pass makes, and for the same reason: at Tahoe's ~39°N
 *  an unweighted degree over-counts E-W movement by ~30%, which would make ε mean different things on
 *  a north-south road than on an east-west one. */
const M_PER_DEG = 111_320

/** Perpendicular distance from `p` to the SEGMENT ab (not the infinite line) in metres.
 *  ⚠ Clamped to the segment (`t` in [0,1]). The infinite-line form is the textbook one and is wrong
 *  here: for a hairpin, the foot of the perpendicular can land far off the end of ab, reporting a
 *  small distance for a point that is nowhere near the road and dropping the corner. */
function perpDistM(
  p: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
  kx: number,
): number {
  const ax = a[0] * kx
  const ay = a[1] * M_PER_DEG
  const bx = b[0] * kx
  const by = b[1] * M_PER_DEG
  const px = p[0] * kx
  const py = p[1] * M_PER_DEG
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * The INDICES of the points worth drawing, ascending, always including the first and last.
 *
 * ⚠ IT RETURNS INDICES, NOT POINTS, AND THAT IS LOAD-BEARING. `DriveMap` splits the route into
 * traveled/untraveled at a segment index computed against the FULL polyline. Handing back a bare list
 * of points would leave the caller unable to say where the split falls, and the traveled line would
 * silently lag or overrun the puck — worst on straights, which is exactly where simplification removes
 * the most points. Indices let the caller map one space onto the other.
 *
 * ⚠ ITERATIVE, NOT RECURSIVE. RDP is naturally recursive, but the recursion depth is data-dependent
 * and a degenerate route (thousands of near-collinear points) is exactly the input this is fed. An
 * explicit stack cannot blow the JS stack on a rider's drive.
 */
export function simplifyIndices(
  points: readonly (readonly [number, number])[],
  epsilonM: number,
): number[] {
  const n = points.length
  if (n <= 2 || epsilonM <= 0) return points.map((_, i) => i)

  // One cos(lat) for the whole route rather than per segment. A drive spans a fraction of a degree of
  // latitude, so the error in kx is far below ε; per-segment would be precision theatre at real cost.
  let latSum = 0
  for (const p of points) latSum += p[1]
  const kx = M_PER_DEG * Math.cos(((latSum / n) * Math.PI) / 180)

  const keep = new Array<boolean>(n).fill(false)
  keep[0] = true
  keep[n - 1] = true

  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length > 0) {
    const [i, j] = stack.pop()!
    if (j <= i + 1) continue
    let worst = 0
    let worstIdx = i
    for (let k = i + 1; k < j; k++) {
      const d = perpDistM(points[k]!, points[i]!, points[j]!, kx)
      if (d > worst) {
        worst = d
        worstIdx = k
      }
    }
    // `>` not `>=`: a point exactly ε from the chord is within tolerance and may go.
    if (worst > epsilonM) {
      keep[worstIdx] = true
      stack.push([i, worstIdx], [worstIdx, j])
    }
  }

  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i)
  return out
}

/**
 * How many of `kept` are ≤ `idx` — i.e. how long the simplified prefix is for a full-polyline segment
 * index. Binary search, because this runs on every advance of the traveled split.
 *
 * ⚠ Returns a COUNT (a slice length), not an index, so the caller writes `slice(0, n)` with no
 * off-by-one to get wrong.
 */
export function keptCountUpTo(kept: readonly number[], idx: number): number {
  let lo = 0
  let hi = kept.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (kept[mid]! <= idx) lo = mid + 1
    else hi = mid
  }
  return lo
}
