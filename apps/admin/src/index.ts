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
//   GET  /admin/jobs              -> recent gen_jobs (the Runs view)
//   GET  /admin/jobs/:id          -> one run (reconciled against its Cloud Run execution)
//   POST /admin/jobs              -> trigger an op as a skipper-gen Job  (jobs.ts — Phase 3)
//   POST /admin/tours/propose     -> Create Tour, phase 1: LLM + geocode  (create-tour.ts — Phase 4)
//   POST /admin/tours             -> Create Tour, phase 2: freeze + draft  (create-tour.ts — Phase 4)

import { Hono } from 'hono'
import { asc, count, desc, eq, inArray } from 'drizzle-orm'
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

// The Runs view — recent gen_jobs (operational record).
app.get('/admin/jobs', async (c) => {
  const jobs = await db.select().from(genJobs).orderBy(desc(genJobs.createdAt)).limit(100)
  return c.json({ jobs })
})

app.get('/admin/jobs/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'not_found' }, 404)
  const job = (await db.select().from(genJobs).where(eq(genJobs.id, id)).limit(1))[0]
  if (!job) return c.json({ error: 'not_found' }, 404)
  // Phase 3 wires the Cloud Run execution reconcile here (settle a stale 'running' row).
  return c.json({ job })
})

const port = Number(process.env.PORT ?? 8788)

// Bun serves a default export of the shape { port, fetch }.
export default { port, fetch: app.fetch }
