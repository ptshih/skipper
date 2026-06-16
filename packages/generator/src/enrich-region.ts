// enrich-region — the corpus ENRICH step. SPENDS $ (Anthropic only — no TTS/R2) + MUTATES DB on --apply.
//
// The distinct PAID op between discovery and generation: `discover` (free sweep → pois.facts.extract)
// → **`enrich` (paid, ONCE per place)** → `generate` (paid, per tour/roam). It scouts each eligible
// STORY poi into a curated, grounded "fact well" on `pois.facts.well` — verbatim article spans the
// enricher SELECTED (never rewrote) + any geology/Wikidata bundles it chose to include (pipeline/
// scout.ts buildWell). Tours + roam both READ that well (resolveStoryGrounding), so enrich cost
// amortizes once-per-place across every telling, and roam gets enrichment for the first time. See
// docs/specs/corpus-enrichment-spec.md.
//
// VERBATIM-only (spec §2): the well carries facts verbatim from sourced fetchers with provenance —
// the make-or-break invariant ("persona lives in DELIVERY, never FACTS"). A poi the enricher can't
// build a well for is LEFT un-enriched (logged) — the read path falls back to the positional extract
// head, and a re-run retries it; never a degraded baked well.
//
// SOP (docs/guides/ops-scripts-sop.md): PREVIEWS (with a cost estimate) by default; the dry run makes
// NO model calls (free). --apply spends.
//
// Usage:
//   dotenvx run -f .env.development -- bun packages/generator/src/enrich-region.ts
//   ... --apply                  run it (spends Anthropic; writes pois.facts.well + facts_hash)
//   ... --limit 5                cap how many places to enrich (a smoke run)
//   ... --force                  re-enrich places that already have a well
//   ... --model opus             A/B the calibration tier vs the default (sonnet)
//   ... --bbox swLng,swLat,neLng,neLat   narrow to a bbox (default: the WHOLE corpus, no geo filter)
//   ... --source wikipedia       narrow to a POI source (faithfully resolves a table 'source' filter)
//   ... --query "emerald"        substring match on name/source-id (a table search filter)
//   ... --include-ids a,b,c      enrich EXACTLY these poi ids (a hand-picked selection)
//   ... --exclude-ids a,b        drop these ids from a filter-resolved set ("select all matching" minus a few)
//   ... --max-cost 20            abort before any spend if the estimate exceeds this

import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois } from '@skipper/db/schema'
import type { PoiFacts } from '@skipper/db/schema'
import { announce, parseFlags } from './pipeline/ops'
import { beginJob, finishJob } from './pipeline/job-progress'
import { ensurePoiOverridesLoaded } from './pipeline/poi-overrides'
import { buildWell } from './pipeline/scout'
import { geologyFacts } from './pipeline/macrostrat'
import { wikidataFacts } from './pipeline/wikidata'
import { toFacts } from './pipeline/select'
import { buildStoryFacts, storyFactsHash } from './pipeline/persist'
import { withRetry } from './pipeline/http'
import { mapLimit } from './pipeline/concurrency'
import { ENRICH_MODELS, type EnrichModelChoice } from './models'
import { GEOLOGY_ENRICHMENT, SCOUT_CONCURRENCY, WIKIDATA_ENRICHMENT } from './config'
import { llmSpendLines, llmSpentUsd } from './pipeline/spend'
import { classifyStoryEligibility } from '@skipper/shared'

/** Soft narration length the well is sized for — the LONG-FORM target (roam's band), since the well
 *  is shared and a tour can always read fewer spans. Passed to the builder as guidance, not a cap. */
const ENRICH_TARGET_SECONDS = 150
/** Rough USD per place, by model (for the pre-run estimate only; the real tally prints after). */
const EST_USD_PER_POI: Record<EnrichModelChoice, number> = { sonnet: 0.04, opus: 0.09 }

function regionLabel(lat: number, lng: number): string {
  if (lat > 39.35 && lng > -119.9) return 'Reno, Nevada'
  if (lat > 39.0 && lng > -119.85) return 'Carson City, Nevada'
  return 'Lake Tahoe'
}

const flags = parseFlags(process.argv.slice(2), {
  valueFlags: ['bbox', 'limit', 'model', 'max-cost', 'source', 'query', 'include-ids', 'exclude-ids'],
})
const apply = flags.has('apply')
const force = flags.has('force')
const limit = Number(flags.value('limit') ?? Infinity)
const maxCostUsd = (() => {
  const v = Number(flags.value('max-cost'))
  return Number.isFinite(v) && v > 0 ? v : Infinity
})()
const modelChoice: EnrichModelChoice = flags.value('model') === 'opus' ? 'opus' : 'sonnet'
const model = ENRICH_MODELS[modelChoice]
/** Optional geographic narrowing. No --bbox = the WHOLE corpus — enrich is a per-POI op, not
 *  region-bound; a region's bbox is just ONE way to choose the set. */
