// The enrichment scout's LOOP MECHANICS, tested with an injected model call + injected
// fetchers (zero network, zero spend) — mirrors how eval-grounding.test.ts fakes the
// decomposer. What must hold: the scout can only INCLUDE bundles a tool actually returned
// (the safety invariant), the turn cap yields null, dispatch feeds results back, and the
// finalize parsing maps to the result shape generate.ts consumes.

import { describe, expect, test } from 'bun:test'
import type Anthropic from '@anthropic-ai/sdk'
import { scoutStop, scoutToolsForStop, type ScoutModelCall, type ScoutStop, type SourcedFacts, type ScoutTools } from '../src/pipeline/scout'

const STOP: ScoutStop = {
  name: 'Emerald Bay State Park',
  kind: 'park',
  region: 'Lake Tahoe',
  corridor: 'Emerald Bay Run',
  facts: ['Emerald Bay State Park is a state park on Lake Tahoe.'],
  targetSeconds: 120,
}

const GEO: SourcedFacts = {
  facts: ['Bedrock here is granite, Cretaceous.'],
  attribution: {
    source: 'macrostrat',
    sourceId: 'map:123',
    title: 'Macrostrat geologic map',
    url: 'https://macrostrat.org',
    license: 'CC BY 4.0',
    retrievedAt: '2026-06-09T00:00:00.000Z',
  },
}
const WD: SourcedFacts = {
  facts: ['Inception: 1953.'],
  attribution: { ...GEO.attribution, source: 'wikidata', license: 'CC0' },
}

/** Build a fake Message whose content is the given tool_use calls. */
const msg = (calls: { name: string; input: unknown }[]): Anthropic.Message =>
  ({
    content: calls.map((c, i) => ({ type: 'tool_use', id: `t${i}`, name: c.name, input: c.input })),
    usage: { input_tokens: 100, output_tokens: 20 },
  }) as unknown as Anthropic.Message

/** A model that plays the given turns in order. */
const script = (...turns: Anthropic.Message[]): ScoutModelCall => {
  let i = 0
  return async () => {
    if (i >= turns.length) throw new Error('scout asked for more turns than scripted')
    return turns[i++]!
  }
}

const tools = (over: Partial<ScoutTools> = {}): ScoutTools => ({
  geologyAt: async () => GEO,
  wikidataFacts: async () => WD,
  ...over,
})

