// @skipper/admin — the founder-only ops console (Hono, served natively by bun).
//
// v1 BACKEND. Behind Google IAP (requireAdmin asserts the founder's identity); a separate
// Cloud Run service from the public api.skipper.fm so a routing bug can't leak ops onto the
// funnel. Reads the same DB + presigns R2 for the ear-pass; triggers the skipper-gen Cloud
// Run Job for ops (jobs.ts); authors tours via the LLM-propose → human-approve flow
// (create-tour.ts). Background: docs/specs/admin-ops-console-spec.md §6.
//
//   GET  /health                  -> liveness (OPEN — Cloud Run probes don't pass through IAP)
//   --- everything below is behind requireAdmin (IAP founder-only) ---
//   GET  /admin/regions           -> region list (for the Create-Tour form)
//   GET  /admin/tours             -> catalog: every tour (incl. drafts) + status + counts
//   GET  /admin/tours/:id         -> the ear-pass: stops/brackets + scripts + latest eval
//   GET  /admin/tours/:id/sign    -> presigned R2 URLs for every clip (no tier gate)
//   GET  /admin/evals?slug=       -> eval_runs history for a slug (the trend)
//   GET  /admin/jobs              -> recent gen_jobs (operational record; powers job polling)
//   GET  /admin/runs              -> unified Runs timeline: gen_jobs + orphan eval_runs
//   GET  /admin/jobs/:id          -> one run (reconciled against its Cloud Run execution) + logs URL
//   POST /admin/jobs              -> trigger an op as a skipper-gen Job  (jobs.ts — Phase 3)
//   POST /admin/jobs/:id/cancel   -> stop a running execution (gen_job_status='canceled') (§14.8)
//   GET  /admin/integrity         -> ready tours violating the audio/attribution invariant (§14.9)
//   POST /admin/tours/propose     -> Create Tour, phase 1: LLM + geocode  (create-tour.ts — Phase 4)
//   POST /admin/tours             -> Create Tour, phase 2: freeze + draft  (create-tour.ts — Phase 4)

import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import {
  evalRuns,
  evalScores,
  genJobs,
  pois,
  regions,
  tourBrackets,
  tourStops,
  tours,
} from '@skipper/db/schema'
import { requireAdmin, type AdminEnv } from './auth'
import { contentTypeForKey, presignGet } from './storage'
import {
  buildJobArgs,
  cancelExecution,
  executionState,
  HttpError,
  jobExecutionLogsUrl,
  runJob,
  type BuildResult,
  type JobKind,
} from './jobs'
import { freezeTour, proposeTour, type ProposePrompt } from './create-tour'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const app = new Hono<AdminEnv>()

