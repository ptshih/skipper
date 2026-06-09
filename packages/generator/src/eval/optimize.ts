// The evaluator-optimizer — the regen engine of the eval flywheel.
//
// Turns eval findings into a better telling: evaluate → fold the failing findings into
// "avoid" notes → regenerate → re-evaluate → accept ONLY if not worse → loop until clean or
// out of budget. This GENERALIZES the bespoke lint→regen loop already living in generate.ts
// (its "accept the regen only if it doesn't INCREASE findings" guard) into a reusable,
// multi-dimension, budgeted loop with an explicit convergence/thrash guard.
//
// GENERIC over the item being optimized (a script string in the real wiring) and AGNOSTIC to
// which evaluators run — the caller supplies evaluate() + regenerate(), so the loop is
// unit-tested with fakes (no API) and adoptable by generate.ts via a thin adapter. See the
// WIRING NOTE at the bottom.

import { DIMENSION_KIND, type StopEval } from './types'

// A finding on a GATE dimension (grounding/tts) weighs heavier than an advisory one
// (charm/diversity), so the loop spends its budget killing hard violations before polish.
const GATE_WEIGHT = 10
const ADVISORY_WEIGHT = 1

/** Weighted finding count — the score the loop MINIMIZES (0 = nothing flagged). */
export function findingScore(evals: StopEval[]): number {
  return evals.reduce(
    (n, e) =>
      n + e.findings.length * (DIMENSION_KIND[e.dimension] === 'gate' ? GATE_WEIGHT : ADVISORY_WEIGHT),
    0,
  )
}

const isGate = (e: StopEval): boolean => DIMENSION_KIND[e.dimension] === 'gate'

/**
 * Fold the failing evals into actionable avoid-notes for the next regen. Gate dimensions lead
 * (most important to fix), and a dimension that ships purpose-built regen instructions as a
 * string[] `detail` (diversity carries the lint's own `avoid` notes) uses those over its
 * human-readable `findings`.
 */
export function collectAvoid(evals: StopEval[]): string[] {
  const failing = evals.filter((e) => !e.pass).sort((a, b) => Number(isGate(b)) - Number(isGate(a)))
  const avoid: string[] = []
  for (const e of failing) {
    const detailNotes =
      Array.isArray(e.detail) && e.detail.every((d) => typeof d === 'string')
        ? (e.detail as string[])
        : null
    avoid.push(...(detailNotes ?? e.findings))
  }
  return avoid
}

/** Score one candidate item across the panel → its per-dimension evals. */
export type EvaluateFn<T> = (item: T) => Promise<StopEval[]> | StopEval[]
/** Produce a fresh take given the accumulated avoid-notes (and the previous item for context). */
export type RegenerateFn<T> = (avoid: string[], prev: T) => Promise<T>

export interface OptimizeOptions<T> {
  evaluate: EvaluateFn<T>
  regenerate: RegenerateFn<T>
  /** Max regen attempts (default 3). 0 = evaluate only, never regenerate. */
  maxRounds?: number
}

export interface OptimizeRound {
  round: number
  avoid: string[]
  candidateScore: number
  accepted: boolean
}

export interface OptimizeResult<T> {
  /** The accepted item — the best take found (the original if no regen beat it). */
  item: T
  /** The accepted item's per-dimension evals. */
  evals: StopEval[]
  rounds: number
  /**
   *  - 'clean'     — no findings remain.
   *  - 'converged' — a round failed to strictly improve the score (thrash guard tripped).
   *  - 'budget'    — hit maxRounds with findings still present.
   */
  stop: 'clean' | 'converged' | 'budget'
  /** Per-round trace (for trajectory evals + debugging). */
  history: OptimizeRound[]
}

/**
 * Run the evaluator-optimizer loop on one item. Accepts a candidate only if it is NOT WORSE
 * than the best so far (ties allowed — a not-worse alternative is taken), and STOPS as soon as
 * a round fails to strictly improve the score (so it never thrashes one tic for another), or
 * when clean, or at the round budget. Returns the best item found — the loop can only hold or
 * improve quality, never regress it.
 */
export async function optimize<T>(initial: T, opts: OptimizeOptions<T>): Promise<OptimizeResult<T>> {
  const maxRounds = opts.maxRounds ?? 3
  let best = initial
  let bestEvals = [...(await opts.evaluate(initial))]
  let bestScore = findingScore(bestEvals)
  const history: OptimizeRound[] = []
  let round = 0

  while (bestScore > 0 && round < maxRounds) {
    round++
    const avoid = collectAvoid(bestEvals)
    const candidate = await opts.regenerate(avoid, best)
    const candidateEvals = [...(await opts.evaluate(candidate))]
    const candidateScore = findingScore(candidateEvals)
    const notWorse = candidateScore <= bestScore
    const improved = candidateScore < bestScore
    if (notWorse) {
      best = candidate
      bestEvals = candidateEvals
      bestScore = candidateScore
    }
    history.push({ round, avoid, candidateScore, accepted: notWorse })
    if (!improved) break // thrash guard: a round that didn't strictly help stops the loop
  }

  const stop: OptimizeResult<T>['stop'] =
    bestScore === 0 ? 'clean' : round >= maxRounds ? 'budget' : 'converged'
  return { item: best, evals: bestEvals, rounds: round, stop, history }
}

// ── WIRING NOTE (adopting this in generate.ts) ──────────────────────────────────────────
// Replace the bespoke lint→regen loop with, per stop:
//   const { item: script, evals } = await optimize(firstScript, {
//     evaluate: (s) => Promise.all([ evaluateGrounding({ ...gIn, script: s }), evaluateTts({ seq, script: s }) ])
//                        .then((rs) => rs.flat()),
//     regenerate: (avoid) => narrateStop({ ...baseReq(stop), ...ctx, avoid }, persona.systemPrompt).then(r => r.script),
//     maxRounds: 4,
//   })
// Per-stop dimensions (grounding, tts, charm) fit this loop directly. DIVERSITY is CROSS-stop
// (it lints the assembled set), so it stays a tour-level pass: run evaluateDiversity over all
// final scripts, then feed any flagged stop back through optimize() with its finding as the
// seed avoid-note. Keep generate.ts's existing per-stop context (recentOpeners/closers/kit/
// motifs) flowing into regenerate() — the loop only owns the accept/stop logic, not the prompt.
