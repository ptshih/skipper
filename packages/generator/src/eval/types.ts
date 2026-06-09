// The eval scorecard schema — the keystone the whole evaluator panel plugs into.
//
// This is step 1 of the "agentic tour generation" build order (see TODO.md / the design
// thread): a STANDING, multi-dimension eval over a generated tour, so "is this tour good?"
// stops being a per-tour bottleneck on the founder's ear and becomes a measured scorecard.
// Only the GROUNDING dimension is implemented in this first slice (./grounding.ts) — it is
// the crown-jewel invariant ("persona lives in DELIVERY, never in FACTS") and is near-
// objective, so it can be a hard GATE rather than advisory. The other dimensions are
// declared here as the panel this grows into; each is just another module that returns a
// `StopEval` (or a tour-level one) in this shape.
//
// Why a uniform shape: a deterministic evaluator (e.g. TTS-cleanliness) and an LLM-judge
// (e.g. charm) compose into one scorecard, and the SAME findings feed the regen loop's
// `avoid[]` hook (the evaluator-optimizer, step 2) without per-dimension plumbing.

/**
 * Whether a narration claim about the PLACE traces to the permitted facts.
 *  - grounded:   traces to a specific fact-sheet line (evidence = that line).
 *  - ambient:    only NAMES/frames the region or corridor, or is plain world-knowledge
 *                that asserts no fact about a specific place (the sky is big) — the
 *                generator's two sanctioned sheet-free carve-outs.
 *  - ungrounded: a place-fact NOT on the sheet — even if hedged ("I bet", "must have
 *                been") or COMPUTED from sheet facts (a span subtracted from two years).
 */
export type ClaimStatus = 'grounded' | 'ambient' | 'ungrounded'

export interface ClaimVerdict {
  /** The asserted place-fact, in the auditor's own words. */
  claim: string
  status: ClaimStatus
  /** The sheet line it traces to (grounded), the carve-out (ambient), or null (ungrounded). */
  evidence: string | null
}

/** The eval dimensions. Only `grounding` ships in this slice; the rest are the target panel. */
export type EvalDimension = 'grounding' | 'charm' | 'diversity' | 'pacing' | 'tts'

/** A GATE dimension fails the whole tour; an ADVISORY one only informs regen, never blocks. */
export type EvalKind = 'gate' | 'advisory'

/**
 * Which dimensions are hard gates vs advisory. The split is by CHECKABILITY: grounding and
 * TTS-cleanliness are (near-)objective → gates; charm/diversity/pacing are subjective →
 * advisory (they feed the optimizer and the human-calibrated judges, never block a tour).
 */
export const DIMENSION_KIND: Record<EvalDimension, EvalKind> = {
  grounding: 'gate',
  tts: 'gate',
  charm: 'advisory',
  diversity: 'advisory',
  pacing: 'advisory',
}

/** One dimension's verdict for one stop. */
export interface StopEval {
  seq: number
  dimension: EvalDimension
  pass: boolean
  /** 0..1, where 1 is clean. For grounding: (grounded + ambient) / total claims. */
  score: number
  /** Human-readable issues; empty when clean. These are what feed the regen `avoid[]` hook. */
  findings: string[]
  /** Dimension-specific payload (grounding → ClaimVerdict[]). */
  detail?: unknown
}

/** A dimension rolled up across every evaluated stop on the tour. */
export interface DimensionRollup {
  dimension: EvalDimension
  kind: EvalKind
  pass: boolean
  /** Mean stop score for this dimension (1 if no stops were evaluated for it). */
  score: number
  stopsEvaluated: number
  stopsFailed: number
}

/** The full per-tour scorecard. `pass` = every GATE dimension passes. */
export interface TourScorecard {
  slug: string
  tourName: string
  /** ISO-8601 stamp, or null if the caller didn't supply one. */
  evaluatedAt: string | null
  dimensions: DimensionRollup[]
  stops: StopEval[]
  pass: boolean
}
