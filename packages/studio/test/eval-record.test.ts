import { describe, expect, test } from 'bun:test'
import { buildScoreRows, dimensionRollupScore, type ClipIdentity } from '../src/eval/record'
import { buildScorecard } from '../src/eval/scorecard'
import type { StopEval } from '../src/eval/types'

// Two clips: clip 0 ships clean; clip 1 fails grounding (withheld).
const evals: StopEval[] = [
  { seq: 0, dimension: 'tts', pass: true, score: 1, findings: [] },
  { seq: 0, dimension: 'grounding', pass: true, score: 1, findings: [] },
  { seq: 1, dimension: 'tts', pass: true, score: 1, findings: [] },
  { seq: 1, dimension: 'grounding', pass: false, score: 0, findings: ['ungrounded place-claim: "the deepest cove on the lake"'] },
]
const card = buildScorecard({ slug: 'lake-tahoe', runName: 'generate_narrations', evaluatedAt: null, stops: evals })

const identity = new Map<number, ClipIdentity>([
  [0, { poiId: 'poi-a', qid: 'Q1', name: 'Emerald Bay', withheld: false }],
  [1, { poiId: 'poi-b', qid: 'Q2', name: 'Fannette Island', withheld: true }],
])

describe('buildScoreRows', () => {
  test('maps each StopEval to a poi-keyed row with the withheld flag denormalized', () => {
    const rows = buildScoreRows('run-1', card, identity)
    expect(rows.length).toBe(4)

    const withheldRows = rows.filter((r) => r.withheld)
    expect(withheldRows.every((r) => r.qid === 'Q2')).toBe(true)
    expect(withheldRows.length).toBe(2) // BOTH of clip 1's dimensions carry withheld=true

    const grounding1 = rows.find((r) => r.qid === 'Q2' && r.dimension === 'grounding')!
    expect(grounding1.poiId).toBe('poi-b')
    expect(grounding1.name).toBe('Fannette Island')
    expect(grounding1.pass).toBe(false)
    expect(grounding1.findings.length).toBe(1)
    expect(grounding1.source).toBe('judge')
  })

  test('a clip with no identity gets null keys and withheld=false', () => {
    const rows = buildScoreRows('run-1', card) // no identity map
    expect(rows.every((r) => r.poiId === null && r.qid === null && !r.withheld)).toBe(true)
  })
})

describe('dimensionRollupScore', () => {
  test('returns the mean for a run dimension, null when not evaluated', () => {
    expect(dimensionRollupScore(card, 'grounding')).toBe(0.5) // (1 + 0) / 2
    expect(dimensionRollupScore(card, 'tts')).toBe(1)
    expect(dimensionRollupScore(card, 'charm')).toBeNull() // never ran
  })
})
