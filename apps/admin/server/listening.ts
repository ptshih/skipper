import { releaseAssessmentResult } from '@skipper/shared'
import { listeningAssessmentFingerprint } from '@skipper/db/hash'
import { Hono } from 'hono'
import { and, eq, isNotNull, isNull, desc, inArray } from 'drizzle-orm'
import { db } from '@skipper/db'
import { listeningReviews, listeningReviewItems, listeningEvidence, drives, releaseAssessments, studioJobs } from '@skipper/db/schema'
import type { AdminEnv } from './auth'
import { presignGet } from './storage'
import { clipFingerprint, corpusFingerprint, loadPublication, publicationLock, buildApprovalQuery, releaseReviewed, reviewQueues, structuralBlockers,
  type PublicationSnapshot } from './publication'
import { user } from '@skipper/db/auth-schema'
import { loadStops } from '@skipper/sim/load'
import { selectionSubject } from '@skipper/db/schema'
import { pointInAnyBbox, parseBboxes } from './bbox'
import { runDrive, type LngLat } from '@skipper/engine'
import { requiredCorridors } from './corridors'
import { checkReviewAudio } from './audio-check'
import { assertEvidenceOwner } from './evidence-owner'
import { dispatchStudioJob } from './dispatch-job'
import { buildJobArgs } from './jobs'
import { previousListeningItems, listeningReviewSummaries } from './listening-history'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const routes = new Hono<AdminEnv>()
routes.onError((e, c) => c.json({ error: 'review_conflict', message: e.message }, 409))

async function session(id: string) {
  if (!uuid.test(id)) throw new Error('Invalid review ID')
  const [review] = await db.select().from(listeningReviews).where(eq(listeningReviews.id, id)).limit(1)
  if (!review) throw new Error('Review not found')
  const items = await db.select().from(listeningReviewItems).where(eq(listeningReviewItems.reviewId, id))
  const assessments = items.length ? await db.select().from(releaseAssessments).where(
    inArray(releaseAssessments.id, items.flatMap(i => i.assessmentId ? [i.assessmentId] : []))) : []
  const [assessmentJob] = await db.select({ id: studioJobs.id, status: studioJobs.status, phase: studioJobs.phase, error: studioJobs.error })
    .from(studioJobs).where(and(eq(studioJobs.kind, 'assess_listening_review'), eq(studioJobs.targetId, id))).orderBy(desc(studioJobs.createdAt)).limit(1)
  const currentItems = items.map(item => {
    const assessment = assessments.find(a => a.id === item.assessmentId) ?? null
    const result = releaseAssessmentResult.safeParse(assessment?.result)
    const current = assessment?.status === 'complete' && result.success
      && result.data.inputFingerprint === listeningAssessmentFingerprint(item.fingerprint, item.notes)
    // Historical model acceptance is not current approval after the model/policy/context changes.
    return { ...item, verdict: item.reviewer?.startsWith('model:') && !current ? 'unreviewed' : item.verdict,
      assessment: assessment && assessment.status === 'complete' && !current
        ? { ...assessment, result: null, error: 'Assessment changed or policy is outdated; reassessment required' } : assessment }
  })
  return { review, items: currentItems, assessmentJob, snapshot: review.snapshot as PublicationSnapshot }
}

routes.get('/regions/:slug/readiness', async c => {
  const p = await loadPublication(c.req.param('slug'))
  const [approved] = await db.select({ id: listeningReviews.id }).from(listeningReviews).where(and(
    eq(listeningReviews.regionSlug, c.req.param('slug')), eq(listeningReviews.fingerprint, p.fingerprint),
    isNotNull(listeningReviews.approvedAt), isNull(listeningReviews.narrationId), isNull(listeningReviews.publishedAt),
  )).limit(1)
  return c.json({ snapshot: p.value, fingerprint: p.fingerprint, blockers: p.blockers,
    requiredCorridors: requiredCorridors(c.req.param('slug')), structuralReady: p.blockers.length === 0, editorialApproved: approved != null && (await session(approved.id)).items.every(i => i.verdict === 'good' && i.technical != null && (i.technical as { ok?: boolean }).ok) })
})

