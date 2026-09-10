// Curated per-POI corrections — the fix layer for UPSTREAM source errors.
//
// The grounding gate verifies script ↔ sheet, so it is structurally BLIND to a sheet whose
// SOURCE is wrong: a Wikipedia article that names the wrong architect produces a perfectly
// "grounded" false clip (found live 2026-06-09: "Leonard" for Lennart Palme at Vikingsholm;
// the Pope Estate's builder/decade). Corrections live in the `poi_overrides` TABLE (the
// founder-decided source of truth — workflow state like upstream_status lives there too;
// rows are curated through the admin console) and are applied here at the fetch
// seams Wikipedia and Wikidata facts flow through, so the corrected text reaches the narration
// sheet, mergedFeatures, pois.facts, and facts_hash identically.
//
// Scope: Wikipedia prose and rendered Wikidata lines support literal corrections.
// Geology (Macrostrat) does not pass either correction seam. (The place's speakable COORDINATE — a corrected
// vantage for side-of-road content — lives on pois.speakable_lat/lng, admin-set via the
// /admin/pois/:id/corrections surface; select.ts resolves the side heading-aware.)
//
// Failure-mode honesty: an unmatched find-string is "source healed" OR "source reworded,
// still wrong" — indistinguishable without a human look, so misses are WARNED (once per
// process per edit), never silent. The eval CLI's --veracity dimension is the CATCH side of
// this loop; adjudicated findings become table rows.
//
// Loading: once per process (ensurePoiOverridesLoaded), awaited inside the Wikipedia and Wikidata
// fetchers (so the facts path can never forget) and at the top of each corpus CLI
// (discover-pois / enrich-pois / generate-narrations). Unloaded == no overrides — only
// unit tests and the sim take that path.

import { db } from '@skipper/db'
import { poiOverrides as poiOverridesTable } from '@skipper/db/schema'
import { withRetry } from './http'

/** One literal text correction (a `fact_edit` row). */
export interface FactEdit {
  find: string
  replace: string
  reason: string
  sourceUrl: string | null
}

/** All curated corrections for one place, aggregated from its rows. */
export interface PlaceOverride {
  source: string
  sourceId: string
  name: string
  factEdits: FactEdit[]
  /** Newest row's updated_at for this place — the facts read-through's staleness stamp
   *  (pois facts fetched BEFORE this instant predate the correction and must re-fetch);
   *  read by `overrideStaleFor`, which is where that contract is actually asserted.
   *  ⚠ The stamp is max-over-EXISTING-rows, so it cannot see a DELETE — always retire by
   *  UPDATE, never by deleting the row. Two retire cases: (a) the correction is no longer
   *  NEEDED but the source text is still there → set replace = find (a no-op that still
   *  matches, bumps updated_at, busts the cache); (b) the source REMOVED the text so `find`
   *  matches nothing (it would warn forever) → set active = false (skipped at load, still
   *  stamps freshness). */
  latestOverrideAt?: Date
}

/** The row shape this module consumes — structural, so seed rows and drizzle rows both fit. */
export interface OverrideRowLike {
  source: string
  sourceId: string
  name: string
  find?: string | null
  replace?: string | null
  reason: string
  sourceUrl?: string | null
  updatedAt?: Date | null
  /** A retired (healed) override: skipped for APPLY/warn/suspect, but still stamps freshness
   *  (its retirement bumps updated_at → busts caches holding the withdrawn correction).
   *  Undefined = active (back-compat for test rows). */
  active?: boolean | null
}

const key = (source: string, sourceId: string): string => `${source}:${sourceId}`

/** Pure rows → per-place aggregation (exported for tests; no I/O). */
export function aggregateOverrideRows(rows: OverrideRowLike[]): Map<string, PlaceOverride> {
  const out = new Map<string, PlaceOverride>()
  for (const r of rows) {
    const k = key(r.source, r.sourceId)
    const entry = out.get(k) ?? {
      source: r.source,
      sourceId: r.sourceId,
      name: r.name,
      factEdits: [],
    }
    // A retired (active === false) row contributes NOTHING to apply/warn/suspect — but it
    // STILL stamps freshness below, so the retirement itself busts caches that adopted the
    // now-withdrawn correction. (undefined/true both apply — back-compat for test rows.)
    // poi_overrides is fact-corrections ONLY now — a row with a find-string is an edit.
    if (r.active !== false && r.find) {
      entry.factEdits.push({
        find: r.find,
        replace: r.replace ?? '',
        reason: r.reason,
        sourceUrl: r.sourceUrl ?? null,
      })
    }
    // EVERY row stamps freshness — active OR retired (a correction adjudication and a
    // retirement both invalidate cached facts; conservative, the cost of a false-stale is
    // one re-fetch).
    if (r.updatedAt && (!entry.latestOverrideAt || r.updatedAt > entry.latestOverrideAt)) {
      entry.latestOverrideAt = r.updatedAt
    }
    out.set(k, entry)
  }
  return out
}

