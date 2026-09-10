#!/usr/bin/env bun
// SPENDS $ (audio LLM) + MUTATES DB: exact saved review/cache/job only; never narration bytes or release.
import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { listeningReviews, listeningReviewItems, releaseAssessments, studioJobs } from '@skipper/db/schema'
import { listeningAssessmentFingerprint } from '@skipper/db/hash'
import { presignGet } from '@skipper/storage'
import { checkReviewAudio } from '@skipper/storage/audio-check'
import { RELEASE_ASSESSMENT_MODEL, RELEASE_ASSESSMENT_POLICY, releaseAssessmentResult,
  acceptsReleaseJudgment, isHardReviewFinding, type ReviewFinding } from '@skipper/shared'
import { judgeReleaseAudio } from './release-review/judge'
import { runJob } from './pipeline/job-progress'

type Clip = { narration: { id: string; audio_url: string; audio_duration_ms: number }; findings: ReviewFinding[] }
const args = process.argv.slice(2)
const reviewId = args.find(a => a.startsWith('--review='))?.slice(9)
const apply = args.includes('--apply')
const maxCost = Number(args.find(a => a.startsWith('--max-cost='))?.slice(11) ?? 25)
if (!reviewId || !/^[0-9a-f-]{36}$/i.test(reviewId) || !Number.isFinite(maxCost) || maxCost <= 0 || maxCost > 100)
  throw new Error('Supply --review=<uuid> and --max-cost between 0 and 100; preview unless --apply')
// A CLI run also needs a durable owner for cache claims; a vanished process must not be mistaken
// for a completed judgment. The existing job lifecycle records this ID exactly as a cloud run does.
if (apply) process.env.STUDIO_JOB_ID ??= crypto.randomUUID()

