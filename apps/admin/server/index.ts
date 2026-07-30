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
//   GET  /admin/users             -> account list with per-user credit ledger summary (granted/used/remaining)
//   POST /admin/users/:id/credits -> grant credits to a user (an admin_grant ledger entry)
//   GET  /admin/places            -> a region's curated places (point-in-bbox) for the /places curation surface
//   PATCH  /admin/places/:id      -> toggle a place's role (endpoint/break) or featured flag (prune+promote)
//   DELETE /admin/places/:id      -> remove a curated place
//   POST /admin/places/resolve    -> live Google Places resolve of a typed name (manual-add candidate)
//   POST /admin/places            -> add a manually-resolved place (upsert by place_id, role-tagged)
//   POST /admin/places/draft      -> LLM-draft a region's curated set (Opus, no Places calls / no writes) — the reviewable preview
//   POST /admin/places/curate     -> resolve the pruned drafts against Google Places + upsert role-tagged

import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { and, asc, between, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import {
  creditEntries,
  evalRuns,
  evalScores,
  studioJobs,
  narrations,
  places,
  poiOverrides,
  pois,
  regions,
} from '@skipper/db/schema'
import { user } from '@skipper/db/auth-schema'
import { CLAUDE_MODELS, classifyStoryEligibility } from '@skipper/shared'
import { checkSpeakableAnchor } from '@skipper/engine'
import { requireAdmin, type AdminEnv } from './auth'
import { bboxError, parseBbox } from './bbox'
import { draftCuratedPlaces, resolvePlaceInBbox, type PlaceDraft, type ResolvedPlace } from './places'
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

/** True for a Postgres unique_violation (SQLSTATE 23505) — how neon-http surfaces a partial-unique-index
 *  conflict. Lets the spend trigger turn a lost idempotency race into a clean 409 instead of a 500. (audit #1) */
function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code
  if (code === '23505') return true
  return /duplicate key value|unique constraint|\b23505\b/i.test(String((e as { message?: unknown } | null)?.message ?? ''))
}

// Bounds on a fact_edit override (audit #10): its find/replace rides EVERY future extract fetch into the
// grounded facts of every regeneration, so an unbounded/garbage write silently corrupts the corpus. A
// real correction is a phrase or sentence — these caps are generous but catch a paste/fat-finger.
const MAX_OVERRIDE_LEN = 2000
const MAX_REASON_LEN = 1000
/** A valid, length-bounded http(s) URL — the override's sourceUrl is operator-supplied provenance. */
function isHttpUrl(s: string): boolean {
  if (s.length > 2048) return false
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

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
  const [rows, poiCoords] = await Promise.all([
    db
      .select({
        slug: regions.slug,
        displayName: regions.displayName,
        bbox: regions.bbox,
        releasedAt: regions.releasedAt,
      })
      .from(regions)
      .orderBy(asc(regions.displayName)),
    // POI→region is geometry-first (point-in-bbox; there's NO region_id to GROUP BY), so load every
    // poi's coords once and tally per region in JS. Cheap — the corpus is a few hundred rows.
    db.select({ lat: pois.lat, lng: pois.lng }).from(pois),
  ])

  // Each poi belongs to the FIRST region (rows are displayName-ordered) whose bbox contains it — the
  // same single-assignment coverage the POIs view shows, so the two counts always agree. A region with
  // no/invalid bbox claims nothing → poiCount stays null ("no bbox set", distinct from a genuine 0).
  const boxed = rows.map((r) => ({ slug: r.slug, box: parseBbox(r.bbox) }))
  const counts = new Map<string, number>(boxed.flatMap((b) => (b.box ? [[b.slug, 0]] : [])))
  for (const { lat, lng } of poiCoords) {
    const hit = boxed.find(
      ({ box }) => box && lat >= box.swLat && lat <= box.neLat && lng >= box.swLng && lng <= box.neLng,
    )
    if (hit) counts.set(hit.slug, counts.get(hit.slug)! + 1)
  }

  return c.json({ regions: rows.map((r) => ({ ...r, poiCount: counts.get(r.slug) ?? null })) })
})

app.post('/admin/regions', async (c) => {
  const body = await c.req.json<{ slug: string; displayName: string; bbox?: string | null }>()
  if (!body.slug?.trim() || !body.displayName?.trim()) {
    return c.json({ error: 'slug and displayName are required' }, 400)
  }
  const bbox = body.bbox?.trim() || null
  // Validate the bbox at the write boundary — a swapped-corner/oversized box silently scopes a later
  // SPENDING enrich/generate over a huge candidate set (point-in-bbox selection). (audit #5)
  if (bbox) {
    const err = bboxError(bbox)
    if (err) return c.json({ error: err }, 400)
  }
  const [row] = await db.insert(regions).values({
    slug: body.slug.trim(),
    displayName: body.displayName.trim(),
    bbox,
  }).returning({ slug: regions.slug, displayName: regions.displayName, bbox: regions.bbox })
  return c.json({ region: row }, 201)
})

app.patch('/admin/regions/:slug', async (c) => {
  const slug = c.req.param('slug')
  const body = await c.req.json<{ displayName?: string; bbox?: string | null }>()
  const update: Record<string, unknown> = {}
  if (body.displayName !== undefined) update.displayName = body.displayName.trim()
  if (body.bbox !== undefined) {
    const bbox = body.bbox?.trim() || null
    if (bbox) {
      const err = bboxError(bbox) // same write-boundary guard as POST (audit #5)
      if (err) return c.json({ error: err }, 400)
    }
    update.bbox = bbox
  }
  if (!Object.keys(update).length) return c.json({ error: 'nothing to update' }, 400)
  const [row] = await db.update(regions)
    .set(update)
    .where(eq(regions.slug, slug))
    .returning({ slug: regions.slug, displayName: regions.displayName, bbox: regions.bbox })
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json({ region: row })
})

