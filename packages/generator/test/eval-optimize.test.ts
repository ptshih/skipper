import { describe, expect, test } from 'bun:test'
import { optimize, findingScore, collectAvoid } from '../src/eval/optimize'
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
