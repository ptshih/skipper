// Fault injection, judged by what the PIPELINE does with it — not by whether the numbers changed.
//
// Every test here runs a degraded trace through `replayHeadless` → `createFixMapper`: the same accuracy
// gate, sentinel handling, projection cursor and end predicate a real drive runs. That is the only bar
// a fault can be held to. A test asserting "canyonMultipath raised the accuracy field" would pass
// forever while the gate it exists to exercise was quietly deleted; the assertions below are written to
// FAIL in that case — admitted vs rejected, cursor advanced vs frozen, drive completed vs not.
//
// ⚠ Each test also states the clean control it is read against, because half of these outcomes are only
// meaningful as a difference. docs/designs/desk-drive-harness.md §4.3.
import { describe, expect, test } from 'bun:test'
import { OFF_ROUTE_MAX_M, type LngLat } from '@skipper/engine'
import { replayHeadless } from './gps-source'
import type { RawFix } from './gps-util'
import {
  canyonMultipath,
  coldStart,
  degrade,
  dropout,
  iosSentinels,
  positionJump,
  reorderTimestamps,
} from './gps-fault'

// A due-north straight line from (0,0). 0.0001° of latitude ≈ 11.1 m, matching the ~13 m vertex spacing
// of a real Google Routes polyline; 301 vertices ≈ 3.3 km.
const VERTS = 301
const LINE: LngLat[] = Array.from({ length: VERTS }, (_, i) => [0, i * 0.0001])
const VERTEX_SPACING_M = 11.12

const T0 = 1_700_000_000_000
// One fix per second, advancing 2.5 vertices — ~27.8 m/s ≈ 62 mph. The speed is chosen so the
// speed-aware accuracy ceiling (speed × leadSeconds × ACCURACY_LEAD_FRACTION) sits ABOVE the canyon
// band and the at-rest floor sits below it: that gap is the whole subject of the first two tests.
const FIX_STEP_DEG = 0.00025
const SPEED_MPS = 27.8
// The last fix lands exactly on the final vertex, so a clean run reaches the end predicate.
const FIX_COUNT = Math.round(((VERTS - 1) * 0.0001) / FIX_STEP_DEG) + 1

/** The perfect input every fault degrades: on the polyline, sane accuracy, heading = travel. */
function cleanTrace(over: { speed?: number } = {}): RawFix[] {
  const speed = over.speed ?? SPEED_MPS
  return Array.from({ length: FIX_COUNT }, (_, i) => ({
    coords: { latitude: i * FIX_STEP_DEG, longitude: 0, accuracy: 5, speed, heading: 0 },
    timestamp: T0 + i * 1000,
  }))
}

/** Metres between two fixes' reported positions (flat-earth; these are metres apart, not degrees). */
function apartM(a: RawFix, b: RawFix): number {
  const dLat = (a.coords.latitude - b.coords.latitude) * 111_194.9
  const dLng = (a.coords.longitude - b.coords.longitude) * 111_194.9
  return Math.hypot(dLat, dLng)
}

describe('the clean control — what every fault is read against', () => {
  test('an undegraded trace is fully admitted and completes the drive', () => {
    // If this ever fails, nothing below means anything: every "the drive still completes" assertion is
    // a claim about the FAULT, not about the fixture.
    const { fixes, rejected, ended } = replayHeadless(LINE, cleanTrace())
    expect(rejected).toBe(0)
    expect(fixes).toHaveLength(FIX_COUNT)
    expect(ended).toBe(true)
  })
})