app.onError((err, c) => {
  console.error('[admin] unhandled error', err)
  return c.json({ error: 'internal' }, 500)
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Liveness — OPEN (Cloud Run startup/liveness probes hit the container directly, not via IAP).
app.get('/health', (c) => c.json({ ok: true }))

// Everything else is founder-only.
app.use('/admin/*', requireAdmin)

app.get('/admin/regions', async (c) => {
  const rows = await db
    .select({ slug: regions.slug, displayName: regions.displayName })
    .from(regions)
    .orderBy(asc(regions.displayName))
  return c.json({ regions: rows })
})

// Catalog — EVERY tour (drafts included; the admin operates the whole catalog, unlike the
// public /tours which only lists ready ones), with stop/bracket counts and an authored flag.
app.get('/admin/tours', async (c) => {
  const rows = await db
    .select({
      id: tours.id,
      slug: tours.slug,
      headline: tours.headline,
      regionSlug: regions.slug,
      regionName: regions.displayName,
      status: tours.status,
      distanceMeters: tours.distanceMeters,
      durationSeconds: tours.durationSeconds,
      routeProvenance: tours.routeProvenance,
      createdAt: tours.createdAt,
      updatedAt: tours.updatedAt,
    })
    .from(tours)
    .innerJoin(regions, eq(tours.regionId, regions.id))
    .orderBy(desc(tours.createdAt))

  const ids = rows.map((r) => r.id)
  const stopCount = new Map<string, number>()
  const bracketCount = new Map<string, number>()
  if (ids.length) {
    const [sc, bc] = await Promise.all([
      db
        .select({ tourId: tourStops.tourId, n: count() })
        .from(tourStops)
        .where(inArray(tourStops.tourId, ids))
        .groupBy(tourStops.tourId),
      db
        .select({ tourId: tourBrackets.tourId, n: count() })
        .from(tourBrackets)
        .where(inArray(tourBrackets.tourId, ids))
        .groupBy(tourBrackets.tourId),
    ])
    for (const r of sc) stopCount.set(r.tourId, Number(r.n))
    for (const r of bc) bracketCount.set(r.tourId, Number(r.n))
  }

  return c.json({
    tours: rows.map(({ routeProvenance, ...r }) => ({
      ...r,
      stops: stopCount.get(r.id) ?? 0,
      brackets: bracketCount.get(r.id) ?? 0,
      // 'admin' = LLM-proposed + human-approved at runtime; 'seed' = the committed seed/data route.
      authored: routeProvenance ? 'admin' : 'seed',
    })),
  })
})

// The ear-pass: a tour's stops/brackets WITH scripts + the latest eval scores. Audio URLs
// come from /sign. Includes drafts (status surfaced) so a freshly-generated tour can be vetted.
app.get('/admin/tours/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'not_found' }, 404)
  const tour = (await db.select().from(tours).where(eq(tours.id, id)).limit(1))[0]
  if (!tour) return c.json({ error: 'not_found' }, 404)

  const [regionRows, stops, brackets, latestRun] = await Promise.all([
    db
      .select({ slug: regions.slug, displayName: regions.displayName })
      .from(regions)
      .where(eq(regions.id, tour.regionId))
      .limit(1),
    db
      .select({
        seq: tourStops.seq,
        stopType: tourStops.stopType,
        name: pois.name,
        poiSource: pois.source,
        poiSourceId: pois.sourceId,
        script: tourStops.script,
        audioUrl: tourStops.audioUrl,
        audioDurationMs: tourStops.audioDurationMs,
        attribution: tourStops.attribution,
        factsHash: tourStops.factsHash,
        triggerLat: tourStops.triggerLat,
        triggerLng: tourStops.triggerLng,
        triggerRadiusM: tourStops.triggerRadiusM,
        revisedAt: tourStops.updatedAt,
      })
      .from(tourStops)
      .innerJoin(pois, eq(tourStops.poiId, pois.id))
      .where(eq(tourStops.tourId, id))
      .orderBy(asc(tourStops.seq)),
    db
      .select({
        kind: tourBrackets.kind,
        script: tourBrackets.script,
        audioUrl: tourBrackets.audioUrl,
        audioDurationMs: tourBrackets.audioDurationMs,
        revisedAt: tourBrackets.updatedAt,
      })
      .from(tourBrackets)
      .where(eq(tourBrackets.tourId, id)),
    db
      .select()
      .from(evalRuns)
      .where(eq(evalRuns.slug, tour.slug))
      .orderBy(desc(evalRuns.createdAt))
      .limit(1),
  ])

  const run = latestRun[0]
  const scores = run
    ? await db
        .select({
          seq: evalScores.seq,
          stopType: evalScores.stopType,
          dimension: evalScores.dimension,
          source: evalScores.source,
          pass: evalScores.pass,
          value: evalScores.value,
          findings: evalScores.findings,
          // The dimension-specific payload (charm best/sag quotes, ClaimVerdict[], …) — the
          // judge's actual reasoning, surfaced so prompt-tuning targets the real sag (§14.7).
          detail: evalScores.detail,
        })
        .from(evalScores)
        .where(eq(evalScores.runId, run.id))
    : []

  return c.json({
    tour: {
      id: tour.id,
      slug: tour.slug,
      headline: tour.headline,
      status: tour.status,
      summary: tour.summary,
      distanceMeters: tour.distanceMeters,
      durationSeconds: tour.durationSeconds,
      startAnchor: { name: tour.startAnchorName, lat: tour.startAnchorLat, lng: tour.startAnchorLng },
      endAnchor: { name: tour.endAnchorName, lat: tour.endAnchorLat, lng: tour.endAnchorLng },
      polyline: tour.polyline,
      routeProvenance: tour.routeProvenance,
    },
    region: regionRows[0] ?? null,
    stops: stops.map(({ audioUrl, ...s }) => ({ ...s, hasAudio: audioUrl != null })),
    brackets: brackets.map(({ audioUrl, ...b }) => ({ ...b, hasAudio: audioUrl != null })),
    eval: run
      ? {
          id: run.id,
          pass: run.pass,
          dryRun: run.dryRun,
          grounding: run.groundingScore,
          tts: run.ttsScore,
          diversity: run.diversityScore,
          charm: run.charmScore,
          veracity: run.veracityScore,
          narrationModel: run.narrationModel,
          createdAt: run.createdAt,
          scores,
        }
      : null,
  })
})

// Presigned R2 URLs for every clip — NO tier gate (founder-only behind IAP).
app.get('/admin/tours/:id/sign', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'not_found' }, 404)

  const [stopClips, bracketClips] = await Promise.all([
    db
      .select({ seq: tourStops.seq, key: tourStops.audioUrl, durationMs: tourStops.audioDurationMs })
      .from(tourStops)
      .where(eq(tourStops.tourId, id))
      .orderBy(asc(tourStops.seq)),
    db
      .select({ kind: tourBrackets.kind, key: tourBrackets.audioUrl, durationMs: tourBrackets.audioDurationMs })
      .from(tourBrackets)
      .where(eq(tourBrackets.tourId, id)),
  ])

  try {
    const stops = stopClips
      .filter((clip) => clip.key)
      .map((clip) => ({
        seq: clip.seq,
        url: presignGet(clip.key!),
        contentType: contentTypeForKey(clip.key!),
        durationMs: clip.durationMs,
      }))
    const signBracket = (kind: 'intro' | 'outro') => {
      const b = bracketClips.find((x) => x.kind === kind && x.key)
      return b
        ? { url: presignGet(b.key!), contentType: contentTypeForKey(b.key!), durationMs: b.durationMs }
        : null
    }
    return c.json({ stops, intro: signBracket('intro'), outro: signBracket('outro') })
  } catch (e) {
    console.error('[admin] presign failed', e)
    return c.json({ error: 'audio_unavailable', message: 'R2 not configured or presign failed.' }, 503)
  }
})

