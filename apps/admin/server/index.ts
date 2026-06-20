// @skipper/admin — the founder-only ops console (Hono, served natively by bun).
//
// v1 BACKEND. Behind Google IAP (requireAdmin asserts the founder's identity); a separate
// Cloud Run service from the public api.skipper.fm so a routing bug can't leak ops onto the
// funnel. Reads the same DB + presigns R2 for the roam ear-pass; triggers the skipper-studio Cloud
// Run Job for corpus ops (jobs.ts). V2: authored tours are deferred — the console operates the
// shared POI corpus + roam narrations; the tour catalog / Create-a-Tour flow is gone.
// Background: docs/specs/admin-ops-console-spec.md §6.
//
//   GET  /health                  -> liveness (OPEN — Cloud Run probes don't pass through IAP)
//   --- everything below is behind requireAdmin (IAP founder-only) ---
//   GET  /admin/regions           -> region list with bbox
//   POST /admin/regions           -> create a new region
//   PATCH /admin/regions/:slug    -> update displayName / bbox
//   POST /admin/regions/bbox-lookup -> LLM + Nominatim parallel bbox lookup by place name
//   GET  /admin/runs              -> unified Runs timeline: studio_jobs + orphan eval_runs
//   GET  /admin/jobs/:id          -> one run (reconciled against its Cloud Run execution) + logs URL
//   POST /admin/jobs              -> trigger an op as a skipper-studio Job  (jobs.ts — Phase 3)
//   POST /admin/jobs/:id/cancel   -> stop a running execution (studio_job_status='canceled') (§14.8)
//   GET  /admin/pois              -> POI corpus: sources, narration usage, attribution, region coverage
//   GET  /admin/pois/:id          -> full POI detail: lat/lng, summary, facts JSON, freshness
//   GET  /admin/pois/:poiId/narration -> presigned R2 URL + metadata for a POI's narration
//   GET  /admin/pois/:id/corrections  -> a POI's fact-edit overrides + speakable anchor
//   POST /admin/pois/:id/corrections  -> add/retire a fact-edit, or set/clear the speakable anchor
//   DELETE /admin/pois/:id        -> hard-delete an orphaned POI (no narration)

import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import {
  evalRuns,
  evalScores,
  studioJobs,
  narrations,
  poiOverrides,
  pois,
  regions,
} from '@skipper/db/schema'
import { CLAUDE_MODELS, classifyStoryEligibility } from '@skipper/shared'
import { checkSpeakableAnchor } from '@skipper/engine'
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
  type ExecState,
  type JobKind,
} from './jobs'

const app = new Hono<AdminEnv>()

