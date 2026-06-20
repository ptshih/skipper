// PACING evaluator — a deterministic, FREE length advisory for a generated clip.
//
// The register length band (lengthForRegister → target/max seconds) reaches the model only as
// prompt text ("aim for ~Ns, never exceed Ms"); nothing read the produced script back, so an
// over-long telling shipped silently — the band's own "a clip that HITS the cap is a prompt
// problem" had no detector. This IS that detector: estimate spoken seconds from word count
// (WORDS_PER_SECOND) and flag a clip that runs past its max CEILING, feeding optimize()'s avoid[]
// hook a "you ran long, cut back" note so the retake comes in tighter.
//
// ADVISORY (it informs the retake, never withholds a clip), and ONE-SIDED on purpose: we flag
// OVERSHOOT only, never undershoot. The prompt doctrine is "let the sheet set the length — a thin
// sheet lands short, never pad to reach the aim", so a clip UNDER target is a feature, not a
// defect; a "you're too short" note would push exactly the padding the grounding gate exists to
// prevent. targetSeconds is the aim the note steers back toward; maxSeconds is the ceiling we
// enforce. The grace factor absorbs word-count→seconds jitter (WORDS_PER_SECOND is approximate),
// so only GENUINE sprawl past the (already generous) ceiling triggers a paid retake.

import { WORDS_PER_SECOND } from '../config'
import type { StopEval } from './types'

/** How far past maxSeconds a clip may estimate before we call it sprawl (absorbs read-pace jitter). */
export const PACING_OVERSHOOT_FACTOR = 1.1

/** Spoken-length estimate (seconds) from a script's word count, at the pipeline's read pace. */
export function estimateSpokenSeconds(script: string): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length
  return words / WORDS_PER_SECOND
}

export interface PacingInput {
  seq: number
  script: string
  /** The clip's register length band (lengthForRegister): the aim and the ceiling. */
  targetSeconds: number
  maxSeconds: number
}

/**
 * Score one clip's length. PASS unless the estimated spoken duration runs past the max ceiling by
 * more than the jitter grace. Reported under the advisory `pacing` dimension with a directive
 * retake note as `detail` (a string[], which the optimizer prefers over the bare finding). Never
 * fires on an under-length clip — short-and-true is a win, and a "too short" nudge would invite
 * padding.
 */
export function evaluatePacing(input: PacingInput): StopEval {
  const est = Math.round(estimateSpokenSeconds(input.script))
  const ceiling = Math.round(input.maxSeconds * PACING_OVERSHOOT_FACTOR)
  const over = est > ceiling
  return {
    seq: input.seq,
    dimension: 'pacing',
    pass: !over,
    score: over ? Math.max(0, Math.min(1, input.maxSeconds / est)) : 1,
    findings: over
      ? [`length: ~${est}s spoken, over the ${input.maxSeconds}s ceiling (aim ~${input.targetSeconds}s)`]
      : [],
    detail: over
      ? [
          `This telling runs about ${est} seconds read aloud — past the ${input.maxSeconds}-second ceiling for this stop. Cut it back toward ${input.targetSeconds} seconds: drop the least-essential fact or two and tighten the lines. Do NOT add anything and do not pad — fewer things, told well.`,
        ]
      : undefined,
  }
}