// Release a region (region-release-gate): flip it DRAFT → RELEASED and bulk-stamp `released_at` on
// every still-STAGED narration in its bbox (auto-release-all). IRREVERSIBLE by design — never
// un-release (the read paths serve released clips forever; un-release would orphan saved drives +
// invalidate offline downloads). Idempotent + re-runnable: a second call keeps the region's original
// release date but stamps any clips that staged since (the "push new clips public" path).
// See docs/decisions/region-release-gate.md.
app.post('/admin/regions/:slug/release', async (c) => {
  const slug = c.req.param('slug')
  const region = (
    await db
      .select({ slug: regions.slug, bbox: regions.bbox, releasedAt: regions.releasedAt })
      .from(regions)
      .where(eq(regions.slug, slug))
      .limit(1)
  )[0]
  if (!region) return c.json({ error: 'not_found' }, 404)
  const box = parseBbox(region.bbox)
  if (!box) {
    return c.json({ error: 'bbox_required', message: 'Set a valid region bbox before releasing.' }, 400)
  }

  const releasedAt = new Date()
  const inBboxPoi = db
    .select({ id: pois.id })
    .from(pois)
    .where(and(between(pois.lat, box.swLat, box.neLat), between(pois.lng, box.swLng, box.neLng)))

  const [, stamped] = await db.batch([
    // Region row: set ONLY while still draft, so a re-run preserves the first release timestamp.
    db.update(regions).set({ releasedAt }).where(and(eq(regions.slug, slug), isNull(regions.releasedAt))),
    // Every staged clip in the bbox → released. Re-runnable: only touches released_at IS NULL rows.
    db
      .update(narrations)
      .set({ releasedAt })
      .where(and(isNull(narrations.releasedAt), inArray(narrations.poiId, inBboxPoi)))
      .returning({ id: narrations.id }),
  ])

  return c.json({
    region: { slug: region.slug, releasedAt: region.releasedAt ?? releasedAt },
    releasedClips: stamped.length,
    alreadyReleased: region.releasedAt != null,
  })
})

// Bbox lookup — a Claude estimate the operator can refine conversationally (founder 2026-06-20:
// dropped the Nominatim/OSM cross-check; Claude-only). Each refine round replays Claude's OWN prior
// estimate + the new instruction, so it EDITS the last box instead of starting over. Used by the
// admin Regions drawer so the operator never has to hand-key coordinates.
app.post('/admin/regions/bbox-lookup', async (c) => {
  const body = await c.req
    .json<{ query?: string; refinements?: { priorBbox?: string; priorReasoning?: string; instruction?: string }[] }>()
    .catch(() => ({}) as { query?: string; refinements?: never })
  const query = body.query?.trim()
  if (!query) return c.json({ error: 'query is required' }, 400)
  const refinements = Array.isArray(body.refinements) ? body.refinements : []

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

  // Build the conversation: the base ask, then alternating (assistant prior-estimate / user refinement)
  // turns. The forced tool only shapes the FINAL answer; historical assistant turns are plain text.
  const messages: import('@anthropic-ai/sdk').Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `What is the bounding box for "${query}"? Return as lng_min,lat_min,lng_max,lat_max. Prefer the tight boundary of the named feature (e.g. a national park boundary, not the broader county). For a drive corridor or road trip region, add ~20 km of buffer on each side.`,
    },
  ]
  for (const ref of refinements) {
    const prior = (ref?.priorBbox ?? '').trim()
    messages.push({
      role: 'assistant',
      content: prior ? `Bounding box: ${prior}. ${ref?.priorReasoning ?? ''}`.trim() : 'Bounding box estimated.',
    })
    messages.push({
      role: 'user',
      content: `Refine that bounding box: ${(ref?.instruction ?? '').trim()}. Return the full updated lng_min,lat_min,lng_max,lat_max.`,
    })
  }

  try {
    const client = new (await import('@anthropic-ai/sdk')).default()
    const msg = await client.messages.create({
      model: process.env.ADMIN_PROPOSE_MODEL ?? CLAUDE_MODELS.opus,
      max_tokens: 512,
      tools: [BBOX_TOOL],
      tool_choice: { type: 'any' },
      messages,
    })
    const tool = msg.content.find((b) => b.type === 'tool_use')
    if (!tool || tool.type !== 'tool_use') return c.json({ llm: null, llmError: 'no tool call' })
    const inp = tool.input as { bbox: string; reasoning: string; confidence: string }
    return c.json({
      llm: { bbox: inp.bbox.trim(), reasoning: inp.reasoning, confidence: inp.confidence as 'high' | 'medium' | 'low' },
      llmError: null,
    })
  } catch (e) {
    return c.json({ llm: null, llmError: String(e) })
  }
})

