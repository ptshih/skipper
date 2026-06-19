import { describe, expect, test } from 'bun:test'
import { buildDrive, type DriveCandidate } from '../src/drive-select'
import type { LngLat } from '../src/geo'

// ~11.1 km north-south line; lat 38.0+i*0.001 → alongSec ≈ i*6.6 over a 660s drive.
const polyline: LngLat[] = Array.from({ length: 101 }, (_, i) => [0, 38.0 + i * 0.001] as LngLat)
const TOTAL_SEC = 660

const cand = (over: Partial<DriveCandidate> & { poiId: string; lat: number }): DriveCandidate => ({
  audioKey: `r2/${over.poiId}.m4a`,
  audioDurationMs: 120_000,
  lng: 0,
  ...over,
})

describe('buildDrive', () => {
  test('excludes off-route candidates (past the off-route floor)', () => {
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [
        cand({ poiId: 'on', lat: 38.05 }),
        cand({ poiId: 'off', lat: 38.05, lng: 0.02 }), // ~1.7 km east — off-route
      ],
    })
    expect(stops.some((s) => s.poiId === 'on')).toBe(true)
    expect(stops.some((s) => s.poiId === 'off')).toBe(false)
  })

  test('respects the minimum time gap and is ordered (seq 0..n-1, alongSec non-decreasing)', () => {
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [
        cand({ poiId: 'a', lat: 38.01 }), // ~66s
        cand({ poiId: 'b', lat: 38.05 }), // ~330s
        cand({ poiId: 'c', lat: 38.09 }), // ~594s
      ],
    })
    expect(stops.length).toBe(3)
    stops.forEach((s, i) => expect(s.seq).toBe(i))
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i]!.alongSec - stops[i - 1]!.alongSec).toBeGreaterThanOrEqual(180)
    }
  })

  test('snaps each stop to a trigger point ON the route (trigger lng = 0, not the POI lng)', () => {
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [cand({ poiId: 'a', lat: 38.05, lng: 0.003 })], // off-route but within the floor
    })
    expect(stops[0]!.triggerLng).toBe(0)
  })

  test('collapses co-located candidates PICK-ONE, keeping the higher-quality one', () => {
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [
        cand({ poiId: 'weak', lat: 38.05, qualityScore: 0 }),
        cand({ poiId: 'strong', lat: 38.0505, qualityScore: 1 }), // ~55 m away → same physical stop
      ],
    })
    expect(stops.length).toBe(1)
    expect(stops[0]!.poiId).toBe('strong')
  })

  test('caps at maxStops', () => {
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 1,
      maxStops: 2,
      candidates: [
        cand({ poiId: 'a', lat: 38.01 }),
        cand({ poiId: 'b', lat: 38.05 }),
        cand({ poiId: 'c', lat: 38.09 }),
      ],
    })
    expect(stops.length).toBeLessThanOrEqual(2)
  })

  test('within a window, a clip that FITS the gap beats an over-long one', () => {
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [
        cand({ poiId: 'overlong', lat: 38.02, audioDurationMs: 300_000 }), // ~132s; 300s clip > 180s gap
        cand({ poiId: 'fits', lat: 38.04, audioDurationMs: 120_000 }), // ~264s; same window, fits
      ],
    })
    expect(stops.some((s) => s.poiId === 'fits')).toBe(true)
    expect(stops.some((s) => s.poiId === 'overlong')).toBe(false)
  })

  test('within a window, prefers a DIFFERENT kind from the previous pick (variety)', () => {
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [
        cand({ poiId: 'first', lat: 38.01, kind: 'lake' }), // first pick → prevKind 'lake'
        cand({ poiId: 'same', lat: 38.05, kind: 'lake' }), // ~330s
        cand({ poiId: 'diff', lat: 38.06, kind: 'peak' }), // ~396s; same window as 'same', different kind
      ],
    })
    expect(stops[0]!.poiId).toBe('first')
    expect(stops[1]!.poiId).toBe('diff')
  })

  test('drops a clip that would queue-lag too far behind the car', () => {
    // minGap 60s with 120s clips → the FIFO queue backs up; a mid clip lands > maxLag late and drops.
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 60,
      maxStops: 10,
      candidates: [
        cand({ poiId: 's0', lat: 38.012, kind: 'a' }), // ~79s
        cand({ poiId: 's1', lat: 38.024, kind: 'b' }), // ~158s → starts ~41s late, kept
        cand({ poiId: 's2', lat: 38.036, kind: 'c' }), // ~238s → would start ~82s late → DROP
        cand({ poiId: 's3', lat: 38.048, kind: 'd' }), // ~317s → queue caught up, kept
      ],
    })
    expect(stops.some((s) => s.poiId === 's2')).toBe(false)
    expect(stops.length).toBe(3)
  })

  test('returns an empty drive when no candidates clear the route', () => {
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [cand({ poiId: 'off', lat: 38.05, lng: 0.02 })],
    })
    expect(stops).toEqual([])
  })
})
