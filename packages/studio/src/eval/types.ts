// The eval scorecard schema — the keystone the whole evaluator panel plugs into.
//
// This is step 1 of the "agentic tour generation" build order (see TODO.md / the design
// thread): a STANDING, multi-dimension eval over a generated tour, so "is this tour good?"
// stops being a per-tour bottleneck on the founder's ear and becomes a measured scorecard.
// GROUNDING is the crown-jewel GATE ("persona lives in DELIVERY, never in FACTS") — near-
// objective, so it blocks rather than merely advises (./grounding.ts). The other dimensions
// are now implemented as sibling modules (tts, diversity, pacing, charm, veracity, laterality),
// each returning a `StopEval` (or a tour-level one) in this same shape; the gate/advisory split
// lives in DIMENSION_KIND below.
//
// Why a uniform shape: a deterministic evaluator (e.g. TTS-cleanliness) and an LLM-judge
// (e.g. charm) compose into one scorecard, and the SAME findings feed the regen loop's
// `avoid[]` hook (the evaluator-optimizer, step 2) without per-dimension plumbing.

/**
 * Whether a narration claim about the PLACE traces to the permitted facts.
 *  - grounded:   traces to a specific fact-sheet line (evidence = that line).
 *  - ambient:    only NAMES/frames the region or corridor, or is plain world-knowledge
 *                that asserts no fact about a specific place (the sky is big) — the
 *                studio pipeline's two sanctioned sheet-free carve-outs.
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

/** The eval dimensions — all implemented as sibling modules (see header); DIMENSION_KIND below splits gate vs advisory. */
export type EvalDimension = 'grounding' | 'charm' | 'diversity' | 'pacing' | 'tts' | 'veracity'

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
  // External truth (sheet ↔ world) is advisory because no trustworthy auto-judge exists for
  // world-truth — a CHECKABILITY limit, not doctrine (grounding/tts ARE auto-gated). Confirmed
  // errors become poi-override entries, adjudicated by a human.
  veracity: 'advisory',
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
  /** How many of `findings` are HARD ones — never acceptable at any count, and fixable within the
   *  clip. Today only diversity sets it, for the hard-banned wind-ups/tics.
   *
   *  ⚠ Exists because an advisory dimension can carry findings of genuinely different kinds. A banned
   *  tic is a per-clip writing defect the model can fix on the next take; a shared n-gram is a CORPUS
   *  problem (the same source fact handed to dozens of POIs — measured, and a $1.68 regeneration
   *  probe showed rewording does not fix it). Scoring them equally let `optimize()` "improve" a take
   *  by dropping the n-gram it was never going to fix while keeping the ban, and then stop. */
  hardFindings?: number
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
export interface RunScorecard {
  /** The region slug this run covered — NULL for a whole-corpus run that spans no single region. */
  slug: string | null
  runName: string
  /** ISO-8601 stamp, or null if the caller didn't supply one. */
  evaluatedAt: string | null
  dimensions: DimensionRollup[]
  stops: StopEval[]
  pass: boolean
}
