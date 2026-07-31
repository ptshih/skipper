// discover-pois — region POI corpus discovery. MUTATES DB on --apply.
//
// This populates the SHARED `pois` corpus for a region's bbox — the one place both TOURS and ROAM
// draw candidates from (POIs are not roam-owned; roam is just one consumer — see CLAUDE.md
// principle #1 + docs/decisions/region-corpus-discovery.md). It discovers every Wikidata-pinned
// place in a raw bbox (the whole Tahoe–Reno corridor by default), prose-joins Wikipedia, tiers
// them, and upserts the STORY + SCENIC tiers into `pois` (facts for story, bare typed pins for
// scenic — the story tier is what a long-form telling needs; scenic pins seed the future wave
// layer). Dedup by the Wikidata QID is the existing upsertPoi seam (it conflicts on `pois.qid`;
// source/source_id are the secondary guard, rewritten in place on a tier flip), so re-running is
// idempotent and a place a tour already visits is the SAME row (facts shared; principle #1).
//
// SOP (docs/guides/ops-scripts-sop.md): PREVIEWS by default; writes only on --apply.
// Discovery is free (WDQS + MediaWiki, no LLM/TTS spend).
//
// Usage:
//   dotenvx run -f .env.development -- bun packages/studio/src/discover-pois.ts
//   dotenvx run -f .env.development -- bun packages/studio/src/discover-pois.ts --apply
//   ... --region <slug>                  sweep a region's discovery bbox (default: lake-tahoe)

import {
  discoverWikidataBbox,
  dedupeByName,
  featureKind,
  type WikidataCandidate,
} from './pipeline/wikidata-discovery'
import { ensurePoiOverridesLoaded } from './pipeline/poi-overrides'
import { fetchFullExtracts } from './pipeline/wikipedia'
import { toFacts } from './pipeline/select'
import { buildStoryFacts, hashFacts, summaryFromExtract, upsertPoi } from './pipeline/persist'
import { announce, parseFlags } from './pipeline/ops'
import { colocationReport, findColocations } from './pipeline/colocation'
import { mapLimit } from './pipeline/concurrency'
import { runJob } from './pipeline/job-progress'
import { sleep } from './pipeline/http'
import { resolveRegion } from './pipeline/region'
import { DEFAULT_REGION_SLUG, TAHOE_RENO_BBOX } from './config'
import type { LngLat } from './pipeline/geo'

/** DB-write fan-out for the corpus upserts. Matches classify-treatments' DB pool — these are Neon
 *  round trips, a different resource from the LLM/TTS knobs in config.ts, so it lives with them. */
const POI_UPSERT_CONCURRENCY = 8

/** Tahoe–Reno corridor: Meyers/South Lake Tahoe west to Homewood/Sugar Pine Point,
 *  north to Kings Beach/Incline, east through Spooner/Zephyr Cove → Carson City →
 *  Virginia City → Reno/Sparks. [lng, lat] corners — from the shared TAHOE_RENO_BBOX. */
const TAHOE_RENO_CORRIDOR: { sw: LngLat; ne: LngLat } = {
  sw: [TAHOE_RENO_BBOX.swLng, TAHOE_RENO_BBOX.swLat],
  ne: [TAHOE_RENO_BBOX.neLng, TAHOE_RENO_BBOX.neLat],
}

/** Split a bbox into a lngSteps × latSteps grid (WDQS etiquette: modest result sets per call). */
export function gridBoxes(
  sw: LngLat,
  ne: LngLat,
  lngSteps: number,
  latSteps: number,
): { sw: LngLat; ne: LngLat }[] {
  const out: { sw: LngLat; ne: LngLat }[] = []
  const dLng = (ne[0] - sw[0]) / lngSteps
  const dLat = (ne[1] - sw[1]) / latSteps
  for (let i = 0; i < lngSteps; i++) {
    for (let j = 0; j < latSteps; j++) {
      out.push({
        sw: [sw[0] + i * dLng, sw[1] + j * dLat],
        ne: [sw[0] + (i + 1) * dLng, sw[1] + (j + 1) * dLat],
      })
    }
  }
  return out
}

