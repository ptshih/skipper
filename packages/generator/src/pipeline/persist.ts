// Persistence — the SHARED facts + grounding writes for the V2 generator.
//
// The DEFERRED hand-authored tour pipeline (the draft-shell load + the atomic narration/interlude
// ready-gate; its segments/tracks/tour_frames tables were dropped in migration 0009) was removed in
// the V1→V2 migration; roam writes its 1:1 narration directly
// (generate-narrations.ts upserts `narrations`). What survives here is the SHARED facts layer every
// writer reads: the `pois` upsert (deduped on (source, source_id); stamps facts_hash/
// facts_fetched_at) + the grounding fingerprint helpers (storyFactsHash / hashFacts) that key the
// staleness contract, used by the corpus tools (discover-pois / enrich-pois / refetch-poi)
// and the roam generator.

import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois } from '@skipper/db/schema'
import { withRetry } from './http'
import type { AttributionSnapshot, PoiFacts, FactSheetEntry } from '@skipper/db/schema'
import type { PoiSource } from '@skipper/shared'

/**
 * Deterministic JSON serialization with object keys sorted recursively — so a hash taken over a
 * facts object is INVARIANT to key ORDER. This is load-bearing because `pois.facts` is `jsonb`:
 * Postgres does NOT preserve object key order, so the SAME logical facts serialize one way
 * in-memory (a writer's freshly-built object, stamped onto `pois.facts_hash`) and a DIFFERENT way
 * read back from the DB (what drives/roam stamp onto `narrations.facts_hash` — e.g. `{text,source,…}`
 * comes back as `{url,text,…}`). Plain `JSON.stringify` would make those two hashes diverge, so a
 * read-back-hashed clip would read as perpetually stale against the staleness contract
 * (`narrations.facts_hash IS DISTINCT FROM pois.facts_hash`). Sorting keys normalizes both sides to one
 * canonical form. ARRAY order is PRESERVED (significant — the well's spans are in reading order);
 * only object keys are reordered. Mirrors `JSON.stringify`'s treatment of `undefined` (object
 * entries dropped, array holes → null) so an omitted-vs-undefined key never shifts the hash.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const parts: string[] = []
  for (const k of Object.keys(obj).sort()) {
    const v = obj[k]
    if (v === undefined) continue // JSON.stringify omits undefined-valued object entries
    parts.push(`${JSON.stringify(k)}:${stableStringify(v)}`)
  }
  return `{${parts.join(',')}}`
}

/** Order-invariant hash of a poi's facts — the change-detector for narration staleness. Null when
 *  no facts. Canonicalizes via `stableStringify` so the hash survives the `pois.facts` jsonb
 *  round-trip: a writer's in-memory `pois.facts_hash` equals a reader's read-back `narrations.facts_hash`
 *  for the same content (the staleness contract compares those two STORED columns by inequality). */
export function hashFacts(facts: PoiFacts | null): string | null {
  if (!facts) return null
  return createHash('sha256').update(stableStringify(facts)).digest('hex')
}

/**
 * The GROUNDING fingerprint for a story poi — the hash a narration's `facts_hash` is compared against for
 * staleness. THE SWITCH (corpus-enrichment-spec §3/§8), now reading the typed `pois.fact_sheet` column:
 *   - ENRICHED (a non-empty fact sheet) → hash the SHEET ONLY. Narration grounds on it, so a
 *     re-`discover` that rewrites `extract` but keeps the SAME sheet must NOT stale narrations; the
 *     `enriched_at` stamp can't churn it either (it isn't in the hash). The true "did the narration
 *     input change" detector. Byte-identical to the pre-column well-hash, so existing rows stay valid.
 *   - UN-ENRICHED (no sheet) → hash the whole facts object (`hashFacts`), so existing rows + the
 *     extract-head fallback keep their current hash exactly. Both WRITERS (sweep/enrich) and READERS
 *     (drives/roam) call THIS, canonicalized (`stableStringify`), so a clip's stamped hash can never
 *     diverge from `pois.facts_hash` across the in-memory ↔ jsonb-read-back boundary.
 */
export function storyFactsHash(
  facts: PoiFacts | null,
  factSheet: FactSheetEntry[] | null | undefined,
): string | null {
  if (factSheet && factSheet.length > 0) {
    return createHash('sha256').update(stableStringify(factSheet)).digest('hex')
  }
  if (!facts) return null
  return hashFacts(facts)
}

/** The distinct sourced credits in a fact sheet → the frozen `narrations.attribution` array (one entry per
 *  (source, sourceId), CC BY-SA / CC0 / CC BY preserved). `retrievedAt` is the sheet's enrich stamp. */
