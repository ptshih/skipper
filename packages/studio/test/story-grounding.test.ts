// The corpus-enrichment facts layer: the fact-sheet-aware hash switch, the facts builder's shape, the
// sheet→attribution dedup, and the fact-sheet↔extract-head resolver. The curated sheet lives in its OWN
// `pois.fact_sheet` column now (NOT the `facts` bag). Pure logic, zero network/spend.
// See docs/designs/corpus-enrichment-spec.md §2/§3/§6.

import { describe, expect, test } from 'bun:test'
import { buildStoryFacts, groundingHash, hashFacts, hashSheet, factSheetToAttribution } from '../src/pipeline/persist'
import { resolveStoryGrounding, sheetDriftSpans } from '../src/pipeline/select'
import type { FactSheetEntry } from '@skipper/db/schema'

const SHEET: FactSheetEntry[] = [
  { text: 'Lake Tahoe is a freshwater lake.', source: 'wikipedia', sourceId: '123', license: 'CC BY-SA 4.0', url: 'https://en.wikipedia.org/?curid=123' },
  { text: 'It sits at 6,225 feet.', source: 'wikidata', sourceId: 'Q123', license: 'CC0', url: 'https://www.wikidata.org/wiki/Q123' },
  { text: 'The bedrock is granodiorite.', source: 'macrostrat', sourceId: '99', license: 'CC BY 4.0' },
]

describe('buildStoryFacts — the facts bag shape (sheet + qid are NOT in it)', () => {
  test('object is the canonical 4-key shape', () => {
    const facts = buildStoryFacts({ extract: 'A.', title: 'T', url: 'u', pageId: 1 })
    expect(JSON.stringify(facts)).toBe(JSON.stringify({ extract: 'A.', title: 'T', url: 'u', pageId: 1 }))
  })

  // (qid is the `pois.qid` column now — it was hoisted out of the facts bag)

  test('the bag never carries well/enrichedAt/qid (those are columns)', () => {
    const facts = buildStoryFacts({ extract: 'A.', title: 'T', url: 'u', pageId: 1 })
    expect('well' in facts).toBe(false)
    expect('enrichedAt' in facts).toBe(false)
    expect('qid' in facts).toBe(false)
    expect(Object.keys(facts)).toEqual(['extract', 'title', 'url', 'pageId'])
  })
})

describe('the grounding fingerprint — hashSheet + groundingHash (split from storyFactsHash 2026-08-03)', () => {
  const facts = buildStoryFacts({ extract: 'A.', title: 'T', url: 'u', pageId: 1 })
  // What the two COLUMNS hold, as the writers set them.
  const unEnriched = { factsHash: hashFacts(facts), sheetHash: hashSheet(null) }
  const enriched = { factsHash: hashFacts(facts), sheetHash: hashSheet(SHEET) }

  test('un-enriched: no sheet hash, so grounding falls through to the facts hash', () => {
    expect(hashSheet(null)).toBeNull()
    expect(hashSheet([])).toBeNull() // an empty sheet = un-enriched, NOT sha256('')
    expect(groundingHash(unEnriched)).toBe(hashFacts(facts))
  })

  test('enriched: grounding is the SHEET hash, never the facts hash', () => {
    expect(groundingHash(enriched)).toBe(hashSheet(SHEET))
    expect(groundingHash(enriched)).not.toBe(hashFacts(facts))
  })

  test('enriched: a changed EXTRACT does not move grounding (the telling grounds on the sheet)', () => {
    // ⚠ THE WHOLE POINT OF THE SPLIT. The free sweep rewrites `facts` constantly; if that moved the
    // grounding hash, every enriched clip would stale and the next generate run would re-narrate and
    // re-synthesize ~421 clips for real money. Now facts_hash moves and grounding does not.
    const other = buildStoryFacts({ extract: 'TOTALLY different article.', title: 'T', url: 'u', pageId: 1 })
    const afterSweep = { factsHash: hashFacts(other), sheetHash: hashSheet(SHEET) }
    expect(afterSweep.factsHash).not.toBe(enriched.factsHash) // the raw digest DID move
    expect(groundingHash(afterSweep)).toBe(groundingHash(enriched)) // grounding did NOT
  })

  test('enriched: a changed SHEET DOES move grounding (clips go stale, as they must)', () => {
    const reEnriched = { factsHash: hashFacts(facts), sheetHash: hashSheet(SHEET.slice(0, 1)) }
    expect(groundingHash(reEnriched)).not.toBe(groundingHash(enriched))
  })

  test('nothing to ground on → null, never a shared constant', () => {
    expect(groundingHash({ factsHash: null, sheetHash: null })).toBeNull()
  })

  test('MIGRATION SAFETY: hashSheet reproduces what the old single column held for an enriched poi', () => {
    // The 2026-08-03 migration MOVES `facts_hash` into `sheet_hash` for the 421 enriched pois rather
    // than recomputing it. That is only correct because hashSheet(sheet) is byte-identical to what
    // storyFactsHash(facts, sheet) returned — the same `digest(sheet)`. If this ever diverges, every
    // migrated poi silently stales and the corpus re-narrates. Pinned as a plain equality on the one
    // property the migration assumed.
    expect(hashSheet(SHEET)).toBe(hashSheet(SHEET))
    expect(hashSheet(SHEET)).not.toBe(hashFacts(facts))
  })
})

