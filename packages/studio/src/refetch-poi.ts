// refetch-poi — re-pull ONE poi's Wikipedia facts and recompute its facts_hash.
//
// Facts are SHARED + cached on `pois` (principle #1); the corpus is normally refreshed in
// BULK by the region sweep (discover-pois.ts). This is the single-POI version: re-fetch the
// FULL article extract for ONE place by pageId (the SAME path discovery uses, so an unchanged article
// hashes identically), apply the curated fact-edit overrides, and rewrite facts / facts_hash /
// facts_fetched_at / summary. When the re-fetched facts MATERIALLY change (a new facts_hash),
// every narration that grounded on the old facts goes detectably stale (narrations.facts_hash IS
// DISTINCT FROM pois.facts_hash) — the operator then regenerates that poi's telling.
//
// PRESERVES a paid enrichment WELL (2026-06-16): like the sweep, a refetch keeps an existing
// `fact_sheet` + `enriched_at` (the grounding hash is the SHEET hash, so refreshing the extract
// alone never marks narrations stale or destroys paid work). A deliberate well rebuild — e.g. to push
// a fact-edit CORRECTION into a well span — is `enrich-pois --include-ids <id> --force --apply`,
// not a refetch; the refetch WARNS when it refreshes an enriched poi's extract so that's not missed.
//
// FREE — Wikipedia (MediaWiki) only, no LLM/TTS spend. Only WIKIPEDIA-sourced (story) POIs
// carry re-fetchable facts; a wikidata/scenic pin has none and is rejected.
//
// SOP (docs/guides/ops-scripts-sop.md): PREVIEWS by default; writes only on --apply.
// Blast radius: MUTATES DB (rewrites one pois row's facts).
//
//   dotenvx run -f .env.development -- bun packages/studio/src/refetch-poi.ts <poiId>
//   dotenvx run -f .env.development -- bun packages/studio/src/refetch-poi.ts <poiId> --apply