describe('canyonMultipath — the fault the speed-aware accuracy gate exists for', () => {
  test('AT SPEED a canyon-degraded trace is still fully admitted — not a zero-fire', () => {
    // The field-confirmed failure this pins: a gate without its speed term rejects every 80–150 m fix,
    // the trigger engine is fed nothing, and the drive silently never fires a stop. Failing CLOSED here
    // is the bug, not the safe default.
    const trace = canyonMultipath(cleanTrace(), { seed: 11 })
    const { fixes, rejected, ended } = replayHeadless(LINE, trace)
    expect(rejected).toBe(0)
    expect(fixes).toHaveLength(FIX_COUNT)
    expect(ended).toBe(true)
  })

  test('AT REST the same degradation is rejected — the loosening is the SPEED term, not a blanket raise', () => {
    // Same positions, same accuracy band, speed 0: the ceiling collapses to its floor and a 100 m fix is
    // genuinely untrustworthy, because at rest there is no 300 m effective radius for it to be useful
    // inside. (Positions still walk the route — we are isolating the speed term, not parking the car.)
    const trace = canyonMultipath(cleanTrace({ speed: 0 }), { seed: 11 })
    const { fixes, rejected, ended } = replayHeadless(LINE, trace)
    expect(fixes).toHaveLength(0)
    expect(rejected).toBe(FIX_COUNT)
    expect(ended).toBe(false)
  })

  test('the degradation is REAL — positions leave the polyline by tens of metres', () => {
    // Guards the other direction: a no-op fault would pass both tests above by doing nothing at all.
    const clean = cleanTrace()
    const trace = canyonMultipath(clean, { seed: 11 })
    const worst = Math.max(...trace.map((raw, i) => apartM(raw, clean[i]!)))
    expect(worst).toBeGreaterThan(20)
    expect(trace.every((raw) => (raw.coords.accuracy ?? 0) >= 80 && (raw.coords.accuracy ?? 0) <= 150)).toBe(true)
  })

  test('but it does NOT freeze the projection cursor — one fault, one failure mode', () => {
    // Attribution: the lateral walk is clamped so it stays inside the off-route band. If it ever throws
    // a fix past OFF_ROUTE_MAX_M the cursor freezes, and a run can no longer tell a canyon result from a
    // positionJump result. The clean run's alongM is the reference.
    const clean = replayHeadless(LINE, cleanTrace()).fixes
    const { fixes } = replayHeadless(LINE, canyonMultipath(cleanTrace(), { seed: 11 }))
    for (let i = 1; i < fixes.length; i++) expect(fixes[i]!.alongM).toBeGreaterThan(fixes[i - 1]!.alongM)
    // Lateral error is perpendicular to travel, so it must not move the along-route projection by more
    // than the vertex quantisation.
    for (let i = 0; i < fixes.length; i++) {
      expect(Math.abs(fixes[i]!.alongM - clean[i]!.alongM)).toBeLessThanOrEqual(2 * VERTEX_SPACING_M)
    }
  })
})

describe('dropout — the tunnel', () => {
  test('removes exactly the windowed fixes and the windowed cursor spans the gap', () => {
    const gapSec = 30
    const trace = dropout(cleanTrace(), { startSec: 30, endSec: 30 + gapSec })
    expect(trace).toHaveLength(FIX_COUNT - gapSec)
    const { fixes, rejected, ended } = replayHeadless(LINE, trace)
    // ⚠ The tunnel leaves NO trace in the gate's books — it produced no bad fixes, it produced none at
    // all. Nothing anywhere goes red; the only evidence is the seam. That is why this fault takes no
    // seed and why a stall ladder cannot lean on the rejection count to notice it.
    expect(rejected).toBe(0)
    expect(ended).toBe(true)
    const seam = fixes[30]!.alongM - fixes[29]!.alongM
    expect(seam).toBeGreaterThan(gapSec * SPEED_MPS * 0.9) // the cursor jumped the whole gap in one step
  })
})