describe('scoutStop — loop mechanics + the gather-never-assert invariant', () => {
  test('fetch → finalize: included bundles come back verbatim with the cue mapped', async () => {
    const r = await scoutStop(
      STOP,
      tools(),
      script(
        msg([{ name: 'fetch_geology', input: { point: 'landmark' } }, { name: 'fetch_wikidata', input: {} }]),
        msg([
          {
            name: 'finalize',
            input: {
              includeGeology: true,
              geologyPoint: 'landmark',
              geologyEmphasis: 'headline',
              includeWikidata: true,
              reason: 'the rock is the headline; a date anchors it',
            },
          },
        ]),
      ),
    )
    expect(r).not.toBeNull()
    expect(r!.geology!.facts).toEqual(GEO.facts) // verbatim — never paraphrased
    expect(r!.geology!.emphasis).toBe('headline')
    expect(r!.geology!.attribution.license).toBe('CC BY 4.0') // provenance rides along
    expect(r!.wikidata!.facts).toEqual(WD.facts)
    expect(r!.toolCalls).toBe(2)
  })

  test('SAFETY: include-without-fetch yields nothing — the scout cannot conjure facts', async () => {
    const r = await scoutStop(
      STOP,
      tools(),
      script(
        msg([
          {
            name: 'finalize',
            input: { includeGeology: true, includeWikidata: true, reason: 'trying to bless unfetched facts' },
          },
        ]),
      ),
    )
    expect(r).not.toBeNull()
    expect(r!.geology).toBeUndefined()
    expect(r!.wikidata).toBeUndefined()
  })

  test('SAFETY: a fetch that returned null cannot be included', async () => {
    const r = await scoutStop(
      STOP,
      tools({ geologyAt: async () => null }),
      script(
        msg([{ name: 'fetch_geology', input: { point: 'road' } }]),
        msg([
          { name: 'finalize', input: { includeGeology: true, geologyPoint: 'road', includeWikidata: false, reason: 'x' } },
        ]),
      ),
    )
    expect(r!.geology).toBeUndefined()
  })

  test('an explicit pass (empty finalize) returns a decision with nothing included', async () => {
    const r = await scoutStop(
      STOP,
      tools(),
      script(msg([{ name: 'finalize', input: { includeGeology: false, includeWikidata: false, reason: 'rich sheet, needs nothing' } }])),
    )
    expect(r).not.toBeNull()
    expect(r!.geology).toBeUndefined()
    expect(r!.wikidata).toBeUndefined()
    expect(r!.reason).toContain('rich sheet')
  })

  test('turn cap without finalize → null (bounded by construction)', async () => {
    const fetchTurn = msg([{ name: 'fetch_geology', input: { point: 'road' } }])
    const r = await scoutStop(STOP, tools(), script(fetchTurn, fetchTurn, fetchTurn, fetchTurn, fetchTurn, fetchTurn))
    expect(r).toBeNull()
  })

  test('no tools to offer (no QID, geology off) → null without any model call', async () => {
    const r = await scoutStop(STOP, { geologyAt: null, wikidataFacts: null }, async () => {
      throw new Error('must not be called')
    })
    expect(r).toBeNull()
  })

  test('geologyPoint defaults to the fetched point when finalize omits it', async () => {
    const r = await scoutStop(
      STOP,
      tools(),
      script(
        msg([{ name: 'fetch_geology', input: { point: 'landmark' } }]),
        msg([{ name: 'finalize', input: { includeGeology: true, includeWikidata: false, reason: 'x' } }]),
      ),
    )
    expect(r!.geology).toBeDefined()
    expect(r!.geology!.emphasis).toBe('supporting') // unspecified emphasis defaults conservative
  })

  test('finalize BATCHED with a fetch in the same turn still lands the fetched bundle', async () => {
    // tool_choice 'any' permits parallel tool use, so a frugal model may emit
    // fetch_geology + finalize together — the include decision must see that fetch.
    const r = await scoutStop(
      STOP,
      tools(),
      script(
        msg([
          { name: 'fetch_geology', input: { point: 'landmark' } },
          {
            name: 'finalize',
            input: { includeGeology: true, geologyPoint: 'landmark', geologyEmphasis: 'headline', includeWikidata: false, reason: 'x' },
          },
        ]),
      ),
    )
    expect(r).not.toBeNull()
    expect(r!.geology!.facts).toEqual(GEO.facts)
    expect(r!.geology!.emphasis).toBe('headline')
    expect(r!.toolCalls).toBe(1)
  })

  test('a max_tokens-truncated turn yields null, never a half-parsed decision', async () => {
    const truncated = {
      ...msg([{ name: 'finalize', input: { includeGeology: true } }]),
      stop_reason: 'max_tokens',
    } as Anthropic.Message
    const r = await scoutStop(STOP, tools(), script(truncated))
    expect(r).toBeNull()
  })

  test('a FAILED landmark fetch never shadows a successful road bundle on omitted geologyPoint', async () => {
    const r = await scoutStop(
      STOP,
      tools({ geologyAt: async (point) => (point === 'road' ? GEO : null) }),
      script(
        msg([
          { name: 'fetch_geology', input: { point: 'landmark' } },
          { name: 'fetch_geology', input: { point: 'road' } },
        ]),
        msg([{ name: 'finalize', input: { includeGeology: true, includeWikidata: false, reason: 'x' } }]),
      ),
    )
    expect(r!.geology).toBeDefined() // falls back to the road bundle, not the null landmark
    expect(r!.geology!.facts).toEqual(GEO.facts)
  })

  test('a fetcher that throws is fed back as "nothing found", not a crash', async () => {
    const r = await scoutStop(
      STOP,
      tools({ wikidataFacts: async () => Promise.reject(new Error('api down')) }),
      script(
        msg([{ name: 'fetch_wikidata', input: {} }]),
        msg([{ name: 'finalize', input: { includeGeology: false, includeWikidata: true, reason: 'x' } }]),
      ),
    )
    expect(r).not.toBeNull()
    expect(r!.wikidata).toBeUndefined()
  })
})

describe('scoutToolsForStop — the enriched-stop PLACE/ROUTE split (spec §6)', () => {
  const geo: SourcedFacts = { facts: ['rock'], attribution: { source: 'macrostrat', sourceId: 'm', license: 'CC BY 4.0', retrievedAt: 't' } }
  const wd: SourcedFacts = { facts: ['fact'], attribution: { source: 'wikidata', sourceId: 'Q1', license: 'CC0', retrievedAt: 't' } }
  const deps = { geologyEnabled: true, wikidataEnabled: true, geologyAt: async () => geo, wikidataFacts: async () => wd }
  const stop = { lat: 1, lng: 2, triggerLat: 3, triggerLng: 4, wikidataQid: 'Q1' }

  test('UN-enriched: full scout — landmark geology fetched, route geology fetched, Wikidata offered', async () => {
    const t = scoutToolsForStop({ ...stop, enriched: false }, deps)
    expect(await t.geologyAt!('landmark')).toEqual(geo) // landmark rock fetched
    expect(await t.geologyAt!('road')).toEqual(geo) // route rock fetched
    expect(t.wikidataFacts).not.toBeNull() // Wikidata offered
  })

  test('ENRICHED: route-only — landmark geology NULL, Wikidata withheld, route geology still fetched', async () => {
    const t = scoutToolsForStop({ ...stop, enriched: true }, deps)
    expect(await t.geologyAt!('landmark')).toBeNull() // the place rock is already in the well
    expect(await t.geologyAt!('road')).toEqual(geo) // the route "rock under the tires" still scouted
    expect(t.wikidataFacts).toBeNull() // a PLACE fact — already in the well
  })

  test('channels off / no QID → null tools', () => {
    expect(scoutToolsForStop(stop, { ...deps, geologyEnabled: false }).geologyAt).toBeNull()
    expect(scoutToolsForStop({ ...stop, wikidataQid: undefined }, deps).wikidataFacts).toBeNull()
    expect(scoutToolsForStop(stop, { ...deps, wikidataEnabled: false }).wikidataFacts).toBeNull()
  })
})