app.onError((err, c) => {
  console.error('[admin] unhandled error', err)
  return c.json({ error: 'internal' }, 500)
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Liveness — OPEN (Cloud Run startup/liveness probes hit the container directly, not via IAP).
// Plain GET /health stays DB-free and cheap so a DB blip can never restart the Cloud Run container.
// GET /health?deep=1 is the admin client's readiness probe (HealthBanner): it also pings the DB so
// the UI can tell "api up but DB / DATABASE_URL broken" apart from "api down". It returns 200 even
// when the DB is down — the client reads `db`, not the HTTP status (a transport failure is what the
// client catches; a reachable-but-unhealthy api must come back as a body it can branch on).
app.get('/health', async (c) => {
  if (c.req.query('deep') !== '1') return c.json({ ok: true })
  try {
    await db.execute(sql`select 1`)
    return c.json({ ok: true, db: true })
  } catch (err) {
    console.error('[admin] /health deep DB check failed', err)
    return c.json({ ok: true, db: false, dbError: err instanceof Error ? err.message : String(err) })
  }
})

// Everything else is founder-only.
app.use('/admin/*', requireAdmin)

app.get('/admin/regions', async (c) => {
  const rows = await db
    .select({ slug: regions.slug, displayName: regions.displayName, bbox: regions.bbox })
    .from(regions)
    .orderBy(asc(regions.displayName))
  return c.json({ regions: rows })
})

app.post('/admin/regions', async (c) => {
  const body = await c.req.json<{ slug: string; displayName: string; bbox?: string | null }>()
  if (!body.slug?.trim() || !body.displayName?.trim()) {
    return c.json({ error: 'slug and displayName are required' }, 400)
  }
  const [row] = await db.insert(regions).values({
    slug: body.slug.trim(),
    displayName: body.displayName.trim(),
    bbox: body.bbox?.trim() || null,
  }).returning({ slug: regions.slug, displayName: regions.displayName, bbox: regions.bbox })
  return c.json({ region: row }, 201)
})

app.patch('/admin/regions/:slug', async (c) => {
  const slug = c.req.param('slug')
  const body = await c.req.json<{ displayName?: string; bbox?: string | null }>()
  const update: Record<string, unknown> = {}
  if (body.displayName !== undefined) update.displayName = body.displayName.trim()
  if (body.bbox !== undefined) update.bbox = body.bbox?.trim() || null
  if (!Object.keys(update).length) return c.json({ error: 'nothing to update' }, 400)
  const [row] = await db.update(regions)
    .set(update)
    .where(eq(regions.slug, slug))
    .returning({ slug: regions.slug, displayName: regions.displayName, bbox: regions.bbox })
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
        model: process.env.ADMIN_PROPOSE_MODEL ?? CLAUDE_MODELS.opus,
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

// The Runs view — a unified timeline merging the operational studio_jobs with the historical
// eval_runs (CLI-era generations that never minted a gen_job). A gen_job that produced an
// eval_run (studioJobs.evalRunId) SUPPRESSES that eval_run row, so each run appears exactly once:
// admin-triggered runs carry status/cost; orphan eval_runs carry pass + the dimension scores.
app.get('/admin/runs', async (c) => {
  const [jobs, evals] = await Promise.all([
    db
      .select({
        id: studioJobs.id,
        kind: studioJobs.kind,
        status: studioJobs.status,
        targetSlug: studioJobs.targetSlug,
        dryRun: studioJobs.dryRun,
        phase: studioJobs.phase,
        costUsd: studioJobs.costUsd,
        evalRunId: studioJobs.evalRunId,
        triggeredBy: studioJobs.triggeredBy,
        createdAt: studioJobs.createdAt,
        cloudRunExecution: studioJobs.cloudRunExecution,
        updatedAt: studioJobs.updatedAt,
      })
      .from(studioJobs)
      .orderBy(desc(studioJobs.createdAt))
      .limit(100),
    db
      .select({
        id: evalRuns.id,
        kind: evalRuns.kind,
        region: evalRuns.region,
        pass: evalRuns.pass,
        dryRun: evalRuns.dryRun,
        grounding: evalRuns.groundingScore,
        withheld: evalRuns.withheld,
        total: evalRuns.total,
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
        const state = await reconcileJobFromExecution({ id: j.id, cloudRunExecution: j.cloudRunExecution! })
        if (state) j.status = state
      }),
    )
  }

  // No-API backstop: force-fail any row that outlived the task-timeout. The reconcile above skips
  // rows >1h old to spare the Cloud Run API, so this is what finally settles an ancient stuck row
  // (and frees its target for re-runs).
  await Promise.all(jobs.map(async (j) => { if (await expireStuckJob(j)) j.status = 'failed' }))

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
      withheld: null,
      // The eval run this job produced (if any) — lets the drawer pull the per-poi report.
      evalRunId: j.evalRunId,
      narrationModel: null,
      gitSha: null,
      triggeredBy: j.triggeredBy,
      createdAt: j.createdAt,
    })),
    ...evals
      .filter((e) => !referenced.has(e.id))
      .map((e) => ({
        source: 'eval' as const,
        id: e.id,
        kind: e.kind,
        slug: e.region,
        status: null,
        pass: e.pass,
        dryRun: e.dryRun,
        phase: null,
        costUsd: null,
        grounding: e.grounding,
        withheld: e.withheld,
        // An eval-source row IS the eval run, so the report keys on its own id.
        evalRunId: e.id,
        narrationModel: e.narrationModel,
        gitSha: e.gitSha,
        triggeredBy: null,
        createdAt: e.createdAt,
      })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 150)

  return c.json({ runs })
})

// One eval run's per-(poi × dimension) verdicts — the report behind a run: which places the gate
// held back (withheld=true) and why (findings), worst-first. Read-only observability.
app.get('/admin/runs/:id/scores', async (c) => {
  const runId = c.req.param('id')
  const [run] = await db
    .select({
      id: evalRuns.id,
      region: evalRuns.region,
      kind: evalRuns.kind,
      pass: evalRuns.pass,
      dryRun: evalRuns.dryRun,
      total: evalRuns.total,
      shipped: evalRuns.shipped,
      withheld: evalRuns.withheld,
      grounding: evalRuns.groundingScore,
      tts: evalRuns.ttsScore,
      diversity: evalRuns.diversityScore,
      narrationModel: evalRuns.narrationModel,
      judgeModel: evalRuns.judgeModel,
      gitSha: evalRuns.gitSha,
      createdAt: evalRuns.createdAt,
    })
    .from(evalRuns)
    .where(eq(evalRuns.id, runId))
  if (!run) return c.json({ error: 'run not found' }, 404)

  const scores = await db
    .select({
      poiId: evalScores.poiId,
      qid: evalScores.qid,
      name: evalScores.name,
      dimension: evalScores.dimension,
      pass: evalScores.pass,
      value: evalScores.value,
      withheld: evalScores.withheld,
      findings: evalScores.findings,
      detail: evalScores.detail,
      script: evalScores.script,
    })
    .from(evalScores)
    .where(eq(evalScores.runId, runId))
  // Worst-first: withheld places, then failures, then the rest.
  scores.sort(
    (a, b) => Number(b.withheld) - Number(a.withheld) || Number(a.pass) - Number(b.pass),
  )
  return c.json({ run, scores })
})

const TERMINAL = ['succeeded', 'failed', 'canceled'] as const
const RECONCILE_AFTER_MS = 30_000
// Past the Cloud Run task-timeout (cloudbuild.studio.yaml = 3600s) + slack, a non-terminal row can
// NOT still be running — the job was killed. Force-fail it with NO API round-trip; this is the
// backstop for a row the executionState reconcile can't settle (no/expired execution name, or a
// row already >1h old which the list reconcile skips), so a stuck row stops blocking re-runs.
const JOB_MAX_AGE_MS = 3_600_000 + 300_000

/** Force-fail a non-terminal studio_jobs row that has outlived the task-timeout. Pure age check (no
 *  Cloud Run API call), guarded so it never clobbers a concurrently-settled row. Returns true if
 *  it settled the row. */
async function expireStuckJob(job: { id: string; status: string; updatedAt: Date | string | null }): Promise<boolean> {
  if (TERMINAL.includes(job.status as (typeof TERMINAL)[number])) return false
  const updatedMs = job.updatedAt ? new Date(job.updatedAt).getTime() : 0
  if (Date.now() - updatedMs <= JOB_MAX_AGE_MS) return false
  await db
    .update(studioJobs)
    .set({ status: 'failed', endedAt: new Date(), error: 'reconciled: timed out (no live execution past the task-timeout)' })
    .where(and(eq(studioJobs.id, job.id), inArray(studioJobs.status, ['queued', 'running'])))
  return true
}

/** Settle a non-terminal studio_jobs row from its Cloud Run execution (the in-process finishJob
 *  never ran — a hard crash). Queries executionState, and on a definite state flips the row to
 *  match. Returns the new status, or null when the execution is `unknown` (nothing reconciled).
 *  Both callers pre-check non-terminal + stale + a known execution name. */
async function reconcileJobFromExecution(job: {
  id: string
  cloudRunExecution: string
}): Promise<Exclude<ExecState, 'unknown'> | null> {
  const state = await executionState(job.cloudRunExecution)
  if (state !== 'running' && state !== 'succeeded' && state !== 'failed') return null
  await db
    .update(studioJobs)
    .set({
      status: state,
      ...(state !== 'running' && { endedAt: new Date() }),
      ...(state === 'failed' && { error: 'reconciled: execution failed' }),
    })
    .where(eq(studioJobs.id, job.id))
  return state
}

app.get('/admin/jobs/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'not_found' }, 404)
  let job = (await db.select().from(studioJobs).where(eq(studioJobs.id, id)).limit(1))[0]
  if (!job) return c.json({ error: 'not_found' }, 404)

  // Reconcile backstop: if the in-process finishJob never ran (a hard crash), settle the row
  // from the Cloud Run execution. Only for a stale non-terminal row with a known execution —
  // so a normal poll doesn't hammer the Run API.
  const nonTerminal = !TERMINAL.includes(job.status as (typeof TERMINAL)[number])
  const stale = Date.now() - new Date(job.updatedAt).getTime() > RECONCILE_AFTER_MS
  if (nonTerminal && stale && job.cloudRunExecution) {
    const state = await reconcileJobFromExecution({ id, cloudRunExecution: job.cloudRunExecution })
    if (state) job = (await db.select().from(studioJobs).where(eq(studioJobs.id, id)).limit(1))[0]!
  }
  // No-API backstop: a non-terminal row past the task-timeout can't still be running — settle it.
  if (await expireStuckJob(job)) {
    job = (await db.select().from(studioJobs).where(eq(studioJobs.id, id)).limit(1))[0]!
  }
  // Job output (log/summary/metrics) is written by the JOB itself at finishJob, atomically with
  // the status flip — the admin no longer reconstructs it from Cloud Logging. logsUrl deep-links
  // to Logs Explorer for the rare hard-crash that never reached finishJob.
  const logsUrl = job.cloudRunExecution ? jobExecutionLogsUrl(job.cloudRunExecution) : null
  return c.json({ job, logsUrl })
})

