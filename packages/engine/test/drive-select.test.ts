import { describe, expect, test } from 'bun:test'
import { buildCandidatePlacer, buildDrive, type DriveCandidate } from '../src/drive-select'
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

  // ⚠ THE ADMISSION RULE HAS TWO CALLERS AND MUST STAY ONE EXPRESSION. `buildDrive` admits on it, and
  // `loadCorpusForRoute` (apps/api) asks it whether a fused telling is reachable before letting that
  // telling retire its own members. When those two answers disagreed the drive lost BOTH: measured on
  // the live Stateline→Stateline loop, "Emerald Bay and Vikingsholm" was refused for range while
  // Vikingsholm's own reachable 81 s clip stayed suppressed behind it. This test is what stops a second
  // copy of the reach test being re-inlined into either side — it fails the moment they diverge.
  test('buildCandidatePlacer agrees with buildDrive on every admission, exactly', () => {
    const place = buildCandidatePlacer(polyline, TOTAL_SEC)
    const cases: DriveCandidate[] = [
      cand({ poiId: 'on-line', lat: 38.05 }),
      cand({ poiId: 'far-off', lat: 38.05, lng: 0.02 }),
      // The 250-700 m band: on-route by the honesty bound, out of TRIGGER reach.
      cand({ poiId: 'band', lat: 38.05, lng: 0.004, anchored: true }),
      cand({ poiId: 'wide-no-members', lat: 38.05, tooWideForPoint: true }),
      cand({
        poiId: 'wide-reachable',
        lat: 38.05,
        lng: 0.02, // an off-road centre, as a real cluster has
        tooWideForPoint: true,
        memberPoints: [[0, 38.06] as LngLat],
        triggerRadiusM: 600,
      }),
    ]
    for (const c of cases) {
      const admitted = buildDrive({
        polyline,
        totalSec: TOTAL_SEC,
        minGapSec: 1,
        maxStops: 10,
        candidates: [c],
      }).length === 1
      expect({ id: c.poiId, admitted }).toEqual({ id: c.poiId, admitted: place(c) !== null })
    }
    // …and the set is not vacuously all-yes or all-no, or the agreement would prove nothing.
    const verdicts = cases.map((c) => place(c) !== null)
    expect(verdicts).toContain(true)
    expect(verdicts).toContain(false)
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
  // radius CAPPED below its true extent — so snapping that centre would place it wherever the centre
  // happens to fall and freeze that into the drive forever. It is placed on its MEMBERS instead.
  //
  // ⚠ The branch keys on GEOMETRY (`tooWideForPoint`), never on a served hull. It keyed on the hull
  // until 2026-07-31, which meant deleting the area MODE would have flipped it and shipped the frozen
  // mis-fire — a deletion elsewhere silently un-writing this test's intent.
  //
  // ⚠ Until 2026-08-03 this rule was a flat refusal, and these tests asserted the group was DROPPED.
  // That refused three groups holding 8m13s of released audio no drive could play.
  test('places a TOO-WIDE candidate on its members, not its centre', () => {
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 1,
      maxStops: 10,
      candidates: [
        // The CENTRE is 2.2 km east — far off-route, so a centre-snap could never admit this. The
        // members are on the line, so the member rule must.
        cand({
          poiId: 'district',
          lat: 38.05,
          lng: 0.02,
          tooWideForPoint: true,
          memberPoints: [[0, 38.06], [0, 38.04]],
        }),
      ],
    })
    expect(stops).toHaveLength(1)
    // ...and it is placed at the EARLIEST member (38.04, alongSec ≈ 26.4), not the latest and not the
    // centre. ⚠ This is the assertion that makes "earliest, not closest" real: both members are
    // equidistant from the route (0 m), so ONLY the along-route ordering can discriminate.
    expect(stops[0]!.triggerLat).toBeCloseTo(38.04, 3)
  })

  test('a TOO-WIDE candidate whose members are all off-route is refused', () => {
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [
        cand({
          poiId: 'district',
          lat: 38.05,
          tooWideForPoint: true,
          // ~1.7 km east of the line — past any reach.
          memberPoints: [[0.02, 38.05]],
        }),
      ],
    })
    expect(stops).toHaveLength(0)
  })

  // FAIL-CLOSED, and it guards the mapper from the other side. `memberPoints` is optional at every
  // hop, so a mapper that carries `tooWideForPoint` and drops the points compiles clean — and the
  // tempting fallback (use the centre) is precisely the frozen mis-placement the flag exists to stop.
  // Silence is the correct failure here; a mis-placed stop is not.
  test('a TOO-WIDE candidate with NO members is refused, never fallen back to its centre', () => {
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [
        // Dead on the line: a centre fallback would admit this, which is the bug.
        cand({ poiId: 'district', lat: 38.05, tooWideForPoint: true }),
      ],
    })
    expect(stops).toHaveLength(0)
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

  // THE GLANCE FILL. A 20 s scenic call-out cannot compete with a 90 s telling — measured on the live
  // corpus, 30 eligible glance candidates added to a real drive selected ZERO, because `better()` ranks
  // on clip length. So glances are selected in a SEPARATE pass over the quiet BETWEEN stops.
  //
  // Route note: 0.001 deg lat ≈ 111 m and the drive runs ≈ 16.85 m/s, so GLANCE_EDGE_SEC (45 s) is
  // ≈ 758 m of road — usefully TIGHTER than DRIVE_MIN_SEPARATION_M (1 km), which is what leaves a band
  // where the window admits a glance and the co-location rule still refuses it (tested below).
  const stopAt = (lat: number, ms: number) => cand({ poiId: `stop@${lat}`, lat, audioDurationMs: ms })
  const glanceAt = (lat: number) =>
    cand({ poiId: `glance@${lat}`, lat, audioDurationMs: 20_000, glance: true })

  test('a glance fills the quiet BETWEEN stops and never displaces one', () => {
    const stops = [stopAt(38.01, 20_000), stopAt(38.09, 20_000)]
    const without = buildDrive({ polyline, totalSec: TOTAL_SEC, minGapSec: 180, maxStops: 10, candidates: stops })
    const with_ = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [...stops, glanceAt(38.05)],
    })
    expect(without).toHaveLength(2)
    expect(with_).toHaveLength(3)
    // ⚠ THE LOAD-BEARING HALF: the two real stops are untouched — same subjects, same placement. A
    // glance that shifted a telling would be worse than a glance that never fired.
    expect(with_.filter((s) => !s.poiId.startsWith('glance')).map((s) => s.poiId)).toEqual(
      without.map((s) => s.poiId),
    )
    // ...and it lands between them, in route order.
    expect(with_[1]!.poiId).toBe('glance@38.05')
  })

  test('a glance does NOT count against maxStops', () => {
    // maxStops 1 admits exactly one STOP; the glance rides anyway.
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 1,
      candidates: [stopAt(38.01, 20_000), stopAt(38.09, 20_000), glanceAt(38.05)],
    })
    expect(stops.filter((s) => !s.poiId.startsWith('glance'))).toHaveLength(1)
    expect(stops.filter((s) => s.poiId.startsWith('glance'))).toHaveLength(1)
  })

  test('a glance too close to a stop is refused — and the same glance further along is taken', () => {
    // A 1 s clip opens the window early (ends ≈ 67 s, so the window starts ≈ 112 s), which admits BOTH
    // candidates on TIME. Only the ground distance separates them: 38.018 is ≈ 890 m from the stop
    // (inside DRIVE_MIN_SEPARATION_M) and 38.03 is ≈ 2.2 km (outside).
    const near = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [stopAt(38.01, 1_000), stopAt(38.09, 20_000), glanceAt(38.018)],
    })
    const far = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [stopAt(38.01, 1_000), stopAt(38.09, 20_000), glanceAt(38.03)],
    })
    expect(near.some((s) => s.poiId.startsWith('glance'))).toBe(false)
    expect(far.some((s) => s.poiId.startsWith('glance'))).toBe(true)
  })

  // ⚠ EVERY test above this line uses exactly ONE glance candidate, which is why they all stayed green
  // through the change from "one glance per window" to "as many as fit". A cap that can only be
  // observed with a SECOND candidate is invisible to a suite that never supplies one — the pair below
  // is what actually pins the fill's arity.
  test('a long window takes AS MANY glances as fit, not one', () => {
    // Two stops ~8.9 km apart leave ≈530 s of quiet between them. At 20 s a glance plus the 45 s edge
    // clearance on each side, that window has room for several — and before 2026-08-03 it took one,
    // which is how a 17-minute silence on the live Stateline loop received a single 20-second call-out.
    const glances = [glanceAt(38.03), glanceAt(38.05), glanceAt(38.07)]
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [stopAt(38.01, 20_000), stopAt(38.09, 20_000), ...glances],
    })
    expect(stops.filter((s) => s.poiId.startsWith('glance'))).toHaveLength(3)
    // …and the tellings are still untouched — the fill runs after selection is final.
    expect(stops.filter((s) => !s.poiId.startsWith('glance')).map((s) => s.poiId)).toEqual([
      'stop@38.01',
      'stop@38.09',
    ])
  })

  test('...but two glances closer than the separation floor do not BOTH land', () => {
    // 38.05 and 38.053 are ≈333 m apart — inside DRIVE_MIN_SEPARATION_M. Once the fill can take more
    // than one per window it needs the co-located rule against ITSELF, or it calls out neighbouring
    // coves back to back. Exactly one survives; which one is the earliest, per the fill's ordering.
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [stopAt(38.01, 20_000), stopAt(38.09, 20_000), glanceAt(38.05), glanceAt(38.053)],
    })
    expect(stops.filter((s) => s.poiId.startsWith('glance'))).toHaveLength(1)
    expect(stops.some((s) => s.poiId === 'glance@38.05')).toBe(true)
  })

  // ⚠ The quiet is measured from when the previous clip stops PLAYING, not from its trigger — the FIFO
  // means a stop's audio outlives its trigger by its whole duration. So a LONGER first clip eats the
  // window a glance needed. The pair below changes ONLY that duration (the stops, the glance and the
  // spacing are identical), which is what makes it a test of the window arithmetic rather than of
  // distance or pacing.
  const roomTest = (firstClipMs: number) =>
    buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 1,
      maxStops: 10,
      candidates: [stopAt(38.0, firstClipMs), stopAt(38.02, 20_000), glanceAt(38.01)],
    })

  test('a glance fits when the preceding clip leaves room', () => {
    // stop@38.0 plays 0-20 s → window opens at 65 s; stop@38.02 triggers at ≈132 s → window shuts at
    // 87 s. The glance sits at ≈66 s and runs 20 s, so it just fits.
    expect(roomTest(20_000).some((s) => s.poiId.startsWith('glance'))).toBe(true)
  })

  test('...and is refused when the preceding clip eats it — same everything else', () => {
    // Only change: the first clip now runs 60 s, so the window opens at 105 s and shut at 87 s. There
    // is no room, and silence is the correct answer.
    const stops = roomTest(60_000)
    expect(stops.filter((s) => !s.poiId.startsWith('glance'))).toHaveLength(2)
    expect(stops.some((s) => s.poiId.startsWith('glance'))).toBe(false)
  })

  // ⚠ THE 250-700 m BAND, AND WHY IT IS ADMITTED AGAIN. These two tests used to assert the opposite:
  // that an ANCHORED candidate ~400 m off route was dropped because the trigger (250 m floor, stretched
  // only by speed) could never reach it. That reasoning modelled a pipeline we do not run. A stop is
  // served at its ROUTE-SNAPPED point and both the player and `runDrive` call `snapStopsToRoute`, which
  // replaces the coordinates with the snapped position — so the stop sits ON the road and fires at
  // closest approach whatever the POI's own offset. Verified on the real engine before the change: a
  // POI at 264/365/390/542/622 m fires at the same second; only with `snapStopsToRoute` bypassed
  // entirely does anything past 250 m go silent.
  //
  // So admission is the HONESTY bound and nothing else, and it must not depend on whether the pin is
  // road-snapped — which is what the pair below pins. `anchored` still changes the served
  // `triggerRadiusM` (how EARLY he starts talking); it must never again change WHETHER the place is on
  // the drive.
  test('admits the 250-700 m band — a snapped stop fires at closest approach', () => {
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [
        cand({ poiId: 'near', lat: 38.02, lng: 0.0017, anchored: true }), // ~150 m east
        cand({ poiId: 'band', lat: 38.07, lng: 0.0046, anchored: true }), // ~400 m east — used to be dropped
      ],
    })
    expect(stops.some((s) => s.poiId === 'near')).toBe(true)
    expect(stops.some((s) => s.poiId === 'band')).toBe(true)
  })

  test('...and `anchored` no longer changes admission at all — same offset, both ways', () => {
    const at = (anchored: boolean) =>
      buildDrive({
        polyline,
        totalSec: TOTAL_SEC,
        minGapSec: 180,
        maxStops: 10,
        candidates: [cand({ poiId: 'band', lat: 38.07, lng: 0.0046, ...(anchored ? { anchored } : {}) })],
      }).some((s) => s.poiId === 'band')
    expect(at(true)).toBe(at(false))
    expect(at(true)).toBe(true)
  })

  // The bound itself still has to BITE, or the two tests above would pass on a gate that admits
  // everything. ~900 m east is past OFF_ROUTE_MAX_M: not on this drive, in any sense.
  test('still refuses a candidate past the honesty bound', () => {
    const stops = buildDrive({
      polyline,
      totalSec: TOTAL_SEC,
      minGapSec: 180,
      maxStops: 10,
      candidates: [cand({ poiId: 'gone', lat: 38.05, lng: 0.0103, anchored: true })], // ~900 m east
    })
    expect(stops).toHaveLength(0)
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