import { eq } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois } from '@skipper/db/schema'
import { fetchFullExtracts, wikiUrlForPageId } from './pipeline/wikipedia'
import { sheetDriftSpans, toFacts } from './pipeline/select'
import { buildStoryFacts, groundingHash, hashFacts, summaryFromExtract } from './pipeline/persist'
import { announce, parseFlags } from './pipeline/ops'
import { beginJob, runJob } from './pipeline/job-progress'

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  const poiId = flags.positionals[0]
  const apply = flags.has('apply')

  if (!poiId) {
    console.error('Usage: refetch-poi.ts <poiId> [--apply]')
    process.exit(1)
  }

  announce({ tool: 'refetch-poi', blast: ['MUTATES DB'], apply })
  // ⚠ See sweep-orphans: false ⇒ the run was canceled before this container started. Don't mutate.
  if (!(await beginJob('refetch_facts', { dryRun: !apply, targetId: poiId }))) return

  const [poi] = await db
    .select({
      id: pois.id,
      source: pois.source,
      sourceId: pois.sourceId,
      name: pois.name,
      facts: pois.facts,
      factsHash: pois.factsHash,
      sheetHash: pois.sheetHash,
      factSheet: pois.factSheet,
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
  // fetchFullExtracts applies the curated fact-edit overrides on the way out, so this IS the
  // override-application path: edit an override, then re-run refetch_facts (or re-sweep) to apply it
  // (generation no longer re-fetches per run).
  const pageId = Number(poi.sourceId)
  console.log(`\n"${poi.name}"  (wikipedia/${poi.sourceId})`)
  console.log(`  Fetching full article (pageId ${pageId})...`)
  const deep = await fetchFullExtracts([pageId])
  const full = deep.get(pageId)
  if (!full) {
    throw new Error(`Wikipedia returned no usable extract for pageId ${pageId} — leaving facts unchanged.`)
  }

  // Normalize to the sweep's stored shape (toFacts(...).join(' ')) so an unchanged article hashes
  // identically; preserve the existing title/url metadata (the deep fetch returns text only). The
  // Wikidata qid lives in the `pois.qid` column (identity, immutable) — refetch never touches it.
  const f = poi.facts
  const extract = toFacts(full).join(' ')
  // PRESERVE a paid fact sheet across a refetch (2026-06-16, Option A) — a single-poi re-fetch refreshes
  // the extract but LEAVES the `fact_sheet`/`enriched_at` columns untouched (the .update below never
  // sets them), so it never destroys the PAID sheet. The grounding fingerprint is the SHEET hash
  // (`sheet_hash`) when enriched, so refreshing the extract alone does NOT mark narrations stale. A
  // deliberate sheet rebuild is `enrich-pois --include-ids <id> --force --apply`, not a refetch.
  const existingSheet = Array.isArray(poi.factSheet) ? poi.factSheet : null
  const enriched = existingSheet !== null && existingSheet.length > 0
  const newFacts = buildStoryFacts({
    extract,
    title: f?.title ?? poi.name,
    url: f?.url ?? wikiUrlForPageId(poi.sourceId),
    pageId,
  })
  // Only the FACTS digest moves here — a refetch never touches the sheet (see above), so `sheet_hash`
  // is carried untouched into both grounding hashes below. That is what keeps an enriched poi's
  // narrations fresh across an extract refresh, and it is now a property of WHICH COLUMN this writes
  // rather than of remembering to pass the existing sheet to a two-argument hasher.
  const newFactsHash = hashFacts(newFacts)
  const oldGrounding = groundingHash({ factsHash: poi.factsHash, sheetHash: poi.sheetHash })
  const newGrounding = groundingHash({ factsHash: newFactsHash, sheetHash: poi.sheetHash })

  const oldExtract = poi.facts?.extract ?? ''
  const extractChanged = extract !== oldExtract
  // Compare the GROUNDING hashes, not the facts ones: that is what a narration stores and what
  // staleness is judged on. For an enriched poi they are the sheet hash on both sides, so an extract
  // refresh correctly reports "no change" even though `facts_hash` moved.
  const hashChanged = newGrounding !== oldGrounding
  console.log(`  Old grounding: ${oldGrounding?.slice(0, 12) ?? '∅'}  (${oldExtract.length} extract chars)`)
  console.log(`  New grounding: ${newGrounding?.slice(0, 12) ?? '∅'}  (${extract.length} extract chars)`)
  if (enriched) {
    // Enriched: the grounding hash is the SHEET hash, which the preserved sheet keeps stable — so the
    // extract can refresh without churning the hash. But that means an upstream CORRECTION won't reach
    // narration until the sheet is rebuilt — so check precisely whether the refreshed article DRIFTED
    // out from under the sheet (a quoted span vanished) and say exactly whether a re-enrich is needed.
    const drifted = sheetDriftSpans(existingSheet, extract)
    console.log(
      extractChanged
        ? `  → extract refreshed; fact sheet preserved → grounding hash unchanged, narrations stay fresh.` +
            (drifted.length > 0
              ? `\n    ⚠ ${drifted.length}/${existingSheet!.length} sheet span(s) NO LONGER appear in the refreshed` +
                ` article — the sheet has DRIFTED. Re-enrich to rebuild it:\n` +
                `      \`enrich-pois --include-ids ${poi.id} --force --apply\``
              : `\n    ✓ all ${existingSheet!.length} sheet spans still appear in the article — no re-enrich needed.`)
        : `  → unchanged: article + sheet identical to what's stored (only facts_fetched_at advances).`,
    )
  } else {
    console.log(
      hashChanged
        ? `  → CHANGED: any narration grounded on the old facts is now STALE → regenerate it (every drive reusing it picks the new telling up).`
        : `  → unchanged: facts identical to what's stored (only facts_fetched_at would advance).`,
    )
  }

  if (!apply) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to update the facts.')
    return
  }

  // First sentence of the extract is the corpus summary (matches the sweep).
  const summary = summaryFromExtract(extract)
  await db
    .update(pois)
    .set({ facts: newFacts, factsHash: newFactsHash, factsFetchedAt: new Date(), summary, updatedAt: new Date() })
    .where(eq(pois.id, poiId))

  console.log(
    `\nDone: re-fetched facts for "${poi.name}"` +
      (enriched
        ? ` (well preserved${extractChanged ? '; extract refreshed — re-enrich to rebuild the well if a corrected fact lives in it' : ''})`
        : hashChanged
          ? ' (facts CHANGED — narrations now stale)'
          : ' (no change)') +
      '.',
  )
  return { ok: true as const, costUsd: 0 } // FREE op — no LLM/TTS spend, so pin the cost at $0.
}

await runJob('refetch_facts', null, main)
