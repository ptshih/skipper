// backfill-poi-extent — populate `pois.area_km2` / `length_km` / `wikidata_types` from Wikidata.
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
import { containmentReason, isContainer } from './pipeline/containment'

/** QIDs per SPARQL VALUES block. WDQS is free but shared infrastructure — keep requests modest. */
const BATCH = 150

interface Claims {
  areaKm2?: number
  lengthKm?: number
  types: string[]
}

async function claimsFor(qids: string[]): Promise<Map<string, Claims>> {
  // `psn:` is the NORMALISED value node, so P2046 arrives in square metres and P2043 in metres whatever
  // unit the claim was authored in (km², acre, hectare, mile…). That normalisation is the only reason
  // these two divisions are the whole conversion.
  const values = qids.map((q) => `wd:${q}`).join(' ')
  const query = `SELECT ?item ?areaSqm ?lenM ?p31Label WHERE {
    VALUES ?item { ${values} }
    OPTIONAL { ?item p:P2046/psn:P2046/wikibase:quantityAmount ?areaSqm . }
    OPTIONAL { ?item p:P2043/psn:P2043/wikibase:quantityAmount ?lenM . }
    OPTIONAL { ?item wdt:P31 ?p31 . }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
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
  const json = (await res.json()) as {
    results?: {
      bindings?: {
        item?: { value: string }
        areaSqm?: { value: string }
        lenM?: { value: string }
        p31Label?: { value: string }
      }[]
    }
  }
  const out = new Map<string, Claims>()
  for (const b of json.results?.bindings ?? []) {
    const qid = b.item?.value.split('/').pop()
    if (!qid) continue
    const c = out.get(qid) ?? { types: [] }
    const sqm = Number(b.areaSqm?.value)
    if (Number.isFinite(sqm) && sqm > 0) c.areaKm2 = sqm / 1_000_000
    const m = Number(b.lenM?.value)
    if (Number.isFinite(m) && m > 0) c.lengthKm = m / 1000
    // One row PER TYPE (the OPTIONALs cross-product), so accumulate rather than overwrite.
    const t = b.p31Label?.value?.toLowerCase().trim()
    if (t && !c.types.includes(t)) c.types.push(t)
    out.set(qid, c)
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
  if (!force) conds.push(isNull(pois.wikidataTypes))
  const rows = await db.select({ id: pois.id, qid: pois.qid, name: pois.name }).from(pois).where(and(...conds))
  if (rows.length === 0) return console.log('\nNothing to fetch — every POI in range already has an area (use --force to redo).')

  console.log(`${rows.length} POI(s) to look up · ${Math.ceil(rows.length / BATCH)} WDQS batch(es), free.\n`)
  const found = new Map<string, Claims>()
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH)
    const got = await claimsFor(slice.map((r) => r.qid))
    for (const [qid, c] of got) found.set(qid, c)
    console.error(`  batch ${Math.floor(i / BATCH) + 1}: +${got.size} entity claim(s)`)
  }

  const hits = rows.filter((r) => found.has(r.qid)).map((r) => ({ ...r, c: found.get(r.qid)! }))
  const containers = hits.filter((h) => isContainer(h.c))
  console.log(
    `\n${hits.length}/${rows.length} resolved. Area claims: ${hits.filter((h) => h.c.areaKm2 != null).length}; ` +
      `length claims: ${hits.filter((h) => h.c.lengthKm != null).length}.`,
  )
  console.log(`\n${containers.length} CONTAINER(s) — inside/along, not passed:`)
  for (const b of containers.slice(0, 20)) console.log(`  ${containmentReason(b.c)}  ·  ${b.name}`)
  if (containers.length > 20) console.log(`  …and ${containers.length - 20} more`)

  if (!apply) return console.log('\nPREVIEW — no writes. Re-run with --apply to persist.')
  let n = 0
  for (const h of hits) {
    await withRetry(
      () =>
        db
          .update(pois)
          .set({ areaKm2: h.c.areaKm2 ?? null, lengthKm: h.c.lengthKm ?? null, wikidataTypes: h.c.types })
          .where(eq(pois.id, h.id)),
      { label: `claims(${h.name})` },
    )
    n++
  }
  console.log(`\n✓ ${n} POI(s) updated (${containers.length} flagged as containers).`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
