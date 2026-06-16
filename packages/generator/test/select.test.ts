import { describe, expect, test } from 'bun:test'
import { selectStops, type SelectParams } from '../src/pipeline/select'
import type { LngLat } from '../src/pipeline/geo'
import type { WikiPoi } from '../src/pipeline/wikipedia'
import type { BreakAnchor } from '../src/pipeline/places'
import type { FactSheetEntry } from '@skipper/db/schema'

// ~11.1 km north-south line (lat 38.000 → 38.100, ~111 m per 0.001°).
const polyline: LngLat[] = Array.from({ length: 101 }, (_, i) => [0, 38.0 + i * 0.001] as LngLat)
const TOTAL_SEC = 660 // ~11 min drive

// Two grounded extracts; A is longer so it wins its spacing window over F. #1: a STORY also REQUIRES a
// curated fact sheet, so wiki() is ENRICHED by default; an un-enriched fixture (factSheet:null) is scenic.
const RICH =
  'This stop has a real grounded fact about the place that runs comfortably past the one hundred forty character minimum, so it stays a story stop.'
const RICHER = RICH + ' And one extra sentence makes this the longest candidate in its window.'
const SHEET: FactSheetEntry[] = [{ text: 'a curated verbatim fact', source: 'wikipedia', sourceId: '1', license: 'CC BY-SA 4.0' }]

const wiki = (over: Partial<WikiPoi> & { lat: number }): WikiPoi => {
  const pageid = Math.round(over.lat * 1000)
  return {
    source: 'wikipedia',
    sourceId: String(pageid),
    pageid,
    title: 'Place',
    lng: 0,
    extract: RICH,
    url: `https://en.wikipedia.org/?curid=${pageid}`,
    factSheet: SHEET, // ENRICHED by default — a STORY needs a sheet (#1)
    ...over,
  }
}

