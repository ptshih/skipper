// snap-speakable-anchors — auto-populate `pois.speakable_lat/lng` (the "where to look" trigger anchor)
// by snapping each POI's centroid pin to the nearest DRIVABLE road. Fixes triage cluster 1a
// (docs/specs/road-snapped-anchors-spec.md): a POI whose pin sits off-road (a resort's grounds, a lake
// centroid) never triggers, or triggers garbage, because the trigger center is the centroid. The
// speakable slot already has a validator (@skipper/engine `checkSpeakableAnchor`) and an audit
// (audit-speakable.ts) — this adds the missing automated PRODUCER (the slot is otherwise hand-curated;
// discover-pois.ts leaves it untouched).
//
// ROADS SOURCE = OpenStreetMap via Overpass (free, keyless). The first cut used Google Roads "Nearest
// Roads", but its snap threshold is far tighter than our trigger bound: it flagged 233/334 Tahoe POIs
// "no road" that actually have a drivable road within bound (a casino 81 m from the highway, parks at
// 60 m…). OSM finds them, costs nothing, and needs no API enablement. We fetch all drivable roads in the
// region bbox once (tiled), index the segments, and snap every POI locally.
//
// For each eligible POI: nearest point on the nearest drivable road → validate it sits within the
// kind-aware bound (`checkSpeakableAnchor`, `speakableAnchorMaxM` = 1.5×radiusForKind) of the pin:
//   • within bound  → write speakable_lat/lng (a road-relative trigger center for 1b steps 1–2).
//   • beyond bound  → DON'T write a bogus anchor; FLAG it — un-triggerable from any road (genuine
//     backcountry, e.g. Desolation Wilderness peaks). This is dogfood feedback #5. Leave the anchor null.
//
// Blast radius: MUTATES DB on --apply only — and NO spend (OSM is free), so no founder $ gate. Conforms
// to docs/guides/ops-scripts-sop.md (SAFE BY DEFAULT): preview fetches + snaps + reports what WOULD be
// written/flagged but writes nothing; --apply also writes.
//
//   preview:  dotenvx run -f .env.development -- bun packages/studio/src/snap-speakable-anchors.ts
//   apply:    dotenvx run -f .env.development -- bun packages/studio/src/snap-speakable-anchors.ts --apply
//   --region <slug>  scope to a region's bbox (default: lake-tahoe).
//   --force          re-snap POIs that already carry an anchor (OVERWRITES admin corrections too) — a
//                    clean re-baseline. Default: only POIs with no speakable anchor yet.

import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois } from '@skipper/db/schema'
import { checkSpeakableAnchor, speakableAnchorMaxM } from '@skipper/engine'
import { announce, parseFlags } from './pipeline/ops'
import { mapLimit } from './pipeline/concurrency'
import { withRetry } from './pipeline/http'
import { resolveRegion, requireRegionBbox } from './pipeline/region'
import { DEFAULT_REGION_SLUG } from './config'

const OVERPASS = 'https://overpass-api.de/api/interpreter'
const UA = 'Skipper/0.1 (https://github.com/ptshih/skipper; hello@skipper.fm) road-snap'
// Through-roads only (no `service` — driveways/parking aisles aren't "the road you drive past a POI on").
const DRIVABLE =
  '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$'
const TILES = 5 // 5×5 grid over the (padded) region bbox — light enough per `out geom` request
const BBOX_PAD_DEG = 0.03 // ~3 km > the max kind-bound (2250 m), so an edge POI still sees its road
const GRID_CELL_DEG = 0.02 // ~2.2 km spatial-index cell; a ±2 scan covers ±4.4 km

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type PoiRow = { id: string; name: string; kind: string | null; lat: number; lng: number }
type Seg = [number, number, number, number] // aLat, aLng, bLat, bLng
type LngLat = [number, number]

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

/** Fetch drivable-road geometry for one tile, with a CLIENT-side timeout + retry (Overpass throttles). */
async function fetchTile(s: number, w: number, n: number, e: number): Promise<{ lat: number; lon: number }[][]> {
  const q = `[out:json][timeout:90];way[highway~"${DRIVABLE}"](${s},${w},${n},${e});out geom;`
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(OVERPASS, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        signal: AbortSignal.timeout(90_000),
      })
      if (res.status === 429 || res.status >= 500) {
        await sleep(3000 * 2 ** attempt)
        continue
      }
      if (!res.ok) throw new Error(`Overpass ${res.status}`)
      const data = (await res.json()) as { elements?: { geometry?: { lat: number; lon: number }[] }[] }
      return (data.elements ?? []).map((el) => el.geometry ?? []).filter((g) => g.length >= 2)
    } catch (err) {
      if (attempt === 3) throw err
      await sleep(3000 * 2 ** attempt)
    }
  }
  return []
}

