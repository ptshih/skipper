// The live mapping pipeline + the replay sources, under test for the first time.
//
// ⚠ Why this file is a big deal rather than routine coverage: until `createFixMapper` was extracted,
// EVERY line it tests lived inside `liveSource`, behind `import * as Location from 'expo-location'` —
// structurally unreachable by `bun test`, and skipped by every simulated drive. The accuracy gate, the
// iOS -1 sentinels, the monotonic cursor and the end predicate are where the field-confirmed failures
// have been, and this is the first harness that can drive them. docs/designs/desk-drive-harness.md.
import { describe, expect, test } from 'bun:test'
import type { LngLat } from '@skipper/engine'
import { createFixMapper, MAX_FIX_ACCURACY_M, type RawFix } from './gps-util'
import { replayHeadless, simulatedSource } from './gps-source'

// A due-north straight line from (0,0), ~11.1 m per 0.0001° of latitude. 201 vertices ≈ 2.2 km.
const LINE: LngLat[] = Array.from({ length: 201 }, (_, i) => [0, i * 0.0001])
const END = LINE[LINE.length - 1]!

/** A clean fix at a given vertex index, with sane accuracy/speed/heading unless overridden. */
function fixAt(i: number, over: Partial<RawFix['coords']> & { timestamp?: number } = {}): RawFix {
  const [lng, lat] = LINE[Math.min(i, LINE.length - 1)]!
  const { timestamp, ...coords } = over
  return {
    coords: { latitude: lat, longitude: lng, accuracy: 5, speed: 20, heading: 0, ...coords },
    timestamp: timestamp ?? 1_000_000 + i * 1000,
  }
}

describe('createFixMapper — the accuracy gate every live fix passes', () => {
  test('admits a clean fix and emits a GpsFix', () => {
    const out: number[] = []
    const accept = createFixMapper(LINE, { onFix: (f) => out.push(f.alongM) })
    expect(accept(fixAt(0))).toBe(true)
    expect(out).toHaveLength(1)
  })

  test('REJECTS an unsettled acquisition fix (~1000 m) and emits nothing', () => {
    const out: unknown[] = []
    const accept = createFixMapper(LINE, { onFix: (f) => out.push(f) })
    // speed 0 → ceiling is the bare MAX_FIX_ACCURACY_M floor.
    expect(accept(fixAt(0, { accuracy: 1000, speed: 0 }))).toBe(false)
    expect(out).toHaveLength(0)
  })

  test('the gate LOOSENS with speed — a canyon-noisy fix drives triggering rather than failing closed', () => {
    // At 30 m/s the ceiling is speed*12*0.5 = 180 m, so a 120 m canyon fix must be ADMITTED.
    // This is the audit-#9 regression: a gate without the speed term rejects every fix in a canyon
    // and the drive silently never fires a stop.
    const accept = createFixMapper(LINE, { onFix: () => {} })
    expect(accept(fixAt(0, { accuracy: 120, speed: 30 }))).toBe(true)
    // ...and the same fix at rest is still rejected.
    const atRest = createFixMapper(LINE, { onFix: () => {} })
    expect(atRest(fixAt(0, { accuracy: 120, speed: 0 }))).toBe(false)
  })

  test('rejects the iOS -1 accuracy sentinel', () => {
    const accept = createFixMapper(LINE, { onFix: () => {} })
    expect(accept(fixAt(0, { accuracy: -1 }))).toBe(false)
  })

  test('admits a null accuracy (unknown, rare — iOS always reports one)', () => {
    const accept = createFixMapper(LINE, { onFix: () => {} })
    expect(accept(fixAt(0, { accuracy: null }))).toBe(true)
  })

  test('a fix exactly ON the floor is admitted; one past it is not', () => {
    const ok = createFixMapper(LINE, { onFix: () => {} })
    expect(ok(fixAt(0, { accuracy: MAX_FIX_ACCURACY_M, speed: 0 }))).toBe(true)
    const bad = createFixMapper(LINE, { onFix: () => {} })
    expect(bad(fixAt(0, { accuracy: MAX_FIX_ACCURACY_M + 0.1, speed: 0 }))).toBe(false)
  })
})

