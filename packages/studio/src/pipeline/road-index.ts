// Shared road geometry and snapping policy for Overpass and local OSM extracts.
// Keep one spatial index so changing the data source cannot change the nearest-road algorithm.

// No service roads: parking aisles/driveways aren't the road a narration drive passes on.
export const DRIVABLE =
  '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$'
// A THROUGH road — one a tour is plausibly driven on. The rest of DRIVABLE (unclassified, residential,
// living_street) is the neighbourhood layer: real, drivable, and usually NOT where the drive is.
// Snapping a downtown building to the side street behind it produces a perfectly valid anchor that
// triggers from a road nobody is on — the failure the road CLASS exists to expose. We still snap to a
// minor road when that's all there is (a lake road is `unclassified` too); we just record which.
export const MAJOR = /^(motorway|trunk|primary|secondary|tertiary)(_link)?$/
export const BBOX_PAD_DEG = 0.03 // ~3 km > the max kind-bound (2250 m), so an edge POI still sees its road
const GRID_CELL_DEG = 0.02 // ~2.2 km spatial-index cell; a ±2 scan covers ±4.4 km

type Seg = [number, number, number, number] // aLat, aLng, bLat, bLng
/** One OSM way reduced to what the snapper needs: its geometry + its `highway=` class. */
export type Way = { geom: { lat: number; lon: number }[]; cls: string; id?: string; tags?: Record<string, string> }

/** Conservative holds, not a road-legality service. Seasonal/conditional tags remain in the
 * report for desk review; a nearest-road match cannot establish current access or visibility. */
export function roadReviewHolds(tags: Record<string, string> = {}): string[] {
  const holds: string[] = []
  for (const key of ['access', 'vehicle', 'motor_vehicle', 'motorcar']) {
    if (['no', 'private', 'agricultural', 'forestry', 'delivery'].includes(tags[key] ?? '')) {
      holds.push(`${key}=${tags[key]}`)
    }
  }
  if (tags.tunnel && tags.tunnel !== 'no') holds.push(`tunnel=${tags.tunnel}`)
  return holds
}

/** Closest point on a segment to P (+ its distance), via a local equirectangular projection at P. */
function nearestOnSeg(plat: number, plng: number, s: Seg): { distM: number; lat: number; lng: number } {
  const kx = Math.cos((plat * Math.PI) / 180) * 111_320
  const ky = 111_320
  const ax = (s[1] - plng) * kx,
    ay = (s[0] - plat) * ky
  const bx = (s[3] - plng) * kx,
    by = (s[2] - plat) * ky
  const dx = bx - ax,
    dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? (-(ax * dx) - ay * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx,
    cy = ay + t * dy
  return { distM: Math.hypot(cx, cy), lat: plat + cy / ky, lng: plng + cx / kx }
}

/** A road index: all drivable segments in the bbox + a coarse grid for nearest-segment lookup. */
export class RoadIndex {
  private readonly segs: Seg[] = []
  /** Parallel to `segs`: the OSM `highway=` class of the way each segment came from. */
  private readonly cls: string[] = []
  private readonly evidence: { id?: string; tags?: Record<string, string> }[] = []
  private readonly grid = new Map<string, number[]>()
  private key = (lat: number, lng: number) => `${Math.floor(lat / GRID_CELL_DEG)}:${Math.floor(lng / GRID_CELL_DEG)}`
  private bin(lat: number, lng: number, idx: number) {
    const k = this.key(lat, lng)
    const b = this.grid.get(k)
    if (b) b.push(idx)
    else this.grid.set(k, [idx])
  }
  add(ways: Way[]) {
    for (const { geom: g, cls, id, tags } of ways)
      for (let i = 0; i < g.length - 1; i++) {
        const a = g[i]!,
          b = g[i + 1]!
        const idx = this.segs.length
        this.segs.push([a.lat, a.lon, b.lat, b.lon])
        this.cls.push(cls)
        this.evidence.push({ id, tags })
        this.bin(a.lat, a.lon, idx) // bin at both endpoints + midpoint so a long segment is found near its middle
        this.bin(b.lat, b.lon, idx)
        this.bin((a.lat + b.lat) / 2, (a.lon + b.lon) / 2, idx)
      }
  }
  get size() {
    return this.segs.length
  }
  /** Nearest road point to P over candidate segments in P's cell ±2; null if no segment indexed nearby.
   *  `majorOnly` restricts the search to through-roads (MAJOR) so a caller can ask "is there a road
   *  people actually drive within bound?" separately from "is there any pavement". */
  nearest(plat: number, plng: number, majorOnly = false): { distM: number; lat: number; lng: number; cls: string; road: { id?: string; tags?: Record<string, string> } } | null {
    const ci = Math.floor(plat / GRID_CELL_DEG),
      cj = Math.floor(plng / GRID_CELL_DEG)
    const seen = new Set<number>()
    let best: { distM: number; lat: number; lng: number; cls: string; road: { id?: string; tags?: Record<string, string> } } | null = null
    for (let di = -2; di <= 2; di++)
      for (let dj = -2; dj <= 2; dj++)
        for (const idx of this.grid.get(`${ci + di}:${cj + dj}`) ?? []) {
          if (seen.has(idx)) continue
          seen.add(idx)
          const cls = this.cls[idx]!
          if (majorOnly && !MAJOR.test(cls)) continue
          const p = nearestOnSeg(plat, plng, this.segs[idx]!)
          if (!best || p.distM < best.distM) best = { ...p, cls, road: this.evidence[idx]! }
        }
    return best
  }
}