/** A road index: all drivable segments in the bbox + a coarse grid for nearest-segment lookup. */
class RoadIndex {
  private readonly segs: Seg[] = []
  private readonly grid = new Map<string, number[]>()
  private key = (lat: number, lng: number) => `${Math.floor(lat / GRID_CELL_DEG)}:${Math.floor(lng / GRID_CELL_DEG)}`
  private bin(lat: number, lng: number, idx: number) {
    const k = this.key(lat, lng)
    const b = this.grid.get(k)
    if (b) b.push(idx)
    else this.grid.set(k, [idx])
  }
  add(ways: { lat: number; lon: number }[][]) {
    for (const g of ways)
      for (let i = 0; i < g.length - 1; i++) {
        const a = g[i]!,
          b = g[i + 1]!
        const idx = this.segs.length
        this.segs.push([a.lat, a.lon, b.lat, b.lon])
        this.bin(a.lat, a.lon, idx) // bin at both endpoints + midpoint so a long segment is found near its middle
        this.bin(b.lat, b.lon, idx)
        this.bin((a.lat + b.lat) / 2, (a.lon + b.lon) / 2, idx)
      }
  }
  get size() {
    return this.segs.length
  }
  /** Nearest road point to P over candidate segments in P's cell ±2; null if no segment indexed nearby. */
  nearest(plat: number, plng: number): { distM: number; lat: number; lng: number } | null {
    const ci = Math.floor(plat / GRID_CELL_DEG),
      cj = Math.floor(plng / GRID_CELL_DEG)
    const seen = new Set<number>()
    let best: { distM: number; lat: number; lng: number } | null = null
    for (let di = -2; di <= 2; di++)
      for (let dj = -2; dj <= 2; dj++)
        for (const idx of this.grid.get(`${ci + di}:${cj + dj}`) ?? []) {
          if (seen.has(idx)) continue
          seen.add(idx)
          const p = nearestOnSeg(plat, plng, this.segs[idx]!)
          if (!best || p.distM < best.distM) best = p
        }
    return best
  }
}

async function buildRoadIndex(bbox: { swLat: number; swLng: number; neLat: number; neLng: number }): Promise<RoadIndex> {
  const s0 = bbox.swLat - BBOX_PAD_DEG,
    n0 = bbox.neLat + BBOX_PAD_DEG
  const w0 = bbox.swLng - BBOX_PAD_DEG,
    e0 = bbox.neLng + BBOX_PAD_DEG
  const dLat = (n0 - s0) / TILES,
    dLng = (e0 - w0) / TILES
  const index = new RoadIndex()
  for (let i = 0; i < TILES; i++)
    for (let j = 0; j < TILES; j++) {
      const ways = await fetchTile(s0 + i * dLat, w0 + j * dLng, s0 + (i + 1) * dLat, w0 + (j + 1) * dLng)
      index.add(ways)
      console.error(`  tile ${i * TILES + j + 1}/${TILES * TILES}: +${ways.length} ways (${index.size} segments)`)
    }
  return index
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2), { valueFlags: ['region'] })
  const apply = flags.has('apply')
  const force = flags.has('force')
  announce({ tool: 'snap-speakable-anchors', blast: ['MUTATES DB'], apply })
  if (force) console.log('(force: re-snapping POIs that already carry an anchor — OVERWRITES admin corrections)\n')

  const region = await resolveRegion(flags.value('region') ?? DEFAULT_REGION_SLUG)
  const bbox = requireRegionBbox(region)
  console.log(`Region: ${region.displayName} (${region.slug})`)

  const conds = [
    sql`${pois.lat} between ${bbox.swLat} and ${bbox.neLat}`,
    sql`${pois.lng} between ${bbox.swLng} and ${bbox.neLng}`,
  ]
  if (!force) conds.push(isNull(pois.speakableLat)) // lat/lng written together → checking lat suffices
  const rows: PoiRow[] = await db
    .select({ id: pois.id, name: pois.name, kind: pois.kind, lat: pois.lat, lng: pois.lng })
    .from(pois)
    .where(and(...conds))

  if (rows.length === 0) {
    console.log('\nNothing to snap — every POI in range already has a speakable anchor (use --force to redo).')
    return
  }
  console.log(`${rows.length} POI(s) to snap.\n\nFetching drivable roads (OSM/Overpass, ${TILES * TILES} tiles)...`)
  const roads = await buildRoadIndex(bbox)
  console.log(`\nIndexed ${roads.size} road segments. Snapping...`)

  // Snap every POI locally to its nearest road point, validated through the canonical bound.
  type Snapped = { row: PoiRow; lat: number; lng: number }
  const toWrite: Snapped[] = []
  const flagged: { row: PoiRow; distanceM: number | null; maxM: number }[] = []
  for (const row of rows) {
    const pin: LngLat = [row.lng, row.lat]
    const near = roads.nearest(row.lat, row.lng)
    if (!near) {
      flagged.push({ row, distanceM: null, maxM: speakableAnchorMaxM(row.kind) })
      continue
    }
    const check = checkSpeakableAnchor(pin, [near.lng, near.lat], row.kind)
    if (check.ok) toWrite.push({ row, lat: near.lat, lng: near.lng })
    else flagged.push({ row, distanceM: check.distanceM, maxM: check.maxM })
  }

  const verb = apply ? 'writing' : 'would write'
  console.log(`\n${toWrite.length} within bound (${verb}); ${flagged.length} flagged off-road (no anchor).`)

  if (apply) {
    let written = 0
    await mapLimit(toWrite, 8, async (s) => {
      await withRetry(
        () => db.update(pois).set({ speakableLat: s.lat, speakableLng: s.lng }).where(eq(pois.id, s.row.id)),
        { label: `snap(${s.row.name})` },
      )
      written++
    })
    console.log(`✓ ${written} anchor(s) written.`)
  } else {
    console.log('PREVIEW — no writes. Re-run with --apply to persist.')
  }

  if (flagged.length) {
    console.log(`\n${flagged.length} POI(s) with no drivable road within bound (genuine backcountry — left anchorless):`)
    for (const f of flagged.slice(0, 20))
      console.log(
        `  ${f.distanceM != null ? Math.round(f.distanceM) + 'm' : 'none'} / ${f.maxM}m  ${f.row.name} (${f.row.kind ?? 'place'})`,
      )
    if (flagged.length > 20) console.log(`  …and ${flagged.length - 20} more`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
