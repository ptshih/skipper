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
//   GET  /admin/regions           -> region list with discoveryBbox
//   POST /admin/regions           -> create a new region
//   PATCH /admin/regions/:slug    -> update displayName / discoveryBbox
//   POST /admin/regions/bbox-lookup -> LLM + Nominatim parallel bbox lookup by place name
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
//   GET  /admin/pois              -> POI corpus: sources, tour + roam usage, attribution, region coverage
//   GET  /admin/pois/:id          -> full POI detail: lat/lng, summary, facts JSON, freshness
//   GET  /admin/roam/sign/:poiId  -> presigned R2 URL + metadata for a POI's roam clip
//   GET  /admin/pois/:id/corrections  -> a POI's fact-edit overrides + speakable anchor
//   POST /admin/pois/:id/corrections  -> add/retire a fact-edit, or set/clear the speakable anchor
//   POST /admin/tours/propose     -> Create Tour, phase 1: LLM + geocode  (create-tour.ts — Phase 4)
//   POST /admin/tours             -> Create Tour, phase 2: freeze + draft  (create-tour.ts — Phase 4)

import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import {
  evalRuns,
  evalScores,
  genJobs,
  poiOverrides,
  pois,
  regions,
  segments,
  tourFrames,
  tours,
  tracks,
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
import { captureJobOutput } from './job-output'
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
    .select({ slug: regions.slug, displayName: regions.displayName, discoveryBbox: regions.discoveryBbox })
    .from(regions)
    .orderBy(asc(regions.displayName))
  return c.json({ regions: rows })
})

app.post('/admin/regions', async (c) => {
  const body = await c.req.json<{ slug: string; displayName: string; discoveryBbox?: string | null }>()
  if (!body.slug?.trim() || !body.displayName?.trim()) {
    return c.json({ error: 'slug and displayName are required' }, 400)
  }
  const [row] = await db.insert(regions).values({
    slug: body.slug.trim(),
    displayName: body.displayName.trim(),
    discoveryBbox: body.discoveryBbox?.trim() || null,
  }).returning({ slug: regions.slug, displayName: regions.displayName, discoveryBbox: regions.discoveryBbox })
  return c.json({ region: row }, 201)
})

app.patch('/admin/regions/:slug', async (c) => {
  const slug = c.req.param('slug')
  const body = await c.req.json<{ displayName?: string; discoveryBbox?: string | null }>()
  const update: Record<string, unknown> = {}
  if (body.displayName !== undefined) update.displayName = body.displayName.trim()
  if (body.discoveryBbox !== undefined) update.discoveryBbox = body.discoveryBbox?.trim() || null
  if (!Object.keys(update).length) return c.json({ error: 'nothing to update' }, 400)
  const [row] = await db.update(regions)
    .set(update)
    .where(eq(regions.slug, slug))
    .returning({ slug: regions.slug, displayName: regions.displayName, discoveryBbox: regions.discoveryBbox })
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json({ region: row })
})

