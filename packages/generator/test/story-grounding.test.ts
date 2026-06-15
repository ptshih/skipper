// The corpus-enrichment facts layer: the well-aware hash switch, the facts builder's
// backward-compatible shape, the well→attribution dedup, and the well↔extract-head resolver.
// Pure logic, zero network/spend. See docs/specs/corpus-enrichment-spec.md §2/§3/§6.

import { describe, expect, test } from 'bun:test'
import {
  buildStoryFacts,
  hashFacts,
  storyFactsHash,
  wellToAttribution,
} from '../src/pipeline/persist'
import { resolveStoryGrounding } from '../src/pipeline/select'
import type { WellSpan } from '@skipper/db/schema'

const WELL: WellSpan[] = [
  { text: 'Lake Tahoe is a freshwater lake.', source: 'wikipedia', sourceId: '123', license: 'CC BY-SA 4.0', url: 'https://en.wikipedia.org/?curid=123' },
  { text: 'It sits at 6,225 feet.', source: 'wikidata', sourceId: 'Q123', license: 'CC0', url: 'https://www.wikidata.org/wiki/Q123' },
  { text: 'The bedrock is granodiorite.', source: 'macrostrat', sourceId: '99', license: 'CC BY 4.0' },
]

describe('buildStoryFacts — backward-compatible shape', () => {
  test('un-enriched object is byte-identical to the historical shape (hash unchanged)', () => {
    const facts = buildStoryFacts({ extract: 'A.', title: 'T', url: 'u', pageId: 1, qid: 'Q1' })
    expect(JSON.stringify(facts)).toBe(
      JSON.stringify({ extract: 'A.', title: 'T', url: 'u', pageId: 1, qid: 'Q1' }),
    )
  })

  test('qid omitted when absent', () => {
    const facts = buildStoryFacts({ extract: 'A.', title: 'T', url: 'u', pageId: 1 })
    expect(JSON.stringify(facts)).toBe(JSON.stringify({ extract: 'A.', title: 'T', url: 'u', pageId: 1 }))
  })

  test('an EMPTY well is treated as un-enriched (no well/enrichedAt keys)', () => {
    const facts = buildStoryFacts({ extract: 'A.', title: 'T', url: 'u', pageId: 1, well: [], enrichedAt: 'x' })
    expect('well' in facts).toBe(false)
    expect('enrichedAt' in facts).toBe(false)
  })

  test('enriched object carries well + enrichedAt right after extract', () => {
    const facts = buildStoryFacts({
      extract: 'A.', title: 'T', url: 'u', pageId: 1, qid: 'Q1', well: WELL, enrichedAt: '2026-06-15T00:00:00Z',
    })
    expect(Object.keys(facts)).toEqual(['extract', 'well', 'enrichedAt', 'title', 'url', 'pageId', 'qid'])
  })
})

describe('storyFactsHash — the grounding fingerprint switch', () => {
  test('un-enriched: equals hashFacts of the whole object (today’s basis)', () => {
    const facts = buildStoryFacts({ extract: 'A.', title: 'T', url: 'u', pageId: 1 })
    expect(storyFactsHash(facts)).toBe(hashFacts(facts))
  })

  test('enriched: hashes the WELL, not the whole object', () => {
    const facts = buildStoryFacts({ extract: 'A.', title: 'T', url: 'u', pageId: 1, well: WELL, enrichedAt: 't' })
    expect(storyFactsHash(facts)).not.toBe(hashFacts(facts))
    expect(storyFactsHash(facts)).toBe(storyFactsHash(facts)) // stable
  })

  test('enriched: a changed EXTRACT does NOT churn the hash (narration grounds on the well)', () => {
    const a = buildStoryFacts({ extract: 'A.', title: 'T', url: 'u', pageId: 1, well: WELL, enrichedAt: 't' })
    const b = buildStoryFacts({ extract: 'TOTALLY different article.', title: 'T', url: 'u', pageId: 1, well: WELL, enrichedAt: 't2' })
    expect(storyFactsHash(a)).toBe(storyFactsHash(b))
  })

  test('enriched: a changed WELL DOES churn the hash (tracks go stale)', () => {
    const a = buildStoryFacts({ extract: 'A.', title: 'T', url: 'u', pageId: 1, well: WELL, enrichedAt: 't' })
    const b = buildStoryFacts({ extract: 'A.', title: 'T', url: 'u', pageId: 1, well: WELL.slice(0, 1), enrichedAt: 't' })
    expect(storyFactsHash(a)).not.toBe(storyFactsHash(b))
  })

  test('null facts → null hash', () => {
    expect(storyFactsHash(null)).toBeNull()
  })
})

