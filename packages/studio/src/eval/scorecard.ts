// Assemble per-stop dimension evals into one RunScorecard + decide the overall gate.
//
// Pure aggregation — no I/O, no model calls — so it is fully unit-tested. The overall
// `pass` is the AND of every GATE dimension (advisory dimensions never block, they only
// inform the regen loop + the human-calibrated judges).

import { DIMENSION_KIND, type DimensionRollup, type EvalDimension, type StopEval, type RunScorecard } from './types'

const mean = (xs: number[]): number => (xs.length === 0 ? 1 : xs.reduce((a, b) => a + b, 0) / xs.length)

/** Roll one dimension's per-stop evals into a single summary. */
function rollupDimension(dimension: EvalDimension, evals: StopEval[]): DimensionRollup {
  const forDim = evals.filter((e) => e.dimension === dimension)
  const failed = forDim.filter((e) => !e.pass)
  return {
    dimension,
    kind: DIMENSION_KIND[dimension],
    pass: failed.length === 0,
    score: mean(forDim.map((e) => e.score)),
    stopsEvaluated: forDim.length,
    stopsFailed: failed.length,
  }
}

export interface ScorecardInput {
  slug: string
  runName: string
  /** ISO-8601, or null if the caller didn't stamp one. */
  evaluatedAt: string | null
  /** Every per-stop dimension eval produced by the panel (any mix of dimensions). */
  stops: StopEval[]
}

/**
 * Build the tour scorecard. Only dimensions that actually produced evals appear in the
 * rollup. Overall `pass` = every GATE dimension that ran passed (a gate dimension that
 * produced zero evals is vacuously passing — it simply wasn't checked).
 */
export function buildScorecard(input: ScorecardInput): RunScorecard {
  const present = [...new Set(input.stops.map((e) => e.dimension))]
  const dimensions = present.map((d) => rollupDimension(d, input.stops))
  const pass = dimensions.filter((d) => d.kind === 'gate').every((d) => d.pass)
  return {
    slug: input.slug,
    runName: input.runName,
    evaluatedAt: input.evaluatedAt,
    dimensions,
    stops: input.stops,
    pass,
  }
}
