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

import { DIMENSION_KIND, type EvalDimension, type StopEval } from './types'

// A finding on a GATE dimension (grounding/tts) weighs heavier than an advisory one
// (charm/diversity), so the loop spends its budget killing hard violations before polish.
const GATE_WEIGHT = 10
const ADVISORY_WEIGHT = 1
/** An advisory finding the dimension marked HARD — a banned wind-up/tic. Between the two, and it is
 *  the ORDERING that matters rather than the number: one hard finding must outrank an ordinary one so
 *  the loop spends its retakes on the fixable defect.
 *
 *  ⚠ It does NOT make a gate unbuyable, and it does not need to: enough hard findings would out-total
 *  a single gate violation (4 × 3 > 10), but `gatesNotWorse` is a SEPARATE and absolute veto — a
 *  candidate worse on any gate dimension is rejected no matter how the weighted score lands. Do not
 *  "fix" this by tuning the number; the Pareto guard is the safety property, this is only triage.
 *
 *  ⚠ WHY THIS TIER EXISTS, measured over the 457 released clips (2026-07-30): 155 of them ship a
 *  hard-banned tic — 148 carry the "here's the …" family — and every one was CAUGHT at generation
 *  time. They shipped because the ban scored 1, exactly like a shared n-gram, while the n-gram rule
 *  flags 38% of the corpus. So the loop was indifferent between clearing a defect the model can
 *  actually fix on the next take and clearing one it cannot (a shared n-gram is the same SOURCE fact
 *  handed to dozens of POIs — a $1.68 regeneration probe showed rewording does not move it), and for
 *  the 50 clips whose ONLY finding was a ban, a take that swapped the ban for any other single
 *  finding scored a TIE, got accepted, and stopped the loop. */
const HARD_ADVISORY_WEIGHT = 4

/** Weighted finding count — the score the loop MINIMIZES (0 = nothing flagged). */
export function findingScore(evals: StopEval[]): number {
  return evals.reduce((n, e) => {
    if (DIMENSION_KIND[e.dimension] === 'gate') return n + e.findings.length * GATE_WEIGHT
    // `hardFindings` is a COUNT of findings already inside `findings`, so it is an upcharge on those,
    // never an addition — and it is clamped in case a dimension ever reports more than it lists.
    const hard = Math.min(e.hardFindings ?? 0, e.findings.length)
    return n + (e.findings.length - hard) * ADVISORY_WEIGHT + hard * HARD_ADVISORY_WEIGHT
  }, 0)
}

const isGate = (e: StopEval): boolean => DIMENSION_KIND[e.dimension] === 'gate'

/** Finding count per GATE dimension — the per-dimension ledger behind the Pareto guard. */
function gateFindingCounts(evals: StopEval[]): Map<EvalDimension, number> {
  const counts = new Map<EvalDimension, number>()
  for (const e of evals) {
    if (isGate(e)) counts.set(e.dimension, (counts.get(e.dimension) ?? 0) + e.findings.length)
  }
  return counts
}

/**
 * The PARETO guard on gates: a candidate may not be worse on ANY gate dimension, no matter
 * what it clears elsewhere. The flattened findingScore alone would happily trade gate for
 * gate (one new hallucination for one cleared markdown leak scores as a tie) or buy a gate
 * violation with a pile of cleared advisory tics — and a regen must NEVER add a gate
 * violation the previous take didn't have. Dimensions absent from a side count as clean.
 */
export function gatesNotWorse(candidate: StopEval[], best: StopEval[]): boolean {
  const bestCounts = gateFindingCounts(best)
  for (const [dim, n] of gateFindingCounts(candidate)) {
    if (n > (bestCounts.get(dim) ?? 0)) return false
  }
  return true
}

/**
 * Fold the failing evals into actionable avoid-notes for the next regen. Gate dimensions lead
 * (most important to fix), and a dimension that ships purpose-built regen instructions as a
 * string[] `detail` (diversity carries the lint's own `avoid` notes) uses those over its
 * human-readable `findings`.
 */
export function collectAvoid(evals: StopEval[]): string[] {
  // Gates lead, then a dimension carrying HARD findings, then the rest. The order is not cosmetic:
  // these notes go into the next prompt, and a banned tic the model can actually fix should not sit
  // below a pile of shared-phrase notes it mostly cannot.
  const rank = (e: StopEval): number => (isGate(e) ? 2 : (e.hardFindings ?? 0) > 0 ? 1 : 0)
  const failing = evals.filter((e) => !e.pass).sort((a, b) => rank(b) - rank(a))
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
 * than the best so far — on the weighted score AND per gate dimension (the Pareto guard:
 * clearing tics can never buy a new gate violation; ties on both are allowed, so a not-worse
 * alternative is taken). STOPS as soon as a round fails to strictly improve the score (so it
 * never thrashes one tic for another), or when clean, or at the round budget. Returns the
 * best item found — the loop can only hold or improve quality, never regress it.
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
    const notWorse = candidateScore <= bestScore && gatesNotWorse(candidateEvals, bestEvals)
    const improved = notWorse && candidateScore < bestScore
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

// ── HOW generate-narrations.ts WIRES THIS ──────────────────────────────────────────────────
// gateClip() (generate-narrations.ts ~L350) makes ONE optimize() call per clip. Its evaluate()
// runs the whole per-clip panel together — evaluateTts + evaluateDiversity + evaluateLaterality
// + evaluatePacing, plus evaluateGrounding behind SKIPPER_GROUNDING_EVAL. Its regenerate()
// excises the ungrounded claims for a grounding failure (eval/excise.ts) and otherwise
// re-narrates via narrateStop with the avoid notes folded in. The loop owns only accept/stop.