export function factSheetToAttribution(sheet: FactSheetEntry[], retrievedAt: string): AttributionSnapshot[] {
  const seen = new Set<string>()
  const out: AttributionSnapshot[] = []
  for (const s of sheet) {
    const key = `${s.source}:${s.sourceId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      source: s.source,
      sourceId: s.sourceId,
      ...(s.url ? { url: s.url } : {}),
      license: s.license,
      retrievedAt,
    })
  }
  return out
}

/** The canonical `pois.facts` object for a STORY place — the ONE builder every facts writer uses (the
 *  region sweep + refetch-poi) so the stored shape is consistent. The curated narration sheet is NO
 *  LONGER here — it lives in the typed `pois.fact_sheet` column (+ `enriched_at`). Key ORDER no longer
 *  affects the hash (`stableStringify` canonicalizes the jsonb read-back), but key PRESENCE still does
 *  — so `qid` is OMITTED when absent (never stored as null). The Wikidata `qid` linkage (region-corpus
 *  rebuilds tour candidates from it) is preserved BY CONSTRUCTION. */
export function buildStoryFacts(input: {
  extract: string
  title: string
  url: string
  pageId: number
  qid?: string | null
}): PoiFacts {
  return {
    extract: input.extract,
    title: input.title,
    url: input.url,
    pageId: input.pageId,
    ...(input.qid ? { qid: input.qid } : {}),
  }
}

/** The corpus `summary` for a story poi — the first sentence of the extract (null if empty).
 *  The ONE place this is derived, so the sweep + refetch stay byte-identical. */
export function summaryFromExtract(extract: string): string | null {
  return extract.split(/(?<=[.!?])\s+/)[0] ?? null
}

export interface UpsertPoiInput {
  source: PoiSource
  sourceId: string
  name: string
  kind: string | null
  lat: number
  lng: number
  /** Curated "where to look" anchor — a place's speakable vantage (off speakableAnchorFor),
   *  SHARED and surviving a facts re-fetch. Omitted for places that speak from their own pin;
   *  coalesced on conflict so a curated anchor is never blanked by a later factless write. */
  speakableLat?: number | null
  speakableLng?: number | null
  summary: string | null
  facts: PoiFacts | null
  /** Change-detector hash of `facts` (hashFacts). Null for break/scenic (no facts). */
  factsHash: string | null
  /** The freshness stamp for these facts — CALLER-owned (review-caught, twice over):
   *  a cache-HIT persist must pass the row's ORIGINAL stamp (reuse never slides the TTL
   *  clock, or frequently-regenerated places would never re-fetch), and a fetched persist
   *  passes the run's overrides-snapshot instant, NOT persist-time now() (a correction
   *  adjudicated mid-run must read as NEWER than the fetch). Forced null when factsHash
   *  is null — a scenic/break write carries no facts clock. */
  factsFetchedAt: Date | null
  /** The curated fact sheet (corpus `enrich` output) — its own column. Null/omitted for an
   *  un-enriched write (sweep/refetch); a paid enrich writes it. Coalesce-preserved on conflict so a
   *  free re-discover never blanks a paid sheet. */
  factSheet?: FactSheetEntry[] | null
  /** When the fact sheet was built (the enrich stamp). Coalesce-preserved like `factSheet`. */
  enrichedAt?: Date | null
}

/** Upsert a POI deduped on (source, source_id); stamps facts freshness; returns its id. */
export async function upsertPoi(input: UpsertPoiInput): Promise<string> {
  const { factsHash, factsFetchedAt: providedStamp, speakableLat, speakableLng, ...rest } = input
  // Only a stop with real facts (a story stop) carries the freshness clock; the stamp
  // itself is caller-owned (see UpsertPoiInput.factsFetchedAt).
  const factsFetchedAt = factsHash ? providedStamp : null
  // Retry-safe: an upsert (onConflictDoUpdate) is idempotent — a retried attempt lands on the
  // same row by (source, source_id) and writes the same facts (only updatedAt's now() differs).
  const rows = await withRetry(
    () =>
      db
        .insert(pois)
        .values({ ...rest, speakableLat, speakableLng, factsHash, factsFetchedAt })
        .onConflictDoUpdate({
          target: [pois.source, pois.sourceId],
          set: {
            // Location is always current — refresh it.
            name: sql`excluded.name`,
            kind: sql`excluded.kind`,
            lat: sql`excluded.lat`,
            lng: sql`excluded.lng`,
            // Speakable anchor is SEED-or-admin-owned (not auto-refetched): keep the EXISTING
            // value, filling from an incoming write only when the row has none. So an admin edit
            // (or the sweep's seed) is never clobbered by a later generate/sweep pass.
            speakableLat: sql`coalesce(${pois.speakableLat}, excluded.speakable_lat)`,
            speakableLng: sql`coalesce(${pois.speakableLng}, excluded.speakable_lng)`,
            // FACTS are SHARED across tours: the SAME place can be a story stop on one tour and
            // a (factless) scenic/break stop on another. NEVER let a factless write blank a place
            // that already carries facts — COALESCE keeps the richest known facts/summary, while a
            // genuine re-fetch (non-null incoming) still overwrites. (Upholds the "pois is the
            // shared facts cache" invariant + keeps the facts_hash staleness contract honest.)
            summary: sql`coalesce(excluded.summary, ${pois.summary})`,
            // FACTS is a plain coalesce now — the curated sheet lives in its OWN column, so a free
            // re-sweep (factless or article-only) can't touch it. (The old graft-back CASE is GONE.)
            facts: sql`coalesce(excluded.facts, ${pois.facts})`,
            // PRESERVE a paid fact sheet + its stamp across a later factless/sweep write: the sweep
            // passes them null → coalesce keeps the existing. A real re-enrich writes them directly.
            factSheet: sql`coalesce(excluded.fact_sheet, ${pois.factSheet})`,
            enrichedAt: sql`coalesce(excluded.enriched_at, ${pois.enrichedAt})`,
            // When the row is ENRICHED the grounding hash is the SHEET hash — keep it so a re-sweep's
            // (un-enriched) recomputed hash never overwrites it and stales the grounded narrations.
            factsHash: sql`case
              when ${pois.factSheet} is not null then ${pois.factsHash}
              else coalesce(excluded.facts_hash, ${pois.factsHash})
            end`,
            factsFetchedAt: sql`coalesce(excluded.facts_fetched_at, ${pois.factsFetchedAt})`,
            updatedAt: new Date(),
          },
        })
        .returning({ id: pois.id }),
    { label: `upsertPoi(${input.source}:${input.sourceId})` },
  )
  return rows[0]!.id
}
