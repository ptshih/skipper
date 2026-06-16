// gen_jobs lifecycle hook — the OPERATIONAL record of a cloud tour-ops run.
//
// A NO-OP unless GEN_JOB_ID is set, so the laptop CLI is byte-identical (it never sets it).
// In the cloud the Cloud Run Job receives GEN_JOB_ID: the admin-api mints the gen_jobs row
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
// Every write is BEST-EFFORT: a gen_jobs failure must NEVER fail the actual op — observability
// must not break generation. All DB calls swallow errors with a warning.
//
// Cloud Run injects CLOUD_RUN_EXECUTION automatically, so the row captures the real execution
// name for the admin-api's reconcile backstop without anyone passing it in.
// Background: docs/specs/admin-ops-console-spec.md §9.

import { eq, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { genJobs } from '@skipper/db/schema'
import type { NewGenJob } from '@skipper/db/schema'
import type { JobKind } from '@skipper/shared'
import { llmSpentUsd } from './spend'
import { installLogCapture, capturedLog, synthesizeJobOutput } from './job-output'

// gen_jobs.kind is a plain text column now; the closed vocabulary is the Zod `jobKind` in @skipper/shared.
type Kind = JobKind

// The kind of the run in progress — set at begin, used to flavor the finish-time log summary.
let currentKind: Kind | undefined

/** The identity of a tour-ops run, set at begin. */
interface BeginFields {
  dryRun: boolean
  /** generate: the tour slug. */
  targetSlug?: string
  /** Known up front for ops; generate backfills via finishJob. */
  tourId?: string
  /** patch_clip: the stop/frame id; resynth/sweep: the tour id. */
  targetId?: string
}

/** How a run ended. costUsd defaults to the process LLM tally (exact LLM spend). */
export interface FinishOutcome {
  ok: boolean
  error?: string
  costUsd?: number
  tourId?: string
  evalRunId?: string
}

const jobId = (): string | undefined => process.env.GEN_JOB_ID || undefined

const warn = (phase: string, e: unknown): void =>
  console.warn(`[job-progress] ${phase} write failed (non-fatal):`, e instanceof Error ? e.message : e)

/** Flip the gen_jobs row to `running`, creating it if a v0 gcloud run didn't pre-create one.
 *  No-op without GEN_JOB_ID. Never throws. */
export async function beginJob(kind: Kind, fields: BeginFields): Promise<void> {
  const id = jobId()
  if (!id) return
  currentKind = kind
  installLogCapture() // tee this run's stdout/stderr so finishJob can persist it on the row
  const row: NewGenJob = {
    id,
    kind,
    status: 'running',
    dryRun: fields.dryRun,
    targetSlug: fields.targetSlug ?? null,
    tourId: fields.tourId ?? null,
    targetId: fields.targetId ?? null,
    args: process.argv.slice(2),
    triggeredBy: process.env.GEN_JOB_TRIGGERED_BY || 'cli',
    cloudRunExecution: process.env.CLOUD_RUN_EXECUTION || null,
    startedAt: new Date(),
  }
  try {
    await db
      .insert(genJobs)
      .values(row)
      // The admin-api may have pre-created the row ('queued') with richer fields; on conflict
      // flip it running + stamp startedAt, preserving everything it set. Also BACKFILL the
      // execution name from THIS job's own env if the admin couldn't capture it at trigger time
      // (CLOUD_RUN_EXECUTION) — keeps every running row reconcilable. COALESCE keeps the admin's.
      .onConflictDoUpdate({
        target: genJobs.id,
        set: {
          status: 'running',
          startedAt: new Date(),
          updatedAt: new Date(),
          cloudRunExecution: sql`coalesce(${genJobs.cloudRunExecution}, ${row.cloudRunExecution})`,
        },
      })
  } catch (e) {
    warn('begin', e)
  }
}

/** Settle the gen_jobs row terminal. No-op without GEN_JOB_ID. Never throws. */
export async function finishJob(outcome: FinishOutcome): Promise<void> {
  const id = jobId()
  if (!id) return
  const set: Partial<NewGenJob> = {
    status: outcome.ok ? 'succeeded' : 'failed',
    endedAt: new Date(),
    costUsd: outcome.costUsd ?? llmSpentUsd(),
    updatedAt: new Date(),
  }
  if (outcome.error !== undefined) set.error = outcome.error.slice(0, 4000)
  if (outcome.tourId !== undefined) set.tourId = outcome.tourId
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
    await db.update(genJobs).set(set).where(eq(genJobs.id, id))
  } catch (e) {
    warn('finish', e)
  }
}
