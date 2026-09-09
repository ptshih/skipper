import { describe, expect, test } from 'bun:test'
import { evaluateLaterality, lateralityHit, LATERALITY_AVOID } from '../src/eval/laterality'

describe('evaluateLaterality', () => {
  test('passes a clip that names no side of the road', () => {
    const e = evaluateLaterality({ seq: 0, script: 'Right about here, the water goes that impossible blue.' })
    expect(e.dimension).toBe('grounding')
    expect(e.pass).toBe(true)
    expect(e.score).toBe(1)
    expect(e.findings).toEqual([])
    expect(e.detail).toBeUndefined()
  })

  test.each([
    'And there it is, on your left.',
    'Coming up off to the right, you will see it.',
    'The lighthouse sits on the left-hand side.',
    'Look to your right.',
  ])('fails a clip that names a side: %p', (script) => {
    expect(lateralityHit(script)).toBe(true)
    const e = evaluateLaterality({ seq: 1, script })
    expect(e.pass).toBe(false)
    expect(e.score).toBe(0)
    expect(e.findings.length).toBe(1)
    // The directive avoid-note rides as detail so the optimizer feeds the instruction, not the finding.
    expect(e.detail).toEqual([LATERALITY_AVOID])
  })

  test('does not flag plain pointing ("there is the lighthouse")', () => {
    expect(lateralityHit('There is the lighthouse, straight ahead.')).toBe(false)
  })
})


test('choice idioms do not falsely withhold a clip, but cannot hide a real direction', () => {
  expect(lateralityHit('Of the three names, I think they landed on the right one.')).toBe(false)
  expect(lateralityHit('They settled on the right name for the hotel.')).toBe(false)
  expect(lateralityHit('They landed on the right one. The hotel is on your left.')).toBe(true)
  expect(lateralityHit('They landed on the right bank of the river.')).toBe(true)
  expect(lateralityHit('The hotel is on the right.')).toBe(true)
})