describe('coldStart — the unsettled acquisition fixes', () => {
  test('the prefix is REJECTED, and the drive still completes on the fixes after it', () => {
    // A ~1000 m fix landing near a stop would false-fire it before the car has moved. Rejecting the
    // prefix must not cost the drive: the cursor starts where the radio settled, and the end predicate
    // still fires.
    const count = 8
    const { fixes, rejected, ended } = replayHeadless(LINE, coldStart(cleanTrace(), { seed: 3, count }))
    expect(rejected).toBe(count)
    expect(fixes).toHaveLength(FIX_COUNT - count)
    expect(ended).toBe(true)
    // The drive picks up mid-route rather than at zero — proof the prefix was dropped, not sanitised.
    expect(fixes[0]!.alongM).toBeGreaterThan(count * SPEED_MPS * 0.9)
  })

  test('rejection does not depend on the reported speed — 1000 m clears the ceiling at any road speed', () => {
    // The ceiling is speed-proportional, so a cold-start value tuned to today's floor would silently
    // start passing at motorway speed. It must fail at both ends of the range.
    for (const speed of [0, SPEED_MPS]) {
      const { rejected } = replayHeadless(LINE, coldStart(cleanTrace({ speed }), { seed: 3, count: 4 }))
      expect(rejected).toBeGreaterThanOrEqual(4)
    }
  })
})

describe('iosSentinels — the -1s that are data, not dirt', () => {
  const sentinelCount = (trace: RawFix[], field: 'speed' | 'heading' | 'accuracy') =>
    trace.filter((raw) => raw.coords[field] === -1).length

  test('speed -1 sanitises to 0 while heading -1 reaches the engine RAW', () => {
    // ⚠ The zero-fire that was found on a road, not reasoned about: saneNonNeg(-1) = 0 reads as a REAL
    // due-north heading and gates out every stop the car is not driving north toward. The engine must
    // receive a NEGATIVE heading so it skips the gate entirely.
    const trace = iosSentinels(cleanTrace(), { seed: 5, fraction: 0.5 })
    const n = sentinelCount(trace, 'heading')
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThan(FIX_COUNT) // a fraction, not the whole trace
    expect(sentinelCount(trace, 'speed')).toBe(n) // one roll per fix: they go bad together, as on iOS

    const { fixes, rejected } = replayHeadless(LINE, trace)
    expect(rejected).toBe(0) // a -1 speed/heading is survivable; it must not cost the fix
    expect(fixes).toHaveLength(FIX_COUNT)
    let seen = 0
    for (let i = 0; i < FIX_COUNT; i++) {
      if (trace[i]!.coords.heading !== -1) continue
      seen++
      expect(fixes[i]!.headingDeg).toBeLessThan(0)
      expect(fixes[i]!.speedMps).toBe(0)
    }
    expect(seen).toBe(n)
  })

  test('a -1 ACCURACY is a hard reject — which is why it is opt-in', () => {
    const trace = iosSentinels(cleanTrace(), { seed: 5, fraction: 0.5, fields: ['accuracy'] })
    const n = sentinelCount(trace, 'accuracy')
    expect(n).toBeGreaterThan(0)
    const { rejected, fixes } = replayHeadless(LINE, trace)
    expect(rejected).toBe(n)
    expect(fixes).toHaveLength(FIX_COUNT - n)
  })
})