routes.post('/regions/:slug/listening-reviews', async c => {
  const body = await c.req.json<{ narrationId?: string }>().catch(() => ({} as { narrationId?: string }))
  if (body.narrationId && !uuid.test(body.narrationId)) throw new Error('Invalid narration ID')
  const p = await loadPublication(c.req.param('slug'), body.narrationId ?? null)
  const id = crypto.randomUUID()
  const previous = await previousListeningItems(db, c.req.param('slug'))
  const values = reviewQueues(p.value.clips, 12, p.value.evidence).map(({ clip, queue }) => {
    const fingerprint = clipFingerprint(clip)
    const prior = previous.find(r => r.item.narrationId === clip.narration.id
      && r.item.fingerprint === fingerprint)?.item
    return { reviewId: id, narrationId: clip.narration.id, fingerprint, queue: queue === 'additional' ? 'flagged' : queue,
      assessmentId: prior?.assessmentId ?? null, verdict: prior?.verdict ?? 'unreviewed', notes: prior?.notes ?? '',
      advisoryReason: prior?.advisoryReason ?? '', technical: prior?.technical ?? null,
      reviewer: prior?.reviewer ?? null }
  })
  await db.batch([
    db.insert(listeningReviews).values({ id, regionSlug: c.req.param('slug'), narrationId: body.narrationId,
      fingerprint: p.fingerprint, snapshot: p.value, reviewer: c.get('adminEmail') }),
    ...(values.length ? [db.insert(listeningReviewItems).values(values)] : []),
  ])
  const assessment = values.length ? await dispatchStudioJob('assess_listening_review',
    buildJobArgs({ kind: 'assess_listening_review', reviewId: id, apply: true }), c.get('adminEmail')) : null
  return c.json({ id, assessment })
})

routes.post('/listening-reviews/:id/assess', async c => {
  const s = await session(c.req.param('id'))
  if (s.review.publishedAt) throw new Error('Published reviews cannot be reassessed')
  const result = await dispatchStudioJob('assess_listening_review', buildJobArgs({
    kind: 'assess_listening_review', reviewId: s.review.id, apply: true,
  }), c.get('adminEmail'))
  return c.json(result.body, result.status)
})

routes.get('/regions/:slug/listening-reviews', async c => {
  const reviews = await listeningReviewSummaries(db, c.req.param('slug'))
  return c.json({ reviews })
})

routes.get('/listening-reviews/:id', async c => {
  const s = await session(c.req.param('id'))
  const current = await loadPublication(s.review.regionSlug, s.review.narrationId)
  return c.json({ ...s, stale: current.fingerprint !== s.review.fingerprint,
    blockers: current.blockers,
    totalListeningMs: s.items.filter(i => i.verdict !== 'good').reduce((total, i) =>
      total + (s.snapshot.clips.find(clip => clip.narration.id === i.narrationId)?.narration.audio_duration_ms ?? 0), 0) })
})

routes.post('/listening-reviews/:id/release', async c => {
  const s = await session(c.req.param('id'))
  if (s.review.publishedAt) return c.json({ alreadyReleased: true, releasedClips: 0 })
  const result = await releaseReviewed(s.review.regionSlug, s.review.id, s.review.narrationId)
  if (!result.approved) throw new Error('Publication changed or approval is missing; create a replacement review')
  return c.json({ releasedClips: result.count, alreadyReleased: result.count === 0 })
})

routes.get('/listening-reviews/:id/audio/:narrationId', async c => {
  const s = await session(c.req.param('id'))
  const clip = s.snapshot.clips.find(n => n.narration.id === c.req.param('narrationId'))
  if (!clip) throw new Error('Clip is not in this review')
  // Review playback serves the frozen version, never silently substitutes regenerated audio.
  return c.json({ url: presignGet(clip.narration.audio_url) })
})

routes.patch('/listening-reviews/:id/items/:itemId', async c => {
  const s = await session(c.req.param('id'))
  const item = s.items.find(i => i.id === c.req.param('itemId'))
  if (!item) throw new Error('Review item not found')
  const body = await c.req.json<{ verdict: string; notes: string; advisoryReason: string }>()
  if (!['unreviewed', 'good', 'needs_work'].includes(body.verdict) || typeof body.notes !== 'string'
    || typeof body.advisoryReason !== 'string' || body.notes.length > 10000 || body.advisoryReason.length > 10000)
    throw new Error('Invalid verdict or notes')
  await db.batch([
    db.execute(publicationLock),
    db.update(listeningReviews).set({ approvedAt: null, approvedBy: null }).where(eq(listeningReviews.id, s.review.id)),
    db.update(listeningReviewItems).set({ verdict: body.verdict, notes: body.notes, advisoryReason: body.advisoryReason, reviewer: c.get('adminEmail'), updatedAt: new Date() })
      .where(and(eq(listeningReviewItems.id, item.id), eq(listeningReviewItems.reviewId, s.review.id))),
  ])
  return c.json({ saved: true })
})