let cache: Map<string, PlaceOverride> | undefined
let loadPromise: Promise<void> | undefined

/**
 * Load the table once per process. Rejects loudly on a DB failure — generating with
 * corrections silently unapplied is exactly the failure this layer exists to prevent.
 */
export function ensurePoiOverridesLoaded(): Promise<void> {
  loadPromise ??= (async () => {
    // This is the FIRST DB read of a run — most exposed to a Neon cold-start blip, and a
    // failure here kills the run before any work ($0 but maddening). neon-http is stateless
    // (each query is its own HTTP request) and this read is pure, so retry it. The retry sits
    // INSIDE the memoized promise: wrapping the CALL wouldn't help — a rejected loadPromise is
    // cached, so re-awaiting it just re-throws the same error.
    const rows = await withRetry(() => db.select().from(poiOverridesTable), {
      label: 'poi-overrides load',
    })
    cache = aggregateOverrideRows(rows)
    if (rows.length > 0) {
      const retired = rows.filter((r) => r.active === false).length
      console.log(
        `poi-overrides: ${rows.length - retired} correction row(s) loaded` +
          (retired > 0 ? ` (+${retired} retired)` : '') +
          '.',
      )
    }
  })()
  return loadPromise
}

/** Test seam: inject rows without a DB (also resets the missed-edit warn dedup). */
export function setPoiOverridesForTest(rows: OverrideRowLike[]): void {
  cache = aggregateOverrideRows(rows)
  loadPromise = Promise.resolve()
  warned.clear()
}

/** Test seam: back to the unloaded state. */
export function clearPoiOverridesForTest(): void {
  cache = undefined
  loadPromise = undefined
  warned.clear()
}

/** The curated override for a place, if any. Unloaded cache == no overrides. */
export function poiOverrideFor(source: string, sourceId: string): PlaceOverride | undefined {
  return cache?.get(key(source, sourceId))
}

/**
 * Do a place's CACHED facts predate its newest curated correction? Pure; no I/O.
 *
 * Corrections enter the corpus ONLY at the Wikipedia fetch seam (see the header) — never at
 * generation, which reads `pois.facts` as-is. So a correction adjudicated AFTER a poi's last
 * fetch is simply not in the stored text, and generating that place bakes the uncorrected
 * sentence into a paid clip. `latestOverrideAt` was written for exactly this check and nothing
 * read it until 2026-08-02 (founder: wire it, don't delete it).
 *
 * The clock is the FETCH stamp, not `enriched_at`: an enrichment SELECTS from the stored
 * extract, so a sheet built yesterday from a fetch that predates the correction still quotes the
 * error — a recent enrich stamp proves nothing about the text underneath.
 *
 * Semantics at the edges (each is a deliberate direction, not a fallthrough):
 *   • no rows for the place — including an UNLOADED cache — → not stale. "Unloaded == no
 *     overrides" is this module's existing rule; a caller that forgot to load gets silence
 *     rather than a false alarm on every place in the corpus.
 *   • rows exist but none carries an updated_at → not stale: two instants can't be ordered when
 *     one is missing. (The column is NOT NULL, so this is the seed/test row shape only.)
 *   • `factsFetchedAt` null → STALE. Facts of unknown age cannot be shown to postdate the
 *     correction, and this layer already prefers a false-stale (one FREE re-fetch) over a
 *     silently uncorrected clip.
 *   • RETIRED rows count, because they stamp (see aggregateOverrideRows) — withdrawing a
 *     correction invalidates cached facts as surely as making one.
 *   • strictly BEFORE, so an exactly-equal stamp is NOT stale — the docstring contract is
 *     "fetched BEFORE this instant", and a to-the-millisecond tie is a clock artifact far more
 *     often than a real fetch/adjudication race.
 *
 * ⚠ This answers "the stored text PREDATES the correction", NOT "the correction is missing from
 * the text". A fetch made after the correction can still have MISSED (source reworded) — that is
 * `reportMissedEdits`, a different signal on a different half of the loop.
 */
