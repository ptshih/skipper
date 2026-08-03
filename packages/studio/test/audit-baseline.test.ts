import { describe, expect, test } from 'bun:test'
import {
  AUDIT_BASELINE_VERSION,
  MATERIAL_TAIL_DELTA_DB,
  collapseRate,
  diffAudits,
  parseBaseline,
  type AuditBaseline,
  type AuditClipRecord,
} from '../src/pipeline/audit-baseline'
import { STRUCTURAL_RETAKE_EPSILON_DB, TAIL_COLLAPSE_DB } from '../src/pipeline/tail'

/** A measured clip; `drop` null means the probe was skipped (sub-24s) or the decode missed. */
const clip = (poiId: string, drop: number | null, over: Partial<AuditClipRecord> = {}): AuditClipRecord => ({
  poiId,
  name: `place ${poiId}`,
  tailDropDb: drop,
  integratedLufs: -14,
  truePeakDb: -1,
  leadingMs: 0,
  unmeasured: false,
  ...over,
})

const baselineOf = (clips: AuditClipRecord[], tailCollapseDb = TAIL_COLLAPSE_DB): AuditBaseline => ({
  version: AUDIT_BASELINE_VERSION,
  capturedAt: '2026-08-03T00:00:00.000Z',
  scope: 'region=lake-tahoe',
  tailCollapseDb,
  clips,
})

describe('diffAudits — classification', () => {
  test('a clip that crosses the band is newlyCollapsed, not merely worsened', () => {
    const d = diffAudits(baselineOf([clip('a', 1)]), [clip('a', 9)], TAIL_COLLAPSE_DB)
    expect(d.newlyCollapsed.map((m) => m.poiId)).toEqual(['a'])
    expect(d.worsened).toHaveLength(0)
    expect(d.collapsedBefore).toBe(0)
    expect(d.collapsedAfter).toBe(1)
  })

  test('a clip that falls back under the band is cleared', () => {
    const d = diffAudits(baselineOf([clip('a', 9)]), [clip('a', 1)], TAIL_COLLAPSE_DB)
    expect(d.cleared.map((m) => m.poiId)).toEqual(['a'])
    expect(d.collapsedBefore).toBe(1)
    expect(d.collapsedAfter).toBe(0)
  })

  test('flagged on both sides is stillCollapsed — counted in both rates, in neither mover list', () => {
    const d = diffAudits(baselineOf([clip('a', 5)]), [clip('a', 8)], TAIL_COLLAPSE_DB)
    expect(d.stillCollapsed.map((m) => m.poiId)).toEqual(['a'])
    expect(d.newlyCollapsed).toHaveLength(0)
    expect(d.worsened).toHaveLength(0)
    expect(d.collapsedBefore).toBe(1)
    expect(d.collapsedAfter).toBe(1)
  })

  test('unflagged drift beyond the epsilon is worsened / improved; inside it is neither', () => {
    const worse = diffAudits(baselineOf([clip('a', 0)]), [clip('a', MATERIAL_TAIL_DELTA_DB)], TAIL_COLLAPSE_DB)
    expect(worse.worsened.map((m) => m.poiId)).toEqual(['a'])

    const better = diffAudits(baselineOf([clip('a', MATERIAL_TAIL_DELTA_DB)]), [clip('a', 0)], TAIL_COLLAPSE_DB)
    expect(better.improved.map((m) => m.poiId)).toEqual(['a'])

    const noise = diffAudits(baselineOf([clip('a', 1)]), [clip('a', 1 + MATERIAL_TAIL_DELTA_DB / 2)], TAIL_COLLAPSE_DB)
    expect(noise.worsened).toHaveLength(0)
    expect(noise.improved).toHaveLength(0)
    expect(noise.comparable).toBe(1)
  })

  test('the noise floor is tail.ts’s retake epsilon, not a second copy of the number', () => {
    expect(MATERIAL_TAIL_DELTA_DB).toBe(STRUCTURAL_RETAKE_EPSILON_DB)
  })
})

