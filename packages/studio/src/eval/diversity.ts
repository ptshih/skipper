// DIVERSITY evaluator — cross-stop sameness — an ADVISORY dimension.
//
// Thin wrapper over the deterministic cross-stop lint (pipeline/lint.ts): personal-kit
// overuse, repeated stock phrases, duplicate opener/closer signatures, tic-stacking,
// list-shape, tidy bows. It's free (no LLM) and CROSS-STOP, so we run it over the whole
// tour at once and map each stop to a per-stop StopEval. Advisory: sameness informs the
// regen `avoid[]` hook (the lint's own `avoid` notes ARE the detail payload), never gates.
//
// Note: the lint is keyed on the active persona's KIT, and breaks aren't linted (they carry
// short generic cues), so the caller passes only story+scenic LintInputs + the persona kit.

import { lintScripts, type LintInput } from '../pipeline/lint'
import type { KitBeat } from '../persona/types'
import type { StopEval } from './types'

/** The persona's kit, as lintScripts wants it (its repetition detectors). */
export type DiversityKit = { beats: KitBeat[]; dropNote: string }

/**
 * Run the cross-stop lint and map it to per-stop advisory diversity evals. Every input
 * stop gets an eval (a clean stop passes); a flagged stop fails with the lint's reasons,
 * and carries the lint's `avoid` instructions as `detail` for the evaluator-optimizer.
 */
export function evaluateDiversity(inputs: LintInput[], kit: DiversityKit): StopEval[] {
  const bySeq = new Map(lintScripts(inputs, kit).map((f) => [f.seq, f]))
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
