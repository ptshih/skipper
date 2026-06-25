// snap-speakable-anchors — auto-populate `pois.speakable_lat/lng` (the "where to look" trigger anchor)
// by snapping each POI's centroid pin to the nearest DRIVABLE road. Fixes triage cluster 1a
// (docs/specs/road-snapped-anchors-spec.md): a POI whose pin sits off-road (a resort's grounds, a lake
// centroid) never triggers, or triggers garbage, because the trigger center is the centroid. The
// speakable slot already has a validator (@skipper/engine `checkSpeakableAnchor`) and an audit
// (audit-speakable.ts) — this adds the missing automated PRODUCER (today the slot is hand-curated only;
// discover-pois.ts leaves it untouched).
//
// For each eligible POI: Google Roads API "Nearest Roads" → the nearest road point → validate it sits
// within the kind-aware bound (`speakableAnchorMaxM` = 1.5×radiusForKind) of the pin:
//   • within bound  → write speakable_lat/lng (a road-relative trigger center for 1b steps 1–2).
//   • too far / no road → DON'T write a bogus anchor; FLAG it — the POI is un-triggerable from any road
//     (this is dogfood feedback #5, "flag POIs not near a road"). Leave the anchor null.
//
// Blast radius: SPENDS $ (Roads API) + MUTATES DB — both ONLY on --apply. Conforms to
// docs/guides/ops-scripts-sop.md (SAFE BY DEFAULT): preview counts the eligible POIs + estimates the
// Roads cost and makes NO API calls and NO writes; --apply snaps + validates + writes.
//
//   preview:  dotenvx run -f .env.development -- bun packages/studio/src/snap-speakable-anchors.ts
//   apply:    dotenvx run -f .env.development -- bun packages/studio/src/snap-speakable-anchors.ts --apply
//   --region <slug>  scope to a region's bbox (default: lake-tahoe).
//   --force          re-snap POIs that already carry an anchor (OVERWRITES admin corrections too) — a
//                    clean re-baseline. Default: only POIs with no speakable anchor yet.

import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois } from '@skipper/db/schema'
import { checkSpeakableAnchor, haversineMeters } from '@skipper/engine'
import { announce, maxCostFlag, parseFlags } from './pipeline/ops'
import { mapLimit } from './pipeline/concurrency'
import { fetchWithRetry, withRetry } from './pipeline/http'
import { resolveRegion, requireRegionBbox } from './pipeline/region'
import { DEFAULT_REGION_SLUG, GOOGLE_READY, requireEnv } from './config'

/** Roads API "Nearest Roads" — up to 100 points/request; ~$10 per 1,000 requests (verify current
 *  Google Maps Platform pricing). Needs the Roads API ENABLED on GOOGLE_MAPS_API_KEY (Routes/Places
 *  enablement alone won't do — same gotcha as Geocoding being off for the first West Shore tour). */
const NEAREST_ROADS_URL = 'https://roads.googleapis.com/v1/nearestRoads'
const ROADS_POINTS_PER_REQUEST = 100
const ROADS_USD_PER_REQUEST = 0.01

interface NearestRoadsResponse {
  snappedPoints?: { location: { latitude: number; longitude: number }; originalIndex?: number }[]
  error?: { message?: string; status?: string }
}

type PoiRow = { id: string; name: string; kind: string | null; lat: number; lng: number }

/** Snap each POI coord to its nearest road point. Returns a Map<row index → {lat,lng}>; an index with
 *  no road in snap range is OMITTED (Roads drops un-snappable points). When Roads returns several
 *  candidates for one point, keep the one closest to the original centroid. */
