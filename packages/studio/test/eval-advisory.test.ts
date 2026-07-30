import { describe, expect, test } from 'bun:test'
import { evaluateDiversity, evaluateDiversityAgainst } from '../src/eval/diversity'
import { charmEvaluator, charmToStopEvals, type CharmJudge, type CharmVerdict } from '../src/eval/charm'
import type { LintInput } from '../src/pipeline/lint'

describe('evaluateDiversity — deterministic cross-stop lint → advisory evals', () => {
  test('flags a stop with a banned reveal wind-up; passes a clean stop', () => {
    const inputs: LintInput[] = [
      { seq: 0, stopType: 'story', script: 'The lake sits quiet this morning, smooth as glass off to the right.' },
      { seq: 1, stopType: 'story', script: "Well, here's the thing about this old town, folks." },
    ]
    const evals = evaluateDiversity(inputs)
    const bySeq = new Map(evals.map((e) => [e.seq, e]))
    expect(bySeq.get(0)!.pass).toBe(true)
    expect(bySeq.get(0)!.dimension).toBe('diversity')
    expect(bySeq.get(1)!.pass).toBe(false)
    expect(bySeq.get(1)!.findings.length).toBeGreaterThan(0)
    // the lint's `avoid` instructions ride along as detail (for the evaluator-optimizer)
    expect(Array.isArray(bySeq.get(1)!.detail)).toBe(true)
  })

  test('emits one eval per input stop (clean tour → all pass)', () => {
    const inputs: LintInput[] = [
      { seq: 0, stopType: 'story', script: 'A quiet cove opens up on the left, the water gone glassy and still.' },
      { seq: 1, stopType: 'scenic', script: 'Pines crowd the shoulder here; the light comes down green and easy.' },
    ]
    const evals = evaluateDiversity(inputs)
    expect(evals).toHaveLength(2)
    expect(evals.every((e) => e.dimension === 'diversity')).toBe(true)
    expect(evals.every((e) => e.pass)).toBe(true)
  })
})

// The V2 generator narrates ONE telling per POI, so it used to call evaluateDiversity([oneStop]).
// With n=1 every cross-clip rule is a no-op by arithmetic — which is how a single geology sentence
// reached 17 released Tahoe clips without anything flagging it. These lock the fix in: the bug was
// SILENT, so only an executable check keeps it fixed.
describe('evaluateDiversityAgainst — a take scored against the region corpus', () => {
  const REPEAT = 'the whole shebang' // a STOCK_PHRASES entry
  const corpus = [
    `The mill up here burned twice and they rebuilt ${REPEAT} both times, stubborn as anything.`,
    'A quiet cove opens up on the left, the water gone glassy and still under the pines.',
  ]

  test('a single-element call CANNOT see a corpus repeat — the original bug, pinned', () => {
    const solo = evaluateDiversity([
      { seq: 7, stopType: 'story', script: `They hauled ${REPEAT} across the pass by sled.` },
    ])
    expect(solo).toHaveLength(1)
    expect(solo[0]!.pass).toBe(true) // clean on its own, and that was the whole problem
  })

  test('the same take IS flagged once the region corpus is in scope', () => {
    const evals = evaluateDiversityAgainst(
      { seq: 7, stopType: 'story', script: `They hauled ${REPEAT} across the pass by sled.` },
      corpus,
    )
    expect(evals).toHaveLength(1) // only the take under test; context evals are discarded
    expect(evals[0]!.seq).toBe(7)
    expect(evals[0]!.pass).toBe(false)
    expect(evals[0]!.findings.join(' ')).toContain(REPEAT)
    expect(evals[0]!.detail).toBeDefined() // the `avoid` note that drives the retake
  })

  test('ORDER: the corpus is never blamed for the new take — the take under test goes last', () => {
    // If `current` were placed first, lintScripts' keep-the-first rule would flag the CORPUS and let
    // the repeating take pass clean — a silent inversion that still returns "a finding".
    const evals = evaluateDiversityAgainst(
      { seq: 0, stopType: 'story', script: `They hauled ${REPEAT} across the pass by sled.` },
      corpus,
    )
    expect(evals.every((e) => e.seq >= 0)).toBe(true) // no synthetic context seq leaks out
    expect(evals[0]!.pass).toBe(false) // seq 0 is the NEW take, and it is the one flagged
  })

  test('a take that shares nothing with the corpus still passes', () => {
    const evals = evaluateDiversityAgainst(
      { seq: 7, stopType: 'story', script: 'Two brothers ran a ferry off this point until the ice took it.' },
      corpus,
    )
    expect(evals[0]!.pass).toBe(true)
  })

  test('empty context degrades to the plain per-stop lint (fresh region, nothing generated yet)', () => {
    const evals = evaluateDiversityAgainst(
      { seq: 3, stopType: 'story', script: "Well, here's the thing about this old town, folks." },
      [],
    )
    expect(evals).toHaveLength(1)
    expect(evals[0]!.pass).toBe(false) // per-stop rules (banned wind-up) still fire with no context
  })
})

describe('charm — verdict → advisory evals (injectable judge, no API)', () => {
  const verdict: CharmVerdict = {
    stops: [
      { seq: 0, charm: 8, best: 'the pun lands', sag: '—' },
      { seq: 1, charm: 3, best: 'one warm line', sag: 'reads like an encyclopedia with a hat on' },
    ],
    overall: 6,
    verdict: 'good bones, one stop drags',
    recommendation: 'tune',
    weakestStops: [1],
    biggestRisk: 'sameness',
  }

  test('charmToStopEvals: >=5 passes, <5 fails with the sag as a finding', () => {
    const evals = charmToStopEvals(verdict)
    const bySeq = new Map(evals.map((e) => [e.seq, e]))
    expect(bySeq.get(0)!.pass).toBe(true)
    expect(bySeq.get(0)!.score).toBeCloseTo(0.8, 5)
    expect(bySeq.get(0)!.dimension).toBe('charm')
    expect(bySeq.get(1)!.pass).toBe(false)
    expect(bySeq.get(1)!.score).toBeCloseTo(0.3, 5)
    expect(bySeq.get(1)!.findings[0]).toContain('encyclopedia')
  })

  test('charmEvaluator runs through an injected judge (advisory: never gates)', async () => {
    const fakeJudge: CharmJudge = async () => verdict
    const evals = await charmEvaluator(
      [
        { seq: 0, stopType: 'story', name: 'A', script: 'x' },
        { seq: 1, stopType: 'story', name: 'B', script: 'y' },
      ],
      fakeJudge,
    )
    expect(evals).toHaveLength(2)
    expect(evals.filter((e) => !e.pass)).toHaveLength(1)
  })
})