// ── Create Tour (spec §5b): LLM-proposed → human-approved → frozen ──

// Phase 1 — propose: prompt -> LLM named waypoints -> region-biased geocode. No DB write.
app.post('/admin/tours/propose', async (c) => {
  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json({ error: 'bad_request', message: 'a JSON body is required' }, 400)
  }
  for (const k of ['regionSlug', 'roughStart', 'roughEnd', 'loopOrDirection'] as const) {
    if (typeof body[k] !== 'string' || !(body[k] as string).trim())
      return c.json({ error: 'bad_request', message: `${k} is required` }, 400)
  }
  try {
    const proposal = await proposeTour(body as unknown as ProposePrompt)
    return c.json({ proposal })
  } catch (e) {
    if (e instanceof HttpError)
      return c.json({ error: 'propose_failed', message: e.message }, e.status as ContentfulStatusCode)
    console.error('[admin] propose failed', e)
    return c.json({ error: 'propose_failed', message: e instanceof Error ? e.message : String(e) }, 502)
  }
})

// Phase 2 — freeze: the human-APPROVED waypoints -> materialize -> draft tour + provenance.
app.post('/admin/tours', async (c) => {
  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json({ error: 'bad_request', message: 'a JSON body is required' }, 400)
  }
  try {
    const tour = await freezeTour(body)
    return c.json({ tour }, 201)
  } catch (e) {
    if (e instanceof HttpError)
      return c.json({ error: 'create_failed', message: e.message }, e.status as ContentfulStatusCode)
    console.error('[admin] create tour failed', e)
    return c.json({ error: 'create_failed', message: e instanceof Error ? e.message : String(e) }, 502)
  }
})