/* -------------------------------------------------------------------------- */
/*  Curated places — the /places curation surface (drive endpoints + breaks)    */
/* -------------------------------------------------------------------------- */
// The `places` table is the curated real-world-location layer (towns/marinas/lookouts as drive
// endpoints; coffee/gas/rest as break pitstops), role-tagged. Coords are resolved + STORED here so the
// runtime picker (GET /drives/anchors) makes zero live Places calls. Region membership is point-in-bbox
// (geometry-first; no region_id). The bulk seed is the interactive Curate flow (POST /draft → operator
// prunes → POST /curate); these endpoints are the draft/resolve + review/prune/promote + manual-add
// surface. See docs/specs/places-endpoints-spec.md.

/** Columns returned for a curated place row (the table + map). */
const placeCols = {
  id: places.id,
  placeId: places.placeId,
  name: places.name,
  primaryType: places.primaryType,
  lat: places.lat,
  lng: places.lng,
  endpointEligible: places.endpointEligible,
  breakEligible: places.breakEligible,
  featured: places.featured,
}

/** Upsert one curated place (dedup by place_id). OR-merge the role flags so a role, once curated,
 *  persists until an admin prunes it (a re-curate / manual-add for the OTHER role never clears this
 *  one); name/coords/primaryType/featured are last-write-wins (a re-resolve refreshes the snapshot +
 *  the popular judgment). Shared by the manual-add (POST /admin/places) + the curate-resolve loop. */
function upsertCuratedPlace(row: {
  placeId: string
  name: string
  primaryType: string | null
  lat: number
  lng: number
  endpointEligible: boolean
  breakEligible: boolean
  featured: boolean
}) {
  return db
    .insert(places)
    .values(row)
    .onConflictDoUpdate({
      target: places.placeId,
      set: {
        name: sql`excluded.name`,
        primaryType: sql`excluded.primary_type`,
        lat: sql`excluded.lat`,
        lng: sql`excluded.lng`,
        endpointEligible: sql`${places.endpointEligible} OR excluded.endpoint_eligible`,
        breakEligible: sql`${places.breakEligible} OR excluded.break_eligible`,
        featured: sql`excluded.featured`,
        updatedAt: new Date(),
      },
    })
    .returning(placeCols)
}

// GET /admin/places?region=<slug> — the region's curated places (point-in-bbox), all role flags, plus
// the region bbox (for the map). featured first, then A→Z — the same order the picker floats.
app.get('/admin/places', async (c) => {
  const slug = (c.req.query('region') ?? '').trim()
  if (!slug) return c.json({ error: 'region (slug) is required' }, 400)
  const region = (
    await db.select({ bbox: regions.bbox }).from(regions).where(eq(regions.slug, slug)).limit(1)
  )[0]
  if (!region) return c.json({ error: 'not_found' }, 404)
  const box = parseBbox(region.bbox)
  if (!box) return c.json({ places: [], bbox: null }) // no bbox set → nothing to scope yet
  const rows = await db
    .select(placeCols)
    .from(places)
    .where(and(between(places.lat, box.swLat, box.neLat), between(places.lng, box.swLng, box.neLng)))
    .orderBy(desc(places.featured), asc(places.name))
  return c.json({ places: rows, bbox: region.bbox })
})

// PATCH /admin/places/:id — toggle a role / featured (the prune+promote loop). Only the booleans sent
// are changed; an empty body is a 400. Independent flags so a place can be pruned from one role only.
app.patch('/admin/places/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'bad_request' }, 400)
  const body = await c.req
    .json<{ endpointEligible?: boolean; breakEligible?: boolean; featured?: boolean }>()
    .catch(() => ({}) as Record<string, never>)
  const update: Record<string, unknown> = {}
  if (typeof body.endpointEligible === 'boolean') update.endpointEligible = body.endpointEligible
  if (typeof body.breakEligible === 'boolean') update.breakEligible = body.breakEligible
  if (typeof body.featured === 'boolean') update.featured = body.featured
  if (!Object.keys(update).length) return c.json({ error: 'nothing to update' }, 400)
  update.updatedAt = new Date()
  const [row] = await db.update(places).set(update).where(eq(places.id, id)).returning(placeCols)
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json({ place: row })
})

// DELETE /admin/places/:id — remove a curated place (a stub detour, if any, cascades via the FK).
app.delete('/admin/places/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'bad_request' }, 400)
  const [row] = await db.delete(places).where(eq(places.id, id)).returning({ id: places.id })
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json({ ok: true })
})

// POST /admin/places/resolve { region, query } — live Google Places resolve of a typed name, bbox-bound
// to the region, for the manual-add flow. Returns { place: null } when nothing matches in-region.
app.post('/admin/places/resolve', async (c) => {
  const body = await c.req.json<{ region?: string; query?: string }>().catch(() => ({}) as Record<string, never>)
  const slug = (body.region ?? '').trim()
  const query = (body.query ?? '').trim()
  if (!slug || !query) return c.json({ error: 'region and query are required' }, 400)
  const region = (
    await db.select({ bbox: regions.bbox }).from(regions).where(eq(regions.slug, slug)).limit(1)
  )[0]
  if (!region) return c.json({ error: 'not_found' }, 404)
  const box = parseBbox(region.bbox)
  if (!box) return c.json({ error: 'bbox_required', message: 'Set a valid region bbox before adding places.' }, 400)
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return c.json({ error: 'places_unconfigured', message: 'GOOGLE_MAPS_API_KEY is not set.' }, 503)
  try {
    const place = await resolvePlaceInBbox(query, box, apiKey)
    return c.json({ place }) // place may be null (no in-region match)
  } catch (e) {
    return c.json({ error: 'places_error', message: e instanceof Error ? e.message : String(e) }, 502)
  }
})

