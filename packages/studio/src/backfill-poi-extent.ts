// backfill-poi-extent — populate `pois.area_km2` from Wikidata P2046, in QID batches.
//
// WHY THIS EXISTS: the legibility layer needs to tell a CONTAINER from a STOP, and nothing else we store
// can. `Sierra Nevada` and `Half Dome` both carry `kind = 'mountain'` with article lengths within 15% of
// each other; `Carson Range` is a container with a SHORT article. Kind and prose length both fail. EXTENT
// is the thing that actually differs — a national park or a mountain range is somewhere you are INSIDE
// for an hour, not somewhere you pass — and Wikidata states it outright in P2046.
//
// Consumed by `classify-treatments.ts`: a POI at or above `CONTAINER_AREA_KM2` may still be a group
// MEMBER (a fused telling naming "Half Dome, in Yosemite National Park" is good) but may never SEED a
// group, because a seed's coordinate defines the group's centre and a park's nominal centroid is
// arbitrary relative to anything you can see.
//
// ⚠ NULL means "Wikidata claims no area", NEVER "small". Most POIs have no claim, so callers must treat
// null as unknown-and-therefore-not-a-container rather than as zero.
//
// Blast radius: MUTATES DB on --apply. NO spend — WDQS is free and keyless (same endpoint discovery
// already uses). Preview reports what would be written.
//
//   preview:  dotenvx run -f .env.development -- bun packages/studio/src/backfill-poi-extent.ts
//   apply:    dotenvx run -f .env.development -- bun packages/studio/src/backfill-poi-extent.ts --apply
//   --region <slug>   scope to a region's bbox (default: lake-tahoe)
//   --force           re-fetch POIs that already have an area recorded

import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois } from '@skipper/db/schema'
import { announce, parseFlags } from './pipeline/ops'
import { withRetry } from './pipeline/http'
import { resolveRegion, requireRegionBbox } from './pipeline/region'
import { DEFAULT_REGION_SLUG, WDQS_ENDPOINT, WDQS_USER_AGENT } from './config'

/** QIDs per SPARQL VALUES block. WDQS is free but shared infrastructure — keep requests modest. */
const BATCH = 150

async function areasFor(qids: string[]): Promise<Map<string, number>> {
  // P2046 carries a unit (km², m², acre, hectare…), so normalise via the unit's conversion-to-SI
  // factor (P2370) rather than assuming km². `psv:` gives the normalised value node.
  const values = qids.map((q) => `wd:${q}`).join(' ')
  const query = `SELECT ?item ?areaSqm WHERE {
    VALUES ?item { ${values} }
    ?item p:P2046/psn:P2046/wikibase:quantityAmount ?areaSqm .
  }`
  const res = await withRetry(
    () =>
      fetch(`${WDQS_ENDPOINT}?query=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': WDQS_USER_AGENT, Accept: 'application/sparql-results+json' },
        signal: AbortSignal.timeout(60_000),
      }),
    { label: 'wdqs.area' },
  )
  if (!res.ok) throw new Error(`WDQS HTTP ${res.status} — free service, usually rate-limited; retry later.`)
  const json = (await res.json()) as { results?: { bindings?: { item?: { value: string }; areaSqm?: { value: string } }[] } }
  const out = new Map<string, number>()
  for (const b of json.results?.bindings ?? []) {
    const qid = b.item?.value.split('/').pop()
    const sqm = Number(b.areaSqm?.value)
    if (!qid || !Number.isFinite(sqm) || sqm <= 0) continue
    // psn: normalises every unit to square METRES, so this division is the only conversion needed.
    out.set(qid, sqm / 1_000_000)
  }
  return out
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2), { valueFlags: ['region'] })
  const apply = flags.has('apply')
  const force = flags.has('force')
  announce({ tool: 'backfill-poi-extent', blast: ['MUTATES DB'], apply })

  const region = await resolveRegion(flags.value('region') ?? DEFAULT_REGION_SLUG)
  const bbox = requireRegionBbox(region)
  console.log(`Region: ${region.displayName} (${region.slug})`)

  const conds = [
    sql`${pois.lat} between ${bbox.swLat} and ${bbox.neLat}`,
    sql`${pois.lng} between ${bbox.swLng} and ${bbox.neLng}`,
  ]
  if (!force) conds.push(isNull(pois.areaKm2))
  const rows = await db.select({ id: pois.id, qid: pois.qid, name: pois.name }).from(pois).where(and(...conds))
  if (rows.length === 0) return console.log('\nNothing to fetch — every POI in range already has an area (use --force to redo).')

  console.log(`${rows.length} POI(s) to look up · ${Math.ceil(rows.length / BATCH)} WDQS batch(es), free.\n`)
  const found = new Map<string, number>()
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH)
    const areas = await areasFor(slice.map((r) => r.qid))
    for (const [qid, km2] of areas) found.set(qid, km2)
    console.error(`  batch ${Math.floor(i / BATCH) + 1}: +${areas.size} area claim(s)`)
  }

  const hits = rows.filter((r) => found.has(r.qid))
  console.log(`\n${hits.length}/${rows.length} have a P2046 area claim (the rest legitimately have none).`)
  const big = hits
    .map((r) => ({ ...r, km2: found.get(r.qid)! }))
    .sort((a, b) => b.km2 - a.km2)
  console.log('\nLargest — these are the CONTAINERS a grouping must not be seeded from:')
  for (const b of big.slice(0, 12)) console.log(`  ${b.km2.toFixed(1).padStart(10)} km²  ${b.name}`)

  if (!apply) return console.log('\nPREVIEW — no writes. Re-run with --apply to persist.')
  let n = 0
  for (const h of big) {
    await withRetry(() => db.update(pois).set({ areaKm2: h.km2 }).where(eq(pois.id, h.id)), { label: `area(${h.name})` })
    n++
  }
  console.log(`\n✓ ${n} area(s) written.`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