describe('createFixMapper — the iOS -1 sentinels reach the engine correctly', () => {
  test('speed -1 is sanitised to 0 (a sane "unknown speed")', () => {
    let speedMps = -99
    const accept = createFixMapper(LINE, { onFix: (f) => (speedMps = f.speedMps) })
    accept(fixAt(0, { speed: -1, accuracy: 5 }))
    expect(speedMps).toBe(0)
  })

  test('⚠ heading -1 passes through RAW, NOT sanitised — the field-confirmed zero-fire bug', () => {
    // saneNonNeg(-1) would be 0, which reads as a REAL due-north heading and gates out every stop the
    // car is not driving north toward. The engine must receive a NEGATIVE heading so it skips the gate.
    let headingDeg = 999
    const accept = createFixMapper(LINE, { onFix: (f) => (headingDeg = f.headingDeg) })
    accept(fixAt(0, { heading: -1 }))
    expect(headingDeg).toBe(-1)
    expect(headingDeg).toBeLessThan(0)
  })

  test('a null heading also arrives negative (unknown), never 0', () => {
    let headingDeg = 999
    const accept = createFixMapper(LINE, { onFix: (f) => (headingDeg = f.headingDeg) })
    accept(fixAt(0, { heading: null }))
    expect(headingDeg).toBe(-1)
  })
})

describe('createFixMapper — tSec is measured from the FIRST ADMITTED fix', () => {
  test('the clock starts at the first admitted fix, not the first offered one', () => {
    const t: number[] = []
    const accept = createFixMapper(LINE, { onFix: (f) => t.push(f.tSec) })
    // Two rejected acquisition fixes 10 s before anything is admitted.
    accept(fixAt(0, { accuracy: 1000, speed: 0, timestamp: 1_000_000 }))
    accept(fixAt(0, { accuracy: 1000, speed: 0, timestamp: 1_005_000 }))
    accept(fixAt(0, { timestamp: 1_010_000 }))
    accept(fixAt(1, { timestamp: 1_012_000 }))
    expect(t).toEqual([0, 2])
  })
})

describe('createFixMapper — the monotonic projection cursor', () => {
  test('alongM advances as the route is walked', () => {
    const along: number[] = []
    const accept = createFixMapper(LINE, { onFix: (f) => along.push(f.alongM) })
    for (const i of [0, 10, 20, 30]) accept(fixAt(i))
    expect(along[0]).toBe(0)
    for (let i = 1; i < along.length; i++) expect(along[i]!).toBeGreaterThan(along[i - 1]!)
  })

  test('NEVER decreases — a backward fix holds position instead of rewinding the drive', () => {
    const along: number[] = []
    const accept = createFixMapper(LINE, { onFix: (f) => along.push(f.alongM) })
    accept(fixAt(50))
    accept(fixAt(10)) // a return-leg-style fix behind the cursor
    expect(along[1]).toBeGreaterThanOrEqual(along[0]!)
  })

  test('an OFF-ROUTE fix freezes the cursor rather than snapping to the least-far vertex', () => {
    // The App-Review-in-Cupertino bug: without off-route rejection the cursor walks forward on every
    // fix, feeds the end predicate, and fires the outro in seconds — drive over, credit spent, silence.
    const along: number[] = []
    const accept = createFixMapper(LINE, { onFix: (f) => along.push(f.alongM) })
    accept(fixAt(5))
    accept({ coords: { latitude: 37.33, longitude: -122.03, accuracy: 5, speed: 20, heading: 0 }, timestamp: 2_000_000 })
    expect(along[1]).toBe(along[0]!)
  })
})

describe('createFixMapper — the end predicate', () => {
  test('fires onEnd exactly once when the route end is reached', () => {
    let ends = 0
    const accept = createFixMapper(LINE, { onFix: () => {}, onEnd: () => ends++ })
    for (let i = 0; i < LINE.length; i++) accept(fixAt(i))
    expect(ends).toBe(1)
    // Driving PAST the destination must not re-fire it.
    accept({ coords: { latitude: END[1] + 0.001, longitude: END[0], accuracy: 5, speed: 20, heading: 0 }, timestamp: 9_000_000 })
    expect(ends).toBe(1)
  })

  test('does NOT fire at the start of the route', () => {
    let ends = 0
    const accept = createFixMapper(LINE, { onFix: () => {}, onEnd: () => ends++ })
    for (const i of [0, 1, 2, 3]) accept(fixAt(i))
    expect(ends).toBe(0)
  })

  test('a trace that stops short never completes the drive — and that is correct', () => {
    // The replay sources deliberately do NOT synthesise an end when the stream runs dry: the live path
    // has no such event, it just stops hearing from the radio. A short trace must reproduce that.
    const short = Array.from({ length: 50 }, (_, i) => fixAt(i))
    const { ended, fixes } = replayHeadless(LINE, short)
    expect(fixes).toHaveLength(50)
    expect(ended).toBe(false)
  })
})