// Eval history for a slug — the run-over-run trend the SPA diffs (latest vs prior).
app.get('/admin/evals', async (c) => {
  const slug = c.req.query('slug')
  if (!slug) return c.json({ error: 'bad_request', message: 'slug is required' }, 400)
  const runs = await db
    .select({
      id: evalRuns.id,
      kind: evalRuns.kind,
      dryRun: evalRuns.dryRun,
      pass: evalRuns.pass,
      grounding: evalRuns.groundingScore,
      tts: evalRuns.ttsScore,
      diversity: evalRuns.diversityScore,
      charm: evalRuns.charmScore,
      veracity: evalRuns.veracityScore,
      narrationModel: evalRuns.narrationModel,
      gitSha: evalRuns.gitSha,
      createdAt: evalRuns.createdAt,
    })
    .from(evalRuns)
    .where(eq(evalRuns.slug, slug))
    .orderBy(desc(evalRuns.createdAt))
    .limit(50)
  return c.json({ slug, runs })
})

// Integrity audit (§14.9). The generator's ready-gate enforces "every stop + bracket has
// audio, every story stop has CC BY-SA attribution" at WRITE time — but nothing audits the
// LIVE db, so a half-failed resynth or a manual poke could leave a `ready` tour silently
// broken (the exact way the canonical demo dies). Pure read; flags only violators.
app.get('/admin/integrity', async (c) => {
  const ready = await db
    .select({ id: tours.id, slug: tours.slug, headline: tours.headline })
    .from(tours)
    .where(eq(tours.status, 'ready'))
    .orderBy(asc(tours.slug))
  const ids = ready.map((r) => r.id)
  if (!ids.length) return c.json({ checked: 0, tours: [] })

  const [silentStops, silentBrackets, unattributed] = await Promise.all([
    db
      .select({ tourId: tourStops.tourId, seq: tourStops.seq, stopType: tourStops.stopType })
      .from(tourStops)
      .where(and(inArray(tourStops.tourId, ids), isNull(tourStops.audioUrl)))
      .orderBy(asc(tourStops.seq)),
    db
      .select({ tourId: tourBrackets.tourId, kind: tourBrackets.kind })
      .from(tourBrackets)
      .where(and(inArray(tourBrackets.tourId, ids), isNull(tourBrackets.audioUrl))),
    // Story stops are the wikipedia-grounded ones — attribution is the legal (not optional)
    // invariant. null OR an empty array both count as missing.
    db
      .select({ tourId: tourStops.tourId, seq: tourStops.seq })
      .from(tourStops)
      .where(
        and(
          inArray(tourStops.tourId, ids),
          eq(tourStops.stopType, 'story'),
          sql`(${tourStops.attribution} is null or jsonb_array_length(${tourStops.attribution}) = 0)`,
        ),
      )
      .orderBy(asc(tourStops.seq)),
  ])

  type Violations = { silentStops: number[]; silentBrackets: string[]; unattributed: number[] }
  const byTour = new Map<string, Violations>()
  const ensure = (id: string): Violations => {
    let v = byTour.get(id)
    if (!v) {
      v = { silentStops: [], silentBrackets: [], unattributed: [] }
      byTour.set(id, v)
    }
    return v
  }
  for (const s of silentStops) ensure(s.tourId).silentStops.push(s.seq)
  for (const b of silentBrackets) ensure(b.tourId).silentBrackets.push(b.kind)
  for (const s of unattributed) ensure(s.tourId).unattributed.push(s.seq)

  const flagged = ready.filter((t) => byTour.has(t.id)).map((t) => ({ ...t, ...byTour.get(t.id)! }))
  return c.json({ checked: ready.length, tours: flagged })
})

// The Runs view — recent gen_jobs (operational record).
app.get('/admin/jobs', async (c) => {
  const jobs = await db.select().from(genJobs).orderBy(desc(genJobs.createdAt)).limit(100)
  return c.json({ jobs })
})