// POST /admin/places — add a manually-resolved place (upsert by place_id). OR-merges role flags so a
// re-add never clears a role the curate job set; name/coords/primaryType/featured are last-write-wins.
app.post('/admin/places', async (c) => {
  const body = await c.req
    .json<{
      placeId?: string
      name?: string
      lat?: number
      lng?: number
      primaryType?: string | null
      endpointEligible?: boolean
      breakEligible?: boolean
      featured?: boolean
    }>()
    .catch(() => ({}) as Record<string, never>)
  const placeId = (body.placeId ?? '').trim()
  const name = (body.name ?? '').trim()
  if (!placeId || !name || typeof body.lat !== 'number' || typeof body.lng !== 'number') {
    return c.json({ error: 'placeId, name, lat, lng are required' }, 400)
  }
  const endpointEligible = body.endpointEligible === true
  const breakEligible = body.breakEligible === true
  if (!endpointEligible && !breakEligible) {
    return c.json({ error: 'pick at least one role (endpoint or break)' }, 400)
  }
  const [row] = await upsertCuratedPlace({
    placeId,
    name,
    primaryType: body.primaryType ?? null,
    lat: body.lat,
    lng: body.lng,
    endpointEligible,
    breakEligible,
    featured: body.featured === true,
  })
  return c.json({ place: row }, 201)
})

// POST /admin/places/draft { region, target? } — LLM-draft this region's curated hubs + pitstops with
// Opus (forced tool). The REVIEWABLE preview: spends a few cents on ONE Opus call, makes NO Places calls
// and writes NOTHING. The operator prunes the returned list, then POST /admin/places/curate resolves +
// upserts the keepers. Founder-gated by IAP (+ the explicit button click). 503 if ANTHROPIC unset.
app.post('/admin/places/draft', async (c) => {
  const body = await c.req.json<{ region?: string; target?: number }>().catch(() => ({}) as Record<string, never>)
  const slug = (body.region ?? '').trim()
  if (!slug) return c.json({ error: 'region is required' }, 400)
  const region = (
    await db.select({ displayName: regions.displayName, bbox: regions.bbox }).from(regions).where(eq(regions.slug, slug)).limit(1)
  )[0]
  if (!region) return c.json({ error: 'not_found' }, 404)
  if (!parseBbox(region.bbox)) {
    return c.json({ error: 'bbox_required', message: 'Set a valid region bbox before curating.' }, 400)
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'anthropic_unconfigured', message: 'ANTHROPIC_API_KEY is not set.' }, 503)
  }
  const targetN = Math.max(8, Math.min(60, Number(body.target) || 30))
  try {
    const drafts = await draftCuratedPlaces(region.displayName, {
      targetN,
      model: process.env.ADMIN_CURATE_MODEL ?? CLAUDE_MODELS.opus,
    })
    return c.json({ drafts })
  } catch (e) {
    return c.json({ error: 'draft_failed', message: e instanceof Error ? e.message : String(e) }, 502)
  }
})

// POST /admin/places/curate { region, drafts } — resolve each operator-kept draft against Google Places
// (bbox-bound) + upsert role-tagged (dedup by place_id, OR-merge roles). SPENDS a few cents of Places +
// writes. A draft that can't be pinned in-region is dropped (non-fatal); a Places error on one draft is
// reported per-row, not fatal to the batch. Returns a per-place result list so the dialog can summarize.
app.post('/admin/places/curate', async (c) => {
  const body = await c.req.json<{ region?: string; drafts?: PlaceDraft[] }>().catch(() => ({}) as Record<string, never>)
  const slug = (body.region ?? '').trim()
  const drafts = Array.isArray(body.drafts) ? body.drafts : []
  if (!slug) return c.json({ error: 'region is required' }, 400)
  if (!drafts.length) return c.json({ error: 'no drafts to curate' }, 400)
  const region = (await db.select({ bbox: regions.bbox }).from(regions).where(eq(regions.slug, slug)).limit(1))[0]
  if (!region) return c.json({ error: 'not_found' }, 404)
  const box = parseBbox(region.bbox)
  if (!box) return c.json({ error: 'bbox_required', message: 'Set a valid region bbox before curating.' }, 400)
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return c.json({ error: 'places_unconfigured', message: 'GOOGLE_MAPS_API_KEY is not set.' }, 503)

  // Resolve sequentially (one-time, ~30 places) and merge by place_id — two drafts can pin the same
  // canonical place (OR the roles, keep featured if either says so). Mirrors curate-places.ts.
  const byId = new Map<string, { place: ResolvedPlace; endpointEligible: boolean; breakEligible: boolean; featured: boolean }>()
  const results: { name: string; status: 'resolved' | 'dropped' | 'error'; resolvedName?: string; message?: string }[] = []
  for (const d of drafts) {
    const query = (d?.query ?? '').trim()
    const role = d?.role
    if (!query || (role !== 'endpoint' && role !== 'break' && role !== 'both')) {
      results.push({ name: d?.name ?? '?', status: 'error', message: 'invalid draft (missing query/role)' })
      continue
    }
    let place: ResolvedPlace | null
    try {
      place = await resolvePlaceInBbox(query, box, apiKey)
    } catch (e) {
      results.push({ name: d.name, status: 'error', message: e instanceof Error ? e.message : String(e) })
      continue
    }
    if (!place) {
      results.push({ name: d.name, status: 'dropped' })
      continue
    }
    const endpoint = role === 'endpoint' || role === 'both'
    const brk = role === 'break' || role === 'both'
    const prev = byId.get(place.placeId)
    byId.set(place.placeId, {
      place,
      endpointEligible: (prev?.endpointEligible ?? false) || endpoint,
      breakEligible: (prev?.breakEligible ?? false) || brk,
      featured: (prev?.featured ?? false) || d.featured === true,
    })
    results.push({ name: d.name, status: 'resolved', resolvedName: place.name })
  }

  for (const r of byId.values()) {
    await upsertCuratedPlace({
      placeId: r.place.placeId,
      name: r.place.name,
      primaryType: r.place.primaryType ?? null,
      lat: r.place.lat,
      lng: r.place.lng,
      endpointEligible: r.endpointEligible,
      breakEligible: r.breakEligible,
      featured: r.featured,
    })
  }

  return c.json({ added: byId.size, results })
})

