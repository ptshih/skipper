// refetch-poi — re-pull ONE poi's Wikipedia facts and recompute its facts_hash.
//
// Facts are SHARED + cached on `pois` (principle #1); the corpus is normally refreshed in
// BULK by the region sweep (sweep-region-pois.ts). This is the single-POI version: re-fetch the
// lead extract for ONE place by title (the SAME path discovery uses, so an unchanged article
// hashes identically), apply the curated fact-edit overrides, and rewrite facts / facts_hash /
// facts_fetched_at / summary. When the re-fetched facts MATERIALLY change (a new facts_hash),
// every track that grounded on the old facts goes detectably stale (tracks.facts_hash IS
// DISTINCT FROM pois.facts_hash) — the operator then regenerates the owning tour/roam.
//
// FREE — Wikipedia (MediaWiki) only, no LLM/TTS spend. Only WIKIPEDIA-sourced (story) POIs
// carry re-fetchable facts; a wikidata/scenic pin has none and is rejected.
//
// SOP (docs/guides/ops-scripts-sop.md): PREVIEWS by default; writes only on --apply.
// Blast radius: MUTATES DB (rewrites one pois row's facts).
//
//   dotenvx run -f .env.development -- bun packages/generator/src/refetch-poi.ts <poiId>
//   dotenvx run -f .env.development -- bun packages/generator/src/refetch-poi.ts <poiId> --apply

import { eq } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois } from '@skipper/db/schema'
import { fetchDeepExtracts } from './pipeline/wikipedia'
import { toFacts } from './pipeline/select'
import { buildStoryFacts, hashFacts } from './pipeline/persist'
import { announce, parseFlags } from './pipeline/ops'
import { beginJob, finishJob } from './pipeline/job-progress'

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  const poiId = flags.positionals[0]
  const apply = flags.has('apply')

  if (!poiId) {
    console.error('Usage: refetch-poi.ts <poiId> [--apply]')
    process.exit(1)
  }

  announce({ tool: 'refetch-poi', blast: ['MUTATES DB'], apply })
  await beginJob('refetch_facts', { dryRun: !apply, targetId: poiId })

  const [poi] = await db
    .select({
      id: pois.id,
      source: pois.source,
      sourceId: pois.sourceId,
      name: pois.name,
      facts: pois.facts,
      factsHash: pois.factsHash,
    })
    .from(pois)
    .where(eq(pois.id, poiId))
    .limit(1)

  if (!poi) throw new Error(`No poi with id ${poiId}`)
  if (poi.source !== 'wikipedia') {
    throw new Error(
      `Re-fetch applies only to wikipedia (story) POIs — "${poi.name}" is source=${poi.source} (no facts to refresh).`,
    )
  }

  // Re-fetch the FULL article by pageId — same depth + normalization the region sweep stores.
  // fetchDeepExtracts applies the curated fact-edit overrides on the way out, so this IS the
  // override-application path: edit an override, then re-run refetch_facts (or re-sweep) to apply it
  // (generation no longer re-fetches per run).
  const pageId = Number(poi.sourceId)
  console.log(`\n"${poi.name}"  (wikipedia/${poi.sourceId})`)
  console.log(`  Fetching full article (pageId ${pageId})...`)
  const deep = await fetchDeepExtracts([pageId])
  const full = deep.get(pageId)
  if (!full) {
    throw new Error(`Wikipedia returned no usable extract for pageId ${pageId} — leaving facts unchanged.`)
  }

  // Normalize to the sweep's stored shape (toFacts(...).join(' ')) so an unchanged article hashes
  // identically; preserve the existing title/url/qid metadata (the deep fetch returns text only).
  const f = (poi.facts ?? {}) as Record<string, unknown>
  const extract = toFacts(full).join(' ')
  const newFacts = buildStoryFacts({
    extract,
    title: (f.title as string) ?? poi.name,
    url: (f.url as string) ?? `https://en.wikipedia.org/?curid=${poi.sourceId}`,
    pageId,
    qid: f.qid as string | undefined,
  })
  const newHash = hashFacts(newFacts)

  const oldLen = typeof poi.facts?.extract === 'string' ? poi.facts.extract.length : 0
  const changed = newHash !== poi.factsHash
  console.log(`  Old hash: ${poi.factsHash?.slice(0, 12) ?? '∅'}  (${oldLen} extract chars)`)
  console.log(`  New hash: ${newHash?.slice(0, 12) ?? '∅'}  (${extract.length} extract chars)`)
  console.log(
    changed
      ? `  → CHANGED: any track grounded on the old facts is now STALE → regenerate the owning tour/roam.`
      : `  → unchanged: facts identical to what's stored (only facts_fetched_at would advance).`,
  )

  if (!apply) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to update the facts.')
    return
  }

  // First sentence of the extract is the corpus summary (matches the sweep).
  const summary = extract.split(/(?<=[.!?])\s+/)[0] ?? null
  await db
    .update(pois)
    .set({ facts: newFacts, factsHash: newHash, factsFetchedAt: new Date(), summary, updatedAt: new Date() })
    .where(eq(pois.id, poiId))

  console.log(`\nDone: re-fetched facts for "${poi.name}"${changed ? ' (facts CHANGED)' : ' (no change)'}.`)
}

main()
  .then(() => finishJob({ ok: true, costUsd: 0 }))
  .catch(async (e) => {
    await finishJob({ ok: false, error: e instanceof Error ? e.message : String(e), costUsd: 0 })
    console.error('\nRe-fetch failed:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
