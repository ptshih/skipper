import { expect, test } from 'bun:test'
import { isHardReviewFinding, type ReviewFinding } from './review-findings'

const tts = (findings: string[], detail?: unknown): ReviewFinding => ({
  pass: false, withheld: false, dimension: 'tts', findings, detail,
})

test('documented, measured audio advisories can reach required listening review', () => {
  expect(isHardReviewFinding(tts(['tail-collapse: measured tail'], {
    tailRetake: { retook: true, shippedCollapsed: true, keptDropDb: 5 },
  }))).toBe(false)
  expect(isHardReviewFinding(tts(['loudness: off target', 'true-peak: AAC overshoot'], {
    loudness: { loudnessOk: false, integratedLufs: -17, truePeakOk: false, truePeakDb: -0.6 },
  }))).toBe(false)
})

test('unsafe, withheld, unmeasured and unknown failures cannot be waived', () => {
  const detail = { loudness: { loudnessOk: false, integratedLufs: -17 } }
  for (const finding of [
    tts(['TTS-unsafe: URL', 'loudness: off target'], detail),
    tts(['loudness: off target']),
    tts(['tail-collapse: measured tail'], {}),
    tts(['new failure'], detail), tts([], detail),
    { ...tts(['loudness: off target'], detail), withheld: true },
    { ...tts(['loudness: off target'], detail), dimension: 'grounding' },
  ]) expect(isHardReviewFinding(finding)).toBe(true)
})

test('actual clipping remains hard, including when mixed with an advisory', () => {
  expect(isHardReviewFinding(tts(['true-peak: AAC overshoot'], {
    loudness: { truePeakOk: false, truePeakDb: 0.1 },
  }))).toBe(true)
  expect(isHardReviewFinding(tts(['loudness: off target'], {
    loudness: { loudnessOk: false, integratedLufs: -17, truePeakDb: 0.1 },
  }))).toBe(true)
})