// The Runs view — a unified timeline merging the operational gen_jobs with the historical
// eval_runs (CLI-era generations that never minted a gen_job). A gen_job that produced an
// eval_run (genJobs.evalRunId) SUPPRESSES that eval_run row, so each run appears exactly once:
// admin-triggered runs carry status/cost; orphan eval_runs carry pass + the dimension scores.
app.get('/admin/runs', async (c) => {
  const [jobs, evals] = await Promise.all([
    db
      .select({
        id: genJobs.id,
        kind: genJobs.kind,
        status: genJobs.status,
        targetSlug: genJobs.targetSlug,
        tourId: genJobs.tourId,
        dryRun: genJobs.dryRun,
        phase: genJobs.phase,
        costUsd: genJobs.costUsd,
        evalRunId: genJobs.evalRunId,
        triggeredBy: genJobs.triggeredBy,
        createdAt: genJobs.createdAt,
      })
      .from(genJobs)
      .orderBy(desc(genJobs.createdAt))
      .limit(100),
    db
      .select({
        id: evalRuns.id,
        kind: evalRuns.kind,
        slug: evalRuns.slug,
        tourId: evalRuns.tourId,
        pass: evalRuns.pass,
        dryRun: evalRuns.dryRun,
        grounding: evalRuns.groundingScore,
        narrationModel: evalRuns.narrationModel,
        gitSha: evalRuns.gitSha,
        createdAt: evalRuns.createdAt,
      })
      .from(evalRuns)
      .orderBy(desc(evalRuns.createdAt))
      .limit(100),
  ])

  const referenced = new Set(jobs.map((j) => j.evalRunId).filter(Boolean) as string[])
  const runs = [
    ...jobs.map((j) => ({
      source: 'job' as const,
      id: j.id,
      kind: j.kind,
      slug: j.targetSlug,
      status: j.status,
      pass: null,
      dryRun: j.dryRun,
      phase: j.phase,
      costUsd: j.costUsd,
      grounding: null,
      narrationModel: null,
      gitSha: null,
      triggeredBy: j.triggeredBy,
      tourId: j.tourId,
      createdAt: j.createdAt,
    })),
    ...evals
      .filter((e) => !referenced.has(e.id))
      .map((e) => ({
        source: 'eval' as const,
        id: e.id,
        kind: e.kind,
        slug: e.slug,
        status: null,
        pass: e.pass,
        dryRun: e.dryRun,
        phase: null,
        costUsd: null,
        grounding: e.grounding,
        narrationModel: e.narrationModel,
        gitSha: e.gitSha,
        triggeredBy: null,
        tourId: e.tourId,
        createdAt: e.createdAt,
      })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 150)

  return c.json({ runs })
})

const TERMINAL = ['succeeded', 'failed', 'canceled'] as const
const RECONCILE_AFTER_MS = 30_000

app.get('/admin/jobs/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'not_found' }, 404)
  let job = (await db.select().from(genJobs).where(eq(genJobs.id, id)).limit(1))[0]
  if (!job) return c.json({ error: 'not_found' }, 404)

  // Reconcile backstop: if the in-process finishJob never ran (a hard crash), settle the row
  // from the Cloud Run execution. Only for a stale non-terminal row with a known execution —
  // so a normal poll doesn't hammer the Run API.
  const nonTerminal = !TERMINAL.includes(job.status as (typeof TERMINAL)[number])
  const stale = Date.now() - new Date(job.updatedAt).getTime() > RECONCILE_AFTER_MS
  if (nonTerminal && stale && job.cloudRunExecution) {
    const state = await executionState(job.cloudRunExecution)
    if (state === 'succeeded' || state === 'failed') {
      await db
        .update(genJobs)
        .set({ status: state, endedAt: new Date(), error: state === 'failed' ? 'reconciled: execution failed' : null })
        .where(eq(genJobs.id, id))
      job = (await db.select().from(genJobs).where(eq(genJobs.id, id)).limit(1))[0]!
    }
  }
  const logsUrl = job.cloudRunExecution ? jobExecutionLogsUrl(job.cloudRunExecution) : null
  return c.json({ job, logsUrl })
})

// Cancel a running/queued execution (§14.8) — the operator stop path the schema reserved on
// gen_job_status='canceled'. Settles the row to 'canceled' after asking Cloud Run to cancel
// the execution (404 there = already gone, still fine). A terminal row is a 409.
app.post('/admin/jobs/:id/cancel', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'not_found' }, 404)
  const job = (await db.select().from(genJobs).where(eq(genJobs.id, id)).limit(1))[0]
  if (!job) return c.json({ error: 'not_found' }, 404)
  if (TERMINAL.includes(job.status as (typeof TERMINAL)[number])) {
    return c.json({ error: 'conflict', message: `Run already ${job.status}.` }, 409)
  }
  if (job.cloudRunExecution) {
    try {
      await cancelExecution(job.cloudRunExecution)
    } catch (e) {
      return c.json({ error: 'cancel_failed', message: e instanceof Error ? e.message : String(e) }, 502)
    }
  }
  await db
    .update(genJobs)
    .set({ status: 'canceled', endedAt: new Date(), error: job.error ?? 'canceled by operator' })
    .where(eq(genJobs.id, id))
  const row = (await db.select().from(genJobs).where(eq(genJobs.id, id)).limit(1))[0]
  return c.json({ job: row })
})

