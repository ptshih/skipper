import { describe, expect, test } from 'bun:test'
import { lastSentences, toFindings } from '../src/pipeline/judge'

describe('judge helpers', () => {
  test('lastSentences returns the trailing n sentences', () => {
    const s = 'One thing here. A second thing. And the final beat, folks.'
    expect(lastSentences(s, 1)).toBe('And the final beat, folks.')
    expect(lastSentences(s, 2)).toBe('A second thing. And the final beat, folks.')
  })

  test('lastSentences handles a single sentence', () => {
    expect(lastSentences('Just one.', 2)).toBe('Just one.')
  })

  test('toFindings maps flagged closers into lint findings with an avoid note', () => {
    const findings = toFindings([{ seq: 3, move: 'personify the place', reason: 'third one in a row' }])
    expect(findings).toHaveLength(1)
    expect(findings[0]!.seq).toBe(3)
    expect(findings[0]!.reasons[0]).toMatch(/personify the place/i)
    expect(findings[0]!.avoid[0]).toMatch(/different kind of move/i)
  })

  test('toFindings on empty input → empty', () => {
    expect(toFindings([])).toEqual([])
  })
})
