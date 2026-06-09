import { describe, expect, test } from 'bun:test'
import { evaluateDiversity } from '../src/eval/diversity'
import { charmEvaluator, charmToStopEvals, type CharmJudge, type CharmVerdict } from '../src/eval/charm'
import { personaForRegion } from '../src/persona'
import type { LintInput } from '../src/pipeline/lint'

const KIT = personaForRegion('lake-tahoe').kit

describe('evaluateDiversity — deterministic cross-stop lint → advisory evals', () => {
  test('flags a stop with a banned reveal wind-up; passes a clean stop', () => {
    const inputs: LintInput[] = [
      { seq: 0, stopType: 'story', script: 'The lake sits quiet this morning, smooth as glass off to the right.' },
      { seq: 1, stopType: 'story', script: "Well, here's the thing about this old town, folks." },
    ]
    const evals = evaluateDiversity(inputs, KIT)
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
    const evals = evaluateDiversity(inputs, KIT)
    expect(evals).toHaveLength(2)
    expect(evals.every((e) => e.dimension === 'diversity')).toBe(true)
    expect(evals.every((e) => e.pass)).toBe(true)
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