// Cancel a running/queued execution (§14.8) — the operator stop path the schema reserved on
// studio_job_status='canceled'. Settles the row to 'canceled' after asking Cloud Run to cancel
// the execution (404 there = already gone, still fine). A terminal row is a 409.
app.post('/admin/jobs/:id/cancel', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'not_found' }, 404)
  const job = (await db.select().from(studioJobs).where(eq(studioJobs.id, id)).limit(1))[0]
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
    .update(studioJobs)
    .set({ status: 'canceled', endedAt: new Date(), error: job.error ?? 'canceled by operator' })
    .where(eq(studioJobs.id, id))
  const row = (await db.select().from(studioJobs).where(eq(studioJobs.id, id)).limit(1))[0]
  return c.json({ job: row })
})

// Trigger an op as a skipper-studio Cloud Run Job. Dry-run by default; a SPENDING run (generate
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
    return c.json({ error: 'conflict', message: 'A run for this target is already in progress.' }, 409)
  }

  const id = crypto.randomUUID()
  const triggeredBy = c.get('adminEmail')
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

  let execShortName = ''
  try {
    execShortName = await runJob(build.args, { STUDIO_JOB_ID: id, STUDIO_JOB_TRIGGERED_BY: triggeredBy })
  } catch (e) {
    // The trigger failed — settle the row so it isn't a phantom 'queued'.
    await db
      .update(studioJobs)
      .set({ status: 'failed', error: e instanceof Error ? e.message : String(e), endedAt: new Date() })
      .where(eq(studioJobs.id, id))
    return c.json({ error: 'trigger_failed', message: e instanceof Error ? e.message : String(e) }, 502)
  }
  if (execShortName) {
    await db.update(studioJobs).set({ cloudRunExecution: execShortName }).where(eq(studioJobs.id, id))
  }

  const row = (await db.select().from(studioJobs).where(eq(studioJobs.id, id)).limit(1))[0]
  return c.json({ job: row }, 201)
})

