// The corpus-enrichment facts layer: the fact-sheet-aware hash switch, the facts builder's shape, the
// sheet→attribution dedup, and the fact-sheet↔extract-head resolver. The curated sheet lives in its OWN
// `pois.fact_sheet` column now (NOT the `facts` bag). Pure logic, zero network/spend.
// See docs/specs/corpus-enrichment-spec.md §2/§3/§6.

import { describe, expect, test } from 'bun:test'
import { buildStoryFacts, hashFacts, storyFactsHash, factSheetToAttribution } from '../src/pipeline/persist'
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

  // (the qid-free shape is also locked in build-story-facts.test.ts; qid is the `pois.qid` column now)

  test('the bag never carries well/enrichedAt/qid (those are columns)', () => {
    const facts = buildStoryFacts({ extract: 'A.', title: 'T', url: 'u', pageId: 1 })
    expect('well' in facts).toBe(false)
    expect('enrichedAt' in facts).toBe(false)
    expect('qid' in facts).toBe(false)
    expect(Object.keys(facts)).toEqual(['extract', 'title', 'url', 'pageId'])
  })
})

describe('storyFactsHash — the grounding fingerprint switch (facts, factSheet)', () => {
  const facts = buildStoryFacts({ extract: 'A.', title: 'T', url: 'u', pageId: 1 })

  test('un-enriched (no sheet): equals hashFacts of the whole object', () => {
    expect(storyFactsHash(facts, null)).toBe(hashFacts(facts))
    expect(storyFactsHash(facts, [])).toBe(hashFacts(facts)) // an empty sheet = un-enriched
  })

  test('enriched: hashes the SHEET, not the whole object', () => {
    expect(storyFactsHash(facts, SHEET)).not.toBe(hashFacts(facts))
    expect(storyFactsHash(facts, SHEET)).toBe(storyFactsHash(facts, SHEET)) // stable
  })

  test('enriched: a changed EXTRACT does NOT churn the hash (narration grounds on the sheet)', () => {
    const other = buildStoryFacts({ extract: 'TOTALLY different article.', title: 'T', url: 'u', pageId: 1 })
    expect(storyFactsHash(facts, SHEET)).toBe(storyFactsHash(other, SHEET))
  })

  test('enriched: a changed SHEET DOES churn the hash (tracks go stale)', () => {
    expect(storyFactsHash(facts, SHEET)).not.toBe(storyFactsHash(facts, SHEET.slice(0, 1)))
  })

  test('null facts + null sheet → null hash', () => {
    expect(storyFactsHash(null, null)).toBeNull()
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

  test('storyFactsHash (enriched): each sheet span’s keys may reorder → same hash', () => {
    const facts = buildStoryFacts({ extract: 'A.', title: 'T', url: 'u', pageId: 1 })
    const inMem: FactSheetEntry = { text: 't', source: 'wikipedia', sourceId: '1', license: 'L', url: 'u' }
    const readBack = { url: 'u', text: 't', source: 'wikipedia', sourceId: '1', license: 'L' } as FactSheetEntry
    expect(storyFactsHash(facts, [readBack])).toBe(storyFactsHash(facts, [inMem]))
  })

  test('sheet SPAN order stays significant (reading order is not a key reorder)', () => {
    const facts = buildStoryFacts({ extract: 'A.', title: 'T', url: 'u', pageId: 1 })
    const s1: FactSheetEntry = { text: 'one', source: 'wikipedia', sourceId: '1', license: 'L' }
    const s2: FactSheetEntry = { text: 'two', source: 'wikipedia', sourceId: '1', license: 'L' }
    expect(storyFactsHash(facts, [s2, s1])).not.toBe(storyFactsHash(facts, [s1, s2]))
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
