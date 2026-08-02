// Persist eval runs durably — eval_runs/eval_scores are the automated gate's SYSTEM OF RECORD.
//
// V2 (2026-06-19): a RUN is one generate-narrations pass over a region's corpus; a SCORE is one
// (poi × dimension) verdict from the inline panel, keyed to the V2 atom (poi id + qid), with the
// WITHHELD flag denormalized so the admin can flat-filter the places the fail-closed gate held
// back. judge and HUMAN verdicts share the `source` primitive (human rows added later for
// calibration). OBSERVABILITY, never product state — failures are warned + swallowed by callers,
// and a DRY run MAY write here while persisting no narration.

import { db } from '@skipper/db'
import { evalRuns, evalScores } from '@skipper/db/schema'
import type { NewEvalScore } from '@skipper/db/schema'
import type { RunScorecard } from './types'

/** A clip's stable V2 identity, threaded onto its score rows + the withheld flag.
 *
 *  ⚠ EXACTLY ONE of `poiId` / `clusterId` is set, mirroring `narrations_subject_xor`. A FUSED cluster
 *  telling has no poi, and putting its cluster id in `poiId` would violate the eval_scores FK as well
 *  as being the same false statement the `poi_clusters` table exists to prevent. */
export interface ClipIdentity {
  poiId: string | null
  /** Set for a fused cluster telling; null for a place telling. */
  clusterId?: string | null
  /** ⚠ Null for a fused telling — a cluster has no QID. `eval_scores_case_idx` is keyed on
   *  (qid, dimension), so fused clips do NOT join across runs for regression tracking until that
   *  index learns about `cluster_id`. Known gap, not worth an index churn before the clips exist. */
  qid: string | null
  name: string
  /** True when this clip was WITHHELD (a GATE dim stayed dirty after the retakes). */
  withheld: boolean
  /** The withheld clip's best-attempt script (so the report shows the held-back telling). Null for
   *  a shipped clip — its script lives in `narrations`. */
  script: string | null
}

export interface EvalRunInput {
  /** The region slug the corpus run covered — NULL for a whole-corpus (explicit-id) run that
   *  spans no single region. */
  region: string | null
  kind: 'generation' | 'offline_audit'
  dryRun: boolean
  narrationModel?: string | null
  judgeModel?: string | null
  /** The scorecard rolled up over every evaluated clip (shipped AND withheld). */
  scorecard: RunScorecard
  total: number
  shipped: number
  withheld: number
  /** seq → the clip's stable identity, for the per-(poi × dimension) score rows. */
  identityBySeq?: Map<number, ClipIdentity>
}

/** A dimension's rollup score, or null when it wasn't run (no vacuous 1s in the trend columns). */
export function dimensionRollupScore(card: RunScorecard, dimension: string): number | null {
  const d = card.dimensions.find((x) => x.dimension === dimension)
  return d && d.stopsEvaluated > 0 ? d.score : null
}

/** Pure scorecard → score-row mapping (exported for tests; no I/O). */
export function buildScoreRows(
  runId: string,
  card: RunScorecard,
  identityBySeq?: Map<number, ClipIdentity>,
): NewEvalScore[] {
  return card.stops.map((s) => {
    const id = identityBySeq?.get(s.seq)
    return {
      runId,
      poiId: id?.poiId ?? null,
      clusterId: id?.clusterId ?? null,
      qid: id?.qid ?? null,
      name: id?.name ?? null,
      dimension: s.dimension,
      source: 'judge' as const,
      pass: s.pass,
      value: s.score,
      withheld: id?.withheld ?? false,
      findings: s.findings,
      detail: (s.detail ?? null) as NewEvalScore['detail'],
      script: id?.script ?? null,
    }
  })
}

function gitShaBestEffort(): string | null {
  try {
    const p = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD'], { cwd: import.meta.dir })
    return p.success ? new TextDecoder().decode(p.stdout).trim() : null
  } catch {
    return null
  }
}

/**
 * The run-level gate verdict: nothing was withheld AND every GATE dimension in the scorecard is clean.
 *
 * ⚠ It was `withheld === 0` alone, which is not the same claim. The gate scores the SCRIPT, but
 * tail-collapse and loudness are measured AFTER synthesis and folded into the scorecard
 * (`applyTailOutcomes` / `applyLoudnessOutcomes`) — by which point the clip has already shipped and was
 * never "withheld". So a run that synthesized a collapsed clip recorded `pass: true` and the admin
 * showed a green gate verdict for a run with a known-bad clip in it. `buildScorecard` already computes
 * the honest half (the AND over every GATE dimension, advisory dims excluded); this stopped discarding
 * it. ANDing is deliberately one-way — it can only turn a green red, never the reverse.
 *
 * Exported for the test: the expression itself is the thing that was wrong, so it needs to be
 * reachable without a database.
 */
export const runPassed = (card: RunScorecard, withheld: number): boolean => withheld === 0 && card.pass

/** Insert one run + its score rows ATOMICALLY. Returns the run id.
 *
 *  The run id is generated CLIENT-side so both inserts ride one `db.batch` — neon-http runs a
 *  batch as a single non-interactive transaction, so a run row can never land without its score
 *  rows (and no interactive-transaction driver is needed).
 *
 *  Run `pass` = nothing had to be withheld AND the scorecard's gate dimensions are all clean.
 *
 *  ⚠ It was `withheld === 0` alone, which is not the same claim. The gate runs on the SCRIPT, but the
 *  tail-collapse and loudness verdicts are measured AFTER synthesis and folded into the scorecard
 *  (`applyTailOutcomes` / `applyLoudnessOutcomes`) — by which point the clip has already shipped and
 *  was never "withheld". So a run that synthesized a collapsed clip recorded `pass: true`, and the
 *  admin showed a green gate verdict for a run with a known-bad clip in it. `buildScorecard` already
 *  computes the honest answer (the AND over every GATE dimension); this just stopped discarding it.
 *
 *  ANDing is deliberately one-way: it can only turn a green red, never the reverse. */
export async function recordEvalRun(input: EvalRunInput): Promise<string> {
  const card = input.scorecard
  const runId = crypto.randomUUID()
  const insertRun = db.insert(evalRuns).values({
    id: runId,
    region: input.region,
    kind: input.kind,
    dryRun: input.dryRun,
    gitSha: gitShaBestEffort(),
    narrationModel: input.narrationModel ?? null,
    judgeModel: input.judgeModel ?? null,
    pass: runPassed(card, input.withheld),
    total: input.total,
    shipped: input.shipped,
    withheld: input.withheld,
    groundingScore: dimensionRollupScore(card, 'grounding'),
    ttsScore: dimensionRollupScore(card, 'tts'),
    diversityScore: dimensionRollupScore(card, 'diversity'),
  })
  const scoreRows = buildScoreRows(runId, card, input.identityBySeq)
  if (scoreRows.length > 0) {
    await db.batch([insertRun, db.insert(evalScores).values(scoreRows)])
  } else {
    await insertRun
  }
  console.log(
    `Eval run recorded → eval_runs ${runId} (${scoreRows.length} score rows, ${input.withheld} withheld).`,
  )
  return runId
}
