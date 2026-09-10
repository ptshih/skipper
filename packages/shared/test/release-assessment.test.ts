import { expect, test } from 'bun:test'
import { acceptsReleaseJudgment, releaseJudgment, releaseAssessmentCost, type ReleaseJudgment } from '../src/release-assessment'
const good: ReleaseJudgment = { scores: { sourceSupport: 9, roadContext: 8, writing: 7, delivery: 8, audioFidelity: 9 }, scriptMatchesAudio: true, confidence: .9, uncertain: false, summary: 'Clear', heardOpening: 'Hello', heardEnding: 'Bye', issues: [], advisoryExplanation: '' }
test('clear judgments pass; any material concern requires attention', () => {
  expect(acceptsReleaseJudgment(good)).toBe(true)
  for (const field of Object.keys(good.scores) as (keyof typeof good.scores)[]) {
    expect(acceptsReleaseJudgment({ ...good, scores: { ...good.scores, [field]: field === 'sourceSupport' || field === 'audioFidelity' ? 8 : 6 } })).toBe(false)
  }
  expect(acceptsReleaseJudgment({ ...good, scriptMatchesAudio: false })).toBe(false)
  expect(acceptsReleaseJudgment({ ...good, uncertain: true })).toBe(false)
  expect(acceptsReleaseJudgment({ ...good, confidence: .79 })).toBe(false)
  expect(acceptsReleaseJudgment({ ...good, issues: [{ dimension: 'delivery', severity: 'major', detail: 'garbled', atSeconds: 5 }] })).toBe(false)
  expect(acceptsReleaseJudgment({ ...good, issues: [{ dimension: 'delivery', severity: 'minor', detail: 'pause', atSeconds: null }] })).toBe(true)
})
test('incomplete or malformed model output cannot become a judgment', () => {
  expect(releaseJudgment.safeParse({ ...good, heardEnding: undefined }).success).toBe(false)
  expect(releaseJudgment.safeParse({ ...good, scores: { ...good.scores, writing: 11 } }).success).toBe(false)
})
test('Gemini audio input and thinking output have real tiered costs', () => {
  expect(releaseAssessmentCost(1000, 1000)).toBeCloseTo(.014)
  expect(releaseAssessmentCost(200001, 1000)).toBeCloseTo(.818004)
})
