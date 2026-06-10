// Curated per-POI corrections — the fix layer for UPSTREAM source errors.
//
// The grounding gate verifies script ↔ sheet, so it is structurally BLIND to a sheet whose
// SOURCE is wrong: a Wikipedia article that names the wrong architect produces a perfectly
// "grounded" false clip (found live 2026-06-09: "Leonard" for Lennart Palme at Vikingsholm;
// the Pope Estate's builder/decade). Corrections live in the `poi_overrides` TABLE (the
// founder-decided source of truth — workflow state like upstream_status lives there too;
// bootstrap rows in packages/db/seed/poi-overrides.ts) and are applied here at the fetch
// seam every Wikipedia fact flows through, so the corrected text reaches the narration
// sheet, mergedFeatures, pois.facts, and facts_hash identically.
//
// Scope honesty (review-confirmed): fact edits apply ONLY to Wikipedia-fetched prose —
// geology (Macrostrat) and Wikidata enrichment lines enter the well through their own
// fetchers and do NOT pass this seam. A side anchor is a corrected COORDINATE for the
// place's speakable content (never a stored left/right — side flips with travel direction);
// select.ts resolves it heading-aware per drive.
//
// Failure-mode honesty: an unmatched find-string is "source healed" OR "source reworded,
// still wrong" — indistinguishable without a human look, so misses are WARNED (once per
// process per edit), never silent. The eval CLI's --veracity dimension is the CATCH side of
// this loop; adjudicated findings become table rows.
//
// Loading: once per process (ensurePoiOverridesLoaded), awaited inside the Wikipedia
// fetchers (so the facts path can never forget) and at the top of generateTour (so the
// sync select.ts lookup is populated before selection). Unloaded == no overrides — only
// unit tests and the sim take that path.

import { db } from '@skipper/db'
import { poiOverrides as poiOverridesTable } from '@skipper/db/schema'

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
  /** Where the place's SPEAKABLE content actually is (side-of-road computation only). */
  sideAnchor?: { lat: number; lng: number }
  /** Newest row's updated_at for this place — the facts read-through's staleness stamp
   *  (pois facts fetched BEFORE this instant predate the correction and must re-fetch).
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
  kind: 'fact_edit' | 'side_anchor'
  find?: string | null
  replace?: string | null
  sideAnchorLat?: number | null
  sideAnchorLng?: number | null
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
    if (r.active !== false) {
      if (r.kind === 'fact_edit' && r.find) {
        entry.factEdits.push({
          find: r.find,
          replace: r.replace ?? '',
          reason: r.reason,
          sourceUrl: r.sourceUrl ?? null,
        })
      } else if (r.kind === 'side_anchor' && r.sideAnchorLat != null && r.sideAnchorLng != null) {
        entry.sideAnchor = { lat: r.sideAnchorLat, lng: r.sideAnchorLng }
      }
    }
    // EVERY row stamps freshness — active OR retired (a side-anchor adjudication and a
    // retirement both invalidate cached facts; conservative, the cost of a false-stale is
    // one re-fetch).
    if (r.updatedAt && (!entry.latestOverrideAt || r.updatedAt > entry.latestOverrideAt)) {
      entry.latestOverrideAt = r.updatedAt
    }
    out.set(k, entry)
  }
  return out
}

/** Newest override row's updated_at for a place — undefined when the place has no rows
 *  (or the cache is unloaded). The facts read-through treats pois facts fetched BEFORE
 *  this instant as stale (they predate the correction). */
export function latestOverrideAtFor(source: string, sourceId: string): Date | undefined {
  return cache?.get(key(source, sourceId))?.latestOverrideAt
}

let cache: Map<string, PlaceOverride> | undefined
let loadPromise: Promise<void> | undefined

/**
 * Load the table once per process. Rejects loudly on a DB failure — generating with
 * corrections silently unapplied is exactly the failure this layer exists to prevent.
 */
export function ensurePoiOverridesLoaded(): Promise<void> {
  loadPromise ??= (async () => {
    const rows = await db.select().from(poiOverridesTable)
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

/** Convenience form for callers that don't report misses. */
export function applyFactEdits(source: string, sourceId: string, extract: string): string {
  return applyFactEditsChecked(source, sourceId, extract).text
}

/**
 * Is a CACHED extract suspect under the place's current fact edits? Used by the pois facts
 * read-through (persist.loadFreshPoiFacts) — a suspect place re-fetches every run, so the
 * live missed-edit warning recurs instead of going dark for the TTL (review-caught).
 * Suspect when, for any edit: (a) the FIND string is visible (the known falsehood is
 * literally present), or (b) a non-deletion edit shows NEITHER find nor replace (it matched
 * nothing at fetch time — "source reworded, falsehood may survive in new clothes").
 * A deletion edit (replace='') that shows no find is indistinguishable applied-vs-missed —
 * accepted as applied (the original run's live warn already fired once).
 */
export function cachedExtractSuspect(source: string, sourceId: string, extract: string): boolean {
  const edits = poiOverrideFor(source, sourceId)?.factEdits
  if (!edits || edits.length === 0) return false
  for (const e of edits) {
    if (extract.includes(e.find)) return true
    if (e.replace.length > 0 && !extract.includes(e.replace)) return true
  }
  return false
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