describe('positionJump — the cursor freeze', () => {
  const JUMP_FROM = 40
  const JUMP_TO = 50
  const M_PER_DEG = 111_194.9 // the test line runs due north, so lat/lng map straight to along/cross-track

  test('the jump lands AHEAD of the cursor and outside the band — which branch it tests', () => {
    // ⚠ Attribution, and it took a measurement to find: a teleport landing BEHIND the cursor is frozen
    // by the monotonic floor whether or not off-route rejection exists, so a test written on a backward
    // jump passes with the rejection deleted. Forward + outside the band leaves exactly one guard that
    // can be holding the cursor, which is what makes the next test mean what it says.
    const clean = cleanTrace()
    const trace = positionJump(clean, { seed: 2, startSec: JUMP_FROM, endSec: JUMP_TO })
    const aheadM = (trace[45]!.coords.latitude - clean[JUMP_FROM - 1]!.coords.latitude) * M_PER_DEG
    const offRouteM = Math.abs(trace[45]!.coords.longitude) * M_PER_DEG
    expect(aheadM).toBeGreaterThan(200)
    expect(offRouteM).toBeGreaterThan(OFF_ROUTE_MAX_M)
  })

  test('an off-route fix does NOT advance alongM, and the drive recovers afterwards', () => {
    // Without off-route rejection the cursor walks forward on every fix however absurd, feeds the end
    // predicate, and the outro fires seconds into the drive — credit spent, nothing played.
    const clean = replayHeadless(LINE, cleanTrace()).fixes
    const trace = positionJump(cleanTrace(), { seed: 2, startSec: JUMP_FROM, endSec: JUMP_TO })
    const { fixes, rejected, ended } = replayHeadless(LINE, trace)

    expect(rejected).toBe(0) // still admitted by the ACCURACY gate — the cursor is what must reject it
    const held = fixes[JUMP_FROM - 1]!.alongM
    for (let i = JUMP_FROM; i < JUMP_TO; i++) expect(fixes[i]!.alongM).toBe(held)
    // The control moved over exactly that span, so the freeze is the fault's doing and not a flat route.
    expect(clean[JUMP_TO - 1]!.alongM).toBeGreaterThan(clean[JUMP_FROM - 1]!.alongM)
    // Rejoining the route inside the projection window simply resumes — freezing is a pause, not a stall.
    expect(fixes[JUMP_TO]!.alongM).toBeGreaterThan(held)
    expect(ended).toBe(true)
  })

  test('the emitted fix keeps its TELEPORTED position — only the projection is held back', () => {
    // alongM freezes but lat/lng pass through raw, because triggering keys on raw proximity to a stop.
    // A jumped fix must therefore be far from every stop, not silently snapped back onto the road.
    const trace = positionJump(cleanTrace(), { seed: 2, startSec: JUMP_FROM, endSec: JUMP_TO })
    const { fixes } = replayHeadless(LINE, trace)
    expect(apartM(trace[45]!, cleanTrace()[45]!)).toBeGreaterThan(1000)
    expect(fixes[45]!.lng).toBe(trace[45]!.coords.longitude)
  })
})

describe('reorderTimestamps — fixes delivered out of order', () => {
  test('swaps delivery order without inventing, dropping or rewriting a fix', () => {
    const clean = cleanTrace()
    const trace = reorderTimestamps(clean, { seed: 9, swaps: 3 })
    expect(trace).toHaveLength(FIX_COUNT)
    let inversions = 0
    for (let i = 1; i < trace.length; i++) {
      if (trace[i]!.timestamp < trace[i - 1]!.timestamp) inversions++
    }
    expect(inversions).toBe(3) // non-overlapping pairs, so the count is exact
    // Same fixes, same clocks — only the order changed.
    const byTime = [...trace].sort((a, b) => a.timestamp - b.timestamp)
    expect(byTime).toEqual(clean)
  })

  test('the monotonic cursor ABSORBS it — out-of-order delivery can never rewind the drive', () => {
    // This is the safety property. A cursor that took the nearest vertex without the monotonic floor
    // would step backwards here, dragging the progress dot back and starving the end predicate.
    const { fixes, ended } = replayHeadless(LINE, reorderTimestamps(cleanTrace(), { seed: 9, swaps: 3 }))
    for (let i = 1; i < fixes.length; i++) {
      expect(fixes[i]!.alongM).toBeGreaterThanOrEqual(fixes[i - 1]!.alongM)
    }
    expect(ended).toBe(true)
  })

  test('⚠ tSec CAN come out negative when the first pair is swapped', () => {
    // Documented, not endorsed: tSec is measured from the first ADMITTED fix and is reporting-only
    // (audit #951), so a late-arriving first fix hands the consumer a negative one. This test is the
    // alarm for the day something starts keying on tSec being monotonic — pacing, a stall ladder, an
    // analytics duration. Then this is a bug and the mapper has to clamp it.
    const { fixes } = replayHeadless(LINE, reorderTimestamps(cleanTrace(), { seed: 9, swaps: 1, endSec: 2 }))
    expect(fixes[0]!.tSec).toBe(0)
    expect(fixes[1]!.tSec).toBeLessThan(0)
  })
})

