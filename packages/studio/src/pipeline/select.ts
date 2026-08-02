// Story grounding — resolve the narration sheet + frozen attribution for a STORY place.
//
// The hand-authored tour pipeline (time-paced stop SELECTION) was removed in the V1→V2
// migration; what survives here is the SHARED grounding resolver every narration writer
// reads — generate-narrations and the corpus tools (enrich-pois, refetch-poi) — plus the
// drift detector. The rule (#1, 2026-06-16): a STORY telling REQUIRES a curated fact sheet;
// an un-enriched POI never grounds on the raw extract. The extract-head branch below is a
// DEFENSIVE fallback only.

import type { AttributionSnapshot, PoiFacts, FactSheetEntry } from '@skipper/db/schema'
import { factSheetToAttribution } from './persist'

/** Split an extract into clean fact sentences for the fact sheet. */
export function toFacts(extract: string): string[] {
  return extract
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** The positional HEAD of an extract — cap to `maxChars`, trimming back to the last full sentence
 *  so narration never grounds on a half sentence (mirrors fetchArticleExtract's truncation). The
 *  un-enriched fallback's narration bound; a no-op when the extract already fits. */
export function headOfExtract(extract: string, maxChars: number): string {
  if (extract.length <= maxChars) return extract
  const head = extract.slice(0, maxChars)
  const lastEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '))
  return (lastEnd > 0 ? head.slice(0, lastEnd + 1) : head).trim()
}

/** The narration sheet + attribution for a STORY poi: the verbatim `fact_sheet` when the place has
 *  been ENRICHED, else the positional `extract` head. #1 (2026-06-16): the generate queue + every narration
 *  writer GATE story tellings on a sheet (un-enriched → scenic / skipped), so the extract-head branch is a
 *  DEFENSIVE fallback that should not fire for a real story telling — it stays only so a stray caller
 *  can't crash. The SINGLE source for the clip AND for the audit that re-scores it, so the frozen credit
 *  can never drift from the facts it was built on. The fact sheet's credit uses its `enrichedAt`; the fallback's Wikipedia credit
 *  uses the caller's `retrievedAt` (the poi's facts_fetched_at). See corpus-enrichment-spec §6/§7. */
export interface StoryGrounding {
  facts: string[]
  attribution: AttributionSnapshot[]
  /** True iff grounded on a curated fact sheet (vs the extract-head fallback). */
  enriched: boolean
}

export function resolveStoryGrounding(
  facts: PoiFacts,
  factSheet: FactSheetEntry[] | null | undefined,
  enrichedAt: Date | string | null | undefined,
  opts: { fallbackChars: number; retrievedAt: string },
): StoryGrounding {
  if (factSheet && factSheet.length > 0) {
    const stamp =
      enrichedAt instanceof Date
        ? enrichedAt.toISOString()
        : typeof enrichedAt === 'string'
          ? enrichedAt
          : opts.retrievedAt
    return {
      facts: factSheet.map((s) => s.text),
      attribution: factSheetToAttribution(factSheet, stamp),
      enriched: true,
    }
  }
  const extract = facts.extract
  const title = facts.title
  const url = facts.url
  const sourceId = String(facts.pageId)
  return {
    facts: toFacts(headOfExtract(extract, opts.fallbackChars)),
    attribution: [
      {
        source: 'wikipedia',
        sourceId,
        ...(title ? { title } : {}),
        ...(url ? { url } : {}),
        license: 'CC BY-SA 4.0',
        retrievedAt: opts.retrievedAt,
      },
    ],
    enriched: false,
  }
}

/** The fact sheet's WIKIPEDIA spans whose verbatim text no longer substring-appears in the current
 *  `extract` — i.e. the article DRIFTED out from under the curated sheet (an upstream edit moved or
 *  removed a sentence the sheet quoted). A precise "this sheet may need a re-enrich" signal — far
 *  better than "the extract changed at all", since enriched clips ground on the sheet, not the
 *  article. Only wikipedia spans are checked (geology/wikidata facts don't come from the article).
 *  Empty when the sheet is still fully grounded in the article (or there's no sheet/extract). */
export function sheetDriftSpans(
  factSheet: FactSheetEntry[] | null | undefined,
  extract: string,
): FactSheetEntry[] {
  if (!factSheet || factSheet.length === 0 || !extract) return []
  return factSheet.filter((s) => s.source === 'wikipedia' && !extract.includes(s.text))
}