async function snapToNearestRoad(coords: PoiRow[], apiKey: string): Promise<Map<number, { lat: number; lng: number }>> {
  const out = new Map<number, { lat: number; lng: number }>()
  for (let base = 0; base < coords.length; base += ROADS_POINTS_PER_REQUEST) {
    const chunk = coords.slice(base, base + ROADS_POINTS_PER_REQUEST)
    // Roads wants "lat,lng|lat,lng" (latitude FIRST), opposite our [lng,lat] internal order.
    const points = chunk.map((c) => `${c.lat},${c.lng}`).join('|')
    const url = `${NEAREST_ROADS_URL}?points=${encodeURIComponent(points)}&key=${apiKey}`
    const res = await fetchWithRetry(url, undefined, { timeoutMs: 20_000 })
    const body = (await res.json()) as NearestRoadsResponse
    if (!res.ok || body.error) {
      throw new Error(
        `Roads API error (${res.status} ${body.error?.status ?? ''}): ${body.error?.message ?? 'unknown'} — ` +
          `is the Roads API enabled on GOOGLE_MAPS_API_KEY?`,
      )
    }
    for (const sp of body.snappedPoints ?? []) {
      const i = base + (sp.originalIndex ?? 0)
      const orig = coords[i]
      if (!orig) continue
      const cand = { lat: sp.location.latitude, lng: sp.location.longitude }
      const prev = out.get(i)
      // Keep the candidate nearest the original centroid (Roads may return several per point).
      if (
        !prev ||
        haversineMeters([cand.lng, cand.lat], [orig.lng, orig.lat]) <
          haversineMeters([prev.lng, prev.lat], [orig.lng, orig.lat])
      ) {
        out.set(i, cand)
      }
    }
  }
  return out
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2), { valueFlags: ['region', 'max-cost'] })
  const apply = flags.has('apply')
  const force = flags.has('force')
  const maxCostUsd = maxCostFlag(flags)
  announce({ tool: 'snap-speakable-anchors', blast: ['SPENDS $', 'MUTATES DB'], apply })
  if (force) console.log('(force: re-snapping POIs that already carry an anchor — OVERWRITES admin corrections)\n')

  const region = await resolveRegion(flags.value('region') ?? DEFAULT_REGION_SLUG)
  const bbox = requireRegionBbox(region)
  console.log(`Region: ${region.displayName} (${region.slug})\n`)

  const conds = [
    sql`${pois.lat} between ${bbox.swLat} and ${bbox.neLat}`,
    sql`${pois.lng} between ${bbox.swLng} and ${bbox.neLng}`,
  ]
  if (!force) conds.push(isNull(pois.speakableLat)) // lat/lng are written together → checking lat suffices
  const rows: PoiRow[] = await db
    .select({ id: pois.id, name: pois.name, kind: pois.kind, lat: pois.lat, lng: pois.lng })
    .from(pois)
    .where(and(...conds))

  if (rows.length === 0) {
    console.log('Nothing to snap — every POI in range already has a speakable anchor (use --force to redo).')
    return
  }

  const requests = Math.ceil(rows.length / ROADS_POINTS_PER_REQUEST)
  const estUsd = requests * ROADS_USD_PER_REQUEST
  console.log(`${rows.length} POI(s) to snap → ${requests} Roads request(s) ≈ $${estUsd.toFixed(2)}.\n`)

  if (!apply) {
    if (!GOOGLE_READY()) console.log('⚠ GOOGLE_MAPS_API_KEY is not set — --apply will need it (preview does not).')
    console.log(
      `PREVIEW — no Roads calls, no writes. Re-run with --apply to snap + write (≈ $${estUsd.toFixed(2)} Roads). ` +
        `Within-bound snaps are written; POIs whose nearest road is too far are FLAGGED, not written.`,
    )
    return
  }

  if (estUsd > maxCostUsd) {
    throw new Error(
      `⛔ Estimated Roads spend ~$${estUsd.toFixed(2)} exceeds --max-cost=$${maxCostUsd.toFixed(2)} — aborting. Raise --max-cost or narrow --region.`,
    )
  }

  console.log(`Snapping ${rows.length} POI(s) via Roads "Nearest Roads"...`)
  const apiKey = requireEnv('GOOGLE_MAPS_API_KEY')
  const snapped = await snapToNearestRoad(rows, apiKey)

  let written = 0
  const flaggedNoRoad: PoiRow[] = []
  const flaggedTooFar: { row: PoiRow; distanceM: number; maxM: number }[] = []
  await mapLimit(rows, 8, async (row, i) => {
    const snap = snapped.get(i)
    if (!snap) {
      flaggedNoRoad.push(row) // Roads found no road near this point at all
      return
    }
    const check = checkSpeakableAnchor([row.lng, row.lat], [snap.lng, snap.lat], row.kind)
    if (!check.ok) {
      flaggedTooFar.push({ row, distanceM: check.distanceM, maxM: check.maxM }) // un-triggerable from a road
      return
    }
    await withRetry(
      () => db.update(pois).set({ speakableLat: snap.lat, speakableLng: snap.lng }).where(eq(pois.id, row.id)),
      { label: `snap(${row.name})` },
    )
    written++
  })

  console.log(`\nDone: ${written} anchor(s) written.`)
  const flaggedTotal = flaggedNoRoad.length + flaggedTooFar.length
  if (flaggedTotal > 0) {
    console.log(
      `\n${flaggedTotal} POI(s) FLAGGED as un-triggerable from a road (no anchor written — they need a ` +
        `hand-set vantage in the admin, or they're genuinely not near any drive):`,
    )
    for (const f of flaggedTooFar)
      console.log(`  too far  ${Math.round(f.distanceM)}m / ${f.maxM}m  ${f.row.name} (${f.row.kind ?? 'place'})`)
    for (const r of flaggedNoRoad) console.log(`  no road  ${r.name} (${r.kind ?? 'place'})`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