const bbox = (() => {
  const raw = flags.value('bbox')
  if (!raw) return null
  const p = raw.split(',').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n)))
    throw new Error(`--bbox must be swLng,swLat,neLng,neLat (got "${raw}")`)
  return { swLng: p[0]!, swLat: p[1]!, neLng: p[2]!, neLat: p[3]! }
})()

// Selection — the corpus subset to enrich, resolved server-side (this CLI IS the job runner). The set is
// (filter-matched ∪ include-ids) \ exclude-ids, then the eligibility gate. Admin sends EITHER an explicit
// id list (hand-picked rows) OR a filter (bbox/source/query) + exclude-ids ("select all matching, minus a
// few") — the Gmail two-tier model, so server-side pagination never has to enumerate every id client-side.
const parseIds = (v: string | undefined): string[] => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])
const sourceFilter = flags.value('source') || null
const query = (flags.value('query') ?? '').trim().toLowerCase()
const includeIds = parseIds(flags.value('include-ids'))
const excludeIds = new Set(parseIds(flags.value('exclude-ids')))
// EXPLICIT mode = a hand-picked id list with NO filter; otherwise FILTER mode resolves bbox/source/query.
const isExplicit = includeIds.length > 0 && !bbox && !sourceFilter && !query

announce({ tool: 'enrich-region', blast: ['SPENDS $', 'MUTATES DB'], apply })

interface Candidate {
  poiId: string
  name: string
  kind: string | null
  lat: number
  lng: number
  extract: string
  facts: PoiFacts
  title: string
  url: string
  pageId: number
  qid: string | null
  hasWell: boolean
}

