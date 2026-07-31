// eval/veracity — scoring/aggregation with a deterministic injected checker (zero spend).
// Mirrors eval-grounding.test.ts: the Anthropic-backed checker is NOT under test here.

import { expect, test } from 'bun:test'
import { evaluateVeracity } from '../src/eval/veracity'
import type { VeracityInput, VeracityVerdict } from '../src/eval/veracity'

const INPUT: VeracityInput = {
  seq: 3,
  name: 'Emerald Bay State Park',
  script: 'The man who designed it was named Leonard Palme.',
  well: ['The architect was Leonard Palme, who was hired by his aunt Lora Josephine Knight.'],
}

const fake =
  (verdicts: VeracityVerdict[]) =>
  async (_input: VeracityInput): Promise<VeracityVerdict[]> =>
    verdicts

test('all corroborated → pass, score 1, no findings', async () => {
  const ev = await evaluateVeracity(
    INPUT,
    fake([
      { claim: 'built 1929', status: 'corroborated', correction: null, sourceUrl: 'https://x' },
      { claim: 'a state park', status: 'corroborated', correction: null, sourceUrl: 'https://y' },
    ]),
  )
  expect(ev.dimension).toBe('veracity')
  expect(ev.pass).toBe(true)
  expect(ev.score).toBe(1)
  expect(ev.findings).toEqual([])
})

test('a contradicted claim → fail, fractional score, finding carries correction + source', async () => {
  const ev = await evaluateVeracity(
    INPUT,
    fake([
      {
        claim: 'the architect was Leonard Palme',
        status: 'contradicted',
        correction: 'the architect was Lennart Palme',
        sourceUrl: 'https://vikingsholm.com/',
      },
      { claim: 'hired by his aunt', status: 'corroborated', correction: null, sourceUrl: 'https://z' },
    ]),
  )
  expect(ev.pass).toBe(false)
  expect(ev.score).toBe(0.5)
  expect(ev.findings).toHaveLength(1)
  expect(ev.findings[0]).toContain('upstream-source error')
  expect(ev.findings[0]).toContain('Lennart Palme')
  expect(ev.findings[0]).toContain('vikingsholm.com')
})

test('unverifiable claims do not fail the stop (advisory needs a human, not an alarm)', async () => {
  const ev = await evaluateVeracity(
    INPUT,
    fake([{ claim: 'foggy provenance', status: 'unverifiable', correction: null, sourceUrl: null }]),
  )
  expect(ev.pass).toBe(true)
  expect(ev.score).toBe(1)
  expect(ev.findings).toEqual([])
})

test('nothing checkable → vacuous pass with score 1', async () => {
  const ev = await evaluateVeracity(INPUT, fake([]))
  expect(ev.pass).toBe(true)
  expect(ev.score).toBe(1)
  expect(ev.detail).toEqual([])
})

test('a contradiction with no correction text still reads as a finding', async () => {
  const ev = await evaluateVeracity(
    INPUT,
    fake([{ claim: 'wrong builder', status: 'contradicted', correction: null, sourceUrl: null }]),
  )
  expect(ev.pass).toBe(false)
  expect(ev.findings[0]).toContain('(none given)')
})