routes.post('/listening-reviews/:id/technical/:itemId', async c => {
  const s = await session(c.req.param('id'))
  const item = s.items.find(i => i.id === c.req.param('itemId'))
  const clip = s.snapshot.clips.find(n => n.narration.id === item?.narrationId)
  if (!item || !clip) throw new Error('Review item not found')
  const response = await fetch(presignGet(clip.narration.audio_url), { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error('Private audio could not be downloaded')
  const bytes = new Uint8Array(await response.arrayBuffer())
  const technical = await checkReviewAudio(bytes, clip.narration.audio_duration_ms)
  await db.batch([
    db.execute(publicationLock),
    db.update(listeningReviews).set({ approvedAt: null, approvedBy: null }).where(eq(listeningReviews.id, s.review.id)),
    db.update(listeningReviewItems).set({ technical, updatedAt: new Date() }).where(eq(listeningReviewItems.id, item.id)),
  ])
  return c.json({ technical })
})

routes.post('/listening-reviews/:id/approve', async c => {
  const s = await session(c.req.param('id'))
  const p = await loadPublication(s.review.regionSlug, s.review.narrationId)
  const blockers = structuralBlockers(p.value)
  if (blockers.length) throw new Error(blockers.join('; '))
  // Lock first, then validate item verdicts and the publication version in the same transaction.
  const [, result] = await db.batch([
    db.execute(publicationLock),
    db.execute(buildApprovalQuery(p.query, s.review.id, c.get('adminEmail'))),
  ])
  if (!result.rows.length) throw new Error('Review is stale, technical checks are incomplete, or required verdicts/advisory reasons are missing')
  return c.json({ approved: true })
})

routes.post('/regions/:slug/listening-evidence', async c => {
  const body = await c.req.json<{ driveId: string; corridor: string; notes: string; mph: number }>()
  if (!uuid.test(body.driveId) || !requiredCorridors(c.req.param('slug')).includes(body.corridor)
    || typeof body.notes !== 'string' || !body.notes.trim() || body.notes.length > 10000
    || !Number.isFinite(body.mph) || body.mph < 5 || body.mph > 80) throw new Error('Supply a saved operator drive, corridor, speed, and access/quiet-window notes')
  const [owned] = await db.select({ deletedAt: drives.deletedAt,
    owner: { email: user.email, role: user.role, isAnonymous: user.isAnonymous },
  }).from(drives).innerJoin(user, eq(user.id, drives.userId))
    .where(eq(drives.id, body.driveId)).limit(1)
  assertEvidenceOwner(owned, c.get('adminEmail'))
  const p = await loadPublication(c.req.param('slug'))
  const resolved = await loadStops(body.driveId)
  const boxes = parseBboxes(p.value.region.bbox)
  const points = resolved.drive.polyline as LngLat[]
  const publicationSubjects = new Set(p.value.clips.map(clip => clip.narration.poi_id ?? clip.narration.cluster_id))
  const relevantSeqs = new Set(resolved.drive.selection.filter(item =>
    publicationSubjects.has(selectionSubject(item)?.id ?? '')).map(item => item.seq))
  if (!points.some(([lng, lat]) => pointInAnyBbox(boxes, lat, lng)) || !relevantSeqs.size)
    throw new Error('Drive must intersect this region and include its staged publication subjects')
  const report = runDrive(resolved.drive.polyline as LngLat[], resolved.stops.map(s => s.ref), { mph: body.mph })
  if (!report.stops.some(stop => stop.fired && relevantSeqs.has(stop.seq)))
    throw new Error('No staged region clip played on this route')
  const [evidence] = await db.insert(listeningEvidence).values({ regionSlug: c.req.param('slug'),
    corridor: body.corridor, driveId: body.driveId, corpusFingerprint: corpusFingerprint(p.value.clips),
    route: { polyline: resolved.drive.polyline, selection: resolved.drive.selection },
    report: { ...report, missing: resolved.missing }, notes: body.notes, reviewer: c.get('adminEmail'),
  }).returning()
  return c.json({ evidence })
})

export { routes as listeningRoutes }
