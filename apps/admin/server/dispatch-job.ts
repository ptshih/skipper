import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@skipper/db'
import { studioJobs } from '@skipper/db/schema'
import { runJob, TriggerRejected, type BuildResult, type JobKind } from './jobs'
import { isUniqueViolation } from './database-errors'

/** Shared dispatch for explicitly requested jobs and automatic operator review assessments.
 * Preserve ambiguous outcomes as queued: a lost response is not proof that a paid job didn't start.
 */
export async function dispatchStudioJob(kind: JobKind, build: BuildResult, triggeredBy: string) {
  // Idempotency: one in-flight run per target (a lost-response retry / double-click can't double-spend).
  // This SELECT is the fast-path 409; the DB partial-unique index `studio_jobs_active_target_uq`
  // (migration 0026) is the ATOMIC backstop for a concurrent submit that races PAST this check — caught
  // at the insert below. (audit #1)
  const targetCond = build.targetSlug
    ? eq(studioJobs.targetSlug, build.targetSlug)
    : build.targetId
      ? eq(studioJobs.targetId, build.targetId)
      : undefined
  const active = await db
    .select({ id: studioJobs.id })
    .from(studioJobs)
    .where(and(eq(studioJobs.kind, kind), inArray(studioJobs.status, ['queued', 'running']), targetCond))
    .limit(1)
  if (active.length) {
    return { status: 409 as const, body: { error: 'conflict', message: 'A run for this target is already in progress.' } }
  }

  const id = crypto.randomUUID()
  try {
    await db.insert(studioJobs).values({
      id,
      kind,
      status: 'queued',
      dryRun: build.dryRun,
      targetSlug: build.targetSlug ?? null,
      targetId: build.targetId ?? null,
      args: build.args,
      triggeredBy,
    })
  } catch (e) {
    // A concurrent submit that slipped past the SELECT above loses the unique-index race here → the
    // same 409, no double-spend. (Before migration 0026 is APPLIED the index doesn't exist, so this
    // branch never fires and the SELECT-409 stays the sole guard — deploy-safe either way.) (audit #1)
    if (isUniqueViolation(e)) {
      return { status: 409 as const, body: { error: 'conflict', message: 'A run for this target is already in progress.' } }
    }
    throw e
  }

  let execShortName = ''
  try {
    execShortName = await runJob(build.args, { STUDIO_JOB_ID: id, STUDIO_JOB_TRIGGERED_BY: triggeredBy })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof TriggerRejected) {
      // Cloud Run definitively refused — nothing was created, so settle the row and free the target.
      await db
        .update(studioJobs)
        .set({ status: 'failed', error: msg, endedAt: new Date() })
        .where(and(eq(studioJobs.id, id), inArray(studioJobs.status, ['queued', 'running'])))
      return { status: 502 as const, body: { error: 'trigger_failed', message: msg } }
    }
    // ⚠ AMBIGUOUS — leave it QUEUED. A network reset or an unreadable body means we never learned
    // whether the execution was created; marking it 'failed' with a NULL execution name released the
    // in-flight lock and told the operator nothing had started, so the natural retry ran the same PAID
    // work again, alongside the first. Queued is the honest state: `beginJob` flips it to 'running'
    // and backfills the execution name if it really did start, and `expireStuckJob` settles it if it
    // did not. The target stays locked meanwhile, which is the safe direction.
    console.error('[admin] jobs:run outcome unknown — leaving the row queued', id, e)
    return { status: 502 as const, body: {
        error: 'trigger_unknown',
        message: `${msg} — the run may have started. It is left queued; the Jobs page will settle it either way.`,
      } }
  }
  if (execShortName) {
    await db.update(studioJobs).set({ cloudRunExecution: execShortName }).where(eq(studioJobs.id, id))
  }

  const row = (await db.select().from(studioJobs).where(eq(studioJobs.id, id)).limit(1))[0]
  return { status: 201 as const, body: { job: row } }
}