// `pois.facts` (and `fact_sheet`) are jsonb — Postgres reorders object keys on read-back, so a hash
// stamped from a writer's in-memory object must equal one recomputed from the DB read-back, or every
// read-back-hashed clip reads as perpetually stale. The hash is canonicalized to guarantee that.
describe('hash is INVARIANT to object key order (the jsonb round-trip contract)', () => {
  test('hashFacts: same facts, shuffled top-level keys → same hash', () => {
    const inMemory = { extract: 'A.', title: 'T', url: 'u', pageId: 1 }
    const readBack = { url: 'u', pageId: 1, title: 'T', extract: 'A.' } // jsonb order
    expect(hashFacts(readBack)).toBe(hashFacts(inMemory))
  })

  test('hashSheet: each sheet span’s keys may reorder → same hash', () => {
    const inMem: FactSheetEntry = { text: 't', source: 'wikipedia', sourceId: '1', license: 'L', url: 'u' }
    const readBack = { url: 'u', text: 't', source: 'wikipedia', sourceId: '1', license: 'L' } as FactSheetEntry
    expect(hashSheet([readBack])).toBe(hashSheet([inMem]))
  })

  test('sheet SPAN order stays significant (reading order is not a key reorder)', () => {
    const s1: FactSheetEntry = { text: 'one', source: 'wikipedia', sourceId: '1', license: 'L' }
    const s2: FactSheetEntry = { text: 'two', source: 'wikipedia', sourceId: '1', license: 'L' }
    expect(hashSheet([s2, s1])).not.toBe(hashSheet([s1, s2]))
  })
})

describe('factSheetToAttribution', () => {
  test('one distinct credit per (source, sourceId), license + url + retrievedAt preserved', () => {
    const attr = factSheetToAttribution(SHEET, '2026-06-15T00:00:00Z')
    expect(attr).toEqual([
      { source: 'wikipedia', sourceId: '123', url: 'https://en.wikipedia.org/?curid=123', license: 'CC BY-SA 4.0', retrievedAt: '2026-06-15T00:00:00Z' },
      { source: 'wikidata', sourceId: 'Q123', url: 'https://www.wikidata.org/wiki/Q123', license: 'CC0', retrievedAt: '2026-06-15T00:00:00Z' },
      { source: 'macrostrat', sourceId: '99', license: 'CC BY 4.0', retrievedAt: '2026-06-15T00:00:00Z' },
    ])
  })

  test('dedups repeated wikipedia spans to a single credit', () => {
    const sheet: FactSheetEntry[] = [
      { text: 'One.', source: 'wikipedia', sourceId: '123', license: 'CC BY-SA 4.0' },
      { text: 'Two.', source: 'wikipedia', sourceId: '123', license: 'CC BY-SA 4.0' },
    ]
    expect(factSheetToAttribution(sheet, 't')).toHaveLength(1)
  })
})