// POI corpus — sources, narration usage, attribution, and region coverage.
app.get('/admin/pois', async (c) => {
  const poisRows = await db
    .select({
      id: pois.id,
      source: pois.source,
      sourceId: pois.sourceId,
      name: pois.name,
      kind: pois.kind,
      lat: pois.lat,
      lng: pois.lng,
      speakableLat: pois.speakableLat,
      speakableLng: pois.speakableLng,
      factsHash: pois.factsHash,
      // Full-extract length: just gates empty vs non-empty for story-eligibility now (a scenic pin has
      // facts=null → 0; the 800-char floor was removed 2026-06-16). It's the full swept article, not a lead.
      extractChars: sql<number>`coalesce(length(${pois.facts} ->> 'extract'), 0)::int`,
      // Enriched = a NON-EMPTY curated fact sheet exists — the canonical predicate buildStoryFacts /
      // resolveStoryGrounding use (an empty `fact_sheet: []` is semantically un-enriched). CASE-guards
      // jsonb_array_length so a non-array value can't error the query.
      enriched: sql<boolean>`case when jsonb_typeof(${pois.factSheet}) = 'array' then jsonb_array_length(${pois.factSheet}) > 0 else false end`,
      // Sheet DRIFT: an ENRICHED poi whose article moved out from under its sheet — a curated wikipedia
      // span no longer substring-appears in the current extract (an upstream edit changed/removed it).
      // A precise "needs a re-enrich" signal (mirrors select.ts sheetDriftSpans); false when un-enriched.
      sheetDrift: sql<boolean>`case
        when jsonb_typeof(${pois.factSheet}) = 'array' and jsonb_array_length(${pois.factSheet}) > 0 then exists (
          select 1 from jsonb_array_elements(${pois.factSheet}) as span
          where span ->> 'source' = 'wikipedia'
            and strpos(coalesce(${pois.facts} ->> 'extract', ''), span ->> 'text') = 0
        )
        else false
      end`,
      createdAt: pois.createdAt,
    })
    .from(pois)
    .orderBy(asc(pois.name))

  if (!poisRows.length) return c.json({ pois: [] })

  const poiIds = poisRows.map((p) => p.id)

  const [clipStats, regionRows] = await Promise.all([
    // Per-poi: narration metadata — the poi's single `narrations` row (1:1,
    // UNIQUE poi_id). Duration + script power anomaly detection; factsHash/attribution/form drive
    // the stale + unattributed axes (story narrations carry CC BY-SA attribution).
    db
      .select({
        poiId: narrations.poiId,
        audioDurationMs: narrations.audioDurationMs,
        script: narrations.script,
        form: narrations.form,
        attribution: narrations.attribution,
        factsHash: narrations.factsHash, // the clip's grounding hash — vs pois.factsHash = fresh|stale
      })
      .from(narrations)
      .where(inArray(narrations.poiId, poiIds)),
    // All regions + their discovery bbox. POI→region is GEOGRAPHIC (bbox containment), matching
    // how roam actually selects candidates (region-corpus.ts / generate-narrations.ts). A region with no
    // bbox can't claim any poi.
    db
      .select({ slug: regions.slug, displayName: regions.displayName, bbox: regions.bbox })
      .from(regions)
      .orderBy(asc(regions.displayName)),
  ])

  // Suspicious duration: < 90 WPM indicates TTS returned duplicated audio in a single file.
  // Normal corpus average is ~155 WPM; 90 WPM is a conservative floor well below any legit clip.
  const WPM_FLOOR = 90
  const clipMap = new Map(clipStats.map((s) => {
    const wordCount = s.script?.trim().split(/\s+/).filter(Boolean).length ?? 0
    const wpm = wordCount > 0 && s.audioDurationMs
      ? wordCount / (s.audioDurationMs / 1000 / 60)
      : null
    // A story narration must carry CC BY-SA attribution (legal, not optional); null/empty = missing.
    const attributed = s.form !== 'story' || (Array.isArray(s.attribution) && s.attribution.length > 0)
    return [s.poiId, { hasClip: true, suspiciousDuration: wpm !== null && wpm < WPM_FLOOR, factsHash: s.factsHash, attributed }]
  }))
  // Parse each region's "swLng,swLat,neLng,neLat" box once; a poi belongs to the FIRST region
  // (deterministic by displayName) whose box contains its coords. A region with no/invalid bbox
  // claims nothing — set one in the admin Regions view to light up coverage.
  const regionBoxes = regionRows.flatMap((r) => {
    if (!r.bbox) return []
    const p = r.bbox.split(',').map(Number)
    if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return []
    return [{ slug: r.slug, name: r.displayName, swLng: p[0]!, swLat: p[1]!, neLng: p[2]!, neLat: p[3]! }]
  })
  const regionForPoi = (lat: number, lng: number) =>
    regionBoxes.find((b) => lat >= b.swLat && lat <= b.neLat && lng >= b.swLng && lng <= b.neLng) ?? null

  const result = poisRows.map((p) => {
    const clip = clipMap.get(p.id)
    const region = regionForPoi(p.lat, p.lng)
    // Story-eligibility — a POI property (roam draws story-grade POIs from this corpus);
    // single-sourced with the studio pipeline's gate constants (@skipper/shared).
    const storyEligibility = classifyStoryEligibility({
      source: p.source,
      name: p.name,
      extractChars: Number(p.extractChars ?? 0),
    })
    // Narration status — does a narration exist, and is it grounded on the poi's CURRENT facts
    // (else a run would regenerate it).
    const narrationStatus: 'none' | 'fresh' | 'stale' = !clip
      ? 'none'
      : clip.factsHash != null && clip.factsHash === p.factsHash
        ? 'fresh'
        : 'stale'
    // Speakable DRIFT: a curated "where to look" anchor sitting implausibly far from the poi's pin
    // (beyond the kind-aware bound) — almost certainly a typo / hallucinated coordinate, the same check
    // the corpus audit (audit-speakable.ts) + the write boundary apply. Only a poi that carries an
    // anchor can drift; pins without one are never flagged.
    const speakableDrift =
      p.speakableLat != null && p.speakableLng != null
        ? !checkSpeakableAnchor([p.lng, p.lat], [p.speakableLng, p.speakableLat], p.kind).ok
        : false
    return {
      id: p.id,
      source: p.source,
      sourceId: p.sourceId,
      name: p.name,
      kind: p.kind,
      factsHash: p.factsHash,
      createdAt: p.createdAt,
      narrationCount: clip ? 1 : 0,
      storyEligibility,
      enriched: p.enriched,
      sheetDrift: p.sheetDrift,
      speakableDrift,
      narrationStatus,
      suspiciousDuration: clip?.suspiciousDuration ?? false,
      // Stale = the narration grounded on a now-changed facts_hash. narrationStatus already encodes this;
      // surface it on the dedicated axis too (un-clipped pois are never stale).
      staleFacts: narrationStatus === 'stale',
      attributed: clip?.attributed ?? true,
      regionSlug: region?.slug ?? null,
      regionName: region?.name ?? null,
    }
  })

  return c.json({ pois: result })
})

