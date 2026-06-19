// pipeline_jobs lifecycle hook — the OPERATIONAL record of a cloud tour-ops run.
//
// A NO-OP unless STUDIO_JOB_ID is set, so the laptop CLI is byte-identical (it never sets it).
// In the cloud the Cloud Run Job receives STUDIO_JOB_ID: the admin-api mints the pipeline_jobs row
// (status 'queued') before triggering in v1; a gcloud-triggered v0 run just passes a fresh
// uuid and beginJob() inserts the row itself. EVERY gen-job entrypoint wraps its body in a
// main() guarded by beginJob/finishJob (the run.ts shape) — a NEW kind MUST do the same. Never
// call this from inside generate.ts (keeps the pipeline untouched). Full registry +
// enforcement: apps/admin/server/jobs.ts SCRIPTS + jobs.test.ts.
//
// LOG CAPTURE lives here too: beginJob() tees this run's console output; finishJob() persists it
// + an LLM summary onto the row (outputLog/outputSummary/outputData), atomically with the status
// flip. The admin READS that — it does NOT fetch Cloud Logging. So a kind that skips this hook
// records neither status nor logs in the console.
//
// Every write is BEST-EFFORT: a pipeline_jobs failure must NEVER fail the actual op — observability
// must not break generation. All DB calls swallow errors with a warning.
//
// Cloud Run injects CLOUD_RUN_EXECUTION automatically, so the row captures the real execution
// name for the admin-api's reconcile backstop without anyone passing it in.
// Background: docs/specs/admin-ops-console-spec.md §9.

import { eq, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pipelineJobs } from '@skipper/db/schema'
import type { NewPipelineJob } from '@skipper/db/schema'
import type { JobKind } from '@skipper/shared'
import { llmSpentUsd } from './spend'
import { installLogCapture, capturedLog, synthesizeJobOutput } from './job-output'

// pipeline_jobs.kind is a plain text column now; the closed vocabulary is the Zod `jobKind` in @skipper/shared.
type Kind = JobKind

// The kind of the run in progress — set at begin, used to flavor the finish-time log summary.
let currentKind: Kind | undefined

/** The identity of an ops run, set at begin. */
interface BeginFields {
  dryRun: boolean
  /** e.g. the region slug for a roam gen. */
  targetSlug?: string
  /** An ops audit label (the poi/region id the job acted on). */
  targetId?: string
}

/** How a run ended. costUsd defaults to the process LLM tally (exact LLM spend). */
export interface FinishOutcome {
  ok: boolean
  error?: string
  costUsd?: number
  evalRunId?: string
}

/** Normalize a thrown value to a string message (the begin/run/finish convention everywhere). */
export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const jobId = (): string | undefined => process.env.STUDIO_JOB_ID || undefined

const warn = (phase: string, e: unknown): void =>
  console.warn(`[job-progress] ${phase} write failed (non-fatal):`, e instanceof Error ? e.message : e)

/** Flip the pipeline_jobs row to `running`, creating it if a v0 gcloud run didn't pre-create one.
 *  No-op without STUDIO_JOB_ID. Never throws. */
export async function beginJob(kind: Kind, fields: BeginFields): Promise<void> {
  const id = jobId()
  if (!id) return
  currentKind = kind
  installLogCapture() // tee this run's stdout/stderr so finishJob can persist it on the row
  const row: NewPipelineJob = {
    id,
    kind,
    status: 'running',
    dryRun: fields.dryRun,
    targetSlug: fields.targetSlug ?? null,
    targetId: fields.targetId ?? null,
    args: process.argv.slice(2),
    triggeredBy: process.env.STUDIO_JOB_TRIGGERED_BY || 'cli',
    cloudRunExecution: process.env.CLOUD_RUN_EXECUTION || null,
    startedAt: new Date(),
  }
  try {
    await db
      .insert(pipelineJobs)
      .values(row)
      // The admin-api may have pre-created the row ('queued') with richer fields; on conflict
      // flip it running + stamp startedAt, preserving everything it set. Also BACKFILL the
      // execution name from THIS job's own env if the admin couldn't capture it at trigger time
      // (CLOUD_RUN_EXECUTION) — keeps every running row reconcilable. COALESCE keeps the admin's.
      .onConflictDoUpdate({
        target: pipelineJobs.id,
        set: {
          status: 'running',
          startedAt: new Date(),
          updatedAt: new Date(),
          cloudRunExecution: sql`coalesce(${pipelineJobs.cloudRunExecution}, ${row.cloudRunExecution})`,
        },
      })
  } catch (e) {
    warn('begin', e)
  }
}

/** Settle the pipeline_jobs row terminal. No-op without STUDIO_JOB_ID. Never throws. */
export async function finishJob(outcome: FinishOutcome): Promise<void> {
  const id = jobId()
  if (!id) return
  const set: Partial<NewPipelineJob> = {
    status: outcome.ok ? 'succeeded' : 'failed',
    endedAt: new Date(),
    costUsd: outcome.costUsd ?? llmSpentUsd(),
    updatedAt: new Date(),
  }
  if (outcome.error !== undefined) set.error = outcome.error.slice(0, 4000)
  if (outcome.evalRunId !== undefined) set.evalRunId = outcome.evalRunId
  // Persist THIS run's own captured output + an LLM summary in the same update that settles
  // status, so the operational record is complete the instant the row goes terminal — no
  // Cloud Logging round-trip. Runs on success AND failure (a failed run's log is the most
  // useful). Best-effort: a synth failure still writes the raw log and settles status.
  const log = capturedLog()
  if (log) {
    set.outputLog = log
    try {
      const { summary, data } = await synthesizeJobOutput(currentKind ?? 'generate', log)
      set.outputSummary = summary
      set.outputData = data
    } catch (e) {
      warn('synthesize', e)
      set.outputSummary = 'Summary unavailable.' // keep "log set ⟹ summary set" so the UI never hangs
    }
  }
  try {
    await db.update(pipelineJobs).set(set).where(eq(pipelineJobs.id, id))
  } catch (e) {
    warn('finish', e)
  }
}

/** The begin → run → finish wrapper every gen-job entrypoint shares (one exit semantics).
 *
 *  Pass `beginFields` to have runJob flip the row `running` before `fn` (entrypoints whose
 *  begin-fields are known up front). Pass `null` when `fn` calls beginJob itself mid-run
 *  (its fields are computed after arg-parse / validation, or it begins in multiple branches).
 *
 *  On success the row settles from `fn`'s returned outcome (so a richer success payload —
 *  costUsd / evalRunId — is forwarded), or `{ ok: true }` when it returns void.
 *  On throw: settle failed, log the message, and exit non-zero. */
export async function runJob(
  kind: Kind,
  beginFields: BeginFields | null,
  fn: () => Promise<FinishOutcome | void>,
): Promise<void> {
  if (beginFields) await beginJob(kind, beginFields)
  try {
    const out = await fn()
    await finishJob(out ?? { ok: true })
  } catch (e) {
    await finishJob({ ok: false, error: errMsg(e) })
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  }
}
