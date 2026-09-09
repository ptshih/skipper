// LATERALITY evaluator — a deterministic, free GROUNDING backstop for shared-corpus clips.
//
// A clip is generated ONCE and reused by every drive that reaches the place, from either approach,
// so the direction of travel is unknown at generation time. Naming a side of the road ("on your
// left", "the right-hand side") therefore asserts a spatial place-fact the narrator was never given
// — an ungrounded claim. (This rule OUTLIVED roam: the mode is gone, the geometry that motivates it
// is not.) The Opus grounding judge would flag it too (the side line is NOT on the well), but this
// catches it for FREE and reliably, so it rides as a deterministic grounding finding that feeds the
// same gate + the same optimize() avoid[] hook. It was an inline guard in generate-narrations.ts;
// promoted into the panel so there is ONE loop and ONE gate.

import type { StopEval } from './types'

/** Names a side of the road. Mirrors the inline generate-narrations guard the panel replaced. */
export const LATERALITY_RE =
  /\b(?:on|to|off to) (?:your|the) (?:left|right)\b|\b(?:left|right)(?:-hand)? side\b/i

/** The grounding finding a laterality slip contributes. Operator-facing only — it is recorded in
 *  `eval_scores` and read in the admin Runs drawer; it never reaches a model, because a laterality
 *  hit always carries `detail` and collectAvoid prefers `detail` over `findings`. */
export const LATERALITY_FINDING =
  'ungrounded place-claim: names a side of the road (the direction of travel is unknown on a shared clip)'

/** The correction reaches the next generated take. Vista descriptions need the same direction-
 * independent wording as road scenes: the Yosemite calibration kept repeating left/right landmark
 * layouts despite the old road-only instruction. Do not replace them with invented compass bearings. */
export const LATERALITY_AVOID =
  'Do NOT name a side of the road (no "on your left/right", no "the left/right-hand side") — the direction of travel is unknown on a shared drive; say "just out there" or "right about here" instead. For a vista, name its landmarks without left/right positions. Do not assume the rider just emerged from a tunnel or arrived from a particular direction; do not invent compass bearings.'

export interface LateralityInput {
  seq: number
  script: string
}

/** True when the script names a side of the road. */
export function lateralityHit(script: string): boolean {
  // "Landed on the right one" is a choice idiom, not a roadside assertion. Remove only
  // this bounded phrase; another directional claim in the same script must still fail.
  const spatialText = script.replace(/\b(?:landed|settled|decided) on the right (?:one|choice|name)\b/gi, '')
  return LATERALITY_RE.test(spatialText)
}

/**
 * Score one clip's laterality. PASS = names no side of the road. Reported under
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
