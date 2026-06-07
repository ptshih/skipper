import { describe, expect, test } from 'bun:test'
import { selectStops, type SelectParams } from '../src/pipeline/select'
import type { LngLat } from '../src/pipeline/geo'
import type { WikiPoi } from '../src/pipeline/wikipedia'
import type { BreakAnchor } from '../src/pipeline/places'

// ~11.1 km north-south line (lat 38.000 → 38.100, ~111 m per 0.001°).
const polyline: LngLat[] = Array.from({ length: 101 }, (_, i) => [0, 38.0 + i * 0.001] as LngLat)
const TOTAL_SEC = 660 // ~11 min drive

// Two grounded extracts, both well over STORY_MIN_FACT_CHARS (140); A is longer
// so it wins its spacing window over F.
const RICH =
  'This stop has a real grounded fact about the place that runs comfortably past the one hundred forty character minimum, so it stays a story stop.'
const RICHER = RICH + ' And one extra sentence makes this the longest candidate in its window.'

const wiki = (over: Partial<WikiPoi> & { lat: number }): WikiPoi => ({
  pageid: Math.round(over.lat * 1000),
  title: 'Place',
  lng: 0,
  extract: RICH,
  url: `https://en.wikipedia.org/?curid=${Math.round(over.lat * 1000)}`,
  ...over,
})

const params = (): SelectParams => ({
  polyline,
  totalSec: TOTAL_SEC,
  pacing: { minGapSec: 180, maxNarratedStops: 5, breakStops: 1 },
  breakAnchors: [{ placeId: 'gas-1', name: 'Gas Stop', lat: 38.06, lng: 0, primaryType: 'gas_station' }] as BreakAnchor[],
  wikiPois: [
    wiki({ lat: 38.01, title: 'Rich A', extract: RICHER }), // ~66s — richest in its window
    wiki({ lat: 38.015, title: 'Near-A F', extract: RICH }), // ~83s — within minGap of A → skipped
    wiki({ lat: 38.05, title: 'Rich B', extract: RICH }), // ~330s
    wiki({ lat: 38.09, title: 'Thin C', extract: 'A small lake.' }), // ~594s — thin → scenic
    wiki({ lat: 38.052, title: 'List of things in the area', extract: RICHER }), // filtered (list page)
    wiki({ lat: 38.05, lng: 0.02, title: 'Far E', extract: RICHER }), // ~1.7 km off-route → excluded
  ],
})

describe('selectStops', () => {
  const plan = selectStops(params())
  const titlesByType = (t: string) => plan.filter((s) => s.stopType === t)
  const has = (name: string) => plan.some((s) => s.name === name)

  test('excludes off-route POIs', () => {
    expect(has('Far E')).toBe(false)
  })

  test('excludes list/index pages', () => {
    expect(plan.some((s) => /^List of/.test(s.name))).toBe(false)
    expect(has('List of things in the area')).toBe(false)
  })

  test('picks the richest candidate within a spacing window (skips the nearer, thinner one)', () => {
    expect(has('Rich A')).toBe(true)
    expect(has('Near-A F')).toBe(false)
  })

  test('classifies by extract length: rich → story, thin → scenic', () => {
    const a = plan.find((s) => s.name === 'Rich A')
    const c = plan.find((s) => s.name === 'Thin C')
    expect(a?.stopType).toBe('story')
    expect(a?.facts.length).toBeGreaterThan(0)
    expect(a?.wikiUrl).toBeTruthy()
    expect(c?.stopType).toBe('scenic')
    expect(c?.facts.length).toBe(0)
    expect(c?.wikiUrl).toBeUndefined()
  })

  test('interleaves exactly one break stop with no audio/facts', () => {
    const breaks = titlesByType('break')
    expect(breaks.length).toBe(1)
    expect(breaks[0]!.source).toBe('google_places')
    expect(breaks[0]!.facts.length).toBe(0)
  })

  test('narrated stops respect the minimum time gap', () => {
    const narrated = plan.filter((s) => s.stopType !== 'break').sort((a, b) => a.alongSec - b.alongSec)
    for (let i = 1; i < narrated.length; i++) {
      expect(narrated[i]!.alongSec - narrated[i - 1]!.alongSec).toBeGreaterThanOrEqual(180)
    }
  })

  test('is ordered: seq is 0..n-1 and alongSec is non-decreasing', () => {
    plan.forEach((s, i) => expect(s.seq).toBe(i))
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i]!.alongSec).toBeGreaterThanOrEqual(plan[i - 1]!.alongSec)
    }
  })

  test('honors maxNarratedStops', () => {
    const tiny = selectStops({ ...params(), pacing: { minGapSec: 1, maxNarratedStops: 2, breakStops: 0 } })
    expect(tiny.filter((s) => s.stopType !== 'break').length).toBeLessThanOrEqual(2)
  })
})
