// buildWell — the corpus fact-well builder's LOOP MECHANICS + the verbatim-selection invariant,
// tested with an injected model call + injected fetchers (zero network, zero spend). What must
// hold: kept spans are VERBATIM from the input (the model only picks ids), span ids are
// deduped/clamped/sorted, included bundles arrive verbatim with provenance, and the bounded
// failure cases (cap, truncation, text-only, no-wikipedia-span) return null so the caller can
// leave the place un-enriched.

import { describe, expect, test } from 'bun:test'
import type Anthropic from '@anthropic-ai/sdk'
import { buildWell, type EnrichInput, type EnrichTools, type ScoutModelCall, type SourcedFacts } from '../src/pipeline/scout'

const INPUT: EnrichInput = {
  name: 'Camp Richardson',
  kind: 'resort',
  region: 'Lake Tahoe',
  spans: [
    'Camp Richardson is a historic resort on the south shore of Lake Tahoe.',
    'It was founded in the 1920s.',
    'The 2020 census recorded a population of 0.', // almanac trivia the model should drop
    'Major Ormsby was killed nearby in 1860.',
  ],
  wiki: { sourceId: '555', url: 'https://en.wikipedia.org/?curid=555', license: 'CC BY-SA 4.0' },
  targetSeconds: 150,
}

const GEO: SourcedFacts = {
  facts: ['The bedrock here is granodiorite.'],
  attribution: { source: 'macrostrat', sourceId: 'map:9', url: 'https://macrostrat.org', license: 'CC BY 4.0', retrievedAt: 't' },
}
const WD: SourcedFacts = {
  facts: ['Inception: 1924.'],
  attribution: { source: 'wikidata', sourceId: 'Q9', url: 'https://www.wikidata.org/wiki/Q9', license: 'CC0', retrievedAt: 't' },
}

const msg = (calls: { name: string; input: unknown }[]): Anthropic.Message =>
  ({
    content: calls.map((c, i) => ({ type: 'tool_use', id: `t${i}`, name: c.name, input: c.input })),
    usage: { input_tokens: 100, output_tokens: 20 },
  }) as unknown as Anthropic.Message

const textOnly = (): Anthropic.Message =>
  ({ content: [{ type: 'text', text: 'hmm' }], usage: { input_tokens: 5, output_tokens: 5 } }) as unknown as Anthropic.Message

const truncated = (): Anthropic.Message =>
  ({ content: [], stop_reason: 'max_tokens', usage: { input_tokens: 5, output_tokens: 5 } }) as unknown as Anthropic.Message

const script = (...turns: Anthropic.Message[]): ScoutModelCall => {
  let i = 0
  return async () => {
    if (i >= turns.length) throw new Error('buildWell asked for more turns than scripted')
    return turns[i++]!
  }
}

const tools = (over: Partial<EnrichTools> = {}): EnrichTools => ({
  geologyAt: async () => GEO,
  wikidataFacts: async () => WD,
  ...over,
})

