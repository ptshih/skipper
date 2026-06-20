import { describe, expect, test } from 'bun:test'
import { estimateSpokenSeconds, evaluatePacing, PACING_OVERSHOOT_FACTOR } from '../src/eval/pacing'

/** A script of exactly n "words" — length is all that matters to the estimator. */
const words = (n: number): string => Array(n).fill('word').join(' ')

describe('estimateSpokenSeconds', () => {
  test('estimates from word count at the pipeline read pace (2.5 words/sec)', () => {
    expect(estimateSpokenSeconds(words(250))).toBe(100) // 250 / 2.5
    expect(estimateSpokenSeconds(words(150))).toBe(60)
  })

  test('is zero for an empty/whitespace script (no spurious 1-word count)', () => {
    expect(estimateSpokenSeconds('   ')).toBe(0)
    expect(estimateSpokenSeconds('')).toBe(0)
  })
})

describe('evaluatePacing', () => {
  test('passes a clip comfortably within its length band', () => {
    // landscape-ish band: 200 words = 80s, under the 100s max
    const e = evaluatePacing({ seq: 0, script: words(200), targetSeconds: 60, maxSeconds: 100 })
    expect(e.dimension).toBe('pacing')
    expect(e.pass).toBe(true)
    expect(e.score).toBe(1)
    expect(e.findings).toEqual([])
    expect(e.detail).toBeUndefined()
  })

  test('does NOT retake a clip slightly over max but within the jitter grace', () => {
    // max 100 → ceiling 110s; 270 words = 108s ≤ 110 → no flag
    const e = evaluatePacing({ seq: 1, script: words(270), targetSeconds: 60, maxSeconds: 100 })
    expect(e.pass).toBe(true)
    expect(e.findings).toEqual([])
  })

  test('flags a clip that sprawls past its max ceiling, with a directive retake note', () => {
    // story band max 180 → ceiling 198s; 600 words = 240s → flag
    const e = evaluatePacing({ seq: 3, script: words(600), targetSeconds: 90, maxSeconds: 180 })
    expect(e.pass).toBe(false)
    expect(e.score).toBeLessThan(1)
    expect(e.findings.length).toBe(1)
    expect(e.findings[0]).toContain('over the 180s ceiling')
    // The directive retake note rides as `detail` (a string[]) so optimize() feeds the instruction.
    expect(Array.isArray(e.detail)).toBe(true)
    expect((e.detail as string[]).length).toBe(1)
    expect((e.detail as string[])[0]).toContain('Cut it back')
  })

  test('never flags an UNDER-length clip — short-and-true is a win, not a defect', () => {
    // 20 words ≈ 8s, far under a 90s target: must NOT push padding
    const e = evaluatePacing({ seq: 0, script: words(20), targetSeconds: 90, maxSeconds: 180 })
    expect(e.pass).toBe(true)
    expect(e.findings).toEqual([])
    expect(e.detail).toBeUndefined()
  })

  test('the overshoot ceiling tracks the grace factor', () => {
    const max = 90 // town band
    const ceiling = Math.round(max * PACING_OVERSHOOT_FACTOR) // 99s → 247.5 words
    const justUnder = evaluatePacing({ seq: 0, script: words(Math.floor(ceiling * 2.5)), targetSeconds: 60, maxSeconds: max })
    const wellOver = evaluatePacing({ seq: 0, script: words(Math.ceil((ceiling + 20) * 2.5)), targetSeconds: 60, maxSeconds: max })
    expect(justUnder.pass).toBe(true)
    expect(wellOver.pass).toBe(false)
  })
})
