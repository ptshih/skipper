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
      // Carried so optimize() can spend its retake budget on the banned tics (per-clip, fixable)
      // rather than on shared n-grams (corpus-level, and measurably not fixable by rewording).
      hardFindings: finding?.hard ?? 0,
    }
  })
}

/**
 * Score ONE take against the REST of the region's tellings — the entry point V2 generation needs.
 *
 * Why this exists: `lintScripts` is cross-stop by construction (it was written for V1, which narrated
 * a whole tour and then linted the assembled scripts). V2 narrates ONE shared telling per POI, and the
 * generator called `evaluateDiversity([oneStop])` — a single-element array. With n=1 every cross-stop
 * rule is a no-op by arithmetic, not by configuration: `hits.slice(1)` on one hit is empty, and the
 * opener/closer maps have nothing to collide with. So the corpus-wide repetition those rules exist to
 * catch could never be seen, and adding a phrase to STOCK_PHRASES would not have changed that.
 * (The PER-stop rules — banned tics, list shape, tidy bows — always worked; only the cross half was dead.)
 *
 * ⚠ ORDER IS THE SEMANTICS. Every cross-stop rule keeps the FIRST occurrence and flags later ones, so
 * the take under test MUST go last. Put it anywhere else and the existing corpus is flagged for the new
 * take's repetition while the take itself passes clean — the exact inversion of what we want.
 *
 * Context entries get synthetic NEGATIVE seqs: findings are keyed by seq, so they must never collide
 * with the real one, and a negative reads unmistakably as "not a stop in this run" if it reaches a log.
 * Only the current stop's eval is returned; the context's own findings are discarded.
 */
export function evaluateDiversityAgainst(current: LintInput, context: readonly string[]): StopEval[] {
  if (context.length === 0) return evaluateDiversity([current])
  const inputs: LintInput[] = context.map((script, i) => ({
    seq: -(i + 1),
    stopType: current.stopType,
    script,
  }))
  inputs.push(current) // last — see the ORDER note above
  return evaluateDiversity(inputs).filter((e) => e.seq === current.seq)
}
