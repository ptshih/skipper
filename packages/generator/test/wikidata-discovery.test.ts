import { describe, expect, test } from 'bun:test'
import {
  tierOf,
  isAreal,
  corridorGateM,
  normName,
  dedupeByName,
  boundingBox,
  type WikidataCandidate,
} from '../src/pipeline/wikidata-discovery'
import { OFF_ROUTE_MAX_M, SPINE_AREAL_OFF_ROUTE_MAX_M, STORY_MIN_FACT_CHARS } from '../src/config'

const RICH = STORY_MIN_FACT_CHARS + 100 // a story-grade extract length
const THIN = STORY_MIN_FACT_CHARS - 50 // below the story floor

describe('tierOf', () => {
  test('a place with a story-grade article is STORY', () => {
    expect(tierOf(['bay'], true, RICH)).toBe('story')
    expect(tierOf(['casino', 'hotel'], true, RICH)).toBe('story') // Cal Neva
    expect(tierOf(['census-designated place'], true, RICH)).toBe('story') // a town (Glenbrook)
  })

  test('"road tunnel" with an article is STORY, not dropped (the Cave Rock Tunnel bug)', () => {
    // The throwaway spike mis-dropped Cave Rock Tunnel because a naive "road" filter matched
    // "road tunnel". The real rule must keep an article-bearing tunnel as a story.
    expect(tierOf(['road tunnel'], true, RICH)).toBe('story')
    expect(tierOf(['tunnel'], true, RICH)).toBe('story')
  })

  test('a typed PLACE with no prose is SCENIC (the scenery layer)', () => {
    expect(tierOf(['bay'], false, 0)).toBe('scenic') // Sand Harbor
    expect(tierOf(['beach'], false, 0)).toBe('scenic')
    expect(tierOf(['state recreation area', 'park'], false, 0)).toBe('scenic')
    expect(tierOf(['mountain'], false, 0)).toBe('scenic')
  })

  test('an article whose extract is THIN falls back to its type (scenic for a place)', () => {
    expect(tierOf(['bay'], true, THIN)).toBe('scenic')
  })

  test('a commercial anchor with no prose is BREAK (the Places layer owns it)', () => {
    expect(tierOf(['hotel'], false, 0)).toBe('break')
    expect(tierOf(['restaurant'], false, 0)).toBe('break')
  })

  test('non-place entities are DROP even with an article', () => {
    expect(tierOf(['high school'], true, RICH)).toBe('drop') // George Whittell High School
    expect(tierOf(['radio station'], true, RICH)).toBe('drop') // KRLT
    expect(tierOf(['public library'], false, 0)).toBe('drop')
    expect(tierOf(['administrative territorial entity'], true, RICH)).toBe('drop')
    expect(tierOf(['stream'], false, 0)).toBe('drop')
  })

  test('an untyped entity with no prose is DROP', () => {
    expect(tierOf([], false, 0)).toBe('drop')
  })
})

describe('isAreal / corridorGateM', () => {
  test('lakes, parks, bays, ranches use the wider gate', () => {
    expect(isAreal(['lake'])).toBe(true)
    expect(isAreal(['state park'])).toBe(true)
    expect(isAreal(['bay'])).toBe(true)
    expect(corridorGateM(['lake'])).toBe(SPINE_AREAL_OFF_ROUTE_MAX_M)
  })

  test('point features use the tight gate', () => {
    expect(isAreal(['building'])).toBe(false)
    expect(isAreal(['casino'])).toBe(false)
    expect(corridorGateM(['building'])).toBe(OFF_ROUTE_MAX_M)
  })
})

describe('normName', () => {
  test('strips state suffix, parenthetical, and case', () => {
    expect(normName('Zephyr Cove, Nevada')).toBe('zephyr cove')
    expect(normName('Zephyr Cove')).toBe('zephyr cove')
    expect(normName('Thunderbird Lodge (Lake Tahoe, Nevada)')).toBe('thunderbird lodge')
    expect(normName('Crystal Bay, Nevada')).toBe('crystal bay')
  })
})

describe('dedupeByName', () => {
  const cand = (
    name: string,
    tier: WikidataCandidate['tier'],
    types: string[],
  ): WikidataCandidate => ({
    qid: name + tier,
    name,
    lat: 39,
    lng: -120,
    types,
    tier,
    offRouteM: 100,
  })

  test('a town STORY collapses its same-named bay SCENIC (story wins)', () => {
    const out = dedupeByName([
      cand('Zephyr Cove, Nevada', 'story', ['census-designated place']),
      cand('Zephyr Cove', 'scenic', ['bay']),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.tier).toBe('story')
  })

  test('a scenic with no story counterpart survives (Sand Harbor)', () => {
    const out = dedupeByName([cand('Sand Harbor', 'scenic', ['bay'])])
    expect(out).toHaveLength(1)
    expect(out[0]!.name).toBe('Sand Harbor')
  })

  test('distinct places are all kept', () => {
    const out = dedupeByName([
      cand('Sand Harbor', 'scenic', ['bay']),
      cand('Secret Harbor', 'scenic', ['bay']),
      cand('Cave Rock Tunnel', 'story', ['road tunnel']),
    ])
    expect(out).toHaveLength(3)
  })
})

describe('boundingBox', () => {
  test('pads a polyline bbox by the margin', () => {
    const { sw, ne } = boundingBox(
      [
        [-120.0, 39.0],
        [-119.9, 39.2],
      ],
      0.025,
    )
    expect(sw[0]).toBeCloseTo(-120.025)
    expect(sw[1]).toBeCloseTo(38.975)
    expect(ne[0]).toBeCloseTo(-119.875)
    expect(ne[1]).toBeCloseTo(39.225)
  })
})