// Bbox lookup — LLM estimate + Nominatim OSM cross-check, run in parallel.
// Used by the admin Regions dialog so the operator never has to hand-key coordinates.
app.post('/admin/regions/bbox-lookup', async (c) => {
  const { query } = await c.req.json<{ query: string }>()
  if (!query?.trim()) return c.json({ error: 'query is required' }, 400)

  const BBOX_TOOL: import('@anthropic-ai/sdk').Anthropic.Tool = {
    name: 'bbox',
    description: 'Return the bounding box for the named geographic area.',
    input_schema: {
      type: 'object' as const,
      properties: {
        bbox: {
          type: 'string',
          description: 'Bounding box as "lng_min,lat_min,lng_max,lat_max". Use decimal degrees, ~4 decimal places.',
        },
        reasoning: {
          type: 'string',
          description: 'One sentence on how you derived the bbox (the landmarks or references you used).',
        },
        confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'high = well-known place with stable boundaries; low = approximation.',
        },
      },
      required: ['bbox', 'reasoning', 'confidence'],
    },
  }

  const [llmResult, osmResult] = await Promise.allSettled([
    // LLM: forced tool call → structured bbox + reasoning
    (async () => {
      const client = new (await import('@anthropic-ai/sdk')).default()
      const msg = await client.messages.create({
        model: process.env.ADMIN_PROPOSE_MODEL ?? 'claude-opus-4-8',
        max_tokens: 512,
        tools: [BBOX_TOOL],
        tool_choice: { type: 'any' },
        messages: [{
          role: 'user',
          content: `What is the bounding box for "${query.trim()}"? Return as lng_min,lat_min,lng_max,lat_max. Prefer the tight boundary of the named feature (e.g. a national park boundary, not the broader county). For a drive corridor or road trip region, add ~20 km of buffer on each side.`,
        }],
      })
      const tool = msg.content.find((b) => b.type === 'tool_use')
      if (!tool || tool.type !== 'tool_use') throw new Error('no tool call')
      const inp = tool.input as { bbox: string; reasoning: string; confidence: string }
      return { bbox: inp.bbox.trim(), reasoning: inp.reasoning, confidence: inp.confidence as 'high' | 'medium' | 'low' }
    })(),

    // OSM Nominatim: top 3 results for the query
    (async () => {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query.trim())}&format=json&limit=3&featuretype=settlement,natural,boundary`
      const res = await fetch(url, { headers: { 'User-Agent': 'skipper-admin/1.0 (admin ops tool)' } })
      if (!res.ok) throw new Error(`Nominatim ${res.status}`)
      const data = await res.json() as Array<{
        display_name: string
        type: string
        class: string
        boundingbox: [string, string, string, string] // lat_min, lat_max, lng_min, lng_max
      }>
      // Reorder Nominatim's [lat_min,lat_max,lng_min,lng_max] → lng_min,lat_min,lng_max,lat_max
      return data.map((r) => ({
        name: r.display_name,
        type: `${r.class}/${r.type}`,
        bbox: `${r.boundingbox[2]},${r.boundingbox[0]},${r.boundingbox[3]},${r.boundingbox[1]}`,
      }))
    })(),
  ])

  return c.json({
    llm: llmResult.status === 'fulfilled' ? llmResult.value : null,
    llmError: llmResult.status === 'rejected' ? String(llmResult.reason) : null,
    osm: osmResult.status === 'fulfilled' ? osmResult.value : null,
    osmError: osmResult.status === 'rejected' ? String(osmResult.reason) : null,
  })
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
      // Stops = tour-bound segments (one segment per stop; its single variant-0 track is the
      // telling). Count segments, not tracks, so the figure stays one-per-stop.
      db
        .select({ tourId: segments.tourId, n: count() })
        .from(segments)
        .where(inArray(segments.tourId, ids))
        .groupBy(segments.tourId),
      db
        .select({ tourId: tourFrames.tourId, n: count() })
        .from(tourFrames)
        .where(inArray(tourFrames.tourId, ids))
        .groupBy(tourFrames.tourId),
    ])
    for (const r of sc) if (r.tourId) stopCount.set(r.tourId, Number(r.n))
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
    // A tour's stops = its tour-bound segments joined to the variant-0 track (the telling) and
    // the shared place. stopType ← tracks.form (always story|scenic|break for a tour stop);
    // triggerRadiusM ← segments.radiusM; revision token ← the narration's updatedAt.
    db
      .select({
        seq: segments.seq,
        // The variant-0 track's id — the patch/re-voice target for the per-stop tuning actions.
        trackId: tracks.id,
        stopType: tracks.form,
        name: pois.name,
        poiSource: pois.source,
        poiSourceId: pois.sourceId,
        script: tracks.script,
        audioUrl: tracks.audioUrl,
        audioDurationMs: tracks.audioDurationMs,
        attribution: tracks.attribution,
        factsHash: tracks.factsHash,
        triggerLat: segments.triggerLat,
        triggerLng: segments.triggerLng,
        triggerRadiusM: segments.radiusM,
        revisedAt: tracks.updatedAt,
      })
      .from(segments)
      .innerJoin(tracks, and(eq(tracks.segmentId, segments.id), eq(tracks.variant, 0)))
      .innerJoin(pois, eq(segments.poiId, pois.id))
      .where(eq(segments.tourId, id))
      .orderBy(asc(segments.seq)),
    db
      .select({
        kind: tourFrames.kind,
        script: tourFrames.script,
        audioUrl: tourFrames.audioUrl,
        audioDurationMs: tourFrames.audioDurationMs,
        revisedAt: tourFrames.updatedAt,
      })
      .from(tourFrames)
      .where(eq(tourFrames.tourId, id)),
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
      .select({ seq: segments.seq, key: tracks.audioUrl, durationMs: tracks.audioDurationMs })
      .from(segments)
      .innerJoin(tracks, and(eq(tracks.segmentId, segments.id), eq(tracks.variant, 0)))
      .where(eq(segments.tourId, id))
      .orderBy(asc(segments.seq)),
    db
      .select({ kind: tourFrames.kind, key: tourFrames.audioUrl, durationMs: tourFrames.audioDurationMs })
      .from(tourFrames)
      .where(eq(tourFrames.tourId, id)),
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
      .select({ tourId: segments.tourId, seq: segments.seq, stopType: tracks.form })
      .from(segments)
      .innerJoin(tracks, and(eq(tracks.segmentId, segments.id), eq(tracks.variant, 0)))
      .where(and(inArray(segments.tourId, ids), isNull(tracks.audioUrl)))
      .orderBy(asc(segments.seq)),
    db
      .select({ tourId: tourFrames.tourId, kind: tourFrames.kind })
      .from(tourFrames)
      .where(and(inArray(tourFrames.tourId, ids), isNull(tourFrames.audioUrl))),
    // Story stops are the wikipedia-grounded ones — attribution is the legal (not optional)
    // invariant. null OR an empty array both count as missing.
    db
      .select({ tourId: segments.tourId, seq: segments.seq })
      .from(segments)
      .innerJoin(tracks, and(eq(tracks.segmentId, segments.id), eq(tracks.variant, 0)))
      .where(
        and(
          inArray(segments.tourId, ids),
          eq(tracks.form, 'story'),
          sql`(${tracks.attribution} is null or jsonb_array_length(${tracks.attribution}) = 0)`,
        ),
      )
      .orderBy(asc(segments.seq)),
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
  // tourId/seq are non-null for tour-bound segments (the CHECK keeps them in lockstep with
  // tourId), but the columns are nullable for roam — guard to satisfy the types.
  for (const s of silentStops) if (s.tourId && s.seq != null) ensure(s.tourId).silentStops.push(s.seq)
  for (const b of silentBrackets) ensure(b.tourId).silentBrackets.push(b.kind)
  for (const s of unattributed) if (s.tourId && s.seq != null) ensure(s.tourId).unattributed.push(s.seq)

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
        cloudRunExecution: genJobs.cloudRunExecution,
        updatedAt: genJobs.updatedAt,
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

  // Reconcile stale non-terminal jobs so the list reflects reality without requiring a
  // detail-drawer click. Limit to jobs updated within the last hour to avoid hammering
  // the Cloud Run API on every poll for ancient rows.
  const staleNonTerminal = jobs.filter(
    (j) =>
      !TERMINAL.includes(j.status as (typeof TERMINAL)[number]) &&
      j.cloudRunExecution &&
      j.updatedAt &&
      Date.now() - new Date(j.updatedAt).getTime() > RECONCILE_AFTER_MS &&
      Date.now() - new Date(j.createdAt).getTime() < 60 * 60 * 1000,
  )
  if (staleNonTerminal.length > 0) {
    await Promise.all(
      staleNonTerminal.map(async (j) => {
        const state = await executionState(j.cloudRunExecution!)
        if (state === 'running' || state === 'succeeded' || state === 'failed') {
          await db
            .update(genJobs)
            .set({
              status: state,
              ...(state !== 'running' && { endedAt: new Date() }),
              ...(state === 'failed' && { error: 'reconciled: execution failed' }),
            })
            .where(eq(genJobs.id, j.id))
          j.status = state
          if (state === 'succeeded') {
            void captureJobOutput(j.id, j.cloudRunExecution!, j.kind)
          }
        }
      }),
    )
  }

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
    if (state === 'running' || state === 'succeeded' || state === 'failed') {
      await db
        .update(genJobs)
        .set({
          status: state,
          ...(state !== 'running' && { endedAt: new Date() }),
          ...(state === 'failed' && { error: 'reconciled: execution failed' }),
        })
        .where(eq(genJobs.id, id))
      job = (await db.select().from(genJobs).where(eq(genJobs.id, id)).limit(1))[0]!
      if (state === 'succeeded') {
        void captureJobOutput(job.id, job.cloudRunExecution!, job.kind)
      }
    }
  }
  // Retry log capture: Cloud Logging has a propagation delay (30s–2min). If the initial
  // fire-and-forget capture ran before logs were indexed, outputLog is null even though the
  // job succeeded. Re-trigger (idempotent — skips instantly if outputLog is already set).
  if (job.status === 'succeeded' && job.cloudRunExecution && job.outputLog == null) {
    void captureJobOutput(job.id, job.cloudRunExecution, job.kind)
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

// POI corpus — sources, tour + roam usage, attribution, and region coverage.
app.get('/admin/pois', async (c) => {
  const poisRows = await db
    .select({
      id: pois.id,
      source: pois.source,
      sourceId: pois.sourceId,
      name: pois.name,
      kind: pois.kind,
      factsHash: pois.factsHash,
      createdAt: pois.createdAt,
    })
    .from(pois)
    .orderBy(asc(pois.name))

  if (!poisRows.length) return c.json({ pois: [] })

  const poiIds = poisRows.map((p) => p.id)

  const [stopStats, clipStats, regionRows] = await Promise.all([
    // Per-poi: tour count, stale-facts count, unattributed story count. Tour stops =
    // tour-bound segments joined to their variant-0 track (the telling carries
    // attribution/factsHash) + the shared place (for the live facts_hash to compare against).
    db
      .select({
        poiId: segments.poiId,
        tourCount: sql<string>`count(distinct ${segments.tourId})`,
        staleCount: sql<string>`count(*) filter (where ${tracks.factsHash} is distinct from ${pois.factsHash})`,
        unattribCount: sql<string>`count(*) filter (where ${tracks.attribution} is null and ${tracks.form} = 'story')`,
      })
      .from(segments)
      .innerJoin(tracks, and(eq(tracks.segmentId, segments.id), eq(tracks.variant, 0)))
      .innerJoin(pois, eq(segments.poiId, pois.id))
      .where(and(inArray(segments.poiId, poiIds), isNotNull(segments.tourId)))
      .groupBy(segments.poiId),
    // Per-poi: roam clip metadata — a roam encounter is a tourId-null segment + its variant-0
    // track (unique per poi; duration + script for anomaly detection).
    db
      .select({
        poiId: segments.poiId,
        audioDurationMs: tracks.audioDurationMs,
        script: tracks.script,
      })
      .from(segments)
      .innerJoin(tracks, and(eq(tracks.segmentId, segments.id), eq(tracks.variant, 0)))
      .where(and(isNull(segments.tourId), inArray(segments.poiId, poiIds))),
    // Per-poi: region slug + name (pick first per poi in JS) — via the tour-bound segments.
    db
      .select({
        poiId: segments.poiId,
        regionSlug: regions.slug,
        regionName: regions.displayName,
      })
      .from(segments)
      .innerJoin(tours, eq(segments.tourId, tours.id))
      .innerJoin(regions, eq(tours.regionId, regions.id))
      .where(inArray(segments.poiId, poiIds)),
  ])

  const stopMap = new Map(stopStats.map((s) => [s.poiId, s]))
  // Suspicious duration: < 90 WPM indicates TTS returned duplicated audio in a single file.
  // Normal corpus average is ~155 WPM; 90 WPM is a conservative floor well below any legit clip.
  const WPM_FLOOR = 90
  const clipMap = new Map(clipStats.map((s) => {
    const wordCount = s.script?.trim().split(/\s+/).filter(Boolean).length ?? 0
    const wpm = wordCount > 0 && s.audioDurationMs
      ? wordCount / (s.audioDurationMs / 1000 / 60)
      : null
    return [s.poiId, { hasClip: true, suspiciousDuration: wpm !== null && wpm < WPM_FLOOR }]
  }))
  // Pick first region per poi
  const regionMap = new Map<string, { regionSlug: string; regionName: string }>()
  for (const r of regionRows) {
    if (!regionMap.has(r.poiId)) regionMap.set(r.poiId, { regionSlug: r.regionSlug, regionName: r.regionName })
  }

  const result = poisRows.map((p) => {
    const s = stopMap.get(p.id)
    const region = regionMap.get(p.id)
    return {
      id: p.id,
      source: p.source,
      sourceId: p.sourceId,
      name: p.name,
      kind: p.kind,
      factsHash: p.factsHash,
      createdAt: p.createdAt,
      tourCount: s ? Number(s.tourCount) : 0,
      roamClipCount: clipMap.get(p.id) ? 1 : 0,
      suspiciousDuration: clipMap.get(p.id)?.suspiciousDuration ?? false,
      staleFacts: s ? Number(s.staleCount) > 0 : false,
      attributed: s ? Number(s.unattribCount) === 0 : true,
      regionSlug: region?.regionSlug ?? null,
      regionName: region?.regionName ?? null,
    }
  })

  return c.json({ pois: result })
})

// Presigned R2 URL + metadata for a single POI's roam clip (founder ear-pass).
app.get('/admin/roam/sign/:poiId', async (c) => {
  const poiId = c.req.param('poiId')
  if (!UUID_RE.test(poiId)) return c.json({ error: 'not_found' }, 404)

  // A roam clip = the tourId-null segment for this poi + its variant-0 track. The track id is
  // the stable clip id (R2 key is per-track); the audio R2 key is tracks.audioUrl.
  const clip = (
    await db
      .select({
        id: tracks.id,
        script: tracks.script,
        audioUrl: tracks.audioUrl,
        audioDurationMs: tracks.audioDurationMs,
        attribution: tracks.attribution,
        factsHash: tracks.factsHash,
      })
      .from(segments)
      .innerJoin(tracks, and(eq(tracks.segmentId, segments.id), eq(tracks.variant, 0)))
      .where(and(isNull(segments.tourId), eq(segments.poiId, poiId)))
      .limit(1)
  )[0]

  if (!clip || !clip.audioUrl) return c.json({ error: 'not_found' }, 404)
  const audioKey = clip.audioUrl

  try {
    return c.json({
      clip: {
        id: clip.id,
        script: clip.script,
        url: presignGet(audioKey),
        contentType: contentTypeForKey(audioKey),
        audioDurationMs: clip.audioDurationMs,
        attribution: clip.attribution,
        factsHash: clip.factsHash,
      },
    })
  } catch (e) {
    console.error('[admin] roam presign failed', e)
    return c.json({ error: 'audio_unavailable', message: 'R2 not configured or presign failed.' }, 503)
  }
})

/* -------------------------------------------------------------------------- */
/*  POI corrections — operator-editable upstream-fact corrections + speakable    */
/*  anchor, replacing the seed-edit + reseed CLI loop. These MUTATE the curation  */
/*  layer (poi_overrides + pois.speakable_lat/lng) but spend nothing — corrections */
/*  take effect on the NEXT generate/regeneration (the generator loads overrides + */
/*  reads pois.speakable fresh per run); they never rewrite existing audio.        */
/* -------------------------------------------------------------------------- */

interface CorrectionOverride {
  find: string | null
  replace: string | null
  reason: string
  sourceUrl: string | null
  active: boolean
  upstreamStatus: string
  updatedAt: string
}
interface CorrectionsPayload {
  overrides: CorrectionOverride[]
  speakable: { lat: number; lng: number } | null
}

// Assemble the corrections payload for one poi: its (source, source_id)-keyed override rows
// (newest first) + its speakable anchor.
async function correctionsForPoi(poi: {
  source: 'wikipedia' | 'google_places' | 'wikidata'
  sourceId: string
  speakableLat: number | null
  speakableLng: number | null
}): Promise<CorrectionsPayload> {
  const rows = await db
    .select({
      find: poiOverrides.find,
      replace: poiOverrides.replace,
      reason: poiOverrides.reason,
      sourceUrl: poiOverrides.sourceUrl,
      active: poiOverrides.active,
      upstreamStatus: poiOverrides.upstreamStatus,
      updatedAt: poiOverrides.updatedAt,
    })
    .from(poiOverrides)
    .where(and(eq(poiOverrides.source, poi.source), eq(poiOverrides.sourceId, poi.sourceId)))
    .orderBy(desc(poiOverrides.updatedAt))

  const speakable =
    poi.speakableLat !== null && poi.speakableLng !== null
      ? { lat: poi.speakableLat, lng: poi.speakableLng }
      : null

  return {
    overrides: rows.map((r) => ({
      find: r.find,
      replace: r.replace,
      reason: r.reason,
      sourceUrl: r.sourceUrl,
      active: r.active,
      upstreamStatus: r.upstreamStatus,
      updatedAt: r.updatedAt.toISOString(),
    })),
    speakable,
  }
}

// Full POI detail — lat/lng, summary, facts JSON, freshness. Used by the admin facts drawer.
app.get('/admin/pois/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'not_found' }, 404)
  const [row] = await db
    .select({
      id: pois.id,
      source: pois.source,
      sourceId: pois.sourceId,
      name: pois.name,
      kind: pois.kind,
      lat: pois.lat,
      lng: pois.lng,
      summary: pois.summary,
      facts: pois.facts,
      factsHash: pois.factsHash,
      factsFetchedAt: pois.factsFetchedAt,
      createdAt: pois.createdAt,
      updatedAt: pois.updatedAt,
    })
    .from(pois)
    .where(eq(pois.id, id))
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json({ poi: row })
})

// The fact-corrections + speakable anchor for one poi (the operator's curation surface).
app.get('/admin/pois/:id/corrections', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'not_found' }, 404)
  const poi = (
    await db
      .select({
        source: pois.source,
        sourceId: pois.sourceId,
        speakableLat: pois.speakableLat,
        speakableLng: pois.speakableLng,
      })
      .from(pois)
      .where(eq(pois.id, id))
      .limit(1)
  )[0]
  if (!poi) return c.json({ error: 'not_found' }, 404)
  return c.json(await correctionsForPoi(poi))
})

// Add/retire a fact-edit override, or set/clear the speakable anchor. Cheap + safe (no spend),
// so no confirm gate. Returns the refreshed corrections payload (same shape as the GET).
app.post('/admin/pois/:id/corrections', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'not_found' }, 404)

  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json({ error: 'bad_request', message: 'a JSON body is required' }, 400)
  }

  const poi = (
    await db
      .select({
        name: pois.name,
        source: pois.source,
        sourceId: pois.sourceId,
        speakableLat: pois.speakableLat,
        speakableLng: pois.speakableLng,
      })
      .from(pois)
      .where(eq(pois.id, id))
      .limit(1)
  )[0]
  if (!poi) return c.json({ error: 'not_found' }, 404)

  const kind = body.kind
  const operator = c.get('adminEmail')

  if (kind === 'fact_edit') {
    const find = typeof body.find === 'string' ? body.find : ''
    const replace = typeof body.replace === 'string' ? body.replace : null
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    const sourceUrl = typeof body.sourceUrl === 'string' && body.sourceUrl.trim() ? body.sourceUrl.trim() : null
    // find non-empty; replace a string (may be ''); reason non-empty — a correction documents itself.
    if (!find) return c.json({ error: 'bad_request', message: '`find` must be a non-empty string.' }, 400)
    if (replace === null) return c.json({ error: 'bad_request', message: '`replace` must be a string (may be empty).' }, 400)
    if (!reason) return c.json({ error: 'bad_request', message: '`reason` is required — a correction documents itself.' }, 400)

    console.log(`[admin] ${operator} fact_edit override on ${poi.source}:${poi.sourceId} (${poi.name}) find=${JSON.stringify(find)}`)
    await db
      .insert(poiOverrides)
      .values({
        source: poi.source,
        sourceId: poi.sourceId,
        name: poi.name,
        find,
        replace,
        reason,
        sourceUrl,
        active: true,
      })
      .onConflictDoUpdate({
        target: [poiOverrides.source, poiOverrides.sourceId, poiOverrides.find],
        set: { replace, reason, sourceUrl, active: true, updatedAt: new Date() },
      })
  } else if (kind === 'retire') {
    const find = typeof body.find === 'string' ? body.find : ''
    if (!find) return c.json({ error: 'bad_request', message: '`find` must be a non-empty string.' }, 400)
    console.log(`[admin] ${operator} retired override on ${poi.source}:${poi.sourceId} find=${JSON.stringify(find)}`)
    await db
      .update(poiOverrides)
      .set({ active: false, updatedAt: new Date() })
      .where(
        and(
          eq(poiOverrides.source, poi.source),
          eq(poiOverrides.sourceId, poi.sourceId),
          eq(poiOverrides.find, find),
        ),
      )
  } else if (kind === 'speakable') {
    const clear = body.clear === true || body.lat === null
    if (clear) {
      console.log(`[admin] ${operator} cleared speakable anchor on ${poi.source}:${poi.sourceId}`)
      await db.update(pois).set({ speakableLat: null, speakableLng: null }).where(eq(pois.id, id))
    } else {
      const lat = typeof body.lat === 'number' ? body.lat : NaN
      const lng = typeof body.lng === 'number' ? body.lng : NaN
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return c.json({ error: 'bad_request', message: '`lat`/`lng` must be finite numbers (or pass clear:true / lat:null).' }, 400)
      }
      console.log(`[admin] ${operator} set speakable anchor on ${poi.source}:${poi.sourceId} → ${lat},${lng}`)
      await db.update(pois).set({ speakableLat: lat, speakableLng: lng }).where(eq(pois.id, id))
    }
  } else {
    return c.json({ error: 'bad_request', message: 'unknown `kind` — expected fact_edit | retire | speakable.' }, 400)
  }

  // Re-read the speakable anchor (it may have just changed) and return the refreshed payload.
  const fresh = (
    await db
      .select({ speakableLat: pois.speakableLat, speakableLng: pois.speakableLng })
      .from(pois)
      .where(eq(pois.id, id))
      .limit(1)
  )[0]
  return c.json(
    await correctionsForPoi({
      source: poi.source,
      sourceId: poi.sourceId,
      speakableLat: fresh?.speakableLat ?? null,
      speakableLng: fresh?.speakableLng ?? null,
    }),
  )
})

// Hard-DELETE one POI — ONLY when it is ORPHANED (no segments reference it). segments.poiId is
// onDelete:'restrict', so a referenced POI can't be deleted at the DB anyway; we check first and
// return a clean 409 instead of a raw FK error. A flagged/stale POI living in a tour or roam is
// referenced BY DEFINITION — the fix there is to regenerate or correct it, not delete it. POIs
// with zero references carry no tracks, so there are no orphan R2 clips to sweep. poi_overrides
// are keyed by (source, source_id), survive the row, and re-apply on re-discovery — left intact.
app.delete('/admin/pois/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'not_found' }, 404)

  const [poi] = await db.select({ id: pois.id, name: pois.name }).from(pois).where(eq(pois.id, id)).limit(1)
  if (!poi) return c.json({ error: 'not_found' }, 404)

  const [refRow] = await db.select({ refs: count() }).from(segments).where(eq(segments.poiId, id))
  const refs = Number(refRow?.refs ?? 0)
  if (refs > 0) {
    return c.json(
      {
        error: 'conflict',
        message: `"${poi.name}" is referenced by ${refs} tour/roam segment(s) — regenerate or correct it instead of deleting.`,
      },
      409,
    )
  }

  await db.delete(pois).where(eq(pois.id, id))
  return c.json({ ok: true, id })
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