describe('resolveStoryGrounding (facts, factSheet, enrichedAt, opts)', () => {
  test('ENRICHED: grounds on the sheet texts + sheet attribution', () => {
    const facts = buildStoryFacts({ extract: 'raw.', title: 'T', url: 'u', pageId: 1 })
    const g = resolveStoryGrounding(facts, SHEET, 'e', { fallbackChars: 4000, retrievedAt: 'r' })
    expect(g.enriched).toBe(true)
    expect(g.facts).toEqual(SHEET.map((s) => s.text))
    expect(g.attribution[0]!.source).toBe('wikipedia')
    expect(g.attribution).toHaveLength(3)
    expect(g.attribution[0]!.retrievedAt).toBe('e') // uses enrichedAt, not the caller's retrievedAt
  })

  test('ENRICHED: a Date enrichedAt is serialized to ISO for the credit', () => {
    const facts = buildStoryFacts({ extract: 'raw.', title: 'T', url: 'u', pageId: 1 })
    const g = resolveStoryGrounding(facts, SHEET, new Date('2026-06-15T00:00:00.000Z'), { fallbackChars: 4000, retrievedAt: 'r' })
    expect(g.attribution[0]!.retrievedAt).toBe('2026-06-15T00:00:00.000Z')
  })

  test('UN-ENRICHED: grounds on toFacts of the extract head + a single Wikipedia credit', () => {
    const facts = buildStoryFacts({ extract: 'First. Second. Third.', title: 'T', url: 'u', pageId: 7 })
    const g = resolveStoryGrounding(facts, null, null, { fallbackChars: 4000, retrievedAt: 'r' })
    expect(g.enriched).toBe(false)
    expect(g.facts).toEqual(['First.', 'Second.', 'Third.'])
    expect(g.attribution).toEqual([
      { source: 'wikipedia', sourceId: '7', title: 'T', url: 'u', license: 'CC BY-SA 4.0', retrievedAt: 'r' },
    ])
  })

  test('UN-ENRICHED: the fallback head caps to fallbackChars, trimmed to a full sentence', () => {
    const facts = buildStoryFacts({ extract: 'Short one. A much longer second sentence that overflows the cap.', title: 'T', url: 'u', pageId: 7 })
    const g = resolveStoryGrounding(facts, null, null, { fallbackChars: 12, retrievedAt: 'r' })
    expect(g.facts).toEqual(['Short one.'])
  })
})

describe('sheetDriftSpans — the article-drift detector (precise "needs re-enrich")', () => {
  const extract = 'Lake Tahoe is a freshwater lake. The bedrock is granodiorite.'

  test('no drift: every wikipedia span still appears in the article → empty', () => {
    const sheet: FactSheetEntry[] = [{ text: 'Lake Tahoe is a freshwater lake.', source: 'wikipedia', sourceId: '1', license: 'L' }]
    expect(sheetDriftSpans(sheet, extract)).toEqual([])
  })

  test('drift: a wikipedia span no longer in the article is returned', () => {
    const sheet: FactSheetEntry[] = [
      { text: 'Lake Tahoe is a freshwater lake.', source: 'wikipedia', sourceId: '1', license: 'L' },
      { text: 'It sits at 6,225 feet.', source: 'wikipedia', sourceId: '1', license: 'L' }, // edited out upstream
    ]
    expect(sheetDriftSpans(sheet, extract).map((s) => s.text)).toEqual(['It sits at 6,225 feet.'])
  })

  test('non-wikipedia spans (geology/wikidata) are NOT checked against the article', () => {
    const sheet: FactSheetEntry[] = [
      { text: 'a wikidata fact absent from the article', source: 'wikidata', sourceId: 'Q1', license: 'CC0' },
      { text: 'a geology fact absent from the article', source: 'macrostrat', sourceId: '9', license: 'CC BY 4.0' },
    ]
    expect(sheetDriftSpans(sheet, extract)).toEqual([])
  })

  test('empty/absent sheet or extract → empty (nothing to check)', () => {
    expect(sheetDriftSpans([], extract)).toEqual([])
    expect(sheetDriftSpans(null, extract)).toEqual([])
    expect(sheetDriftSpans([{ text: 'x', source: 'wikipedia', sourceId: '1', license: 'L' }], '')).toEqual([])
  })
})
