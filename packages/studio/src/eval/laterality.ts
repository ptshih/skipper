// LATERALITY evaluator — a deterministic, free GROUNDING backstop for free-roam clips.
//
// On a FREE-ROAM encounter the direction of travel is unknown, so naming a side of the road
// ("on your left", "the right-hand side") asserts a spatial place-fact the narrator was never
// given — an ungrounded claim. The Opus grounding judge would flag it too (the side line is NOT
// on the roam well), but this catches it for FREE and reliably, so it rides as a deterministic
// grounding finding that feeds the same gate + the same optimize() avoid[] hook. It was an inline
// guard in generate-narrations.ts; promoted into the panel so there is ONE loop and ONE gate.

import type { StopEval } from './types'

/** Names a side of the road. Mirrors the roam guard the inline gate replaces. */
export const LATERALITY_RE =
  /\b(?:on|to|off to) (?:your|the) (?:left|right)\b|\b(?:left|right)(?:-hand)? side\b/i

/** The grounding finding a laterality slip contributes. */
export const LATERALITY_FINDING =
  'ungrounded place-claim: names a side of the road (the direction of travel is unknown on a free-roam drive)'

/** The directive regen note fed into the next take (the StopEval.detail the optimizer prefers). */
export const LATERALITY_AVOID =
  'Do NOT name a side of the road (no "on your left/right", no "the left/right-hand side") — the direction of travel is unknown on a free-roam drive; say "just out there" or "right about here" instead.'

export interface LateralityInput {
  seq: number
  script: string
}

/** True when the script names a side of the road. */
export function lateralityHit(script: string): boolean {
  return LATERALITY_RE.test(script)
}

/**
 * Score one roam clip's laterality. PASS = names no side of the road. Reported under
 * dimension='grounding' (a side it cannot know IS an ungrounded place-claim), with the directive
 * avoid-note as `detail` so the optimizer feeds the precise instruction, not the bare finding.
 */
export function evaluateLaterality(input: LateralityInput): StopEval {
  const hit = lateralityHit(input.script)
  return {
    seq: input.seq,
    dimension: 'grounding',
    pass: !hit,
    score: hit ? 0 : 1,
    findings: hit ? [LATERALITY_FINDING] : [],
    detail: hit ? [LATERALITY_AVOID] : undefined,
  }
}