// GET /admin/runs — a unified feed merging the operational studio_jobs with the historical
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
        // The Target column reads targetSlug (the display region) and falls back to targetId
        // (the lock label) so legacy rows — which only set targetId — still show their region.
        // A whole-corpus run leaves both NULL, surfaced as "All".
        targetId: studioJobs.targetId,
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
        tts: evalRuns.ttsScore,
        diversity: evalRuns.diversityScore,
        withheld: evalRuns.withheld,
        total: evalRuns.total,
        shipped: evalRuns.shipped,
        narrationModel: evalRuns.narrationModel,
        gitSha: evalRuns.gitSha,
        createdAt: evalRuns.createdAt,
      })
      .from(evalRuns)
      .orderBy(desc(evalRuns.createdAt))
      .limit(100),
  ])

  // Reconcile stale non-terminal jobs so the list reflects reality without requiring a
  // detail-drawer click. Limit to jobs created within the 6h task-timeout window (cloudbuild.studio.yaml
  // = 21600s) to avoid hammering the Cloud Run API on every poll for ancient rows past the timeout.
  const staleNonTerminal = jobs.filter(
    (j) =>
      !TERMINAL.includes(j.status as (typeof TERMINAL)[number]) &&
      j.cloudRunExecution &&
      j.updatedAt &&
      Date.now() - new Date(j.updatedAt).getTime() > RECONCILE_AFTER_MS &&
      Date.now() - new Date(j.createdAt).getTime() < 6 * 60 * 60 * 1000,
  )
  if (staleNonTerminal.length > 0) {
    await Promise.all(
      staleNonTerminal.map(async (j) => {
        const state = await reconcileJobFromExecution({ id: j.id, cloudRunExecution: j.cloudRunExecution! })
        // reconcile's UPDATE is guarded (audit #3): a row another path settled terminal DURING the
        // executionState round-trip is a no-op, so re-read the authoritative status rather than the
        // attempted one — else the list (and the expireStuckJob check below) would act on a phantom
        // status for one poll. The detail route already re-reads the same way.
        if (state) {
          const fresh = (
            await db.select({ status: studioJobs.status }).from(studioJobs).where(eq(studioJobs.id, j.id)).limit(1)
          )[0]
          if (fresh) j.status = fresh.status
        }
      }),
    )
  }

  // No-API backstop: force-fail any row that outlived the task-timeout. The reconcile above skips
  // rows >6h old to spare the Cloud Run API, so this is what finally settles an ancient stuck row
  // (and frees its target for re-runs).
  await Promise.all(jobs.map(async (j) => { if (await expireStuckJob(j)) j.status = 'failed' }))

  const referenced = new Set(jobs.map((j) => j.evalRunId).filter(Boolean) as string[])
  const runs = [
    ...jobs.map((j) => ({
      source: 'job' as const,
      id: j.id,
      kind: j.kind,
      slug: j.targetSlug ?? j.targetId,
      status: j.status,
      pass: null,
      dryRun: j.dryRun,
      phase: j.phase,
      costUsd: j.costUsd,
      grounding: null,
      tts: null,
      diversity: null,
      withheld: null,
      total: null,
      shipped: null,
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
        tts: e.tts,
        diversity: e.diversity,
        withheld: e.withheld,
        total: e.total,
        shipped: e.shipped,
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
// Past the Cloud Run task-timeout (cloudbuild.studio.yaml = 21600s / 6h) + slack, a non-terminal row
// can NOT still be running — the job was killed. Force-fail it with NO API round-trip; this is the
// backstop for a row the executionState reconcile can't settle (no/expired execution name, or a
// row already >6h old which the list reconcile skips), so a stuck row stops blocking re-runs.
const JOB_MAX_AGE_MS = 21_600_000 + 300_000

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
    // Guard non-terminal (like expireStuckJob) so a row another path settled DURING the executionState
    // round-trip — e.g. an operator cancel — is never clobbered (and a stale 'running' can't un-cancel
    // it). A terminal status is a one-way latch. (audit #3)
    .where(and(eq(studioJobs.id, job.id), inArray(studioJobs.status, ['queued', 'running'])))
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
    // Guard non-terminal: if the run settled (e.g. succeeded) between the read above and this write,
    // don't overwrite that terminal status with 'canceled'. The re-read returns the real row. (audit #3)
    .where(and(eq(studioJobs.id, id), inArray(studioJobs.status, ['queued', 'running'])))
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
    return c.json({ error: 'conflict', message: 'A run for this target is already in progress.' }, 409)
  }

  const id = crypto.randomUUID()
  const triggeredBy = c.get('adminEmail')
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
      return c.json({ error: 'conflict', message: 'A run for this target is already in progress.' }, 409)
    }
    throw e
  }

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
        releasedAt: narrations.releasedAt, // region-release-gate: NULL = staged, non-null = public
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
    return [s.poiId, { hasClip: true, suspiciousDuration: wpm !== null && wpm < WPM_FLOOR, factsHash: s.factsHash, attributed, released: s.releasedAt != null }]
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

  // Off-road flag (dogfood 2026-06-25 #5/#7 "flag POIs not near a road — they won't trigger"): a POI with
  // NO road-snapped speakable anchor triggers on its raw centroid, so an off-road pin fires garbage or never.
  // But a null anchor is AMBIGUOUS — it's either genuine backcountry (the snap found no drivable road within
  // bound, leaving it null on purpose — snap-speakable-anchors.ts) OR a region the snap simply hasn't run over
  // yet. We disambiguate with NO new column + NO re-run: a region whose snap has run carries anchored POIs, so
  // "anchorless WHERE its region also has anchors" = the snap examined this pin and found no road. Un-snapped
  // regions (zero anchors) flag nothing — we don't know yet. Self-corrects the moment a new region is snapped.
  const snappedRegions = new Set<string>()
  for (const p of poisRows) {
    if (p.speakableLat == null) continue
    const r = regionForPoi(p.lat, p.lng)
    if (r) snappedRegions.add(r.slug)
  }

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
      // Anchorless AND its region has been snapped (carries anchors) ⇒ off-road / won't trigger (see snappedRegions).
      offRoad: p.speakableLat == null && region != null && snappedRegions.has(region.slug),
      narrationStatus,
      suspiciousDuration: clip?.suspiciousDuration ?? false,
      // Stale = the narration grounded on a now-changed facts_hash. narrationStatus already encodes this;
      // surface it on the dedicated axis too (un-clipped pois are never stale).
      staleFacts: narrationStatus === 'stale',
      attributed: clip?.attributed ?? true,
      // region-release-gate: a clip exists but is STAGED (not yet public) until released. Only
      // meaningful when a clip exists (narrationStatus !== 'none').
      released: clip?.released ?? false,
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
        releasedAt: narrations.releasedAt,
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
        // region-release-gate: NULL = staged (not public), non-null = released. Drives the badge +
        // the per-clip Release action in the admin narration tab.
        releasedAt: clip.releasedAt,
      },
    })
  } catch (e) {
    console.error('[admin] narration presign failed', e)
    return c.json({ error: 'audio_unavailable', message: 'R2 not configured or presign failed.' }, 503)
  }
})