export function overrideStaleFor(
  source: string,
  sourceId: string,
  factsFetchedAt: Date | null,
): boolean {
  const correctedAt = poiOverrideFor(source, sourceId)?.latestOverrideAt
  if (!correctedAt) return false
  if (!factsFetchedAt) return true
  return factsFetchedAt < correctedAt
}

/** Source-aware diagnostic: Wikipedia is cached at fetch; Wikidata enters at enrichment.
 * A Wikipedia-origin POI can contain both sources, including older sheet QIDs. Retired
 * edits still stamp freshness through overrideStaleFor. This remains advisory, not a lock.
 */
export function stalePoiOverrideSources(poi: {
  source: string
  sourceId: string
  qid: string | null
  factSheet: readonly { source: string; sourceId: string }[] | null
  factsFetchedAt: Date | null
  enrichedAt: Date | null
}): { source: string; sourceId: string; cachedAt: Date | null; correctedAt: Date }[] {
  const identities = new Map<string, { source: string; sourceId: string; cachedAt: Date | null }>()
  if (poi.source === 'wikipedia') {
    identities.set(key(poi.source, poi.sourceId), { source: poi.source, sourceId: poi.sourceId, cachedAt: poi.factsFetchedAt })
  }
  const qids = new Set([
    ...(poi.qid ? [poi.qid] : []),
    ...(poi.source === 'wikidata' ? [poi.sourceId] : []),
    ...(poi.factSheet ?? []).filter((entry) => entry.source === 'wikidata').map((entry) => entry.sourceId),
  ])
  for (const sourceId of qids) {
    identities.set(key('wikidata', sourceId), { source: 'wikidata', sourceId, cachedAt: poi.enrichedAt })
  }
  return [...identities.values()].flatMap((identity) => {
    const correctedAt = poiOverrideFor(identity.source, identity.sourceId)?.latestOverrideAt
    return correctedAt && overrideStaleFor(identity.source, identity.sourceId, identity.cachedAt)
      ? [{ ...identity, correctedAt }]
      : []
  })
}

export interface FactEditOutcome {
  text: string
  /** Edits whose find-string matched nothing in THIS text (healed? reworded? truncated?). */
  missed: FactEdit[]
}

/**
 * Apply a place's fact edits to a fetched extract (every occurrence; literal — the
 * function-replacement form sidesteps JS `$`-substitution in replacement text). Pure +
 * total: unknown place or unmatched find returns the text unchanged, reported in `missed`.
 */
export function applyFactEditsChecked(
  source: string,
  sourceId: string,
  extract: string,
): FactEditOutcome {
  const edits = poiOverrideFor(source, sourceId)?.factEdits
  if (!edits || edits.length === 0 || extract.length === 0) return { text: extract, missed: [] }
  let out = extract
  const missed: FactEdit[] = []
  // Sequential: a later find CAN match text an earlier replacement introduced — keep
  // entries independent (they are corrections of distinct source sentences, not a rewrite
  // chain).
  for (const e of edits) {
    if (out.includes(e.find)) out = out.replaceAll(e.find, () => e.replace)
    else missed.push(e)
  }
  return { text: out, missed }
}

const warned = new Set<string>()

/**
 * Surface unmatched edits — once per process per (place, edit, context). A miss can be
 * benign (the lead extract simply doesn't reach the target sentence; the source healed) or
 * the layer's primary failure mode (the article was REWORDED and the falsehood survives in
 * new clothes) — a human look decides, so the signal must never be silent.
 */
export function reportMissedEdits(
  source: string,
  sourceId: string,
  missed: FactEdit[],
  context: string,
): void {
  for (const e of missed) {
    const k = `${key(source, sourceId)}|${e.find}|${context}`
    if (warned.has(k)) continue
    warned.add(k)
    const name = poiOverrideFor(source, sourceId)?.name ?? sourceId
    console.warn(
      `poi-overrides: fact edit for "${name}" matched NOTHING in the ${context} fetch ` +
        `(find: "${e.find.slice(0, 60)}…"). Source healed, REWORDED (falsehood may survive), ` +
        `or text truncated — verify and update/retire the row.`,
    )
  }
}

/** How many override-stale places a generator's pre-flight names before it says "…and N more".
 *
 *  Long enough that the usual handful is fully actionable, short enough that a corpus-wide miss can't
 *  bury the spend estimate it sits above — the point of the warning is that the operator still READS
 *  it. Shared by both generators: this is a pre-PAID-RUN advisory, and one tuned in the solo CLI but
 *  not the fused one is how an operator learns to trust a warning that is lying in the other. */
export const OVERRIDE_STALE_LIST_CAP = 10
