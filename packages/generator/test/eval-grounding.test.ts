import { describe, expect, test } from 'bun:test'
import { evaluateGrounding, type ClaimDecomposer, type GroundingInput } from '../src/eval/grounding'
import { buildScorecard } from '../src/eval/scorecard'
import type { ClaimVerdict, StopEval } from '../src/eval/types'

const input = (over: Partial<GroundingInput> = {}): GroundingInput => ({
  seq: 0,
  stopType: 'story',
  placeName: 'Emerald Bay',
  script: 'some script',
  well: ['Emerald Bay is a bay on Lake Tahoe.'],
  region: 'Lake Tahoe',
  corridor: 'Emerald Bay Run',
  ...over,
})

/** A decomposer that returns whatever verdicts you hand it — no model call. */
const fake = (verdicts: ClaimVerdict[]): ClaimDecomposer => async () => verdicts

describe('evaluateGrounding — the gate scoring', () => {
  test('all grounded → pass, score 1, no findings', async () => {
    const e = await evaluateGrounding(
      input(),
      fake([
        { claim: 'it is a bay on Lake Tahoe', status: 'grounded', evidence: 'Emerald Bay is a bay...' },
        { claim: 'on Lake Tahoe', status: 'ambient', evidence: 'names the region' },
      ]),
    )
    expect(e.pass).toBe(true)
    expect(e.score).toBe(1)
    expect(e.findings).toHaveLength(0)
    expect(e.dimension).toBe('grounding')
  })

  test('one ungrounded among grounded → FAIL, fractional score, finding surfaced', async () => {
    const e = await evaluateGrounding(
      input({ seq: 3 }),
      fake([
        { claim: 'a bay on Lake Tahoe', status: 'grounded', evidence: 'sheet line' },
        { claim: 'one of the deepest spots on the lake', status: 'ungrounded', evidence: null },
        { claim: 'mountain mornings are cold', status: 'ambient', evidence: 'world knowledge' },
      ]),
    )
    expect(e.pass).toBe(false)
    expect(e.seq).toBe(3)
    expect(e.score).toBeCloseTo(2 / 3, 5) // 2 of 3 claims are clean
    expect(e.findings).toHaveLength(1)
    expect(e.findings[0]).toContain('one of the deepest spots')
  })

  test('no factual claims → pass, score 1 (a pure-delivery scenic stop)', async () => {
    const e = await evaluateGrounding(input({ stopType: 'scenic', placeName: undefined }), fake([]))
    expect(e.pass).toBe(true)
    expect(e.score).toBe(1)
  })

  test('a hedged invented fact is still ungrounded (the verdict drives the gate)', async () => {
    const e = await evaluateGrounding(
      input(),
      fake([{ claim: 'I bet a stagecoach came through here', status: 'ungrounded', evidence: null }]),
    )
    expect(e.pass).toBe(false)
    expect(e.score).toBe(0)
  })
})

describe('buildScorecard — rollup + the gate', () => {
  const groundingEval = (seq: number, pass: boolean, score: number): StopEval => ({
    seq,
    dimension: 'grounding',
    pass,
    score,
    findings: pass ? [] : ['ungrounded place-claim: "..."'],
  })
  const charmEval = (seq: number, pass: boolean): StopEval => ({
    seq,
    dimension: 'charm',
    pass,
    score: pass ? 1 : 0.4,
    findings: pass ? [] : ['flat closer'],
  })

  test('a grounding (GATE) failure fails the whole tour', () => {
    const card = buildScorecard({
      slug: 'emerald-bay-run',
      tourName: 'Emerald Bay',
      evaluatedAt: null,
      stops: [groundingEval(0, true, 1), groundingEval(1, false, 0.5), groundingEval(2, true, 1)],
    })
    expect(card.pass).toBe(false)
    const g = card.dimensions.find((d) => d.dimension === 'grounding')!
    expect(g.kind).toBe('gate')
    expect(g.stopsFailed).toBe(1)
    expect(g.stopsEvaluated).toBe(3)
    expect(g.score).toBeCloseTo((1 + 0.5 + 1) / 3, 5)
  })

  test('an ADVISORY (charm) failure does NOT fail the tour', () => {
    const card = buildScorecard({
      slug: 't',
      tourName: 'T',
      evaluatedAt: null,
      stops: [groundingEval(0, true, 1), charmEval(0, false), charmEval(1, false)],
    })
    expect(card.pass).toBe(true) // only gate dimensions block
    const charm = card.dimensions.find((d) => d.dimension === 'charm')!
    expect(charm.kind).toBe('advisory')
    expect(charm.pass).toBe(false)
    expect(charm.stopsFailed).toBe(2)
  })

  test('all gates clean → tour passes', () => {
    const card = buildScorecard({
      slug: 't',
      tourName: 'T',
      evaluatedAt: null,
      stops: [groundingEval(0, true, 1), groundingEval(1, true, 1)],
    })
    expect(card.pass).toBe(true)
  })
})