describe('wellToAttribution', () => {
  test('one distinct credit per (source, sourceId), license + url + retrievedAt preserved', () => {
    const attr = wellToAttribution(WELL, '2026-06-15T00:00:00Z')
    expect(attr).toEqual([
      { source: 'wikipedia', sourceId: '123', url: 'https://en.wikipedia.org/?curid=123', license: 'CC BY-SA 4.0', retrievedAt: '2026-06-15T00:00:00Z' },
      { source: 'wikidata', sourceId: 'Q123', url: 'https://www.wikidata.org/wiki/Q123', license: 'CC0', retrievedAt: '2026-06-15T00:00:00Z' },
      { source: 'macrostrat', sourceId: '99', license: 'CC BY 4.0', retrievedAt: '2026-06-15T00:00:00Z' },
    ])
  })

  test('dedups repeated wikipedia spans to a single credit', () => {
    const well: WellSpan[] = [
      { text: 'One.', source: 'wikipedia', sourceId: '123', license: 'CC BY-SA 4.0' },
      { text: 'Two.', source: 'wikipedia', sourceId: '123', license: 'CC BY-SA 4.0' },
    ]
    expect(wellToAttribution(well, 't')).toHaveLength(1)
  })
})

describe('resolveStoryGrounding', () => {
  test('ENRICHED: grounds on the well texts + well attribution', () => {
    const facts = buildStoryFacts({ extract: 'raw.', title: 'T', url: 'u', pageId: 1, well: WELL, enrichedAt: 'e' })
    const g = resolveStoryGrounding(facts, { fallbackChars: 4000, retrievedAt: 'r' })
    expect(g.enriched).toBe(true)
    expect(g.facts).toEqual(WELL.map((s) => s.text))
    expect(g.attribution[0]!.source).toBe('wikipedia')
    expect(g.attribution).toHaveLength(3)
    expect(g.attribution[0]!.retrievedAt).toBe('e') // uses enrichedAt, not the caller's retrievedAt
  })

  test('UN-ENRICHED: grounds on toFacts of the extract head + a single Wikipedia credit', () => {
    const facts = buildStoryFacts({ extract: 'First. Second. Third.', title: 'T', url: 'u', pageId: 7 })
    const g = resolveStoryGrounding(facts, { fallbackChars: 4000, retrievedAt: 'r' })
    expect(g.enriched).toBe(false)
    expect(g.facts).toEqual(['First.', 'Second.', 'Third.'])
    expect(g.attribution).toEqual([
      { source: 'wikipedia', sourceId: '7', title: 'T', url: 'u', license: 'CC BY-SA 4.0', retrievedAt: 'r' },
    ])
  })

  test('UN-ENRICHED: the fallback head caps to fallbackChars, trimmed to a full sentence', () => {
    const facts = buildStoryFacts({ extract: 'Short one. A much longer second sentence that overflows the cap.', title: 'T', url: 'u', pageId: 7 })
    const g = resolveStoryGrounding(facts, { fallbackChars: 12, retrievedAt: 'r' })
    expect(g.facts).toEqual(['Short one.'])
  })
})
