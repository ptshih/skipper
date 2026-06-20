import { describe, expect, test } from 'bun:test'
import type { LngLat } from '@skipper/engine'
import {
  accuracyCeilingM,
  accuracyOk,
  isReducedAccuracy,
  MAX_FIX_ACCURACY_M,
  projectForwardIndex,
  reachedRouteEnd,
  saneNonNeg,
} from './gps-util'

describe('saneNonNeg (iOS -1 speed/heading sentinel)', () => {
  test('clamps the iOS -1 sentinel + negatives to 0', () => {
    expect(saneNonNeg(-1)).toBe(0)
    expect(saneNonNeg(-0.5)).toBe(0)
  })
  test('clamps null/undefined to 0', () => {
    expect(saneNonNeg(null)).toBe(0)
    expect(saneNonNeg(undefined)).toBe(0)
  })
  test('passes a real non-negative value through unchanged', () => {
    expect(saneNonNeg(0)).toBe(0)
    expect(saneNonNeg(13.4)).toBe(13.4)
  })
})

describe('accuracyCeilingM / accuracyOk (the gate every live fix passes — audit #9)', () => {
  // These concrete values assume DEFAULT_TRIGGER.leadSeconds = 12, ACCURACY_LEAD_FRACTION = 0.5,
  // MAX_FIX_ACCURACY_M = 50 → ceiling = max(50, speed * 6). A change to any of those should fail
  // here LOUDLY (that's the point — this gate's silent regression is the field zero-fire bug).
  test('ceiling floors at MAX_FIX_ACCURACY_M when slow/stopped, then grows with speed', () => {
    expect(accuracyCeilingM(0)).toBe(MAX_FIX_ACCURACY_M) // 50
    expect(accuracyCeilingM(5)).toBe(50) // 5*6=30 < 50 → floor holds
    expect(accuracyCeilingM(10)).toBe(60) // 10*6=60 > 50
    expect(accuracyCeilingM(30)).toBe(180) // ~60 mph
  })

  test('null accuracy is admitted (unknown — rare; do not fail closed)', () => {
    expect(accuracyOk(null, 0)).toBe(true)
    expect(accuracyOk(undefined, 30)).toBe(true)
  })

  test('the iOS -1 (negative) accuracy sentinel is rejected', () => {
    expect(accuracyOk(-1, 30)).toBe(false)
  })

  test('a fix is admitted iff its accuracy is within the speed-aware ceiling', () => {
    expect(accuracyOk(50, 0)).toBe(true) // exactly the floor — admitted
    expect(accuracyOk(51, 0)).toBe(false) // just over the floor — rejected
    // The canyon case the speed-aware term exists for: a ~120 m fix at ~60 mph still DRIVES triggering.
    expect(accuracyOk(120, 30)).toBe(true) // 120 <= 180
    expect(accuracyOk(200, 30)).toBe(false) // an unsettled fix is still rejected
  })
})

describe('isReducedAccuracy (iOS Precise Location off — audit #499)', () => {
  test("only the literal 'reduced' is reduced", () => {
    expect(isReducedAccuracy('reduced')).toBe(true)
    expect(isReducedAccuracy('full')).toBe(false)
    expect(isReducedAccuracy(undefined)).toBe(false) // off iOS → never blocks sim/Android
    expect(isReducedAccuracy('approximate')).toBe(false) // a value-set drift must NOT read as reduced
  })
})

describe('projectForwardIndex (monotonic forward route projection — review #1/#10/#12)', () => {
  // A north-running polyline (increasing latitude); nearest vertex == closest latitude.
  const line: LngLat[] = [
    [0, 0],
    [0, 0.001],
    [0, 0.002],
    [0, 0.003],
    [0, 0.004],
    [0, 0.005],
  ]

  test('finds the nearest vertex ahead of the cursor', () => {
    expect(projectForwardIndex(line, 0, 0, 0.0031, 400)).toBe(3) // closest to lat 0.0031 is idx 3
    expect(projectForwardIndex(line, 1, 0, 0.0049, 400)).toBe(5)
  })

  test('NEVER returns below the cursor — a return-leg fix cannot snap the dot backward', () => {
    // Cursor already at 4; a fix back near idx 3 must stay >= 4 (monotonic), not jump to 3.
    expect(projectForwardIndex(line, 4, 0, 0.0031, 400)).toBe(4)
  })

  test('bounds the search to the window ahead (no O(n) full-polyline scan)', () => {
    // Window of 2 from cursor 0 only sees idx 0,1 — so a fix near idx 5 caps at the best within [0,2).
    expect(projectForwardIndex(line, 0, 0, 0.005, 2)).toBe(1)
  })
})

describe('reachedRouteEnd (live end-of-route detection — review #1, audit #332)', () => {
  const base = { alongM: 0, routeEndM: 1000, cursor: 0, polylineLen: 100, rawToEndM: 999, epsilonM: 25 }

  test('false mid-route', () => {
    expect(reachedRouteEnd(base)).toBe(false)
  })

  test('true once projected alongM is within epsilon of the end', () => {
    expect(reachedRouteEnd({ ...base, alongM: 980 })).toBe(true) // 980 >= 1000-25
    expect(reachedRouteEnd({ ...base, alongM: 970 })).toBe(false) // still short
  })

  test('true once the cursor reaches the last segment', () => {
    expect(reachedRouteEnd({ ...base, cursor: 98 })).toBe(true) // 98 >= 100-2
  })

  test('FALLBACK: raw distance within epsilon AND >50% covered completes a lagging cursor', () => {
    expect(reachedRouteEnd({ ...base, alongM: 600, rawToEndM: 10 })).toBe(true)
  })

  test('the >50% guard blocks a FALSE end at the start of an out-and-back (final vertex ≈ start)', () => {
    // Near the end vertex by raw distance, but barely underway — must NOT complete.
    expect(reachedRouteEnd({ ...base, alongM: 100, rawToEndM: 10 })).toBe(false)
  })

  test('a zero-length route never completes', () => {
    expect(reachedRouteEnd({ ...base, routeEndM: 0, alongM: 0, rawToEndM: 0 })).toBe(false)
  })
})