describe('diffAudits — the rates are computed on the INTERSECTION', () => {
  // The trap this pins, and the shape is chosen so BOTH ways of getting it wrong are caught: the
  // baseline saw 2 places, 1 collapsed (50%); the current run saw 3, 2 collapsed. Counting the
  // numerator over the whole current queue reads 2/2 → 100%; taking the denominator from it reads
  // 1/3 → 33%. Only the intersection says what actually happened on the shared places: unchanged.
  const before = baselineOf([clip('a', 9), clip('b', 1)])
  const after = [clip('a', 9), clip('b', 1), clip('c', 9)]

  test('a widened current queue moves neither the numerator nor the denominator', () => {
    const d = diffAudits(before, after, TAIL_COLLAPSE_DB)
    expect(d.comparable).toBe(2)
    expect(d.collapsedBefore).toBe(1)
    expect(d.collapsedAfter).toBe(1)
    expect(collapseRate(d.collapsedAfter, d.comparable)).toBe(50)
  })

  test('the clips outside the intersection are NAMED, in both directions', () => {
    const d = diffAudits(baselineOf([clip('a', 9), clip('gone', 1)]), [clip('a', 9), clip('new', 1)], TAIL_COLLAPSE_DB)
    expect(d.comparable).toBe(1)
    expect(d.excluded).toEqual([
      { poiId: 'gone', name: 'place gone', reason: 'absent-from-current' },
      { poiId: 'new', name: 'place new', reason: 'absent-from-baseline' },
    ])
  })
})

describe('diffAudits — an unmeasured clip is not evidence', () => {
  test('unmeasured on either side leaves the comparison and is named', () => {
    const d = diffAudits(
      baselineOf([clip('a', null, { unmeasured: true }), clip('b', 9)]),
      [clip('a', 9), clip('b', null, { unmeasured: true })],
      TAIL_COLLAPSE_DB,
    )
    expect(d.comparable).toBe(0)
    expect(d.collapsedBefore).toBe(0)
    expect(d.collapsedAfter).toBe(0)
    expect(d.excluded.map((e) => e.reason).sort()).toEqual(['unmeasured-after', 'unmeasured-before'])
  })

  test('a null tail reading (sub-24s clip) is excluded even when the clip measured fine otherwise', () => {
    const d = diffAudits(baselineOf([clip('a', null)]), [clip('a', 9)], TAIL_COLLAPSE_DB)
    expect(d.comparable).toBe(0)
    expect(d.excluded[0]?.reason).toBe('unmeasured-before')
  })
})

describe('diffAudits — one threshold, applied to both sides', () => {
  test('the CURRENT band classifies the baseline too, and a moved band is flagged', () => {
    // Recorded at 4 dB, re-read at 8: the 5 dB clip was flagged then and must not be flagged now.
    const d = diffAudits(baselineOf([clip('a', 5)], 4), [clip('a', 5)], 8)
    expect(d.collapsedBefore).toBe(0)
    expect(d.collapsedAfter).toBe(0)
    expect(d.thresholdMoved).toBe(true)
  })

  test('an unchanged band is not flagged as moved', () => {
    expect(diffAudits(baselineOf([clip('a', 1)], 4), [clip('a', 1)], 4).thresholdMoved).toBe(false)
  })
})

describe('collapseRate', () => {
  test('an empty comparison has no rate and must not read as 0% collapse', () => {
    const d = diffAudits(baselineOf([]), [], TAIL_COLLAPSE_DB)
    expect(d.comparable).toBe(0)
    expect(collapseRate(d.collapsedAfter, d.comparable)).toBe(0) // callers gate on `comparable`
  })

  test('percentages, not fractions', () => {
    expect(collapseRate(1, 4)).toBe(25)
  })
})

describe('parseBaseline', () => {
  test('round-trips a captured baseline', () => {
    const b = baselineOf([clip('a', 3.5)])
    expect(parseBaseline(JSON.stringify(b))).toEqual(b)
  })

  test('refuses a version it cannot read rather than diffing mismatched fields', () => {
    const stale = JSON.stringify({ ...baselineOf([clip('a', 1)]), version: AUDIT_BASELINE_VERSION + 1 })
    expect(() => parseBaseline(stale)).toThrow(/version/)
  })

  test('refuses malformed input', () => {
    expect(() => parseBaseline('not json')).toThrow(/valid JSON/)
    expect(() => parseBaseline('[]')).toThrow(/version/)
    expect(() => parseBaseline(JSON.stringify({ version: AUDIT_BASELINE_VERSION }))).toThrow(/clips/)
    expect(() =>
      parseBaseline(JSON.stringify({ version: AUDIT_BASELINE_VERSION, clips: [] })),
    ).toThrow(/tailCollapseDb/)
  })
})