const params = (): SelectParams => ({
  polyline,
  totalSec: TOTAL_SEC,
  pacing: { minGapSec: 180, maxNarratedStops: 5, breakStops: 1 },
  // ~495s — placed in a clear slot (>90s after Rich B @330s) so it isn't rejected as
  // stacking on a narrated stop's clip (selectBreaks' preceding-gap rule).
  breakAnchors: [{ placeId: 'gas-1', name: 'Gas Stop', lat: 38.075, lng: 0, primaryType: 'gas_station' }] as BreakAnchor[],
  wikiPois: [
    wiki({ lat: 38.01, title: 'Rich A', extract: RICHER }), // ~66s — richest in its window
    wiki({ lat: 38.015, title: 'Near-A F', extract: RICH }), // ~83s — within minGap of A → skipped
    wiki({ lat: 38.05, title: 'Rich B', extract: RICH }), // ~330s
    wiki({ lat: 38.09, title: 'Thin C', extract: 'A small lake.', factSheet: null }), // ~594s — un-enriched → scenic (#1)
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

  test('classifies by SHEET presence: enriched → story, un-enriched → scenic (#1)', () => {
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

describe('selectStops trigger points + break off-route filter', () => {
  test('snaps each stop to a trigger point on the route with a sane approach heading', () => {
    const plan = selectStops(params())
    for (const s of plan) {
      // The route runs due north along lng 0, so every trigger point snaps to lng 0
      // (NOT the off-route POI lng) and the approach heading is ~north (0°/360°).
      expect(s.triggerLng).toBe(0)
      expect(s.triggerLat).toBeGreaterThanOrEqual(38.0)
      expect(s.triggerLat).toBeLessThanOrEqual(38.1)
      expect(s.approachHeadingDeg === 0 || s.approachHeadingDeg === 360 || s.approachHeadingDeg < 1).toBe(true)
    }
  })

  test('drops a break anchor that snaps too far off the route', () => {
    const farBreak = selectStops({
      ...params(),
      // A single break anchor ~1.7 km east of the route (lng 0.02) — past OFF_ROUTE_MAX_M.
      breakAnchors: [{ placeId: 'far-gas', name: 'Far Gas', lat: 38.05, lng: 0.02, primaryType: 'gas_station' }] as BreakAnchor[],
    })
    expect(farBreak.some((s) => s.stopType === 'break')).toBe(false)
  })

  test('keeps an on-route break anchor', () => {
    const onRoute = selectStops({
      ...params(),
      // lat 38.075 ≈ 495s — on-route AND clear of the preceding story (so it isn't dropped
      // for stacking); this test is about the OFF-ROUTE filter keeping an on-route anchor.
      breakAnchors: [{ placeId: 'near-gas', name: 'Near Gas', lat: 38.075, lng: 0, primaryType: 'gas_station' }] as BreakAnchor[],
    })
    expect(onRoute.filter((s) => s.stopType === 'break').length).toBe(1)
  })

  test('drops a break that would stack on the preceding story (queue would back up)', () => {
    const stacked = selectStops({
      ...params(),
      // The only anchor sits ~7s after Rich B (@~330s) — inside the preceding-gap floor, so it
      // would queue behind Rich B's clip and play late. No clear slot ⇒ no break.
      breakAnchors: [{ placeId: 'stacked', name: 'Stacked Gas', lat: 38.051, lng: 0, primaryType: 'gas_station' }] as BreakAnchor[],
    })
    expect(stacked.some((s) => s.stopType === 'break')).toBe(false)
  })
})

describe('selectStops co-located dedup', () => {
  // A route that runs NORTH then doubles back SOUTH ~88 m to the east, so the two
  // ends sit at OPPOSITE ends of the route (far apart in along-route time) yet only
  // ~88 m apart on the ground — the Fannette-⊂-Emerald-Bay shape. A pure time-gap
  // would keep both; only the spatial dedup collapses them.
  const uRoute: LngLat[] = [
    ...Array.from({ length: 21 }, (_, i) => [0, 38.0 + i * 0.001] as LngLat), // north along lng 0
    ...Array.from({ length: 21 }, (_, i) => [0.001, 38.02 - i * 0.001] as LngLat), // south along lng 0.001
  ]
  const plan = selectStops({
    polyline: uRoute,
    totalSec: 660,
    pacing: { minGapSec: 30, maxNarratedStops: 5, breakStops: 0 }, // tiny gap: time-window would NOT dedup
    breakAnchors: [],
    wikiPois: [
      wiki({ pageid: 1, lat: 38.0, lng: 0, title: 'Start Rich', extract: RICHER }), // snaps to route START
      wiki({ pageid: 2, lat: 38.0, lng: 0.001, title: 'End Rich', extract: RICH }), // ~88 m away, snaps to route END
    ],
  })

  test('collapses two co-located POIs to one, keeping the richer extract', () => {
    expect(plan.some((s) => s.name === 'Start Rich')).toBe(true) // RICHER wins
    expect(plan.some((s) => s.name === 'End Rich')).toBe(false) // not its own stop
    expect(plan.filter((s) => s.stopType !== 'break').length).toBe(1)
  })

  test('FOLDS the co-located POI into the survivor as a merged feature (not discarded)', () => {
    const survivor = plan.find((s) => s.name === 'Start Rich')
    expect(survivor?.mergedFeatures?.length).toBe(1)
    expect(survivor?.mergedFeatures?.[0]?.name).toBe('End Rich')
    expect(survivor?.mergedFeatures?.[0]?.facts.length).toBeGreaterThan(0) // its facts survive
    // The merged telling runs a little longer than a lone story.
    expect(survivor!.targetSeconds).toBeGreaterThan(120)
  })

  test('the survivor sits at opposite end in TIME, proving spatial (not time-gap) dedup', () => {
    // Start and End snap to alongSec ~0 and ~max — a time gap alone keeps both.
    const along = (name: string) => plan.find((s) => s.name === name)?.alongSec
    expect(along('Start Rich')).toBeLessThan(60) // near the route start
  })
})

describe('selectStops — selection is INVARIANT to the extract storage cap (4k→12k)', () => {
  // Two CO-LOCATED story candidates, BOTH already past the 4k narration head. A free re-discover
  // re-stores the second one's extract from ~4k up to ~12k; that must NOT flip which one survives
  // the merge, because selection ranks on the narration-visible head (rankLen), not raw length.
  // (Regression guard for the review's high-severity selection-drift finding.)
  const uRoute: LngLat[] = [
    ...Array.from({ length: 21 }, (_, i) => [0, 38.0 + i * 0.001] as LngLat),
    ...Array.from({ length: 21 }, (_, i) => [0.001, 38.02 - i * 0.001] as LngLat),
  ]
  const survivorWhenSecondExtractIs = (repeats: number): string => {
    const plan = selectStops({
      polyline: uRoute,
      totalSec: 660,
      pacing: { minGapSec: 30, maxNarratedStops: 5, breakStops: 0 },
      breakAnchors: [],
      wikiPois: [
        wiki({ pageid: 1, lat: 38.0, lng: 0, title: 'A first', extract: RICH.repeat(31) }), // ~4.3k, > 4k head
        wiki({ pageid: 2, lat: 38.0, lng: 0.001, title: 'B second', extract: RICH.repeat(repeats) }),
      ],
    })
    return plan.find((s) => s.stopType !== 'break')!.name
  }

  test('growing the co-located neighbour from ~4k to ~12k does not change the survivor', () => {
    // raw-length ranking would flip the survivor to B at ~12k; the rankLen cap keeps it A in both.
    expect(survivorWhenSecondExtractIs(30)).toBe('A first') // B ~4.2k — both clamp to 4k → A (first) wins
    expect(survivorWhenSecondExtractIs(90)).toBe('A first') // B ~12.6k — raw would flip to B; capped → still A
  })
})
