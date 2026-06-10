// Persist eval runs durably — eval_runs/eval_scores are the eval loop's SYSTEM OF RECORD.
//
// Decided 2026-06-09 after a best-practices survey (see docs/decisions/
// fact-overrides-and-veracity.md): every eval platform converges on "the run is a DB record
// keyed to a pinned artifact; local files are dev transport". One run row carries the full
// GenerateResult artifact (jsonb, ~100KB — squarely in-DB territory) + typed rollup columns
// for trend queries; one score row per (run × stop × dimension) keyed by the STABLE place
// identity (pois source/source_id — stop ids regenerate, places don't), so run-over-run
// regression is a join and judge↔human calibration is a GROUP BY (human adjudications are
// `source='human'` rows on the same case).
//
// These tables are observability, never product state — recording failures are warned and
// swallowed by callers, and a DRY generation may write here while writing no tour state.

import { eq } from 'drizzle-orm'
import { db } from '@skipper/db'
import { evalRuns, evalScores, tours } from '@skipper/db/schema'
import type { NewEvalScore } from '@skipper/db/schema'
import { JUDGMENT_MODEL } from '../models'
import type { TourScorecard } from './types'

export interface StopIdentity {
  poiSource?: string
  poiSourceId?: string
  stopType?: 'story' | 'scenic' | 'break'
}

export interface EvalRunInput {
  slug: string
  tourId?: string | null
  kind: 'generation' | 'offline_audit'
  dryRun: boolean
  narrationModel?: string | null
  judgeModel?: string | null
  scorecard: TourScorecard
  /** The full artifact the scorecard scored (a GenerateResult, or whatever the CLI read). */
  artifact: unknown
  /** seq → stable place identity, for the cross-run score rows. */
  identityBySeq?: Map<number, StopIdentity>
}

/** A dimension's rollup score, or null when it wasn't run (no vacuous 1s in trend columns). */
export function dimensionRollupScore(card: TourScorecard, dimension: string): number | null {
  const d = card.dimensions.find((x) => x.dimension === dimension)
  return d && d.stopsEvaluated > 0 ? d.score : null
}

/** Pure scorecard → score-row mapping (exported for tests; no I/O). */
export function buildScoreRows(
  runId: string,
  card: TourScorecard,
  identityBySeq?: Map<number, StopIdentity>,
): NewEvalScore[] {
  return card.stops.map((s) => {
    const ident = identityBySeq?.get(s.seq)
    return {
      runId,
      poiSource: ident?.poiSource ?? null,
      poiSourceId: ident?.poiSourceId ?? null,
      seq: s.seq,
      stopType: ident?.stopType ?? null,
      dimension: s.dimension,
      source: 'judge' as const,
      pass: s.pass,
      value: s.score,
      findings: s.findings,
      detail: s.detail ?? null,
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

/** Insert one run + its score rows ATOMICALLY. Returns the run id.
 *
 *  The run id is generated CLIENT-side so both inserts can ride one `db.batch` — neon-http
 *  runs a batch as a single non-interactive transaction, so a run row can never land
 *  without its score rows (and no interactive-transaction driver is needed for it). */
export async function recordEvalRun(input: EvalRunInput): Promise<string> {
  const card = input.scorecard
  const runId = crypto.randomUUID()
  const insertRun = db.insert(evalRuns).values({
    id: runId,
    tourId: input.tourId ?? null,
    slug: input.slug,
    kind: input.kind,
    dryRun: input.dryRun,
    gitSha: gitShaBestEffort(),
    narrationModel: input.narrationModel ?? null,
    judgeModel: input.judgeModel ?? null,
    pass: card.pass,
    groundingScore: dimensionRollupScore(card, 'grounding'),
    ttsScore: dimensionRollupScore(card, 'tts'),
    diversityScore: dimensionRollupScore(card, 'diversity'),
    charmScore: dimensionRollupScore(card, 'charm'),
    veracityScore: dimensionRollupScore(card, 'veracity'),
    artifact: input.artifact as Record<string, unknown>,
    scorecard: card as unknown as Record<string, unknown>,
  })
  const scoreRows = buildScoreRows(runId, card, input.identityBySeq)
  if (scoreRows.length > 0) {
    await db.batch([insertRun, db.insert(evalScores).values(scoreRows)])
  } else {
    await insertRun
  }
  console.log(`Eval run recorded → eval_runs ${runId} (${scoreRows.length} score rows).`)
  return runId
}

/** Best-effort tour lookup for the offline CLI (the artifact may predate the tour row). */
export async function tourIdForSlug(slug: string): Promise<string | null> {
  const rows = await db.select({ id: tours.id }).from(tours).where(eq(tours.slug, slug))
  return rows[0]?.id ?? null
}

/** The minimal GenerateResult surface the generation-path recorder needs (structural —
 *  avoids a pipeline/generate ↔ eval import cycle). */
export interface GenerationArtifactLike {
  slug: string
  tourId?: string
  dryRun: boolean
  narrationModel?: string
  stops: { seq: number; source?: string; sourceId?: string; stopType?: string }[]
  eval: { scorecard: TourScorecard }
}

/** Record the in-pipeline panel's run (live or dry) straight from a GenerateResult. */
export async function recordGenerationEval(result: GenerationArtifactLike): Promise<string> {
  return recordEvalRun({
    slug: result.slug,
    tourId: result.tourId ?? null,
    kind: 'generation',
    dryRun: result.dryRun,
    narrationModel: result.narrationModel ?? null,
    judgeModel: JUDGMENT_MODEL,
    scorecard: result.eval.scorecard,
    artifact: result,
    identityBySeq: new Map(
      result.stops.map((s) => [
        s.seq,
        {
          ...(s.source ? { poiSource: s.source } : {}),
          ...(s.sourceId ? { poiSourceId: s.sourceId } : {}),
          ...(s.stopType ? { stopType: s.stopType as StopIdentity['stopType'] } : {}),
        },
      ]),
    ),
  })
}
