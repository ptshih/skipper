import { describe, expect, test } from 'bun:test'
import { buildScoreRows, dimensionRollupScore, groundingScoreFor, runPassed, type ClipIdentity } from '../src/eval/record'
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
  [0, { poiId: 'poi-a', qid: 'Q1', name: 'Emerald Bay', withheld: false, script: null }],
  [1, { poiId: 'poi-b', qid: 'Q2', name: 'Fannette Island', withheld: true, script: 'A withheld telling about the deepest cove.' }],
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
    // The withheld clip carries its best-attempt script (denormalized onto its rows) for the report.
    expect(withheldRows.every((r) => r.script === 'A withheld telling about the deepest cove.')).toBe(true)
  })

  test('a shipped clip carries no script (it lives in narrations)', () => {
    const rows = buildScoreRows('run-1', card, identity)
    expect(rows.filter((r) => r.qid === 'Q1').every((r) => r.script === null)).toBe(true)
  })

  test('a clip with no identity gets null keys and withheld=false', () => {
    const rows = buildScoreRows('run-1', card) // no identity map
    expect(rows.every((r) => r.poiId === null && r.qid === null && !r.withheld && r.script === null)).toBe(true)
  })
})

describe('dimensionRollupScore', () => {
  test('returns the mean for a run dimension, null when not evaluated', () => {
    expect(dimensionRollupScore(card, 'grounding')).toBe(0.5) // (1 + 0) / 2
    expect(dimensionRollupScore(card, 'tts')).toBe(1)
    expect(dimensionRollupScore(card, 'charm')).toBeNull() // never ran
  })
})

// ── The FUSED cluster identity path ──────────────────────────────────────────────────────────────
// `ClipIdentity` mirrors `narrations_subject_xor`: exactly one of poiId / clusterId. The fixture above
// only ever exercises the poi side, so the cluster side — the one whose whole reason for existing is
// that putting a cluster id in `poiId` would violate the eval_scores FK AND restate the false claim
// `poi_clusters` was created to prevent — shipped uncovered.
describe('buildScoreRows — fused cluster tellings', () => {
  const fusedIdentity = new Map<number, ClipIdentity>([
    [0, { poiId: null, clusterId: 'cluster-a', qid: null, name: 'Emerald Bay', withheld: false, script: null }],
    [1, { poiId: 'poi-b', qid: 'Q2', name: 'Fannette Island', withheld: true, script: 'held back' }],
  ])

  test('a fused clip keys on clusterId and leaves poiId NULL', () => {
    const rows = buildScoreRows('run-2', card, fusedIdentity)
    const fused = rows.filter((r) => r.name === 'Emerald Bay')
    expect(fused.length).toBe(2) // both dimensions
    expect(fused.every((r) => r.clusterId === 'cluster-a')).toBe(true)
    expect(fused.every((r) => r.poiId === null)).toBe(true)
    // A cluster has no QID — documented, and load-bearing for eval_scores_case_idx.
    expect(fused.every((r) => r.qid === null)).toBe(true)
  })

  test('the xor holds on every row: never both keys, never neither', () => {
    const rows = buildScoreRows('run-2', card, fusedIdentity)
    for (const r of rows) {
      expect((r.poiId !== null) !== (r.clusterId !== null)).toBe(true)
    }
  })

  test('a poi clip still leaves clusterId NULL (the other half of the xor)', () => {
    const rows = buildScoreRows('run-2', card, fusedIdentity)
    expect(rows.filter((r) => r.qid === 'Q2').every((r) => r.clusterId === null)).toBe(true)
  })
})

// ── The run-level gate verdict ───────────────────────────────────────────────────────────────────
// `pass` was `withheld === 0` alone, which greens a run whose SHIPPED clips carry a gate failure the
// scorecard knows about — tail-collapse and loudness are measured after synthesis, so those clips
// were never "withheld". These pin both halves of the AND.
describe('the eval-run gate verdict (buildScorecard drives it)', () => {
  const clean = buildScorecard({
    slug: 'lake-tahoe',
    runName: 'r',
    evaluatedAt: null,
    stops: [
      { seq: 0, dimension: 'tts', pass: true, score: 1, findings: [] },
      { seq: 0, dimension: 'grounding', pass: true, score: 1, findings: [] },
    ],
  })
  // A clip that SHIPPED and then measured a tail collapse: the tts gate dim is dirty, nothing withheld.
  const shippedButDirty = buildScorecard({
    slug: 'lake-tahoe',
    runName: 'r',
    evaluatedAt: null,
    stops: [
      { seq: 0, dimension: 'tts', pass: false, score: 0, findings: ['tail collapse 9.1 dB'] },
      { seq: 0, dimension: 'grounding', pass: true, score: 1, findings: [] },
    ],
  })

  test('a genuinely clean run with nothing withheld passes', () => {
    expect(runPassed(clean, 0)).toBe(true)
  })

  test('a scorecard gate failure fails the run even with NOTHING withheld', () => {
    // The regression: `withheld === 0` alone reported this exact run as a PASS. The clip shipped, so
    // it was never withheld, and only the post-synthesis measurement knows it is bad.
    expect(runPassed(shippedButDirty, 0)).toBe(false)
  })

  test('a withheld clip still fails the run even with a clean scorecard', () => {
    expect(runPassed(clean, 1)).toBe(false)
  })

  test('an ADVISORY dimension never fails the run', () => {
    const advisoryDirty = buildScorecard({
      slug: 'lake-tahoe',
      runName: 'r',
      evaluatedAt: null,
      stops: [
        { seq: 0, dimension: 'tts', pass: true, score: 1, findings: [] },
        { seq: 0, dimension: 'diversity', pass: false, score: 0, findings: ['echoes an existing opener'] },
      ],
    })
    expect(advisoryDirty.pass).toBe(true)
    expect(runPassed(advisoryDirty, 0)).toBe(true)
  })
})

// ── grounding_score must not go green for a judge that never ran ──────────────────────────────────
// `evaluateLaterality` reports under dimension='grounding' and runs unconditionally, while the paid
// Opus judge is gated. With the judge off the dimension still rolls up a clean 1.0 — a confident
// grounding trend nobody measured. Only the caller knows, so the caller has to say.
describe('groundingScoreFor', () => {
  // A run with the judge OFF: laterality is the only thing that reported grounding, and it passed.
  const lateralityOnly = buildScorecard({
    slug: 'lake-tahoe',
    runName: 'r',
    evaluatedAt: null,
    stops: [
      { seq: 0, dimension: 'grounding', pass: true, score: 1, findings: [] },
      { seq: 1, dimension: 'grounding', pass: true, score: 1, findings: [] },
    ],
  })

  test('judge OFF → null, NOT the vacuous 1.0 the rollup would report', () => {
    expect(dimensionRollupScore(lateralityOnly, 'grounding')).toBe(1) // what it used to record
    expect(groundingScoreFor(lateralityOnly, false)).toBeNull()
  })

  test('judge ON → the real rollup', () => {
    expect(groundingScoreFor(card, true)).toBe(0.5)
  })

  test('UNSTATED means "assume it ran" — audit-corpus always judges on --apply', () => {
    expect(groundingScoreFor(card, undefined)).toBe(0.5)
  })

  test('a dimension that never ran is still null regardless of the flag', () => {
    expect(groundingScoreFor(card, true)).not.toBeNull()
    expect(dimensionRollupScore(card, 'charm')).toBeNull()
  })
})
