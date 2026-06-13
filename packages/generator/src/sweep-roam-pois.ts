// sweep-roam-pois — basin-wide POI discovery for FREE-ROAM mode. MUTATES DB on --apply.
//
// Free-roam (docs/ideas/free-roam-mode.md) narrates the POI CORPUS, not a route — so this
// sweep discovers every Wikidata-pinned place in a raw bbox (the whole Tahoe basin by
// default), prose-joins Wikipedia, tiers them, and upserts the STORY + SCENIC tiers into
// `pois` (facts for story, bare typed pins for scenic — roam v0 narrates story-grade only;
// scenic pins seed the future wave layer). Dedup by (source, source_id) is the existing
// upsertPoi seam, so re-running is idempotent and a place a tour already visits is the
// SAME row (facts shared; principle #1).
//
// SOP (docs/guides/ops-scripts-sop.md): PREVIEWS by default; writes only on --apply.
// Discovery is free (WDQS + MediaWiki, no LLM/TTS spend).
//
// Usage:
//   dotenvx run -f .env.development -- bun packages/generator/src/sweep-roam-pois.ts
//   dotenvx run -f .env.development -- bun packages/generator/src/sweep-roam-pois.ts --apply
//   ... --bbox swLng,swLat,neLng,neLat   (override the basin default)

import {
  discoverWikidataBbox,
  dedupeByName,
  featureKind,
  type WikidataCandidate,
} from './pipeline/wikidata-discovery'
import { ensurePoiOverridesLoaded } from './pipeline/poi-overrides'
import { hashFacts, upsertPoi } from './pipeline/persist'
import { speakableAnchorFor } from './pipeline/speakable'
import { announce, parseFlags } from './pipeline/ops'
import { sleep } from './pipeline/http'
import type { LngLat } from './pipeline/geo'

/** Tahoe–Reno corridor: Meyers/South Lake Tahoe west to Homewood/Sugar Pine Point,
 *  north to Kings Beach/Incline, east through Spooner/Zephyr Cove → Carson City →
 *  Virginia City → Reno/Sparks. [lng, lat] corners. */
const TAHOE_RENO_CORRIDOR: { sw: LngLat; ne: LngLat } = {
  sw: [-120.25, 38.86],
  ne: [-119.55, 39.65],
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

function parseBbox(raw: string | undefined): { sw: LngLat; ne: LngLat } {
  if (!raw) return TAHOE_RENO_CORRIDOR
  const parts = raw.split(',').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`--bbox must be swLng,swLat,neLng,neLat (got "${raw}")`)
  }
  return { sw: [parts[0]!, parts[1]!], ne: [parts[2]!, parts[3]!] }
}

const flags = parseFlags(process.argv.slice(2), { valueFlags: ['bbox'] })
const apply = flags.has('apply')
const box = parseBbox(flags.value('bbox'))

announce({ tool: 'sweep-roam-pois', blast: ['MUTATES DB'], apply })

// Overrides ride every fetch (the fact-edit seam) — load them before any extract lands.
await ensurePoiOverridesLoaded()

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

if (!apply) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to upsert pois.')
  process.exit(0)
}

const fetchedAt = new Date()
let wrote = 0
for (const s of stories) {
  const a = s.article!
  // Store the FULL discovery payload (incl. the linked Wikidata qid) so a tour generate can
  // rebuild the spine candidate (WikiPoi) losslessly from the pool — see pipeline/region-corpus.ts.
  const facts = { extract: a.extract, title: a.title, url: a.url, pageId: a.pageId, qid: s.qid }
  // Seed the curated "where to look" anchor onto the corpus row (coalesce-kept by upsertPoi, so
  // an admin edit always wins on a re-sweep). select.ts reads it back off pois.speakable.
  const sp = speakableAnchorFor('wikipedia', String(a.pageId))
  await upsertPoi({
    source: 'wikipedia',
    sourceId: String(a.pageId),
    name: a.title,
    kind: featureKind(s.types) ?? null,
    lat: s.lat,
    lng: s.lng,
    ...(sp ? { speakableLat: sp.lat, speakableLng: sp.lng } : {}),
    summary: a.extract.split(/(?<=[.!?])\s+/)[0] ?? null,
    facts,
    factsHash: hashFacts(facts),
    factsFetchedAt: fetchedAt,
  })
  wrote++
}
for (const s of scenics) {
  const sp = speakableAnchorFor('wikidata', s.qid)
  await upsertPoi({
    source: 'wikidata',
    sourceId: s.qid,
    name: s.name,
    kind: featureKind(s.types) ?? null,
    lat: s.lat,
    lng: s.lng,
    ...(sp ? { speakableLat: sp.lat, speakableLng: sp.lng } : {}),
    summary: null,
    facts: null,
    factsHash: null,
    factsFetchedAt: null,
  })
  wrote++
}
console.log(`\nUpserted ${wrote} pois (${stories.length} story + ${scenics.length} scenic).`)