// Per-clip release (region-release-gate): stamp ONE narration released — the trickle case (release a
// freshly ear-checked clip inside an already-open region, without re-releasing the whole region).
// Release-only + monotonic: never clears released_at. See docs/decisions/region-release-gate.md.
app.post('/admin/pois/:poiId/narration/release', async (c) => {
  const poiId = c.req.param('poiId')
  if (!UUID_RE.test(poiId)) return c.json({ error: 'not_found' }, 404)
  const [row] = await db
    .update(narrations)
    .set({ releasedAt: new Date() })
    .where(and(eq(narrations.poiId, poiId), isNull(narrations.releasedAt)))
    .returning({ releasedAt: narrations.releasedAt })
  if (row) return c.json({ releasedAt: row.releasedAt })
  // No row updated → either no narration for this poi, or it's already released. Distinguish so the
  // client shows the right state (an already-released clip is a no-op success, not a 404).
  const existing = (
    await db
      .select({ releasedAt: narrations.releasedAt })
      .from(narrations)
      .where(eq(narrations.poiId, poiId))
      .limit(1)
  )[0]
  if (!existing) return c.json({ error: 'not_found' }, 404)
  return c.json({ releasedAt: existing.releasedAt, alreadyReleased: true })
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
  /** OSM `highway=` class the anchor snapped to; null when hand-placed or un-snapped. */
  speakableRoadClass: string | null
  /** Non-null ⇒ hidden from NEW drives + roam (audio kept; saved drives keep the stop). */
  excludedReason: string | null
  /** How this poi is GROUPED for telling (docs/ideas/poi-legibility-layer.md). Null when it stands
   *  alone, which is most of them. An ANCHOR speaks for the group; a SATELLITE is spoken about by its
   *  anchor. Written by `classify-treatments`; INERT until phase 4 fuses the audio. */
  cluster:
    | { role: 'anchor'; treatment: string; title: string | null; members: { id: string; name: string }[] }
    | { role: 'satellite'; anchorId: string; anchorName: string; treatment: string | null; title: string | null }
    | null
}

// Assemble the corrections payload for one poi: its (source, source_id)-keyed override rows
// (newest first) + its speakable anchor.
async function correctionsForPoi(poi: {
  id?: string
  source: 'wikipedia' | 'wikidata'
  sourceId: string
  speakableLat: number | null
  speakableLng: number | null
  speakableRoadClass: string | null
  excludedReason: string | null
  clusterAnchorId?: string | null
  clusterTreatment?: string | null
  clusterTitle?: string | null
}): Promise<CorrectionsPayload> {
  // Resolve the grouping into something the console can render without a second round-trip: an anchor
  // needs the names it speaks for, a satellite needs the name of the poi that speaks for it.
  let cluster: CorrectionsPayload['cluster'] = null
  if (poi.clusterAnchorId) {
    const [a] = await db
      .select({ name: pois.name, treatment: pois.clusterTreatment, title: pois.clusterTitle })
      .from(pois)
      .where(eq(pois.id, poi.clusterAnchorId))
      .limit(1)
    cluster = {
      role: 'satellite',
      anchorId: poi.clusterAnchorId,
      anchorName: a?.name ?? '(missing anchor)',
      treatment: a?.treatment ?? null,
      title: a?.title ?? null,
    }
  } else if (poi.clusterTreatment && poi.id) {
    const members = await db
      .select({ id: pois.id, name: pois.name })
      .from(pois)
      .where(eq(pois.clusterAnchorId, poi.id))
      .orderBy(pois.name)
    cluster = { role: 'anchor', treatment: poi.clusterTreatment, title: poi.clusterTitle ?? null, members }
  }
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
    // Which OSM road the anchor was snapped to. The operator's question this answers: "why does this
    // stop trigger from nowhere?" — a `residential`/`unclassified` anchor is on a real road that the
    // drive never takes. Written by snap-speakable-anchors; null for a hand-placed or un-snapped anchor.
    cluster,
    speakableRoadClass: poi.speakableRoadClass,
    // Non-null ⇒ this poi is HIDDEN from new drives and from roam. Surfaced here because it is
    // otherwise invisible: the API just stops returning the place, with nothing in the console saying so.
    excludedReason: poi.excludedReason,
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
        id: pois.id,
        source: pois.source,
        sourceId: pois.sourceId,
        speakableLat: pois.speakableLat,
        speakableLng: pois.speakableLng,
        speakableRoadClass: pois.speakableRoadClass,
        excludedReason: pois.excludedReason,
        clusterAnchorId: pois.clusterAnchorId,
        clusterTreatment: pois.clusterTreatment,
        clusterTitle: pois.clusterTitle,
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
        speakableRoadClass: pois.speakableRoadClass,
        excludedReason: pois.excludedReason,
        clusterAnchorId: pois.clusterAnchorId,
        clusterTreatment: pois.clusterTreatment,
        clusterTitle: pois.clusterTitle,
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
    // Bound the strings — this override rides every future extract fetch into the grounded corpus. (audit #10)
    if (find.length > MAX_OVERRIDE_LEN || replace.length > MAX_OVERRIDE_LEN) {
      return c.json({ error: 'bad_request', message: `\`find\`/\`replace\` must each be ≤ ${MAX_OVERRIDE_LEN} chars.` }, 400)
    }
    if (reason.length > MAX_REASON_LEN) {
      return c.json({ error: 'bad_request', message: `\`reason\` must be ≤ ${MAX_REASON_LEN} chars.` }, 400)
    }
    if (sourceUrl && !isHttpUrl(sourceUrl)) {
      return c.json({ error: 'bad_request', message: '`sourceUrl` must be a valid http(s) URL.' }, 400)
    }

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
  } else if (kind === 'exclude') {
    // Hide/unhide a poi as a STOP. Cheap, reversible, and no spend — but it does change what riders
    // hear, so the reason is REQUIRED on the way in: an unexplained exclusion is the exact thing this
    // surface exists to prevent (a place vanishing from drives with nothing saying why).
    // ⚠ Audio is never touched. The narration row and its R2 clip survive, so un-excluding restores the
    // place with no regeneration — which is why this is a flag and not a delete.
    const clear = body.clear === true || body.reason === null
    if (clear) {
      console.log(`[admin] ${operator} RESTORED ${poi.name} (${poi.source}:${poi.sourceId}) — exclusion cleared`)
      await db.update(pois).set({ excludedReason: null }).where(eq(pois.id, id))
    } else {
      const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
      if (!reason) {
        return c.json({ error: 'bad_request', message: '`reason` is required — an exclusion documents itself (or pass clear:true).' }, 400)
      }
      if (reason.length > MAX_REASON_LEN) {
        return c.json({ error: 'bad_request', message: `\`reason\` must be ≤ ${MAX_REASON_LEN} chars.` }, 400)
      }
      console.log(`[admin] ${operator} EXCLUDED ${poi.name} (${poi.source}:${poi.sourceId}) — ${reason}`)
      await db.update(pois).set({ excludedReason: `${reason} (by ${operator})` }).where(eq(pois.id, id))
    }
  } else {
    return c.json(
      { error: 'bad_request', message: 'unknown `kind` — expected fact_edit | retire | speakable | exclude.' },
      400,
    )
  }

  // Re-read the speakable anchor (it may have just changed) and return the refreshed payload.
  const fresh = (
    await db
      .select({
        speakableLat: pois.speakableLat,
        speakableLng: pois.speakableLng,
        speakableRoadClass: pois.speakableRoadClass,
        excludedReason: pois.excludedReason,
      })
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
      speakableRoadClass: fresh?.speakableRoadClass ?? null,
      excludedReason: fresh?.excludedReason ?? null,
      id,
      clusterAnchorId: poi.clusterAnchorId,
      clusterTreatment: poi.clusterTreatment,
      clusterTitle: poi.clusterTitle,
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

/* ── USERS + CREDITS ── */

// Sanity cap on a single admin grant — generous (covers a whole IAP-pack make-good) but catches a
// fat-finger before it writes an absurd balance. A grant is append-only and there's no reverse UI, so
// the cheap guard is worth it. Tune freely; not a product limit.
const MAX_ADMIN_GRANT = 1000

// Account list + each user's credit-ledger summary (granted/used/remaining), one row per `user`.
// The `user` table (Better Auth) and `credit_entries` ledger live in the SAME Neon DB, so the admin's
// neon-http `db` reads both. Credits are aggregated in ONE grouped pass and joined in JS (mirrors the
// POIs view's per-id stats join). A user with no ledger rows hasn't been granted/touched yet → all 0.
app.get('/admin/users', async (c) => {
  const [users, credits] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isAnonymous: user.isAnonymous,
        banned: user.banned,
        createdAt: user.createdAt,
      })
      .from(user)
      .orderBy(desc(user.createdAt)),
    db
      .select({
        userId: creditEntries.userId,
        // remaining = SUM(amount) (the live balance); granted = SUM of grant amounts (lifetime cap);
        // used = the consumed magnitude (consumes are stored negative — negate the sum to a count).
        remaining: sql<number>`coalesce(sum(${creditEntries.amount}), 0)::int`,
        granted: sql<number>`coalesce(sum(${creditEntries.amount}) filter (where ${creditEntries.kind} = 'grant'), 0)::int`,
        used: sql<number>`coalesce(-sum(${creditEntries.amount}) filter (where ${creditEntries.kind} = 'consume'), 0)::int`,
      })
      .from(creditEntries)
      .groupBy(creditEntries.userId),
  ])

  const creditByUser = new Map(credits.map((r) => [r.userId, r]))
  const rows = users.map((u) => {
    const cr = creditByUser.get(u.id)
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isAnonymous: u.isAnonymous ?? false,
      banned: u.banned ?? false,
      createdAt: u.createdAt,
      granted: cr?.granted ?? 0,
      used: cr?.used ?? 0,
      remaining: cr?.remaining ?? 0,
    }
  })
  return c.json({ users: rows })
})

