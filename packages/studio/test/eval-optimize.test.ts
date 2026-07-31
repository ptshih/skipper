import { describe, expect, test } from 'bun:test'
import { optimize, findingScore, collectAvoid, gatesNotWorse } from '../src/eval/optimize'
import type { StopEval } from '../src/eval/types'

// Model the "item" as a number = how many grounding findings remain. evaluate() turns it into
// a grounding StopEval with that many findings; regenerate() is whatever the test injects.
const evalOf = (n: number): StopEval[] => [
  {
    seq: 0,
    dimension: 'grounding',
    pass: n === 0,
    score: n === 0 ? 1 : 0,
    findings: Array.from({ length: n }, (_, i) => `ungrounded claim ${i}`),
  },
]
const evaluate = (n: number) => evalOf(n)

describe('findingScore — gate findings weigh heavier', () => {
  test('gate ×10, advisory ×1', () => {
    const evals: StopEval[] = [
      { seq: 0, dimension: 'grounding', pass: false, score: 0, findings: ['x'] }, // gate → 10
      { seq: 0, dimension: 'charm', pass: false, score: 0.3, findings: ['y'] }, // advisory → 1
    ]
    expect(findingScore(evals)).toBe(11)
  })
  test('clean → 0', () => {
    expect(findingScore(evalOf(0))).toBe(0)
  })
})

// The HARD advisory tier. Measured motivation: 155 of 457 released clips ship a banned wind-up,
// every one caught at generation time, because a ban scored exactly the same as a shared n-gram —
// so the loop had no reason to spend a retake on the one the model can actually fix.
describe('findingScore — a HARD advisory finding outranks an ordinary one', () => {
  const diversity = (findings: string[], hard: number): StopEval => ({
    seq: 0,
    dimension: 'diversity',
    pass: false,
    score: 0,
    findings,
    hardFindings: hard,
  })

  test('a banned tic weighs more than a plain advisory finding', () => {
    expect(findingScore([diversity(['banned tic'], 1)])).toBeGreaterThan(
      findingScore([diversity(['shared n-gram'], 0)]),
    )
  })

  test('hardFindings is an UPCHARGE on findings, never an addition', () => {
    // One finding, marked hard → one hard charge, not one hard + one ordinary.
    const oneHard = findingScore([diversity(['banned tic'], 1)])
    const twoOrdinary = findingScore([diversity(['a', 'b'], 0)])
    expect(oneHard).toBeGreaterThan(twoOrdinary) // 4 vs 2
    // And a mixed clip charges each finding exactly once.
    expect(findingScore([diversity(['banned', 'ngram'], 1)])).toBe(oneHard + 1)
  })

  test('one hard advisory still ranks below one GATE finding', () => {
    const gate: StopEval = { seq: 0, dimension: 'grounding', pass: false, score: 0, findings: ['ungrounded'] }
    expect(findingScore([diversity(['banned'], 1)])).toBeLessThan(findingScore([gate]))
  })

  // ⚠ The weight does NOT make a gate unbuyable — enough hard findings out-total one gate (4x3 > 10).
  // `gatesNotWorse` is the actual safety property, and it is an absolute veto independent of score.
  test('a pile of hard advisories can out-total a gate, and gatesNotWorse still refuses it', () => {
    const gate = (n: number): StopEval => ({ seq: 0, dimension: 'grounding', pass: n === 0, score: 0, findings: Array.from({ length: n }, () => 'ungrounded') })
    const best = [gate(0), diversity(['a', 'b', 'c'], 3)] // score 12, gates clean
    const candidate = [gate(1), diversity([], 0)] // score 10 — LOWER, but adds a gate violation
    expect(findingScore(candidate)).toBeLessThan(findingScore(best))
    expect(gatesNotWorse(candidate, best)).toBe(false) // …and is rejected anyway
  })

  test('THE REGRESSION: clearing the ban beats clearing the unfixable n-gram', () => {
    // Both takes have one finding left. Before the hard tier these scored identically, so a take
    // that kept the ban was accepted as a tie and the thrash guard stopped the loop.
    const keptTheBan = findingScore([diversity(['banned tic'], 1)])
    const clearedTheBan = findingScore([diversity(['shared n-gram'], 0)])
    expect(clearedTheBan).toBeLessThan(keptTheBan)
  })

  test('an over-reported hard count is clamped, not trusted', () => {
    expect(findingScore([diversity(['only one'], 99)])).toBe(findingScore([diversity(['only one'], 1)]))
  })

  test('absent hardFindings behaves exactly as before', () => {
    const withoutField: StopEval = { seq: 0, dimension: 'diversity', pass: false, score: 0, findings: ['a', 'b'] }
    expect(findingScore([withoutField])).toBe(2)
  })
})

describe('collectAvoid — hard notes lead the advisory ones', () => {
  test('gate > hard advisory > ordinary advisory', () => {
    const evals: StopEval[] = [
      { seq: 0, dimension: 'charm', pass: false, score: 0, findings: ['ordinary'] },
      { seq: 0, dimension: 'diversity', pass: false, score: 0, findings: ['banned'], detail: ['DROP THE BAN'], hardFindings: 1 },
      { seq: 0, dimension: 'grounding', pass: false, score: 0, findings: ['ungrounded'] },
    ]
    expect(collectAvoid(evals)).toEqual(['ungrounded', 'DROP THE BAN', 'ordinary'])
  })
})