await runJob('assess_listening_review', { dryRun: !apply, targetId: reviewId }, async () => {
  const [review] = await db.select().from(listeningReviews).where(eq(listeningReviews.id, reviewId)).limit(1)
  if (!review) throw new Error('Review not found')
  if (review.publishedAt) throw new Error('Published reviews are immutable assessment history')
  const clips = (review.snapshot as { clips: Clip[] }).clips
  const items = await db.select().from(listeningReviewItems).where(eq(listeningReviewItems.reviewId, reviewId))
  if (!items.length || items.length !== clips.length) throw new Error('Review has no complete publication set')
  console.log({ reviewId, clips: clips.length, model: RELEASE_ASSESSMENT_MODEL, policy: RELEASE_ASSESSMENT_POLICY, apply, maxCost })
  if (!apply) return { ok: true, costUsd: 0 }
  let budgetUsed = 0, costUsd = 0, accepted = 0, attention = 0, reused = 0, failed = 0
  const jobId = process.env.STUDIO_JOB_ID!
  try {
  for (let offset = 0; offset < items.length; offset += 3) {
  const batch = await Promise.allSettled(items.slice(offset, offset + 3).map(async item => {
    const [job] = await db.select({ status: studioJobs.status }).from(studioJobs).where(eq(studioJobs.id, jobId)).limit(1)
    if (!job || !['queued', 'running'].includes(job.status)) throw new Error('Assessment job canceled or unavailable')
    const clip = clips.find(c => c.narration.id === item.narrationId)
    if (!clip || createHash('sha256').update(JSON.stringify(clip)).digest('hex') !== item.fingerprint)
      throw new Error('Frozen clip and review-item fingerprints disagree')
    const fingerprint = listeningAssessmentFingerprint(item.fingerprint, item.notes)
    const key = and(eq(releaseAssessments.inputFingerprint, fingerprint), eq(releaseAssessments.model, RELEASE_ASSESSMENT_MODEL),
      eq(releaseAssessments.policyVersion, RELEASE_ASSESSMENT_POLICY))
    let [cached] = await db.select().from(releaseAssessments).where(key).limit(1)
    const waitDeadline = Date.now() + 15 * 60 * 1000
    while (cached?.status === 'pending') {
      const [owner] = cached.jobId ? await db.select({ status: studioJobs.status }).from(studioJobs).where(eq(studioJobs.id, cached.jobId)).limit(1) : []
      if (owner && ['queued', 'running'].includes(owner.status)) {
        if (cached.jobId === jobId || Date.now() > waitDeadline) throw new Error('Assessment owner is still active; no duplicate call was made')
        await Bun.sleep(5000)
        ;[cached] = await db.select().from(releaseAssessments).where(key).limit(1)
        continue
      }
      // Only a terminal/missing owner permits recovery; elapsed time alone is not evidence of death.
      if (!owner || !['queued', 'running'].includes(owner.status)) {
        await db.update(releaseAssessments).set({ status: 'failed', error: 'Previous assessment owner stopped', updatedAt: new Date() })
          .where(and(eq(releaseAssessments.id, cached.id), eq(releaseAssessments.status, 'pending'), sql`${releaseAssessments.jobId} is not distinct from ${cached.jobId}::uuid`))
        cached = undefined
      }
    }
    if (cached?.status !== 'complete') {
      const claimed = await db.insert(releaseAssessments).values({ inputFingerprint: fingerprint, model: RELEASE_ASSESSMENT_MODEL,
        policyVersion: RELEASE_ASSESSMENT_POLICY, jobId }).onConflictDoUpdate({ target: [releaseAssessments.inputFingerprint,
          releaseAssessments.model, releaseAssessments.policyVersion], set: { status: 'pending', jobId, error: null, updatedAt: new Date() },
          setWhere: eq(releaseAssessments.status, 'failed') }).returning()
      cached = claimed[0]
      if (!cached) throw new Error('Another job claimed this clip; no duplicate model call was made')
      const claimId = cached.id
      await db.update(studioJobs).set({ phase: `Assessing ${accepted + attention + 1}/${items.length}` }).where(eq(studioJobs.id, jobId))
      try {
        if (clip.findings.some(isHardReviewFinding)) throw new Error('Hard generation finding must be corrected before model acceptance')
        if (clip.narration.audio_duration_ms > 600000) throw new Error('Audio exceeds the ten-minute assessment limit')
        const response = await fetch(presignGet(clip.narration.audio_url), { signal: AbortSignal.timeout(30000) })
        if (!response.ok) throw new Error('Frozen private audio unavailable')
        const bytes = new Uint8Array(await response.arrayBuffer())
        const technical = await checkReviewAudio(bytes, clip.narration.audio_duration_ms)
        if (!technical.ok) throw new Error(technical.message)
        // Reserve a conservative upper bound for the capped context/audio/output request.
        // Reservation happens synchronously before awaiting the model, including concurrent clips.
        if (budgetUsed + 3 > maxCost) throw new Error('Assessment spend cap reached; remaining clips need a later run')
        budgetUsed += 3
        const result = await judgeReleaseAudio({ clip, notes: item.notes, bytes, fingerprint, technical, onUsage: usage => {
          costUsd += usage.costUsd; budgetUsed += usage.costUsd - 3
        } })
        const updated = await db.update(releaseAssessments).set({ status: 'complete', result, updatedAt: new Date() })
          .where(and(eq(releaseAssessments.id, cached.id), eq(releaseAssessments.jobId, jobId), eq(releaseAssessments.status, 'pending'))).returning()
        cached = updated[0]
        if (!cached) throw new Error('Assessment claim changed during model work')
      } catch (error) {
        failed++
        const message = error instanceof Error ? error.message : String(error)
        console.error(`Assessment exception for ${item.narrationId}: ${message}`)
        await db.update(releaseAssessments).set({ status: 'failed', error: message, updatedAt: new Date() })
          .where(and(eq(releaseAssessments.id, claimId), eq(releaseAssessments.jobId, jobId)))
        cached = { ...cached!, status: 'failed', error: message }
      }
    } else reused++
    const parsed = releaseAssessmentResult.safeParse(cached.result)
    const valid = cached.status === 'complete' && parsed.success && parsed.data.inputFingerprint === fingerprint
    const good = valid && parsed.data.technical.ok && acceptsReleaseJudgment(parsed.data.judgment)
      && (!clip.findings.some(f => !f.pass) || !!parsed.data.judgment.advisoryExplanation.trim())
    good ? accepted++ : attention++
    // Human Good/Needs work wins. Model output never goes into human notes. A concurrent note edit
    // invalidates this item's input hash, so leave it for the next assessment rather than overwrite.
    await db.batch([
      db.execute(sql`lock table listening_reviews,listening_review_items in share row exclusive mode`),
      db.update(listeningReviews).set({ approvedAt: null, approvedBy: null }).where(and(eq(listeningReviews.id, reviewId), sql`${listeningReviews.publishedAt} is null`)),
      db.update(listeningReviewItems).set({ assessmentId: cached.id,
        ...(valid ? { technical: parsed.data.technical } : {}),
        verdict: good ? 'good' : 'unreviewed', queue: item.queue === 'reel' ? 'reel' : 'flagged',
        advisoryReason: good ? `Automatically accepted by ${RELEASE_ASSESSMENT_MODEL}: ${parsed.data.judgment.advisoryExplanation || parsed.data.judgment.summary}` : '',
        reviewer: `model:${RELEASE_ASSESSMENT_MODEL}`, updatedAt: new Date() })
        .where(and(eq(listeningReviewItems.id, item.id), eq(listeningReviewItems.fingerprint, item.fingerprint), eq(listeningReviewItems.notes, item.notes),
          sql`(${listeningReviewItems.verdict} = 'unreviewed' or ${listeningReviewItems.reviewer} like 'model:%')`,
          sql`exists(select 1 from listening_reviews r where r.id=${reviewId}::uuid and r.published_at is null)`)),
    ])
    console.log({ narrationId: item.narrationId, decision: good ? 'model_accepted' : 'needs_attention', reused, costUsd })
  }))
  const rejected = batch.find(result => result.status === 'rejected')
  if (rejected?.status === 'rejected') throw rejected.reason
  }
  } catch (error) {
    return { ok: false, costUsd, error: error instanceof Error ? error.message : String(error) }
  }
  console.log({ assessed: items.length, accepted, attention, reused, failed, knownModelCostUsd: costUsd,
    note: failed ? 'Failed/timeout calls may incur additional provider charges; inspect exceptions.' : 'All model usage recorded.' })
  return { ok: failed === 0, costUsd, ...(failed ? { error: `${failed} assessment exceptions need attention or retry` } : {}) }
})