describe('buildWell — verbatim span selection + bundle inclusion', () => {
  test('selects spans VERBATIM by id, in reading order; spans are byte-identical to the input', async () => {
    const call = script(msg([{ name: 'finalize_well', input: { keepSpanIds: [3, 0], includeGeology: false, includeWikidata: false, reason: 'beats only' } }]))
    const r = await buildWell(INPUT, tools(), { call })
    expect(r).not.toBeNull()
    expect(r!.well.map((s) => s.text)).toEqual([INPUT.spans[0]!, INPUT.spans[3]!]) // sorted to article order
    for (const s of r!.well) {
      expect(s.source).toBe('wikipedia')
      expect(s.sourceId).toBe('555')
      expect(s.license).toBe('CC BY-SA 4.0')
      expect(INPUT.spans).toContain(s.text) // verbatim — never rewritten
    }
  })

  test('dedupes + clamps out-of-range ids', async () => {
    const call = script(msg([{ name: 'finalize_well', input: { keepSpanIds: [0, 0, 99, -1, 1], includeGeology: false, includeWikidata: false, reason: 'x' } }]))
    const r = await buildWell(INPUT, tools(), { call })
    expect(r!.well.map((s) => s.text)).toEqual([INPUT.spans[0]!, INPUT.spans[1]!])
  })

  test('fetch geology + wikidata, then include both — bundles arrive verbatim with provenance', async () => {
    const call = script(
      msg([{ name: 'fetch_geology', input: {} }, { name: 'fetch_wikidata', input: {} }]),
      msg([{ name: 'finalize_well', input: { keepSpanIds: [0], includeGeology: true, includeWikidata: true, reason: 'thin — rounded out' } }]),
    )
    const r = await buildWell(INPUT, tools(), { call })
    expect(r!.well).toEqual([
      { text: INPUT.spans[0]!, source: 'wikipedia', sourceId: '555', license: 'CC BY-SA 4.0', url: 'https://en.wikipedia.org/?curid=555' },
      { text: 'The bedrock here is granodiorite.', source: 'macrostrat', sourceId: 'map:9', license: 'CC BY 4.0', url: 'https://macrostrat.org' },
      { text: 'Inception: 1924.', source: 'wikidata', sourceId: 'Q9', license: 'CC0', url: 'https://www.wikidata.org/wiki/Q9' },
    ])
  })

  test('a fetched bundle with NO license falls back to the source default (geology→CC BY 4.0, wikidata→CC0)', async () => {
    // A real Macrostrat tile / Wikidata entity can return a bundle whose attribution.license is absent
    // (license is optional). buildWell must bake the source default, not undefined, into the frozen
    // FactSheetEntry.license (it flows straight into the CC credit array). (scout.ts: `?? 'CC BY 4.0'` / `?? 'CC0'`.)
    const geoNoLicense: SourcedFacts = { facts: ['Granodiorite.'], attribution: { source: 'macrostrat', sourceId: 'map:9', retrievedAt: 't' } }
    const wdNoLicense: SourcedFacts = { facts: ['Inception: 1924.'], attribution: { source: 'wikidata', sourceId: 'Q9', retrievedAt: 't' } }
    const call = script(
      msg([{ name: 'fetch_geology', input: {} }, { name: 'fetch_wikidata', input: {} }]),
      msg([{ name: 'finalize_well', input: { keepSpanIds: [0], includeGeology: true, includeWikidata: true, reason: 'x' } }]),
    )
    const r = await buildWell(INPUT, tools({ geologyAt: async () => geoNoLicense, wikidataFacts: async () => wdNoLicense }), { call })
    expect(r!.well.find((s) => s.source === 'macrostrat')!.license).toBe('CC BY 4.0')
    expect(r!.well.find((s) => s.source === 'wikidata')!.license).toBe('CC0')
  })

  test('includeGeology with no fetched bundle never invents a span', async () => {
    // Model claims include but never fetched (or the fetch returned null) → nothing added.
    const call = script(msg([{ name: 'finalize_well', input: { keepSpanIds: [0], includeGeology: true, includeWikidata: true, reason: 'x' } }]))
    const r = await buildWell(INPUT, tools(), { call })
    expect(r!.well).toHaveLength(1)
    expect(r!.well[0]!.source).toBe('wikipedia')
  })

  test('only offers fetch tools that exist (no QID → no wikidata tool)', async () => {
    let offeredNames: string[] = []
    const call: ScoutModelCall = async ({ tools: offered }) => {
      offeredNames = offered.map((t) => t.name)
      return msg([{ name: 'finalize_well', input: { keepSpanIds: [0], includeGeology: false, includeWikidata: false, reason: 'x' } }])
    }
    await buildWell(INPUT, tools({ wikidataFacts: null }), { call })
    expect(offeredNames).toContain('fetch_geology')
    expect(offeredNames).not.toContain('fetch_wikidata')
    expect(offeredNames).toContain('finalize_well')
  })

  test('a finalize that keeps NO article span → null (never well-less; caller falls back)', async () => {
    const call = script(msg([{ name: 'finalize_well', input: { keepSpanIds: [], includeGeology: true, includeWikidata: false, reason: 'x' } }]))
    expect(await buildWell(INPUT, tools(), { call })).toBeNull()
  })

  test('max_tokens truncation → null', async () => {
    expect(await buildWell(INPUT, tools(), { call: script(truncated()) })).toBeNull()
  })

  test('text-only / refusal turn → null', async () => {
    expect(await buildWell(INPUT, tools(), { call: script(textOnly()) })).toBeNull()
  })

  test('turn cap without a finalize → null', async () => {
    const fetchForever = script(...Array.from({ length: 10 }, () => msg([{ name: 'fetch_geology', input: {} }])))
    expect(await buildWell(INPUT, tools(), { call: fetchForever })).toBeNull()
  })

  test('empty article → null', async () => {
    expect(await buildWell({ ...INPUT, spans: [] }, tools(), { call: script() })).toBeNull()
  })
})
