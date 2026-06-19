// DIVERSITY evaluator — cross-stop sameness — an ADVISORY dimension.
//
// Thin wrapper over the deterministic cross-stop lint (pipeline/lint.ts): repeated stock
// phrases, duplicate opener/closer signatures, tic-stacking, list-shape, tidy bows. It's free
// (no LLM) and CROSS-STOP, so we run it over the whole tour at once and map each stop to a
// per-stop StopEval. Advisory: sameness informs the regen `avoid[]` hook (the lint's own
// `avoid` notes ARE the detail payload), never gates.
//
// Note: breaks aren't linted (they carry short generic cues), so the caller passes only
// story+scenic LintInputs.

import { lintScripts, type LintInput } from '../pipeline/lint'
import type { StopEval } from './types'

/**
 * Run the cross-stop lint and map it to per-stop advisory diversity evals. Every input
 * stop gets an eval (a clean stop passes); a flagged stop fails with the lint's reasons,
 * and carries the lint's `avoid` instructions as `detail` for the evaluator-optimizer.
 */
export function evaluateDiversity(inputs: LintInput[]): StopEval[] {
  const bySeq = new Map(lintScripts(inputs).map((f) => [f.seq, f]))
  return inputs.map((i) => {
    const finding = bySeq.get(i.seq)
    return {
      seq: i.seq,
      dimension: 'diversity',
      pass: !finding,
      score: finding ? 0 : 1,
      findings: finding?.reasons ?? [],
      detail: finding?.avoid,
    }
  })
}