describe('collectAvoid — gate-first, prefers string[] detail', () => {
  test('gate findings lead; diversity uses its lint `avoid` detail over reasons', () => {
    const evals: StopEval[] = [
      { seq: 0, dimension: 'diversity', pass: false, score: 0, findings: ['reason: repeated opener'], detail: ['Open this stop a different way.'] },
      { seq: 0, dimension: 'grounding', pass: false, score: 0, findings: ['ungrounded: 300ft deep'] },
    ]
    const avoid = collectAvoid(evals)
    expect(avoid[0]).toContain('ungrounded') // gate dimension leads
    expect(avoid).toContain('Open this stop a different way.') // diversity detail, not its reason
    expect(avoid).not.toContain('reason: repeated opener')
  })
})

describe('optimize — the accept-if-not-worse loop', () => {
  test('already clean → 0 rounds, stop "clean"', async () => {
    const r = await optimize<number>(0, { evaluate, regenerate: async () => 0, maxRounds: 4 })
    expect(r.rounds).toBe(0)
    expect(r.stop).toBe('clean')
    expect(r.item).toBe(0)
  })

  test('improves each round until clean', async () => {
    // each regen fixes exactly one finding
    const r = await optimize<number>(3, { evaluate, regenerate: async (_avoid, prev) => prev - 1, maxRounds: 5 })
    expect(r.item).toBe(0)
    expect(r.stop).toBe('clean')
    expect(r.rounds).toBe(3)
    expect(r.history.every((h) => h.accepted)).toBe(true)
  })

  test('hits the round budget with findings left → stop "budget"', async () => {
    const r = await optimize<number>(5, { evaluate, regenerate: async (_a, prev) => prev - 1, maxRounds: 2 })
    expect(r.item).toBe(3) // 5 → 4 → 3, then budget exhausted
    expect(r.stop).toBe('budget')
    expect(r.rounds).toBe(2)
  })

  test('a non-improving round stops the loop and KEEPS THE BEST (never regresses)', async () => {
    // regen makes it strictly WORSE — must be rejected, best held, loop stopped
    const r = await optimize<number>(2, { evaluate, regenerate: async (_a, prev) => prev + 3, maxRounds: 5 })
    expect(r.item).toBe(2) // worse candidate rejected; original kept
    expect(r.stop).toBe('converged')
    expect(r.rounds).toBe(1)
    expect(r.history[0]!.accepted).toBe(false)
  })

  test('a tie is accepted but stops the loop (no thrash)', async () => {
    // regen returns an equal-score alternative (no strict improvement)
    const r = await optimize<number>(2, { evaluate, regenerate: async (_a, prev) => prev, maxRounds: 5 })
    expect(r.stop).toBe('converged')
    expect(r.rounds).toBe(1)
    expect(r.history[0]!.accepted).toBe(true) // not-worse → taken
  })
})

describe('the Pareto gate guard — clearing tics never buys a gate violation', () => {
  const evalsOf = (grounding: number, tts: number, advisory: number): StopEval[] => [
    { seq: 0, dimension: 'grounding', pass: grounding === 0, score: 0, findings: Array.from({ length: grounding }, (_, i) => `ungrounded ${i}`) },
    { seq: 0, dimension: 'tts', pass: tts === 0, score: 0, findings: Array.from({ length: tts }, (_, i) => `tts ${i}`) },
    { seq: 0, dimension: 'diversity', pass: advisory === 0, score: 0, findings: Array.from({ length: advisory }, (_, i) => `tic ${i}`) },
  ]

  test('gatesNotWorse: per-gate-dimension ledger, advisory ignored', () => {
    expect(gatesNotWorse(evalsOf(1, 0, 9), evalsOf(1, 1, 0))).toBe(true) // tts cleared, grounding held
    expect(gatesNotWorse(evalsOf(2, 0, 0), evalsOf(1, 1, 5))).toBe(false) // +1 grounding — never
    expect(gatesNotWorse(evalsOf(0, 1, 0), evalsOf(1, 0, 0))).toBe(false) // gate-for-gate trade — never
  })

  test('REJECTS a tie that trades a cleared tts breaker for a NEW ungrounded claim', async () => {
    // item: tuple [grounding, tts, advisory]. initial = 1 ungrounded + 1 tts (score 20);
    // candidate = 2 ungrounded + clean tts (score 20) — a scalar tie the old accept took.
    type Item = [number, number, number]
    const r = await optimize<Item>([1, 1, 0], {
      evaluate: (i) => evalsOf(...i),
      regenerate: async () => [2, 0, 0] as Item,
      maxRounds: 3,
    })
    expect(r.history[0]!.accepted).toBe(false) // Pareto guard: grounding got worse
    expect(r.item).toEqual([1, 1, 0]) // incumbent kept
    expect(r.stop).toBe('converged')
  })

  test('REJECTS buying a gate violation with a pile of cleared advisory tics', async () => {
    type Item = [number, number, number]
    // initial = 0 ungrounded + 12 tics (score 12); candidate = 1 ungrounded + 0 tics (score 10)
    // — a scalar IMPROVEMENT that adds a hallucination. Must be rejected.
    const r = await optimize<Item>([0, 0, 12], {
      evaluate: (i) => evalsOf(...i),
      regenerate: async () => [1, 0, 0] as Item,
      maxRounds: 3,
    })
    expect(r.history[0]!.accepted).toBe(false)
    expect(r.item).toEqual([0, 0, 12])
  })

  test('ACCEPTS clearing a gate while picking up an advisory tic (gates lead)', async () => {
    type Item = [number, number, number]
    const r = await optimize<Item>([1, 0, 0], {
      evaluate: (i) => evalsOf(...i),
      regenerate: async () => [0, 0, 1] as Item,
      maxRounds: 3,
    })
    expect(r.history[0]!.accepted).toBe(true)
    expect(r.item).toEqual([0, 0, 1])
  })
})
