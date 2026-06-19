import { describe, expect, test } from 'bun:test'
import { buildPreviewTimeline, type PreviewStop } from '../src/preview'
import type { LngLat } from '../src/geo'

// ~11.1 km north-south line (lat 38.000 -> 38.100, ~111 m per 0.001 deg).
const polyline: LngLat[] = Array.from({ length: 101 }, (_, i) => [0, 38.0 + i * 0.001] as LngLat)

// Three stops on the route: a story near the start, a silent break in the middle,
// a story near the end. (lng 0 = right on the line.)
const stops: PreviewStop[] = [
  { seq: 0, stopType: 'story', name: 'Start', lat: 38.01, lng: 0, audioDurationMs: 40_000 },
  { seq: 1, stopType: 'break', name: 'Rest', lat: 38.05, lng: 0, audioDurationMs: null },
  { seq: 2, stopType: 'story', name: 'End', lat: 38.09, lng: 0, audioDurationMs: 50_000 },
]

describe('buildPreviewTimeline', () => {
  const tl = buildPreviewTimeline(stops, polyline, { totalDriveSec: 600 })

  test('interleaves clip / drive / rest in route order, drive only BETWEEN stops', () => {
    expect(tl.segments.map((s) => s.kind)).toEqual(['clip', 'drive', 'rest', 'drive', 'clip'])
  })

  test('startMs is contiguous and equals the running sum of previewMs', () => {
    let acc = 0
    for (const s of tl.segments) {
      expect(s.startMs).toBe(acc)
      acc += s.previewMs
    }
    expect(tl.totalPreviewMs).toBe(acc)
  })

  test('clips keep full length; the silent break is a short rest card', () => {
    const clips = tl.segments.filter((s) => s.kind === 'clip')
    expect(clips.map((s) => s.previewMs)).toEqual([40_000, 50_000])
    const rest = tl.segments.find((s) => s.kind === 'rest')!
    expect(rest.previewMs).toBe(2_000) // default restSec
    expect(rest.stopType).toBe('break')
  })

  test('drive gaps are compressed within [minGap, maxGap] and far shorter than real', () => {
    const drives = tl.segments.filter((s) => s.kind === 'drive')
    expect(drives.length).toBe(2)
    for (const d of drives) {
      expect(d.previewMs).toBeGreaterThanOrEqual(1_200) // minGapSec default
      expect(d.previewMs).toBeLessThanOrEqual(4_000) // maxGapSec default
      expect(d.previewMs).toBeLessThan(d.realMs) // compressed
      expect(d.distanceM).toBeGreaterThan(0)
    }
  })

  test('route progress is 0..1, monotonic non-decreasing, and drive spans from->to', () => {
    let last = -1
    for (const s of tl.segments) {
      expect(s.routeProgress).toBeGreaterThanOrEqual(0)
      expect(s.routeProgress).toBeLessThanOrEqual(1)
      expect(s.routeProgress).toBeGreaterThanOrEqual(last)
      last = s.routeProgress
    }
    const firstDrive = tl.segments.find((s) => s.kind === 'drive')!
    expect(firstDrive.fromProgress!).toBeLessThan(firstDrive.routeProgress)
  })

  test('totalRealMs ~= sum of clip lengths + real drive time (the actual drive)', () => {
    // 40s + 50s clips + 2s rest + real drive time across ~80% of a 600s drive.
    const clipRest = 40_000 + 50_000 + 2_000
    expect(tl.totalRealMs).toBeGreaterThan(clipRest)
    expect(tl.clipCount).toBe(2)
  })

  test('compression options are honored (a fixed tiny gap)', () => {
    const tight = buildPreviewTimeline(stops, polyline, { totalDriveSec: 600, minGapSec: 1, maxGapSec: 1 })
    for (const d of tight.segments.filter((s) => s.kind === 'drive')) expect(d.previewMs).toBe(1_000)
  })

  test('single-stop tour has no drive segments', () => {
    const one = buildPreviewTimeline([stops[0]!], polyline, { totalDriveSec: 600 })
    expect(one.segments.map((s) => s.kind)).toEqual(['clip'])
    expect(one.totalPreviewMs).toBe(40_000)
  })
})

// (Intro/outro frame tests removed — asides/framing deleted in v2; see geometry-first-regions.md.)
