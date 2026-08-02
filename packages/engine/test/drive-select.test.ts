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

  // The PICK-ONE co-located dedupe (DRIVE_MIN_SEPARATION_M). Two narrations closer than 1 km on the
  // ground are the same physical stop, so one of them must go.
  //
  // ⚠ THIS WAS UNTESTED until 2026-08-02, and the gap was invisible in the usual way: setting
  // DRIVE_MIN_SEPARATION_M to 0 — i.e. deduping NOTHING — left the whole engine suite green. Found by
  // mutating the constant after it was inlined, not by reading the code.
  //
  // ⚠ THE CONTROL IS THE POINT. Two other rules can drop a nearby second stop and would make a
  // separation-only assertion pass for the wrong reason: the min-gap pacing clock, and the queue-lag
  // DROP (a 2-minute clip in front of a stop 33 s later lags it out at DRIVE_MAX_LAG_SEC). So the gap
  // is 1 s and the clips are 10 s — both neutralized — and the far pair proves the DISTANCE is what
  // discriminates, because it survives with everything else held identical.
  const coLocated = (aLat: number, bLat: number) =>
    buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 1,
      maxStops: 10,
      candidates: [
        cand({ poiId: 'a', lat: aLat, audioDurationMs: 10_000 }),
        cand({ poiId: 'b', lat: bLat, audioDurationMs: 10_000 }),
      ],
    })

  test('two candidates INSIDE the separation floor collapse to one', () => {
    // 0.005 deg lat ≈ 557 m — inside the 1 km floor.
    expect(coLocated(38.05, 38.055)).toHaveLength(1)
  })

  test('...and the same pair OUTSIDE it keeps both (the distance is what decides)', () => {
    // 0.02 deg lat ≈ 2.2 km — outside the floor, everything else identical.
    expect(coLocated(38.05, 38.07)).toHaveLength(2)
  })


  // The SECOND admission rule. A too-wide group arrives with an off-road enclosing-circle CENTRE and a
  // radius CAPPED below its true extent — so the point rule would place it wherever the centre happens
  // to fall and freeze that into the drive forever. It must be refused outright, even when its centre
  // sits squarely ON the route (which is exactly the case the point rule would admit).
  //
  // ⚠ The refusal keys on GEOMETRY (`tooWideForPoint`), never on a served hull. It keyed on the hull
  // until 2026-07-31, which meant deleting the area MODE would have flipped this branch from REFUSE to
  // ADMIT and shipped the frozen mis-fire — a deletion elsewhere silently un-writing this test's intent.
  test('refuses a TOO-WIDE candidate even when its point would be admitted', () => {
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [
        cand({ poiId: 'point', lat: 38.02 }),
        // Dead on the line — the point rule admits this without the refusal.
        cand({ poiId: 'district', lat: 38.05, tooWideForPoint: true }),
      ],
    })
    expect(stops.some((s) => s.poiId === 'point')).toBe(true)
    expect(stops.some((s) => s.poiId === 'district')).toBe(false)
  })

  // Guards the mapper: `tooWideForPoint` is optional at every hop, so an omitted field compiles clean
  // and silently restores the point behaviour. Same candidate, flag absent ⇒ admitted.
  test('the same candidate WITHOUT the flag is still admitted (the refusal is the geometry, not the place)', () => {
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [cand({ poiId: 'district', lat: 38.05 })],
    })
    expect(stops.some((s) => s.poiId === 'district')).toBe(true)
  })

  // The 250-700 m band: a candidate the old flat off-route ceiling admitted but the TRIGGER could
  // never reach, so it consumed a pacing slot and played nothing. Measured on the real Tahoe drives at
  // 3 of 18 selected stops before the fix. ~11.1 km over 660 s = ~17 m/s, so speed x 12 s lead ~ 202 m
  // and an ANCHORED stop keeps its 250 m floor — a 400 m offset is unreachable, a 150 m one is fine.
  test('drops an ANCHORED candidate the trigger radius can never reach (250-700m band)', () => {
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [
        cand({ poiId: 'near', lat: 38.02, lng: 0.0017, anchored: true }), // ~150 m east — within the 250 m floor
        cand({ poiId: 'far', lat: 38.07, lng: 0.0046, anchored: true }), // ~400 m east — past it, silent
      ],
    })
    expect(stops.some((s) => s.poiId === 'near')).toBe(true)
    expect(stops.some((s) => s.poiId === 'far')).toBe(false)
  })

  // The same 400 m offset must STILL be admitted when the stop is NOT road-snapped: an un-anchored pin
  // keeps the fat kind-aware floor (600 m default), so tightening the gate must not regress it. This is
  // what stops the fix from quietly deleting the ~99 un-anchored backcountry places.
  test('KEEPS the same offset when un-anchored (fat kind-aware floor still applies)', () => {
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [cand({ poiId: 'far', lat: 38.07, lng: 0.0046 })], // no `anchored` → 600 m floor
    })
    expect(stops.some((s) => s.poiId === 'far')).toBe(true)
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

  test('collapses co-located candidates PICK-ONE, keeping the richer (longer) one', () => {
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [
        cand({ poiId: 'weak', lat: 38.05, audioDurationMs: 60_000 }),
        cand({ poiId: 'strong', lat: 38.0505, audioDurationMs: 120_000 }), // ~55 m away → same physical stop
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

describe('buildDrive — variety', () => {
  // Two UNKNOWN buckets must not count as a repeat. Treating null === null as "same" is what silently
  // disabled the variety rule for 85% of the corpus, since `kind` is a natural-feature allowlist.
  test('an unknown variety key never suppresses a candidate', () => {
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [
        cand({ poiId: 'a', lat: 38.01 }),
        cand({ poiId: 'b', lat: 38.05 }),
        cand({ poiId: 'c', lat: 38.09 }),
      ],
    })
    expect(stops).toHaveLength(3)
  })

  // With buckets present the selector prefers a DIFFERENT one inside the same min-gap window.
  //
  // ⚠ The two rivals must sit MORE than DRIVE_MIN_SEPARATION_M (1 km) apart. Step 2's co-located
  // pick-one collapse runs BEFORE pacing, so anything closer is deduped by clip length and the variety
  // rule never sees it — which is exactly how a first draft of this test "failed" against correct code.
  // 0.012° of latitude ≈ 1.33 km (survives the collapse) and ≈ 79 s apart (same window).
  test('prefers a different variety bucket over a repeat of the previous pick', () => {
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [
        cand({ poiId: 'first', lat: 38.0, varietyKey: 'dwelling' }),
        cand({ poiId: 'repeat', lat: 38.06, varietyKey: 'dwelling', audioDurationMs: 120_000 }),
        cand({ poiId: 'varied', lat: 38.072, varietyKey: 'lodging', audioDurationMs: 120_000 }),
      ],
    })
    expect(stops.some((s) => s.poiId === 'varied')).toBe(true)
    expect(stops.some((s) => s.poiId === 'repeat')).toBe(false)
  })
})