const flags = parseFlags(process.argv.slice(2), { valueFlags: ['region'] })
const apply = flags.has('apply')
const regionKey = flags.value('region') ?? DEFAULT_REGION_SLUG

announce({ tool: 'discover-pois', blast: ['MUTATES DB'], apply })

async function main(): Promise<void> {
  // Overrides ride every fetch (the fact-edit seam) — load them before any extract lands.
  await ensurePoiOverridesLoaded()

  // Resolve --region → its discovery bbox (the geometry-first input; see pipeline/region.ts).
  // A region with no bbox set yet falls back to the built-in Tahoe basin so a first sweep still
  // has somewhere to look.
  const region = await resolveRegion(regionKey)
  const box: { sw: LngLat; ne: LngLat } = region.bbox
    ? { sw: [region.bbox.swLng, region.bbox.swLat], ne: [region.bbox.neLng, region.bbox.neLat] }
    : TAHOE_RENO_CORRIDOR
  console.log(
    `Region: ${region.displayName} (${region.slug})` +
      (region.bbox ? '' : ' — no discovery bbox set, using the Tahoe basin default') +
      '\n',
  )

  // 5×7 grid over the corridor (~11×11 km cells — WDQS chokes on wide-area boxes; the
  // original 2×3 attempt timed out on a mid-lake cell), merged by qid, then ONE same-place
  // dedupe across the whole merged set (a place straddling a cell boundary appears in two
  // cells). A cell that still fails after one local retry is SKIPPED and reported — the
  // sweep is idempotent, so a re-run fills the gap.
  const cells = gridBoxes(box.sw, box.ne, 5, 7)
  const byQid = new Map<string, WikidataCandidate>()
  const failedCells: number[] = []
  for (const [i, cell] of cells.entries()) {
    console.log(
      `Cell ${i + 1}/${cells.length} [${cell.sw.map((n) => n.toFixed(3))} → ${cell.ne.map((n) => n.toFixed(3))}]...`,
    )
    let cands: WikidataCandidate[] | null = null
    for (let attempt = 1; attempt <= 2 && !cands; attempt++) {
      try {
        cands = await discoverWikidataBbox(cell.sw, cell.ne)
      } catch (e) {
        console.warn(`  attempt ${attempt} failed: ${(e as Error).message}`)
        if (attempt === 1) await sleep(8_000) // give WDQS a breath before the local retry
      }
    }
    if (!cands) {
      failedCells.push(i + 1)
      continue
    }
    for (const c of cands) {
      const prev = byQid.get(c.qid)
      // Prefer the richer record (a story over its scenic twin from a boundary overlap).
      if (!prev || (c.tier === 'story' && prev.tier !== 'story')) byQid.set(c.qid, c)
    }
    console.log(`  ${cands.length} candidates (running total ${byQid.size})`)
    await sleep(1_000) // gentle pacing between WDQS calls
  }
  if (failedCells.length > 0) {
    console.warn(
      `\n⚠ ${failedCells.length}/${cells.length} cells failed and were SKIPPED (cells ${failedCells.join(', ')}). ` +
        `The sweep is idempotent — re-run to fill the gaps.`,
    )
  }
  const merged = dedupeByName([...byQid.values()])

  const stories = merged.filter((c) => c.tier === 'story' && c.article)
  const scenics = merged.filter((c) => c.tier === 'scenic')
  const breaks = merged.filter((c) => c.tier === 'break')
  const drops = merged.filter((c) => c.tier === 'drop')

  console.log(
    `\nCorridor sweep: ${merged.length} places → ${stories.length} STORY, ${scenics.length} SCENIC, ` +
      `${breaks.length} break (skipped), ${drops.length} drop (skipped)\n`,
  )
  console.log('STORY (roam-narratable — extract chars):')
  for (const s of [...stories].sort((a, b) => (b.article!.extract.length || 0) - (a.article!.extract.length || 0))) {
    console.log(`  ${String(s.article!.extract.length).padStart(5)}  ${s.name}`)
  }
  console.log(`\nSCENIC pins persisted for the future wave layer: ${scenics.length}`)

  // Co-location triage — runs on the swept batch, BEFORE anything is written, so a mis-located place
  // is caught before it is paid to enrich and narrate. Warns, never rejects: most collisions are
  // genuine (see pipeline/colocation.ts for why this can't be decided for free).
  for (const line of colocationReport(findColocations(merged.map((c) => ({ qid: c.qid, name: c.name, lat: c.lat, lng: c.lng }))))) {
    console.warn(line)
  }

  if (!apply) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to upsert pois.')
    return
  }

  // Deepen to the FULL article HERE (the "real step 1", 2026-06-15): the corpus stores the full
  // extract, so tours + roam read it WITHOUT a per-run re-fetch — no deepen-time fact mutation or
  // factsHash churn, and eligibility measures real article richness (not a lead proxy). Free
  // (MediaWiki, paced); a miss falls back to the discovery lead. There is NO separate lead field —
  // `facts.extract` IS the full article; the lead is used only transiently for discovery tiering.
  console.log(`Deepening ${stories.length} story extracts to full articles...`)
  const deep = await fetchFullExtracts(stories.map((s) => s.article!.pageId))
  const fetchedAt = new Date()
  let wrote = 0
  let deepMiss = 0
  // Bounded fan-out, not a serial walk: upsertPoi is a single QID-keyed insert...onConflictDoUpdate,
  // idempotent and order-independent, so the only thing serial buys is one neon-http round trip per
  // poi — minutes of pure latency on a region-scale sweep (Tahoe ~459 story pins, Yosemite 837). 8
  // matches the DB-write pool classify-treatments already uses.
  await mapLimit(stories, POI_UPSERT_CONCURRENCY, async (s) => {
    const a = s.article!
    const full = deep.get(a.pageId)
    if (!full) deepMiss++
    // Normalize via toFacts(...).join(' ') so the stored extract (and its hash) MATCH what a tour or
    // roam run recomputes from toFacts(extract) — one shared fingerprint across every writer/reader.
    const extract = toFacts(full ?? a.extract).join(' ') // full article; lead fallback on a fetch miss
    // Store the FULL extract for EVERY story-tier candidate regardless of length — it is the ENRICHER's
    // raw input, and whether the article is rich enough to NARRATE is the paid enrich step's call (it
    // builds a curated fact sheet or defers; #1 downgrades an un-enriched poi to scenic). No char floor
    // here: a guessed cutoff would starve the enricher of borderline articles it might rescue
    // (correctness over cost, CLAUDE.md — the old 800-char demotion was removed 2026-06-16).
    // The facts bag is the raw article + provenance; the Wikidata qid is the canonical IDENTITY,
    // passed separately as the dedup key (region-corpus rebuilds the candidate from pois.qid).
    const facts = buildStoryFacts({ extract, title: a.title, url: a.url, pageId: a.pageId })
    // Speakable anchor (a corrected "where to look" vantage for a misleading centroid) is admin-set
    // on pois.speakable now — the sweep leaves it untouched (coalesce-preserved by upsertPoi).
    await upsertPoi({
      qid: s.qid,
      source: 'wikipedia',
      sourceId: String(a.pageId),
      name: a.title,
      kind: featureKind(s.types) ?? null,
      lat: s.lat,
      lng: s.lng,
      summary: summaryFromExtract(extract),
      facts,
      factsHash: hashFacts(facts),
      factsFetchedAt: fetchedAt,
    })
    wrote++
  })
  if (deepMiss > 0) console.warn(`  ⚠ ${deepMiss} story extract(s) fell back to the lead (deep fetch miss).`)
  await mapLimit(scenics, POI_UPSERT_CONCURRENCY, async (s) => {
    await upsertPoi({
      qid: s.qid,
      source: 'wikidata',
      sourceId: s.qid,
      name: s.name,
      kind: featureKind(s.types) ?? null,
      lat: s.lat,
      lng: s.lng,
      summary: null,
      facts: null,
      factsHash: null,
      factsFetchedAt: null,
    })
    wrote++
  })
  console.log(`\nUpserted ${wrote} pois (${stories.length} story + ${scenics.length} scenic).`)
}

await runJob('discover_pois', { dryRun: !apply, targetId: regionKey }, main)