// Grant credits to a user — appends a positive `admin_grant` entry to the ledger (lifts both their
// balance AND their lifetime cap). NOT a GCP spend (it hands the USER free drive generations), so no
// founder-go gate; it IS an append-only mutation, so the client confirms. Each grant is a distinct
// event with a fresh idempotency key (mirrors freeGrantEntry's shape; source 'admin_grant' already in
// the enum). The amount>0 + kind:'grant' satisfies the ledger's sign check.
app.post('/admin/users/:id/credits', async (c) => {
  const id = c.req.param('id')

  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json({ error: 'bad_request', message: 'a JSON body is required' }, 400)
  }

  const amount = typeof body.amount === 'number' ? body.amount : NaN
  const note = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!Number.isInteger(amount) || amount <= 0) {
    return c.json({ error: 'bad_request', message: '`amount` must be a positive integer.' }, 400)
  }
  if (amount > MAX_ADMIN_GRANT) {
    return c.json({ error: 'bad_request', message: `\`amount\` must be ≤ ${MAX_ADMIN_GRANT}.` }, 400)
  }
  if (note.length > MAX_REASON_LEN) {
    return c.json({ error: 'bad_request', message: `\`reason\` must be ≤ ${MAX_REASON_LEN} chars.` }, 400)
  }

  // credit_entries.userId is a soft (un-FK'd) ref to user.id — validate the account exists here.
  const [account] = await db.select({ id: user.id, email: user.email }).from(user).where(eq(user.id, id)).limit(1)
  if (!account) return c.json({ error: 'not_found' }, 404)

  const operator = c.get('adminEmail')
  const reason = note ? `admin grant by ${operator}: ${note}` : `admin grant by ${operator}`
  console.log(`[admin] ${operator} granted ${amount} credit(s) to ${account.email} (${id})`)

  await db.insert(creditEntries).values({
    userId: id,
    amount,
    kind: 'grant',
    source: 'admin_grant',
    reason,
    idempotencyKey: `admin_grant:${crypto.randomUUID()}`,
  })

  // Return the refreshed credit summary so the row updates in place without a full refetch race.
  const [summary] = await db
    .select({
      remaining: sql<number>`coalesce(sum(${creditEntries.amount}), 0)::int`,
      granted: sql<number>`coalesce(sum(${creditEntries.amount}) filter (where ${creditEntries.kind} = 'grant'), 0)::int`,
      used: sql<number>`coalesce(-sum(${creditEntries.amount}) filter (where ${creditEntries.kind} = 'consume'), 0)::int`,
    })
    .from(creditEntries)
    .where(eq(creditEntries.userId, id))
  return c.json({
    id,
    granted: summary?.granted ?? amount,
    used: summary?.used ?? 0,
    remaining: summary?.remaining ?? amount,
  })
})

// Serve the built SPA. In prod the Hono service serves it (one Cloud Run service behind IAP);
// in local dev vite serves the UI and proxies /admin + /health here, so this dir is absent and
// these 404 harmlessly. IAP gates the whole service at ingress, so the static assets need no
// in-app gate (only /health is intentionally open, for Cloud Run probes that bypass IAP).
const WEB_ROOT = process.env.ADMIN_WEB_ROOT ?? './public'
app.use('/*', serveStatic({ root: WEB_ROOT }))
// SPA fallback — client-side routes (/jobs, /evals, /pois, /regions, /reference) return index.html.
app.get('*', serveStatic({ path: `${WEB_ROOT}/index.html` }))

const port = Number(process.env.PORT ?? 8788)

// Bun serves a default export of the shape { port, fetch }.
export default { port, fetch: app.fetch }
