// buildCorpusFactSheet — the corpus fact-sheet builder's LOOP MECHANICS + the verbatim-selection invariant,
// tested with an injected model call + injected fetchers (zero network, zero spend). What must
// hold: kept spans are VERBATIM from the input (the model only picks ids), span ids are
// deduped/clamped/sorted, included bundles arrive verbatim with provenance, and the bounded
// failure cases (cap, truncation, text-only, no-wikipedia-span) return null so the caller can
// leave the place un-enriched.

import { describe, expect, test } from 'bun:test'
import type { Content } from '@google/genai'
import { buildCorpusFactSheet, type EnrichInput, type EnrichTools, type ScoutModelCall, type ScoutReply, type SourcedFacts } from '../src/pipeline/scout'

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

/** A Gemini reply: function calls as parts (the first carrying a thought signature, as the live API
 *  does), finish STOP even with calls present, usage in `usageMetadata`. */
const msg = (calls: { name: string; input: unknown }[]): ScoutReply =>
  ({
    candidates: [
      {
        content: {
          role: 'model',
          parts: calls.map((c, i) => ({
            functionCall: { id: `t${i}`, name: c.name, args: c.input },
            ...(i === 0 ? { thoughtSignature: `sig-${c.name}` } : {}),
          })),
        },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 15, thoughtsTokenCount: 5 },
  }) as ScoutReply

const textOnly = (): ScoutReply =>
  ({
    candidates: [{ content: { role: 'model', parts: [{ text: 'hmm' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
  }) as ScoutReply

const truncated = (): ScoutReply =>
  ({
    candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'MAX_TOKENS' }],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
  }) as ScoutReply

const script = (...turns: ScoutReply[]): ScoutModelCall => {
  let i = 0
  return async () => {
    if (i >= turns.length) throw new Error('buildCorpusFactSheet asked for more turns than scripted')
    return turns[i++]!
  }
}

const tools = (over: Partial<EnrichTools> = {}): EnrichTools => ({
  geologyAt: async () => GEO,
  wikidataFacts: async () => WD,
  ...over,
})

describe('buildCorpusFactSheet — verbatim span selection + bundle inclusion', () => {
  test('selects spans VERBATIM by id, in reading order; spans are byte-identical to the input', async () => {
    const call = script(msg([{ name: 'finalize_fact_sheet', input: { keepSpanIds: [3, 0], includeGeology: false, includeWikidata: false, reason: 'beats only' } }]))
    const r = await buildCorpusFactSheet(INPUT, tools(), { call })
    expect(r).not.toBeNull()
    expect(r!.sheet.map((s) => s.text)).toEqual([INPUT.spans[0]!, INPUT.spans[3]!]) // sorted to article order
    for (const s of r!.sheet) {
      expect(s.source).toBe('wikipedia')
      expect(s.sourceId).toBe('555')
      expect(s.license).toBe('CC BY-SA 4.0')
      expect(INPUT.spans).toContain(s.text) // verbatim — never rewritten
    }
  })

  test('dedupes + clamps out-of-range ids', async () => {
    const call = script(msg([{ name: 'finalize_fact_sheet', input: { keepSpanIds: [0, 0, 99, -1, 1], includeGeology: false, includeWikidata: false, reason: 'x' } }]))
    const r = await buildCorpusFactSheet(INPUT, tools(), { call })
    expect(r!.sheet.map((s) => s.text)).toEqual([INPUT.spans[0]!, INPUT.spans[1]!])
  })

  test('fetch geology + wikidata, then include both — bundles arrive verbatim with provenance', async () => {
    const call = script(
      msg([{ name: 'fetch_geology', input: {} }, { name: 'fetch_wikidata', input: {} }]),
      msg([{ name: 'finalize_fact_sheet', input: { keepSpanIds: [0], includeGeology: true, includeWikidata: true, reason: 'thin — rounded out' } }]),
    )
    const r = await buildCorpusFactSheet(INPUT, tools(), { call })
    expect(r!.sheet).toEqual([
      { text: INPUT.spans[0]!, source: 'wikipedia', sourceId: '555', license: 'CC BY-SA 4.0', url: 'https://en.wikipedia.org/?curid=555' },
      { text: 'The bedrock here is granodiorite.', source: 'macrostrat', sourceId: 'map:9', license: 'CC BY 4.0', url: 'https://macrostrat.org' },
      { text: 'Inception: 1924.', source: 'wikidata', sourceId: 'Q9', license: 'CC0', url: 'https://www.wikidata.org/wiki/Q9' },
    ])
  })

  test('a fetched bundle with NO license falls back to the source default (geology→CC BY 4.0, wikidata→CC0)', async () => {
    // A real Macrostrat tile / Wikidata entity can return a bundle whose attribution.license is absent
    // (license is optional). buildCorpusFactSheet must bake the source default, not undefined, into the frozen
    // FactSheetEntry.license (it flows straight into the CC credit array). (scout.ts: `?? 'CC BY 4.0'` / `?? 'CC0'`.)
    const geoNoLicense: SourcedFacts = { facts: ['Granodiorite.'], attribution: { source: 'macrostrat', sourceId: 'map:9', retrievedAt: 't' } }
    const wdNoLicense: SourcedFacts = { facts: ['Inception: 1924.'], attribution: { source: 'wikidata', sourceId: 'Q9', retrievedAt: 't' } }
    const call = script(
      msg([{ name: 'fetch_geology', input: {} }, { name: 'fetch_wikidata', input: {} }]),
      msg([{ name: 'finalize_fact_sheet', input: { keepSpanIds: [0], includeGeology: true, includeWikidata: true, reason: 'x' } }]),
    )
    const r = await buildCorpusFactSheet(INPUT, tools({ geologyAt: async () => geoNoLicense, wikidataFacts: async () => wdNoLicense }), { call })
    expect(r!.sheet.find((s) => s.source === 'macrostrat')!.license).toBe('CC BY 4.0')
    expect(r!.sheet.find((s) => s.source === 'wikidata')!.license).toBe('CC0')
  })

  test('includeGeology with no fetched bundle never invents a span', async () => {
    // Model claims include but never fetched (or the fetch returned null) → nothing added.
    const call = script(msg([{ name: 'finalize_fact_sheet', input: { keepSpanIds: [0], includeGeology: true, includeWikidata: true, reason: 'x' } }]))
    const r = await buildCorpusFactSheet(INPUT, tools(), { call })
    expect(r!.sheet).toHaveLength(1)
    expect(r!.sheet[0]!.source).toBe('wikipedia')
  })

  test('only offers fetch tools that exist (no QID → no wikidata tool)', async () => {
    let offeredNames: string[] = []
    const call: ScoutModelCall = async ({ tools: offered }) => {
      offeredNames = offered.map((t) => t.name)
      return msg([{ name: 'finalize_fact_sheet', input: { keepSpanIds: [0], includeGeology: false, includeWikidata: false, reason: 'x' } }])
    }
    await buildCorpusFactSheet(INPUT, tools({ wikidataFacts: null }), { call })
    expect(offeredNames).toContain('fetch_geology')
    expect(offeredNames).not.toContain('fetch_wikidata')
    expect(offeredNames).toContain('finalize_fact_sheet')
  })

  test('a finalize that keeps NO article span → null (never well-less; caller falls back)', async () => {
    const call = script(msg([{ name: 'finalize_fact_sheet', input: { keepSpanIds: [], includeGeology: true, includeWikidata: false, reason: 'x' } }]))
    expect(await buildCorpusFactSheet(INPUT, tools(), { call })).toBeNull()
  })

  // ⚠ Gemini 3 400s a follow-up turn whose earlier function call lost its thought signature (probed
  // 2026-09-23), and it requires one functionResponse per call with the call's own id and name. So the
  // loop must send the model's turn back UNTOUCHED — the one property a hand-rebuilt history breaks.
  test("echoes the model's turn VERBATIM (signature included) and answers every fetch by id + name", async () => {
    const sent: Content[][] = []
    const turns = [
      msg([{ name: 'fetch_geology', input: {} }, { name: 'fetch_wikidata', input: {} }]),
      msg([{ name: 'finalize_fact_sheet', input: { keepSpanIds: [0], includeGeology: true, includeWikidata: false, reason: 'x' } }]),
    ]
    let i = 0
    const call: ScoutModelCall = async ({ contents }) => {
      sent.push(structuredClone(contents))
      return turns[i++]!
    }
    await buildCorpusFactSheet(INPUT, tools(), { call })
    const second = sent[1]!
    expect(second).toHaveLength(3)
    expect(second[1]).toEqual(turns[0]!.candidates![0]!.content!) // byte-for-byte, signature and all
    expect(second[1]!.parts![0]!.thoughtSignature).toBe('sig-fetch_geology')
    expect(second[2]!.role).toBe('user')
    expect(second[2]!.parts!.map((p) => [p.functionResponse?.id, p.functionResponse?.name])).toEqual([
      ['t0', 'fetch_geology'],
      ['t1', 'fetch_wikidata'],
    ])
    expect(second[2]!.parts![0]!.functionResponse!.response).toEqual({ output: '- The bedrock here is granodiorite.' })
  })

  test('usage adds up across turns, thinking counted as output', async () => {
    const call = script(
      msg([{ name: 'fetch_geology', input: {} }]),
      msg([{ name: 'finalize_fact_sheet', input: { keepSpanIds: [0], includeGeology: false, includeWikidata: false, reason: 'x' } }]),
    )
    const r = await buildCorpusFactSheet(INPUT, tools(), { call })
    expect(r!.usage).toEqual({ inputTokens: 200, outputTokens: 40 })
  })

  test('MAX_TOKENS truncation → null', async () => {
    expect(await buildCorpusFactSheet(INPUT, tools(), { call: script(truncated()) })).toBeNull()
  })

  test('text-only / refusal turn → null', async () => {
    expect(await buildCorpusFactSheet(INPUT, tools(), { call: script(textOnly()) })).toBeNull()
  })

  test('turn cap without a finalize → null', async () => {
    const fetchForever = script(...Array.from({ length: 10 }, () => msg([{ name: 'fetch_geology', input: {} }])))
    expect(await buildCorpusFactSheet(INPUT, tools(), { call: fetchForever })).toBeNull()
  })

  test('empty article → null', async () => {
    expect(await buildCorpusFactSheet({ ...INPUT, spans: [] }, tools(), { call: script() })).toBeNull()
  })
})