// Trigger an op as a skipper-gen Cloud Run Job. Dry-run by default; a SPENDING run (generate
// non-dry-run, or an op with apply) requires confirm:true (the SPA gates this behind a typed
// confirm). Idempotent: refuses if a non-terminal run already exists for the same target.
app.post('/admin/jobs', async (c) => {
  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json({ error: 'bad_request', message: 'a JSON body is required' }, 400)
  }

  let build: BuildResult
  try {
    build = buildJobArgs(body)
  } catch (e) {
    if (e instanceof HttpError) return c.json({ error: 'bad_request', message: e.message }, 400)
    throw e
  }

  if (build.spends && body.confirm !== true) {
    return c.json(
      { error: 'confirmation_required', message: 'This run spends money or deletes bytes — pass confirm:true.' },
      412,
    )
  }

  const kind = body.kind as JobKind // buildJobArgs validated it against the same vocabulary

  // Idempotency: one in-flight run per target (a lost-response retry / double-click can't double-spend).
  const targetCond = build.targetSlug
    ? eq(genJobs.targetSlug, build.targetSlug)
    : build.targetId
      ? eq(genJobs.targetId, build.targetId)
      : undefined
  const active = await db
    .select({ id: genJobs.id })
    .from(genJobs)
    .where(and(eq(genJobs.kind, kind), inArray(genJobs.status, ['queued', 'running']), targetCond))
    .limit(1)
  if (active.length) {
    return c.json({ error: 'conflict', message: 'A run for this target is already in progress.' }, 409)
  }

  const id = crypto.randomUUID()
  const triggeredBy = c.get('adminEmail')
  await db.insert(genJobs).values({
    id,
    kind,
    status: 'queued',
    dryRun: build.dryRun,
    targetSlug: build.targetSlug ?? null,
    tourId: build.tourId ?? null,
    targetId: build.targetId ?? null,
    args: build.args,
    triggeredBy,
  })

  let execShortName = ''
  try {
    execShortName = await runJob(build.args, { GEN_JOB_ID: id, GEN_JOB_TRIGGERED_BY: triggeredBy })
  } catch (e) {
    // The trigger failed — settle the row so it isn't a phantom 'queued'.
    await db
      .update(genJobs)
      .set({ status: 'failed', error: e instanceof Error ? e.message : String(e), endedAt: new Date() })
      .where(eq(genJobs.id, id))
    return c.json({ error: 'trigger_failed', message: e instanceof Error ? e.message : String(e) }, 502)
  }
  if (execShortName) {
    await db.update(genJobs).set({ cloudRunExecution: execShortName }).where(eq(genJobs.id, id))
  }

  const row = (await db.select().from(genJobs).where(eq(genJobs.id, id)).limit(1))[0]
  return c.json({ job: row }, 201)
})

// Serve the built SPA. In prod the Hono service serves it (one Cloud Run service behind IAP);
// in local dev vite serves the UI and proxies /admin + /health here, so this dir is absent and
// these 404 harmlessly. IAP gates the whole service at ingress, so the static assets need no
// in-app gate (only /health is intentionally open, for Cloud Run probes that bypass IAP).
const WEB_ROOT = process.env.ADMIN_WEB_ROOT ?? './public'
app.use('/*', serveStatic({ root: WEB_ROOT }))
// SPA fallback — client-side routes (/runs, /tours/:id, /create) return index.html.
app.get('*', serveStatic({ path: `${WEB_ROOT}/index.html` }))

const port = Number(process.env.PORT ?? 8788)

// Bun serves a default export of the shape { port, fetch }.
export default { port, fetch: app.fetch }