describe('replayHeadless — the harness form', () => {
  test('drives a whole trace through the real pipeline and reports what the gate dropped', () => {
    const trace = [
      fixAt(0, { accuracy: 1000, speed: 0 }), // cold start, rejected
      fixAt(0, { accuracy: 1000, speed: 0 }), // rejected
      ...Array.from({ length: LINE.length }, (_, i) => fixAt(i)),
    ]
    const { fixes, rejected, ended } = replayHeadless(LINE, trace)
    expect(rejected).toBe(2)
    expect(fixes).toHaveLength(LINE.length)
    expect(ended).toBe(true)
  })

  test('a trace of nothing but rejected fixes yields a drive that never moves — the zero-fire shape', () => {
    const trace = Array.from({ length: 100 }, (_, i) => fixAt(i, { accuracy: 1000, speed: 0 }))
    const { fixes, rejected, ended } = replayHeadless(LINE, trace)
    expect(fixes).toHaveLength(0)
    expect(rejected).toBe(100)
    expect(ended).toBe(false)
  })
})

// ── The ADAPTIVE sim time scale ──────────────────────────────────────────────
// The road can be compressed; AUDIO cannot. At a constant 8× every clip needs 8× as much drive to
// finish as it would in the car, so the fire-queue backs up a stop at a time and narration drifts
// arbitrarily far behind the map — the "narrations never finish" report. Break-even is (gap between
// stops ÷ clip length), ≈2.8× on a measured Tahoe drive, so lowering the constant only slows the
// divergence. The fix is a scale that is 1 while a clip plays and fast only on the quiet road.
//
// ⚠ What makes that possible is that the pump re-reads the rate BEFORE EVERY TICK. A captured number
// reads it once and no later change can ever take effect — the whole feature would silently no-op
// while every other assertion here still passed. That is what the first test pins.
describe('simulatedSource — the adaptive time scale', () => {
  const LINE: LngLat[] = [
    [-120.0, 39.0],
    [-119.99, 39.0],
    [-119.98, 39.0],
  ]

  /** Collect up to `n` fixes, recording the wall-clock ms between them. */
  const collect = (source: ReturnType<typeof simulatedSource>, n: number) =>
    new Promise<{ count: number; gaps: number[] }>((resolve) => {
      const gaps: number[] = []
      let count = 0
      let last = Date.now()
      const sub = source(
        () => {
          const now = Date.now()
          if (count > 0) gaps.push(now - last)
          last = now
          count++
          if (count >= n) {
            sub.stop()
            resolve({ count, gaps })
          }
        },
        () => resolve({ count, gaps }),
      )
    })

  test('re-reads the scale on EVERY tick, so a mid-drive change can take effect', async () => {
    let reads = 0
    const src = simulatedSource(LINE, {
      mph: 600,
      tickHz: 100,
      timeScale: () => {
        reads++
        return 1000 // clamps dt to the 1ms floor — keeps the test quick
      },
    })
    const { count } = await collect(src, 6)
    expect(count).toBe(6)
    // A captured number would have been read exactly once. This is the regression that would make the
    // whole adaptive path a silent no-op.
    expect(reads).toBeGreaterThan(1)
  })

  test('a plain number still works — replaySource and the non-fast sim both pass one', async () => {
    const src = simulatedSource(LINE, { mph: 600, tickHz: 100, timeScale: 1000 })
    const { count } = await collect(src, 5)
    expect(count).toBe(5)
  })

  test('slowing the scale mid-stream actually slows delivery', async () => {
    // Fast until the 3rd fix, then ~20ms/tick — the shape of "the skipper started talking".
    let emitted = 0
    const src = simulatedSource(LINE, {
      mph: 600,
      tickHz: 100,
      timeScale: () => (emitted++ < 3 ? 1000 : 0.5),
    })
    const { gaps } = await collect(src, 6)
    // The last gap is taken under the slow scale; the first under the fast one. A generous threshold —
    // the ratio here is ~20:1, so this is not a tight timing assertion.
    expect(gaps[gaps.length - 1]!).toBeGreaterThan(10)
    expect(gaps[0]!).toBeLessThan(10)
  })
})