// Presigned R2 URL + metadata for a single POI's narration (founder ear-pass).
app.get('/admin/pois/:poiId/narration', async (c) => {
  const poiId = c.req.param('poiId')
  if (!UUID_RE.test(poiId)) return c.json({ error: 'not_found' }, 404)

  // A narration = the poi's single `narrations` row (1:1, UNIQUE poi_id). The narration id is the
  // stable clip id (R2 key is per-narration); the audio R2 key is narrations.audioUrl.
  const clip = (
    await db
      .select({
        id: narrations.id,
        script: narrations.script,
        audioUrl: narrations.audioUrl,
        audioDurationMs: narrations.audioDurationMs,
        attribution: narrations.attribution,
        factsHash: narrations.factsHash,
      })
      .from(narrations)
      .where(eq(narrations.poiId, poiId))
      .limit(1)
  )[0]

  if (!clip || !clip.audioUrl) return c.json({ error: 'not_found' }, 404)
  const audioKey = clip.audioUrl

  try {
    return c.json({
      narration: {
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
    console.error('[admin] narration presign failed', e)
    return c.json({ error: 'audio_unavailable', message: 'R2 not configured or presign failed.' }, 503)
  }
})

/* -------------------------------------------------------------------------- */
/*  POI corrections — operator-editable upstream-fact corrections + speakable    */
/*  anchor, replacing the seed-edit + reseed CLI loop. These MUTATE the curation  */
/*  layer (poi_overrides + pois.speakable_lat/lng) but spend nothing — corrections */
/*  take effect on the NEXT generate/regeneration (the studio pipeline loads overrides + */
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
  source: 'wikipedia' | 'wikidata'
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
        // pin + kind: the speakable-anchor sanity guard compares the anchor to the pin against the
        // kind-aware bound (a vantage is "roughly here," not km away).
        kind: pois.kind,
        lat: pois.lat,
        lng: pois.lng,
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
      // Sanity-guard the anchor against the pin: a "where to look" vantage is roughly within the
      // feature's own body, never km away. A coordinate beyond the kind-aware bound is almost
      // certainly a typo or a hallucination, so reject it — overridable with `force:true` for the
      // rare genuinely-distant vantage. The corpus audit (`audit-speakable.ts`) enforces the SAME
      // bound over existing rows.
      const check = checkSpeakableAnchor([poi.lng, poi.lat], [lng, lat], poi.kind)
      if (!check.ok && body.force !== true) {
        console.log(
          `[admin] ${operator} REJECTED speakable anchor on ${poi.source}:${poi.sourceId} — ${Math.round(check.distanceM)}m > ${check.maxM}m`,
        )
        return c.json(
          {
            error: 'speakable_too_far',
            message: `That anchor is ${Math.round(check.distanceM)} m from the POI pin — beyond the ${check.maxM} m sanity bound for a “${poi.kind ?? 'place'}”. A vantage is roughly here, not km away, so this looks like a typo. Double-check the coordinates, or pass force:true to set it anyway.`,
            distanceM: Math.round(check.distanceM),
            maxM: check.maxM,
          },
          422,
        )
      }
      console.log(`[admin] ${operator} set speakable anchor on ${poi.source}:${poi.sourceId} → ${lat},${lng} (${Math.round(check.distanceM)}m from pin)`)
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

// Hard-DELETE one POI — ONLY when it is ORPHANED (no narration references it). narrations.poiId
// is onDelete:'cascade', so the DB would happily drop the narration with the poi — but a POI carrying
// a narration is referenced BY DEFINITION, and the fix there is to regenerate or correct it, not
// delete it; we refuse with a clean 409. An orphaned POI carries no narration, so there are no orphan
// R2 clips to sweep. poi_overrides are keyed by (source, source_id), survive the row, and re-apply on
// re-discovery — left intact.
app.delete('/admin/pois/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'not_found' }, 404)

  const [poi] = await db.select({ id: pois.id, name: pois.name }).from(pois).where(eq(pois.id, id)).limit(1)
  if (!poi) return c.json({ error: 'not_found' }, 404)

  const [refRow] = await db.select({ refs: count() }).from(narrations).where(eq(narrations.poiId, id))
  const refs = Number(refRow?.refs ?? 0)
  if (refs > 0) {
    return c.json(
      {
        error: 'conflict',
        message: `"${poi.name}" has a narration — regenerate or correct it instead of deleting.`,
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
// SPA fallback — client-side routes (/runs, /pois, /regions, /reference) return index.html.
app.get('*', serveStatic({ path: `${WEB_ROOT}/index.html` }))

const port = Number(process.env.PORT ?? 8788)

// Bun serves a default export of the shape { port, fetch }.
export default { port, fetch: app.fetch }