async function main(): Promise<void> {
  await ensurePoiOverridesLoaded()

  const rows = await withRetry(
    () =>
      db
        .select({
          id: pois.id,
          source: pois.source,
          sourceId: pois.sourceId,
          name: pois.name,
          kind: pois.kind,
          lat: pois.lat,
          lng: pois.lng,
          facts: pois.facts,
        })
        .from(pois)
        .where(
          isExplicit
            ? inArray(pois.id, includeIds)
            : bbox
              ? and(
                  // sql`` not eq() — pois.source is a PgEnum, so a dynamic (user-supplied) string needs a
                  // parameterized compare; a non-enum value simply matches nothing (honest 0, no throw).
                  sql`${pois.source} = ${sourceFilter ?? 'wikipedia'}`,
                  sql`${pois.lat} between ${bbox.swLat} and ${bbox.neLat}`,
                  sql`${pois.lng} between ${bbox.swLng} and ${bbox.neLng}`,
                )
              : sql`${pois.source} = ${sourceFilter ?? 'wikipedia'}`,
        ),
    { label: 'load enrich corpus' },
  )

  const candidates: Candidate[] = []
  let skippedIneligible = 0
  for (const r of rows) {
    if (excludeIds.has(r.id)) continue // "select all matching, minus a few" — the deselected rows
    // `query` is part of the SELECTION predicate (a table search filter) — apply it BEFORE the
    // eligibility gate so the "not story-grade" count below reflects only SELECTED rows, not the corpus.
    if (query && !`${r.name} ${r.sourceId}`.toLowerCase().includes(query)) continue
    const facts = (r.facts ?? {}) as PoiFacts
    const extract = typeof facts.extract === 'string' ? facts.extract : ''
    // Story eligibility is the SAME gate every consumer uses (single-sourced in @skipper/shared):
    // wikipedia source + not taste-denied + extract ≥ the story floor. Measured on the FULL extract.
    // Enrich can only build a well for an eligible story poi, so a SELECTED non-eligible row is
    // skipped + COUNTED (honest reporting in the run log), never silently dropped.
    if (classifyStoryEligibility({ source: r.source, name: r.name, leadExtractChars: extract.length }) !== 'eligible') {
      skippedIneligible++
      continue
    }
    const well = facts.well
    const hasWell = Array.isArray(well) && well.length > 0
    candidates.push({
      poiId: r.id,
      name: r.name,
      kind: r.kind,
      lat: r.lat,
      lng: r.lng,
      extract,
      facts,
      title: typeof facts.title === 'string' ? facts.title : r.name,
      url: typeof facts.url === 'string' ? facts.url : `https://en.wikipedia.org/?curid=${r.sourceId}`,
      pageId: typeof facts.pageId === 'number' ? facts.pageId : Number(r.sourceId),
      qid: typeof facts.qid === 'string' ? facts.qid : null,
      hasWell,
    })
  }

  const skipped = candidates.filter((c) => c.hasWell && !force)
  const queue = candidates.filter((c) => !c.hasWell || force).slice(0, limit)

  const selectionLabel = isExplicit
    ? `${includeIds.length} hand-picked`
    : [
        bbox ? 'in bbox' : 'corpus-wide',
        sourceFilter ? `source=${sourceFilter}` : '',
        query ? `query="${query}"` : '',
        excludeIds.size ? `−${excludeIds.size} excluded` : '',
      ]
        .filter(Boolean)
        .join(', ')
  console.log(
    `Corpus: ${candidates.length} eligible story pois (${selectionLabel}) — ` +
      `${skipped.length} already enriched (skipped), ${queue.length} to enrich.` +
      (skippedIneligible ? ` [${skippedIneligible} selected not story-grade — skipped]` : '') +
      '\n',
  )
  for (const c of queue) console.log(`  ${String(c.extract.length).padStart(6)}  ${c.name}`)

  if (queue.length === 0) {
    console.log('\nNothing to enrich.')
    return
  }

  const estUsd = queue.length * EST_USD_PER_POI[modelChoice]
  console.log(
    `\nModel: ${model} (${modelChoice}). Estimated spend: ~$${estUsd.toFixed(2)} ` +
      `(${queue.length} places × ~$${EST_USD_PER_POI[modelChoice].toFixed(2)}, ± half — restraint makes rich places finalize cheap).`,
  )

  if (!apply) {
    console.log('\nDRY RUN — no model calls, nothing written. Re-run with --apply to enrich.')
    return
  }

  if (estUsd > maxCostUsd) {
    console.error(
      `⛔ Estimated spend ~$${estUsd.toFixed(2)} exceeds --max-cost=$${maxCostUsd.toFixed(2)} — aborting before any spend. Narrow with --limit or raise --max-cost.`,
    )
    return
  }

  console.log(`\nEnriching ${queue.length} places (concurrency ${SCOUT_CONCURRENCY()})...`)
  const enrichedAt = new Date().toISOString()
  let done = 0
  let wrote = 0
  let deferred = 0

  await mapLimit(queue, SCOUT_CONCURRENCY(), async (c) => {
    // The model SELECTS from the verbatim article sentences (by index) — never free-form text.
    const spans = toFacts(c.extract)
    let result
    try {
      result = await buildWell(
        {
          name: c.name,
          kind: c.kind,
          region: regionLabel(c.lat, c.lng),
          spans,
          wiki: { sourceId: String(c.pageId), url: c.url, license: 'CC BY-SA 4.0' },
          targetSeconds: ENRICH_TARGET_SECONDS,
        },
        {
          // Geology at the place CENTROID (the rock that makes the place); the road-snapped
          // "rock under the tires" stays at tour gen (spec §6). Wikidata only when a QID exists.
          geologyAt: GEOLOGY_ENRICHMENT() ? () => geologyFacts(c.lat, c.lng) : null,
          wikidataFacts: WIKIDATA_ENRICHMENT() && c.qid ? () => wikidataFacts(c.qid!) : null,
        },
        { model },
      )
    } catch (e) {
      console.warn(`  ⚠ ${c.name}: enrich failed (${(e as Error).message}) — left un-enriched (retry on re-run).`)
      done++
      deferred++
      return
    }

    if (!result) {
      console.log(`  [${++done}/${queue.length}] ${c.name}: deferred (no well built) — falls back to the extract head.`)
      deferred++
      return
    }

    // ADD the well to the existing facts (extract preserved as the enricher's input/audit source);
    // re-stamp facts_hash off the WELL (storyFactsHash) so the staleness contract keys on the
    // grounding fingerprint. Do NOT touch facts_fetched_at — that is the EXTRACT fetch clock
    // (discover/sweep owns it); the well carries its own `enrichedAt`.
    const newFacts = buildStoryFacts({
      extract: c.extract,
      title: c.title,
      url: c.url,
      pageId: c.pageId,
      qid: c.qid,
      well: result.well,
      enrichedAt,
    })
    await withRetry(
      () =>
        db
          .update(pois)
          .set({ facts: newFacts, factsHash: storyFactsHash(newFacts), updatedAt: new Date() })
          .where(eq(pois.id, c.poiId)),
      { label: `enrich(${c.name})` },
    )
    wrote++
    const wiki = result.well.filter((s) => s.source === 'wikipedia').length
    const enrich = result.well.length - wiki
    console.log(
      `  [${++done}/${queue.length}] ${c.name}: well = ${wiki} spans${enrich ? ` + ${enrich} enrichment` : ''} — ${result.reason}`,
    )
  })

  console.log(`\nDone: ${wrote} enriched, ${deferred} deferred (no well) of ${queue.length}.`)
  for (const line of llmSpendLines()) console.log(line)
  console.log(`LLM spend this run: ~$${llmSpentUsd().toFixed(2)}`)
}

await beginJob('enrich_region', { dryRun: !apply, targetId: 'region-corpus' })
try {
  await main()
  await finishJob({ ok: true })
} catch (e) {
  await finishJob({ ok: false, error: e instanceof Error ? e.message : String(e) })
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}
