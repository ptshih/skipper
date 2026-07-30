// Persistence — the SHARED facts + grounding writes for the V2 studio pipeline.
//
// The DEFERRED hand-authored tour pipeline (the draft-shell load + the atomic narration/aside
// ready-gate; its segments/tracks/tour_frames tables were dropped in migration 0009) was removed in
// the V1→V2 migration; roam writes its 1:1 narration directly
// (generate-narrations.ts upserts `narrations`). What survives here is the SHARED facts layer every
// writer reads: the `pois` upsert (deduped on the Wikidata QID `pois.qid`; stamps facts_hash/
// facts_fetched_at). The grounding fingerprint helpers (storyFactsHash / hashFacts) that key the
// staleness contract MOVED to `@skipper/db/hash` — a fused CLUSTER telling's fingerprint is an
// aggregate the admin console has to compute too, and admin cannot import studio. They are re-exported
// here so the corpus tools (discover-pois / enrich-pois / refetch-poi / generate-narrations) keep one
// import path.

import { sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois } from '@skipper/db/schema'
import { withRetry } from './http'
import type { AttributionSnapshot, PoiFacts, FactSheetEntry } from '@skipper/db/schema'
import type { PoiSource } from '@skipper/shared'

export { hashFacts, storyFactsHash } from '@skipper/db/hash'

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
 *  LONGER here — it lives in the typed `pois.fact_sheet` column (+ `enriched_at`); the Wikidata `qid`
 *  is NO LONGER here either — it's the first-class `pois.qid` column (the canonical identity), passed
 *  separately to `upsertPoi`. So this bag is now just the raw article + provenance. Key ORDER no longer
 *  affects the hash (`@skipper/db/hash`'s `stableStringify` canonicalizes the jsonb read-back). */
export function buildStoryFacts(input: {
  extract: string
  title: string
  url: string
  pageId: number
}): PoiFacts {
  return {
    extract: input.extract,
    title: input.title,
    url: input.url,
    pageId: input.pageId,
  }
}

/** The corpus `summary` for a story poi — the first sentence of the extract (null if empty).
 *  The ONE place this is derived, so the sweep + refetch stay byte-identical. */
export function summaryFromExtract(extract: string): string | null {
  return extract.split(/(?<=[.!?])\s+/)[0] ?? null
}

export interface UpsertPoiInput {
  /** The Wikidata QID — the CANONICAL identity + dedup key (every poi has one). A scenic↔story tier
   *  flip lands on the SAME row via this key; source/sourceId are rewritten in place. */
  qid: string
  source: PoiSource
  sourceId: string
  name: string
  kind: string | null
  lat: number
  lng: number
  /** Curated "where to look" anchor — a place's speakable vantage (admin-set on pois.speakable),
   *  SHARED and surviving a facts re-fetch. Omitted for places that speak from their own pin (the
   *  sweep never sets it); coalesced on conflict so a curated anchor is never blanked by a re-sweep. */
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

/** Upsert a POI deduped on its Wikidata QID; stamps facts freshness; returns its id. */
export async function upsertPoi(input: UpsertPoiInput): Promise<string> {
  const { factsHash, factsFetchedAt: providedStamp, speakableLat, speakableLng, ...rest } = input
  // Only a stop with real facts (a story stop) carries the freshness clock; the stamp
  // itself is caller-owned (see UpsertPoiInput.factsFetchedAt).
  const factsFetchedAt = factsHash ? providedStamp : null
  // Retry-safe: an upsert (onConflictDoUpdate) is idempotent — a retried attempt lands on the
  // same row by `qid` and writes the same data (only updatedAt's now() differs).
  const rows = await withRetry(
    () =>
      db
        .insert(pois)
        .values({ ...rest, speakableLat, speakableLng, factsHash, factsFetchedAt })
        .onConflictDoUpdate({
          // Dedup on the canonical QID — so a scenic↔story TIER FLIP (same place, different
          // source/source_id across re-sweeps) lands on the SAME row instead of orphaning a twin.
          target: pois.qid,
          set: {
            // The per-source native handle FOLLOWS the latest discovery: a flip rewrites source +
            // source_id in place on the qid-keyed row (qid itself is the immutable key, never set).
            source: sql`excluded.source`,
            sourceId: sql`excluded.source_id`,
            // Location is always current — refresh it.
            name: sql`excluded.name`,
            kind: sql`excluded.kind`,
            lat: sql`excluded.lat`,
            lng: sql`excluded.lng`,
            // Speakable anchor is ADMIN-owned (not auto-refetched, never sweep-set): keep the
            // EXISTING value, filling from an incoming write only when the row has none — so an
            // admin edit is never clobbered by a later generate/sweep pass.
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
    { label: `upsertPoi(${input.qid} ${input.source}:${input.sourceId})` },
  )
  return rows[0]!.id
}