describe('determinism — a fault trace that cannot be re-run is not a fixture', () => {
  // ⚠ The whole harness rests on this: the parameter sweep re-runs ONE trace against many trigger
  // radii, and a regression fixture must reproduce byte-for-byte on another machine. A single
  // Math.random() anywhere in gps-fault.ts turns every number the sweep prints into noise.
  const seeded: [string, (trace: RawFix[], seed: number) => RawFix[]][] = [
    ['canyonMultipath', (t, seed) => canyonMultipath(t, { seed })],
    ['coldStart', (t, seed) => coldStart(t, { seed, count: 6 })],
    ['iosSentinels', (t, seed) => iosSentinels(t, { seed, fraction: 0.5 })],
    ['positionJump', (t, seed) => positionJump(t, { seed, startSec: 10, endSec: 20 })],
    ['reorderTimestamps', (t, seed) => reorderTimestamps(t, { seed, swaps: 4 })],
  ]

  for (const [name, apply] of seeded) {
    test(`${name} is identical for the same seed and different for another`, () => {
      const trace = cleanTrace()
      expect(apply(trace, 7)).toEqual(apply(trace, 7))
      expect(apply(trace, 8)).not.toEqual(apply(trace, 7))
    })
  }

  test('dropout is seedless by construction — the same window always removes the same fixes', () => {
    const trace = cleanTrace()
    expect(dropout(trace, { startSec: 5, endSec: 9 })).toEqual(dropout(trace, { startSec: 5, endSec: 9 }))
  })
})

describe('purity — the input trace survives every fault untouched', () => {
  test('no fault mutates the array it was given or the fixes inside it', () => {
    // Faults chain, and a shared harness trace is reused across a sweep's hundreds of runs. One in-place
    // write would make run #2 a degradation of run #1's output — silently, and never reproducibly.
    const trace = cleanTrace()
    const before = structuredClone(trace)
    canyonMultipath(trace, { seed: 1 })
    dropout(trace, { startSec: 1, endSec: 4 })
    coldStart(trace, { seed: 1 })
    iosSentinels(trace, { seed: 1, fraction: 1, fields: ['speed', 'heading', 'accuracy'] })
    positionJump(trace, { seed: 1, startSec: 1, endSec: 4 })
    reorderTimestamps(trace, { seed: 1, swaps: 5 })
    expect(trace).toEqual(before)
  })
})

describe('degrade — composition', () => {
  test('applies faults left to right', () => {
    const trace = cleanTrace()
    const chained = degrade(trace, [
      (t) => canyonMultipath(t, { seed: 4 }),
      (t) => dropout(t, { startSec: 10, endSec: 20 }),
    ])
    expect(chained).toEqual(dropout(canyonMultipath(trace, { seed: 4 }), { startSec: 10, endSec: 20 }))
    expect(chained).toHaveLength(FIX_COUNT - 10)
  })

  test('⚠ a speed sentinel INSIDE a canyon is rejected — an interaction neither fault causes alone', () => {
    // A -1 speed sanitises to 0, which collapses the accuracy ceiling back to its floor, which throws
    // away a canyon-band fix that either fault alone leaves admitted. Real, and the reason a composed
    // run's rejection count must never be read as a canyon result. (It is also the honest shape of a
    // canyon: iOS drops course/speed exactly where the fix quality drops.)
    const trace = cleanTrace()
    expect(replayHeadless(LINE, canyonMultipath(trace, { seed: 4 })).rejected).toBe(0)
    expect(replayHeadless(LINE, iosSentinels(trace, { seed: 6, fraction: 0.4, fields: ['speed'] })).rejected).toBe(0)

    const composed = degrade(trace, [
      (t) => canyonMultipath(t, { seed: 4 }),
      (t) => iosSentinels(t, { seed: 6, fraction: 0.4, fields: ['speed'] }),
    ])
    const sentinels = composed.filter((raw) => raw.coords.speed === -1).length
    expect(sentinels).toBeGreaterThan(0)
    expect(replayHeadless(LINE, composed).rejected).toBe(sentinels)
  })
})
