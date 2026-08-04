// @skipper/admin — the founder-only ops console (Hono, served natively by bun).
//
// v1 BACKEND. Behind Google IAP (requireAdmin asserts the founder's identity); a separate
// Cloud Run service from the public api.skipper.fm so a routing bug can't leak ops onto the
// funnel. Reads the same DB + presigns R2 for the ear-pass; triggers the skipper-studio Cloud
// Run Job for corpus ops (jobs.ts). V2: authored tours are deferred — the console operates the
// shared POI corpus + the narrations drives reuse; the tour catalog / Create-a-Tour flow is gone.
// Background: docs/designs/admin-ops-console-spec.md §6.
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
//   GET  /admin/drives            -> rider-owned drives: owner, route shape, stop count, derived region(s)
//   GET  /admin/drives/:id        -> one drive: frozen route + provenance + each stop resolved against the LIVE corpus
//   DELETE /admin/drives/:id      -> HARD-delete a drive (double-confirmed; never touches audio or the credit ledger)
//   GET  /admin/places            -> a region's curated places (point-in-bbox) for the /places curation surface
//   PATCH  /admin/places/:id      -> toggle a place's role (endpoint/break) or featured flag (prune+promote)
//   DELETE /admin/places/:id      -> remove a curated place
//   POST /admin/places/resolve    -> live Google Places resolve of a typed name (manual-add candidate)
//   POST /admin/places            -> add a manually-resolved place (upsert by place_id, role-tagged)
//   POST /admin/places/draft      -> LLM-draft a region's curated set (Opus, no Places calls / no writes) — the reviewable preview
//   POST /admin/places/curate     -> resolve the pruned drafts against Google Places + upsert role-tagged

import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { csrf } from 'hono/csrf'
import { and, asc, between, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import {
  creditEntries,
  drives,
  evalRuns,
  evalScores,
  studioJobs,
  narrations,
  places,
  poiOverrides,
  poiClusters,
  pois,
  regions,
  selectionSubject,
  type DriveSelection,
} from '@skipper/db/schema'
import { user } from '@skipper/db/auth-schema'
import { CLAUDE_MODELS, classifyStoryEligibility } from '@skipper/shared'
import { checkAccessPoint, checkSpeakableAnchor } from '@skipper/engine'
import { groundingHash } from '@skipper/db/hash'
import { requireAdmin, type AdminEnv } from './auth'
import { bboxError, bboxOverlapsRect, parseBbox, pointInBbox, type BboxCorners } from './bbox'
import { mapWithConcurrency } from './concurrency'
import { draftCuratedPlaces, isAddressLike, isBusinessLike, isParkingLike, nameDisagrees, resolvePlaceInBbox, type PlaceDraft, type ResolvedPlace } from './places'
import { contentTypeForKey, presignGet } from './storage'
import {
  buildJobArgs,
  cancelExecution,
  executionState,
  HttpError,
  jobExecutionLogsUrl,
  runJob,
  TriggerRejected,
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
/** A region row's raw shape for {@link regionBoxesOf} — whatever the caller selected, as long as it
 *  carries the three fields region-derivation needs. */
type RegionBoxRow = { slug: string; displayName: string; bbox: string | null }
/** Region rows → PARSED boxes, the lookup table every geometry-first region derivation reads. A region
 *  with no/invalid bbox claims nothing (set one in the Regions view to light up coverage). Shared by
 *  the two derivations so they can't disagree about which regions are even eligible: a POI resolves by
 *  point-in-bbox, a DRIVE by rectangle-overlap, but both must start from the same parse. */
function regionBoxesOf(rows: RegionBoxRow[]): { slug: string; name: string; box: BboxCorners }[] {
  return rows.flatMap((r) => {
    const box = parseBbox(r.bbox)
    return box ? [{ slug: r.slug, name: r.displayName, box }] : []
  })
}

/** One region by slug, with its bbox ALREADY PARSED — the opening move of all four curated-places
 *  routes (list / resolve / draft / curate), which had each written the same select + 404 + `parseBbox`
 *  preamble out longhand.
 *
 *  ⚠ It returns the pair rather than enforcing anything, because the four genuinely DISAGREE about what
 *  a missing box means: the list route answers an empty page (nothing curated yet is not an error), the
 *  three write/spend routes answer 400 `bbox_required`. Sharing the LOOKUP and leaving the DECISION with
 *  the caller is the split that keeps this honest — folding the 400 in here would have silently turned
 *  the list route into an error page.
 *
 *  The parse-once discipline is the point (see the draft route, which spells out why): the bbox is not
 *  merely a precondition, it SCOPES the work, so the string must not be read twice by two expressions. */
async function regionWithBox(
  slug: string,
): Promise<{ displayName: string; bbox: string | null; box: BboxCorners | null } | null> {
  const row = (
    await db
      .select({ displayName: regions.displayName, bbox: regions.bbox })
      .from(regions)
      .where(eq(regions.slug, slug))
      .limit(1)
  )[0]
  return row ? { ...row, box: parseBbox(row.bbox) } : null
}

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

// ⚠⚠ CSRF, MOUNTED AHEAD OF THE WALL. requireAdmin authenticates a CALLER; it does nothing about a
// request the founder's own BROWSER was tricked into making, and this console had no such check at all
// — no Origin, no Sec-Fetch-Site, no token — while `c.req.json()` parses a body whatever its
// Content-Type. That is a live path in the normal working state: `bun run dev:admin` keeps the bypass
// on (requireAdmin admits unconditionally, so there is no cookie or header for the browser to
// withhold, and SameSite is irrelevant), against the SAME Neon and R2 as production.
//
// The sharpest instance needs no JSON trick and no confirm flag, because it reads neither:
//     <form action="http://localhost:8788/admin/regions/lake-tahoe/release" method="POST"></form>
// auto-submitted from any page the founder happens to open. `POST /admin/regions/:slug/release` takes
// only a path param, has no spend/confirm gate, and stamps released_at across every staged narration
// in the bbox plus the fused cluster clips — which this file's own header calls IRREVERSIBLE by
// design. A form POST is a CORS-simple request: no preflight, so nothing stopped it.
//
// hono's csrf() rejects exactly that class — a state-changing method whose Content-Type is form-ish
// (urlencoded / multipart / text/plain, and a MISSING one counts as text/plain), unless Sec-Fetch-Site
// is same-origin or the Origin matches. A cross-origin JSON POST is left alone because the browser
// already blocks it on the preflight this server never answers. The SPA is unaffected either way: its
// `req()` always sets Content-Type: application/json, including on bodyless POSTs, so nothing it sends
// can match — in prod (same-origin) or in dev through the vite proxy.
// ⚠ This also covers PROD, where the only protection today is whatever SameSite policy IAP puts on its
// own cookie: requireAdmin trusts x-goog-authenticated-user-email, which IAP injects on any
// authenticated request — including a cross-site one. That policy is Google's to change, not ours.
app.use('/admin/*', csrf())

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

  // ⚠ A poi counts toward EVERY region whose bbox contains it — regions are boxes and boxes may
  // overlap, so membership is genuinely many-to-many (founder, 2026-08-02). These counts therefore do
  // NOT sum to the corpus size, deliberately: a place in the Tahoe box and a future Reno box is in
  // both, and a region that under-reported its own corpus would be the more misleading number.
  // This was `.find()` (first region by display name wins), which matched the POIs view — the two
  // agreed with each other and both disagreed with what a region release would actually publish.
  // A region with no/invalid bbox claims nothing → poiCount stays null ("no bbox set", ≠ a genuine 0).
  const boxed = rows.map((r) => ({ slug: r.slug, box: parseBbox(r.bbox) }))
  const counts = new Map<string, number>(boxed.flatMap((b) => (b.box ? [[b.slug, 0]] : [])))
  for (const { lat, lng } of poiCoords) {
    for (const { slug, box } of boxed) {
      if (box && pointInBbox(box, lat, lng)) counts.set(slug, counts.get(slug)! + 1)
    }
  }

  return c.json({ regions: rows.map((r) => ({ ...r, poiCount: counts.get(r.slug) ?? null })) })
})

app.post('/admin/regions', async (c) => {
  const body = await c.req.json<{ slug: string; displayName: string; bbox?: string | null }>()
  if (!body.slug?.trim() || !body.displayName?.trim()) {
    return c.json({ error: 'slug and displayName are required' }, 400)
  }
  // ⚠ The slug is PERMANENT — there is no DELETE-region route and no rename — and it is interpolated
  // into every later path (PATCH /admin/regions/:slug, .../release). So it is validated here, at the
  // one boundary that can still refuse it, rather than discovered later as an unroutable region.
  const slug = body.slug.trim()
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return c.json(
      { error: 'bad_request', message: 'slug must be lowercase letters/digits separated by single hyphens (e.g. "lake-tahoe")' },
      400,
    )
  }
  const bbox = body.bbox?.trim() || null
  // Validate the bbox at the write boundary — a swapped-corner/oversized box silently scopes a later
  // SPENDING enrich/generate over a huge candidate set (point-in-bbox selection). (audit #5)
  if (bbox) {
    const err = bboxError(bbox)
    if (err) return c.json({ error: err }, 400)
  }
  let row
  try {
    ;[row] = await db.insert(regions).values({
      slug,
      displayName: body.displayName.trim(),
      bbox,
    }).returning({ slug: regions.slug, displayName: regions.displayName, bbox: regions.bbox })
  } catch (e) {
    // A duplicate slug surfaced as an opaque 500 via app.onError; the console had no way to tell
    // "already exists" from "the server broke".
    if (isUniqueViolation(e)) {
      return c.json({ error: 'conflict', message: `a region with the slug "${slug}" already exists` }, 409)
    }
    throw e
  }
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

  // …and the CLUSTERS those pois belong to, for FUSED tellings. ⚠ Without this a fused clip can NEVER
  // be released: its `poi_id` is NULL, so the poi-keyed predicate below can't match it, and
  // `released_at` is what every public read path filters on. It would be paid-for, correct, and
  // unhearable. A cluster is "in the region" the same geometry-first way everything else is — by where
  // its members are.
  const inBboxCluster = db
    .selectDistinct({ id: pois.clusterId })
    .from(pois)
    .where(
      and(
        isNotNull(pois.clusterId),
        between(pois.lat, box.swLat, box.neLat),
        between(pois.lng, box.swLng, box.neLng),
      ),
    )

  const [, stamped, stampedFused] = await db.batch([
    // Region row: set ONLY while still draft, so a re-run preserves the first release timestamp.
    db.update(regions).set({ releasedAt }).where(and(eq(regions.slug, slug), isNull(regions.releasedAt))),
    // Every staged clip in the bbox → released. Re-runnable: only touches released_at IS NULL rows.
    db
      .update(narrations)
      .set({ releasedAt })
      .where(and(isNull(narrations.releasedAt), inArray(narrations.poiId, inBboxPoi)))
      .returning({ id: narrations.id }),
    // The other subject kind. Separate statement rather than an OR, so each half stays an indexed
    // lookup and the counts are reportable apart.
    db
      .update(narrations)
      .set({ releasedAt })
      .where(and(isNull(narrations.releasedAt), inArray(narrations.clusterId, inBboxCluster)))
      .returning({ id: narrations.id }),
  ])

  return c.json({
    region: { slug: region.slug, releasedAt: region.releasedAt ?? releasedAt },
    releasedClips: stamped.length + stampedFused.length,
    releasedFusedClips: stampedFused.length,
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
    // ⚠ EXPLICIT TIMEOUT + LOW maxRetries, and this is a rule, not a preference. A bare `new Anthropic()`
    // takes the SDK defaults — verified in the installed 0.112.1 client: `DEFAULT_TIMEOUT = 600000`
    // (10 minutes) and `maxRetries ?? 2`. That is up to THREE Opus turns and thirty minutes behind one
    // operator click, inside a service whose own request budget is 300s — so two of those turns would
    // bill after the browser has already been 504'd, with nobody to deliver the answer to. CLAUDE.md says
    // it directly for a model call in a request path: "Low maxRetries (0-1) + an explicit timeout inside
    // the Cloud Run budget — do NOT copy studio's maxRetries: 5, tuned for a batch run that already spent."
    // 90s x 2 attempts stays inside this server's 240s idleTimeout as well as Cloud Run's 300s.
    const client = new (await import('@anthropic-ai/sdk')).default({ maxRetries: 1, timeout: 90_000 })
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
// runtime allowlist makes zero live Places calls. (It used to be served as GET /drives/anchors; 1.1
// deleted that route — the curated set is now sent to the PLANNER server-side and never to a client,
// because the endpoint was an unauthenticated dump of every curated place WITH exact coordinates.)
// Region membership is point-in-bbox
// (geometry-first; no region_id). The bulk seed is the interactive Curate flow (POST /draft → operator
// prunes → POST /curate); these endpoints are the draft/resolve + review/prune/promote + manual-add
// surface. See docs/designs/places-endpoints-spec.md.

/** Columns returned for a curated place row (the table + map). */
/** The `pois` columns the corrections payload reports back. Named once so the row loaded at the top of
 *  `POST /admin/pois/:id/corrections` and the rows its own UPDATEs return are the SAME shape — which is
 *  what lets that route answer from the write instead of re-reading what it just stored. */
const poiFreshCols = {
  speakableLat: pois.speakableLat,
  speakableLng: pois.speakableLng,
  speakableRoadClass: pois.speakableRoadClass,
  excludedReason: pois.excludedReason,
}
/** Derived from the schema, never hand-written: spelling these four types out again is how a column's
 *  nullability changes in one place and stays true-looking in the other. */
type PoiFreshCols = Pick<typeof pois.$inferSelect, keyof typeof poiFreshCols>

const placeCols = {
  id: places.id,
  placeId: places.placeId,
  name: places.name,
  primaryType: places.primaryType,
  lat: places.lat,
  lng: places.lng,
  rank: places.rank,
  // Where a car is actually sent when the pin is not drivable — null for almost every place. Surfaced
  // so the console can SHOW which endpoints carry a correction; it is the operator's only view of it.
  accessLat: places.accessLat,
  accessLng: places.accessLng,
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
  rank: number
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
        // ⚠ THE BEST (LOWEST) RANK WINS, not last-write-wins, and it is the same argument the old
        // `featured` OR-merge made: this upsert is reached by BOTH a whole-region re-curate and the
        // manual Add-a-place dialog, and a manual add that carried no rank would otherwise demote a
        // place the draft had ranked 1. Demotion stays possible, through an explicit PATCH.
        rank: sql`LEAST(COALESCE(${places.rank}, 2147483647), COALESCE(excluded.rank, 2147483647))`,
        // ⚠ `accessLat`/`accessLng` ARE DELIBERATELY ABSENT FROM THIS SET, and their absence is the
        // whole mechanism — an access point is OPERATOR-OWNED, like `pois.speakable_lat/lng`. Adding
        // them here (or to the `values` above) would let a re-curate revert a human's correction and
        // send riders back up the gated road, which is exactly what already happens to lat/lng and is
        // why the correction had to move out of lat/lng in the first place. Nothing fails if you add
        // them; the drives just quietly go wrong again. docs/decisions/undrivable-endpoint-anchors.md
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
  const region = await regionWithBox(slug)
  if (!region) return c.json({ error: 'not_found' }, 404)
  const box = region.box
  if (!box) return c.json({ places: [], bbox: null }) // no bbox set → nothing to scope yet
  const rows = await db
    .select(placeCols)
    .from(places)
    .where(and(between(places.lat, box.swLat, box.neLat), between(places.lng, box.swLng, box.neLng)))
    .orderBy(sql`${places.rank} ASC NULLS LAST`, asc(places.name))
  return c.json({ places: rows, bbox: region.bbox })
})

// PATCH /admin/places/:id — set a place's RANK or its access point. ⚠ The role/featured toggles are gone
// (2026-08-04): `places` is destinations only, so pruning is DELETE and promotion is a rank.
app.patch('/admin/places/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'bad_request' }, 400)
  const body = await c.req
    .json<{
      /** 1 = most likely to be named. Null clears it, sorting the place last. */
      rank?: number | null
      /** Both together, or both null to clear. See the access-point block below. */
      accessLat?: number | null
      accessLng?: number | null
    }>()
    .catch(() => ({}) as Record<string, never>)
  const update: Record<string, unknown> = {}
  if ('rank' in body && (typeof body.rank === 'number' || body.rank === null)) update.rank = body.rank

  // THE ACCESS POINT — where a car is sent when the place's own pin is not drivable.
  //
  // ⚠ THE PAIR IS ATOMIC. A lone latitude is not a location, and half-applying one would leave the row
  // with an access longitude from a previous correction and a latitude from this one — a coordinate
  // that was never anywhere. Both keys must be present, and both must be the same kind of thing:
  // two numbers to set, two nulls to clear.
  const wantsAccess = 'accessLat' in body || 'accessLng' in body
  if (wantsAccess) {
    const { accessLat: alat, accessLng: alng } = body
    const clearing = alat === null && alng === null
    const setting = typeof alat === 'number' && typeof alng === 'number'
    if (!clearing && !setting) {
      return c.json({ error: 'bad_request', message: 'accessLat and accessLng must both be numbers, or both null.' }, 400)
    }
    if (clearing) {
      update.accessLat = null
      update.accessLng = null
    } else {
      // ⚠ BOUNDED AGAINST THE PLACE'S OWN PIN, and read from the DB rather than from the request — a
      // caller that supplied the pin too could authorise any coordinate by lying about where the place
      // is. This is the same shape as the speakable-anchor guard above: the write boundary is where an
      // implausible coordinate has to die, because past it the value is indistinguishable from a good
      // one and the only symptom is a rider routed somewhere they never asked to go.
      const [place] = await db
        .select({ lat: places.lat, lng: places.lng })
        .from(places)
        .where(eq(places.id, id))
        .limit(1)
      if (!place) return c.json({ error: 'not_found' }, 404)
      const check = checkAccessPoint([place.lng, place.lat], [alng!, alat!])
      if (!check.ok) {
        return c.json(
          {
            error: 'access_point_too_far',
            message:
              `That point is ${Math.round(check.distanceM)} m from the place (max ${check.maxM} m). ` +
              `An access point is the same place's turn-off, not a different place.`,
          },
          422,
        )
      }
      update.accessLat = alat
      update.accessLng = alng
    }
  }

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
  const region = await regionWithBox(slug)
  if (!region) return c.json({ error: 'not_found' }, 404)
  const box = region.box
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

// POST /admin/places — add a manually-resolved place (upsert by place_id). name/coords/primaryType are
// last-write-wins; `rank` takes the BEST of old and new so a re-add never demotes a drafted place.
app.post('/admin/places', async (c) => {
  const body = await c.req
    .json<{
      placeId?: string
      name?: string
      lat?: number
      lng?: number
      primaryType?: string | null
      rank?: number
    }>()
    .catch(() => ({}) as Record<string, never>)
  const placeId = (body.placeId ?? '').trim()
  const name = (body.name ?? '').trim()
  if (!placeId || !name || typeof body.lat !== 'number' || typeof body.lng !== 'number') {
    return c.json({ error: 'placeId, name, lat, lng are required' }, 400)
  }
  // ⚠ There is no role to pick any more — adding a place to `places` IS declaring it a destination.
  const [row] = await upsertCuratedPlace({
    placeId,
    name,
    primaryType: body.primaryType ?? null,
    lat: body.lat,
    lng: body.lng,
    // ⚠ A hand-add carries no drafted rank, so it sorts LAST rather than jumping the model's order.
    // `rank` is nullable in the schema for exactly this; the upsert's LEAST() keeps a later curate run
    // free to promote it.
    rank: typeof body.rank === 'number' ? body.rank : (null as unknown as number),
  })
  return c.json({ place: row }, 201)
})

/** What an operator may ASK the draft model for, and what the resolve step will ACCEPT.
 *
 * ⚠ THEY ARE DELIBERATELY DIFFERENT NUMBERS — collapsing them into one re-breaks this immediately.
 * `target` is GUIDANCE, not a limit: the prompt says "Draft roughly ${targetN} places", and the model
 * overshoots (a target of 100 came back with 103 on the first real run). So a resolve cap set EQUAL to
 * the draft cap rejects the very draft its own flow just produced. That is not hypothetical — when the
 * draft cap moved 60 -> 120 and this one stayed at 60, a 103-place draft could not be resolved at all,
 * and the comment here still asserted the two were in lockstep. The resolve cap is the draft cap plus
 * room for the overshoot; if you move one, move both.
 *
 * ⚠ The resolve cap is a SPEND bound, not tidiness: every accepted draft costs TWO billed Google Places
 * calls, so it is what stops one click from spending whatever the client happened to post. It is ALSO
 * bounded by the clock: the resolve loop is serial at ~0.8s/draft, so 160 is ~130s against the 240s
 * idleTimeout at the foot of this file — read that comment before raising it. */
// ⚠ THIS IS DELIBERATELY LOWER THAN THE CLI's 250 (packages/studio/src/curate-places.ts), and the gap
// is NOT drift — the two are bound by different things and must not be "unified" (founder, 2026-08-04).
// The CLI is a batch process with no clock over it, so it streams and drafts deep. This is a REQUEST
// PATH: the call below is non-streaming with a 90s timeout inside this server's 240s idleTimeout, and a
// deep draft cannot return inside that budget no matter what `max_tokens` says. Streaming would not
// rescue it either — the ROUTE still has to answer. MAX_CURATE_DRAFTS below is the same story for the
// resolve step. So: deep, store-everything runs are a CLI job; this route stays the reviewable
// desk-sized preview it was built to be.
const MAX_DRAFT_TARGET = 120
const MAX_CURATE_DRAFTS = 160

/** How many curate drafts are resolved (and later upserted) at once.
 *
 *  ⚠ DELIBERATELY SMALL, and not a throughput dial. The ceiling that matters is not this server's — it
 *  is Google's per-minute quota on a PAID API, and the failure mode of guessing high is a burst of
 *  rate-limit errors partway through a run that has already billed for every resolve it completed.
 *  6 turns MAX_CURATE_DRAFTS from ~320 serial round trips (~130s, brushing IDLE_TIMEOUT_SEC) into
 *  roughly a fifth of that, which is the whole win; going wider buys little and risks the run.
 *  Raise it only with a real measurement of the quota in front of you. */
const CURATE_CONCURRENCY = 6

// POST /admin/places/draft { region, target? } — LLM-draft this region's curated hubs + pitstops with
// Opus (forced tool). The REVIEWABLE preview: spends a few cents on ONE Opus call, makes NO Places calls
// and writes NOTHING. The operator prunes the returned list, then POST /admin/places/curate resolves +
// upserts the keepers. Founder-gated by IAP (+ the explicit button click). 503 if ANTHROPIC unset.
app.post('/admin/places/draft', async (c) => {
  const body = await c.req.json<{ region?: string; target?: number }>().catch(() => ({}) as Record<string, never>)
  const slug = (body.region ?? '').trim()
  if (!slug) return c.json({ error: 'region is required' }, 400)
  const region = await regionWithBox(slug)
  if (!region) return c.json({ error: 'not_found' }, 404)
  // ⚠ Parsed ONCE by regionWithBox and passed the RESULT down — the bbox is no longer merely a
  // precondition, it is what SCOPES the draft (see draftSystem). Re-parsing at the call site would be
  // the same string read twice by two expressions, which is the drift this repo keeps paying for.
  const bbox = region.box
  if (!bbox) {
    return c.json({ error: 'bbox_required', message: 'Set a valid region bbox before curating.' }, 400)
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'anthropic_unconfigured', message: 'ANTHROPIC_API_KEY is not set.' }, 503)
  }
  // ⚠ THE CLAMP IS THE ONE AUTHORITY on this number — the panel's min/max are affordance, not a guard.
  // Coupled to two things, so do not raise it alone: (1) `max_tokens` on the draft call (the list is ONE
  // forced tool call; a truncated one is a 200 carrying a half-parsed list — see draftCuratedPlaces),
  // and (2) this route's own CLOCK, which is what actually binds it — see MAX_DRAFT_TARGET above.
  // ⚠ MAX_PLAN_ANCHORS (apps/api/src/limits.ts, 200) is NO LONGER a total this set must stay under; it
  // is the planner's SERVE cap and a region is now expected to hold more rows than it. Exceeding it is
  // an ordinary state, not an alarm — the roster takes the top 200 by rank.
  // ⚠ THE DEFAULT WAS SIZED FOR A UI THAT NO LONGER EXISTS. 30 was right when this set fed the
  // tap-to-pick create form — a list a human THUMB-SCROLLED, where 120 is a wall. `GET /drives/anchors`
  // was deleted end to end in 1.1 and the set's only consumer is now the PLANNER's roster, which Opus
  // reads whole from a cached prefix. Thumb-scrolling stopped binding; MAX_PLAN_ANCHORS (200) and model
  // attention are what bind, and every name added is one fewer in-persona "do not know that one".
  const targetN = Math.max(8, Math.min(MAX_DRAFT_TARGET, Number(body.target) || 100))
  try {
    const drafts = await draftCuratedPlaces(region.displayName, bbox, {
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
  // ⚠ Bounded — see MAX_CURATE_DRAFTS for why this sits ABOVE the draft cap rather than equal to it.
  if (drafts.length > MAX_CURATE_DRAFTS) {
    return c.json({ error: 'bad_request', message: `at most ${MAX_CURATE_DRAFTS} drafts per curate (got ${drafts.length})` }, 400)
  }
  const region = await regionWithBox(slug)
  if (!region) return c.json({ error: 'not_found' }, 404)
  const box = region.box
  if (!box) return c.json({ error: 'bbox_required', message: 'Set a valid region bbox before curating.' }, 400)
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return c.json({ error: 'places_unconfigured', message: 'GOOGLE_MAPS_API_KEY is not set.' }, 503)

  // ⚠ TWO PHASES ON PURPOSE: the NETWORK fans out, the DECISIONS stay sequential.
  //
  // Phase 1 is the only slow part — `resolvePlaceInBbox` is two necessarily-sequential Google calls
  // (Autocomplete → Details), but the drafts are independent of each other, so they were paying for
  // each other's latency: at MAX_CURATE_DRAFTS that is 320 round trips end to end, ~130s against this
  // service's own 240s idle timeout (see the IDLE_TIMEOUT_SEC note — it already named parallelising
  // this loop as the fix that has to come with any raise of the draft cap).
  //
  // Phase 2 then folds in DRAFT ORDER, and that is what keeps this change boring: `results` stays in
  // the order the operator's list was in, and the `byId` merge is deterministic by CONSTRUCTION rather
  // than by an argument about `Math.min` being commutative. The guards are pure, so running them here
  // costs nothing.
  const resolved = await mapWithConcurrency(drafts, CURATE_CONCURRENCY, async (d) => {
    const query = (d?.query ?? '').trim()
    const rank = d?.rank
    if (!query || typeof rank !== 'number') return { kind: 'invalid' as const }
    try {
      // `rank` rides along rather than being re-read (and re-asserted) in phase 2: it was validated
      // HERE, so carrying it keeps that proof structural instead of a cast the compiler can't check.
      return { kind: 'ok' as const, rank, place: await resolvePlaceInBbox(query, box, apiKey) }
    } catch (e) {
      return { kind: 'failed' as const, message: e instanceof Error ? e.message : String(e) }
    }
  })

  const byId = new Map<string, { place: ResolvedPlace; rank: number }>()
  const results: { name: string; status: 'resolved' | 'dropped' | 'error'; resolvedName?: string; message?: string }[] = []
  for (const [i, d] of drafts.entries()) {
    const outcome = resolved[i]!
    if (outcome.kind === 'invalid') {
      results.push({ name: d?.name ?? '?', status: 'error', message: 'invalid draft (missing query/rank)' })
      continue
    }
    if (outcome.kind === 'failed') {
      results.push({ name: d.name, status: 'error', message: outcome.message })
      continue
    }
    const { rank, place } = outcome
    if (!place) {
      results.push({ name: d.name, status: 'dropped' })
      continue
    }
    // ⚠ A street resolve is a rider destination we would speak aloud and route to, so it must be a real
    // place. ⚠ This used to spare BREAK rows, where a `route` was a legitimate answer (Luther Pass
    // Road); with the break role gone there is nothing to spare. Rejecting outright: the substitution means we
    // resolved something the operator never asked for, and quietly re-filing it hides that.
    if (isAddressLike(place.types)) {
      results.push({
        name: d.name,
        status: 'dropped',
        resolvedName: place.name,
        message: `resolved to a street address (“${place.name}”) — Google substituted an in-box name-alike, so this is not a real endpoint`,
      })
      continue
    }
    // ⚠ The draft was RIGHT and the resolve substituted — see isParkingLike. No prompt can prevent it.
    if (isParkingLike(place.types)) {
      results.push({
        name: d.name,
        status: 'dropped',
        resolvedName: place.name,
        message: `resolved to a car park (“${place.name}”) — Google returned the lot that SERVES the place, not the place`,
      })
      continue
    }
    // ⚠ Not a substitution like the two above — the DEEP TAIL's failure: a real name a local business
    // also carries ("Serene Lakes" → "Serene Lakes Realty"). See isBusinessLike.
    if (isBusinessLike(place.types)) {
      results.push({
        name: d.name,
        status: 'dropped',
        resolvedName: place.name,
        message: `resolved to a business (“${place.name}”) — a transaction, not a destination`,
      })
      continue
    }
    // ⚠ The general case — see nameDisagrees. A legitimate rename lands here too, which is why both
    // names are reported rather than the row vanishing.
    if (nameDisagrees(d.name, place.name)) {
      results.push({
        name: d.name,
        status: 'dropped',
        resolvedName: place.name,
        message: `resolved to something else entirely (“${place.name}”) — no word in common with what was asked for`,
      })
      continue
    }
    const prev = byId.get(place.placeId)
    byId.set(place.placeId, {
      place,
      // ⚠ Lowest rank wins on a duplicate — two drafts naming one place disagree about how famous it
      // is, and taking the later one would let a passing mention demote the model's own headline.
      rank: Math.min(prev?.rank ?? Number.POSITIVE_INFINITY, rank),
    })
    results.push({ name: d.name, status: 'resolved', resolvedName: place.name })
  }

  // ⚠ Per-write try/catch, because everything expensive has ALREADY happened by this point. The
  // resolve loop above has spent two billed Places calls per draft; a bare throw here escaped to
  // app.onError, turned the whole request into `{"error":"internal"}` 500, and took the per-draft
  // `results` report with it — so the operator paid for every resolve and was left unable to tell
  // which places landed, on the table that IS the planner's endpoint allowlist. A failed row is now
  // reported as an error against its own name and the batch keeps going.
  // ⚠ Also pooled, for the same reason and with the SAME per-row semantics: under neon-http every
  // `await` is its own HTTP request, so this was one round trip per curated place stacked on top of the
  // resolve loop inside one request budget. The rows are deduped by place_id, so no two concurrent
  // upserts touch the same row. A single multi-row insert would be one round trip, but it collapses the
  // per-row error attribution this block exists for — a different trade, and a decision, not a cleanup.
  let added = 0
  await mapWithConcurrency([...byId.values()], CURATE_CONCURRENCY, async (r) => {
    try {
      await upsertCuratedPlace({
        placeId: r.place.placeId,
        name: r.place.name,
        primaryType: r.place.primaryType ?? null,
        lat: r.place.lat,
        lng: r.place.lng,
        rank: r.rank,
      })
      // Safe under the pool: JS runs these callbacks on one thread, so `+=` cannot interleave.
      added += 1
    } catch (e) {
      console.error('[admin] curate upsert failed', r.place.placeId, e)
      const row = results.find((x) => x.resolvedName === r.place.name && x.status === 'resolved')
      if (row) {
        row.status = 'error'
        row.message = `resolved, but the write failed: ${e instanceof Error ? e.message : String(e)}`
      }
    }
  })

  // `added` is now what was actually WRITTEN, not what resolved — a row whose upsert failed is
  // counted as an error above, not as an add.
  return c.json({ added, results })
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
  // ⚠ Every other id-taking route guards this first. Without it a non-uuid reaches a uuid column, the
  // driver raises `invalid input syntax for type uuid`, and app.onError turns a stale bookmark into an
  // opaque 500 instead of an honest 404.
  if (!UUID_RE.test(runId)) return c.json({ error: 'not_found' }, 404)
  // Both queries key only off `runId` — neither needs the other's result — so they go together rather
  // than paying two sequential neon-http round trips. That driver is one-shot HTTP per query, and this
  // route is fetched when the operator opens a run drawer, so the second trip is time a human spends
  // watching a spinner. The trade: a run that doesn't exist now issues one query it won't use. That's
  // the rare branch paying for the common one.
  const [[run], scores] = await Promise.all([
    db
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
      .where(eq(evalRuns.id, runId)),
    db
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
      .where(eq(evalScores.runId, runId)),
  ])
  if (!run) return c.json({ error: 'run not found' }, 404)

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
// ⚠ ONE HOME. This mirrors cloudbuild.studio.yaml's `--task-timeout=21600`, and that value has already
// been changed once (1h → 6h). If it is raised again and this copy is not, the backstop force-FAILS a
// live, spending run five minutes past six hours — and because the in-flight lock only blocks
// non-terminal rows, that also frees the target for a second, concurrent paid run. Set
// STUDIO_TASK_TIMEOUT_SEC in the same place that sets --task-timeout; the literal is the fallback for
// a deploy that has not been updated yet, not the source of truth.
const TASK_TIMEOUT_SEC = Number(process.env.STUDIO_TASK_TIMEOUT_SEC) || 21_600
const JOB_MAX_AGE_MS = TASK_TIMEOUT_SEC * 1000 + 300_000

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
  // ⚠ REFUSE rather than pretend. With no execution name there is nothing to ask Cloud Run to stop, and
  // this used to skip the API call and stamp 'canceled' anyway — telling the operator a paid run had
  // stopped when nothing had been told to stop, and releasing the in-flight lock so a replacement run
  // could start alongside the one still going. The window is small (the name is backfilled at trigger,
  // and by beginJob if that was lost) but it is exactly the moment an operator cancels: right after
  // dispatch.
  if (!job.cloudRunExecution) {
    return c.json(
      {
        error: 'conflict',
        message:
          "This run hasn't reported its Cloud Run execution yet, so there is nothing to cancel — " +
          'retry in a moment. (Cancelling now would mark it stopped without stopping it.)',
      },
      409,
    )
  }
  try {
    await cancelExecution(job.cloudRunExecution)
  } catch (e) {
    return c.json({ error: 'cancel_failed', message: e instanceof Error ? e.message : String(e) }, 502)
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
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof TriggerRejected) {
      // Cloud Run definitively refused — nothing was created, so settle the row and free the target.
      await db
        .update(studioJobs)
        .set({ status: 'failed', error: msg, endedAt: new Date() })
        .where(and(eq(studioJobs.id, id), inArray(studioJobs.status, ['queued', 'running'])))
      return c.json({ error: 'trigger_failed', message: msg }, 502)
    }
    // ⚠ AMBIGUOUS — leave it QUEUED. A network reset or an unreadable body means we never learned
    // whether the execution was created; marking it 'failed' with a NULL execution name released the
    // in-flight lock and told the operator nothing had started, so the natural retry ran the same PAID
    // work again, alongside the first. Queued is the honest state: `beginJob` flips it to 'running'
    // and backfills the execution name if it really did start, and `expireStuckJob` settles it if it
    // did not. The target stays locked meanwhile, which is the safe direction.
    console.error('[admin] jobs:run outcome unknown — leaving the row queued', id, e)
    return c.json(
      {
        error: 'trigger_unknown',
        message: `${msg} — the run may have started. It is left queued; the Jobs page will settle it either way.`,
      },
      502,
    )
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
      sheetHash: pois.sheetHash,
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
      clusterId: pois.clusterId,
      // ⚠ Exclusion is a real, BULK-settable state (prune-corpus writes it en masse) that the drive
      // build path enforces — apps/api/src/drives.ts:482 `isNull(pois.excludedReason)`. The corpus
      // table could not see it, so it had no badge, no filter and no count, and the numbers on the two
      // paid-run buttons silently included places no read path will ever serve.
      excludedReason: pois.excludedReason,
      createdAt: pois.createdAt,
    })
    .from(pois)
    .orderBy(asc(pois.name))

  if (!poisRows.length) return c.json({ pois: [] })

  const poiIds = poisRows.map((p) => p.id)

  const [clipStats, fusedRows, regionRows] = await Promise.all([
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
      // `poi_id IN (…)` is never true for NULL, so a fused telling is excluded here by SQL semantics
      // rather than by a predicate. That is still right — this map answers "does this POI have its OWN
      // clip" — but it is no longer the whole story: a member whose cluster speaks for it has no clip
      // of its own and is not un-narrated either. See `fusedByCluster` below.
      .where(inArray(narrations.poiId, poiIds)),
    // The FUSED tellings, so a clustered member can be reported as COVERED rather than as a place
    // nobody ever narrated. Without this the console calls 104 real, live places "none" — which reads
    // as a generation backlog and would send an operator to pay for clips that already exist.
    db
      .select({ clusterId: narrations.clusterId, releasedAt: narrations.releasedAt })
      .from(narrations)
      .where(isNotNull(narrations.clusterId)),
    // All regions + their discovery bbox. POI→region is GEOGRAPHIC (bbox containment), matching
    // how a drive actually selects candidates (discover-pois.ts / generate-narrations.ts). A region with no
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
  // Parse each region's "swLng,swLat,neLng,neLat" box once, then match a poi by point-in-bbox.
  const regionBoxes = regionBoxesOf(regionRows)
  // ⚠ EVERY containing region, not the first. A POI can belong to more than one region — regions are
  // BBOXES and boxes are free to overlap (founder, 2026-08-02), and `lake-tahoe`'s seeded box is the
  // whole Tahoe–Reno corridor, so a future `reno` sits entirely inside it. This used to be `.find()`,
  // which silently assigned each poi to the FIRST region by display name. That was not a display nit:
  //   • a shared poi was counted in only one region, so the other under-reported;
  //   • the Region filter HID it from its second region — and since a paid run now dispatches the
  //     explicit ids of the filtered rows, "select all" under that region would quietly omit it;
  //   • the off-road heuristic marked only the first region as snapped.
  // It also made a region release look wrong when it wasn't: releasing by raw bbox correctly publishes
  // every clip in the box, but the operator could not SEE the ones the console had filed elsewhere.
  const regionsForPoi = (lat: number, lng: number) => regionBoxes.filter((b) => pointInBbox(b.box, lat, lng))

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
    // An anchored poi proves the snap has run over EVERY region that contains it.
    for (const r of regionsForPoi(p.lat, p.lng)) snappedRegions.add(r.slug)
  }

  // clusterId → is its fused telling live to riders (vs still staged)
  const fusedByCluster = new Map(fusedRows.map((f) => [f.clusterId, f.releasedAt != null]))

  const result = poisRows.map((p) => {
    const clip = clipMap.get(p.id)
    // A member whose cluster carries a fused telling is SPOKEN FOR — its own clip (if any) is retired
    // from the read paths once that telling is released. Reported so the operator can tell "covered"
    // from "never generated"; they look identical on `narrationStatus` alone.
    const fusedReleased = p.clusterId != null ? fusedByCluster.get(p.clusterId) : undefined
    const coveredByCluster = fusedReleased === true
    const inRegions = regionsForPoi(p.lat, p.lng)
    // Story-eligibility — a POI property (drives draw story-grade POIs from this corpus);
    // single-sourced with the studio pipeline's gate constants (@skipper/shared).
    const storyEligibility = classifyStoryEligibility({
      source: p.source,
      name: p.name,
      extractChars: Number(p.extractChars ?? 0),
    })
    // Narration status — does a narration exist, and is it grounded on the poi's CURRENT facts
    // (else a run would regenerate it).
    // ⚠ Against the poi's GROUNDING hash — `coalesce(sheet_hash, facts_hash)`, single-sourced as
    // `groundingHash` (@skipper/db/hash) — never `facts_hash` alone. A narration stamps the grounding
    // value, and for an enriched poi that is the SHEET digest, so comparing raw-facts digests would
    // paint every enriched clip in the console STALE and invite a paid regen of the whole corpus.
    const poiGrounding = groundingHash(p)
    const narrationStatus: 'none' | 'fresh' | 'stale' = !clip
      ? 'none'
      : clip.factsHash != null && clip.factsHash === poiGrounding
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
      // The GROUNDING hash — the number the verdict above compared and the one the detail sheet
      // shows beside the clip's. Reporting `facts_hash` here would print a digest that matches nothing.
      factsHash: poiGrounding,
      createdAt: p.createdAt,
      narrationCount: clip ? 1 : 0,
      storyEligibility,
      enriched: p.enriched,
      sheetDrift: p.sheetDrift,
      speakableDrift,
      // Anchorless AND its region has been snapped (carries anchors) ⇒ off-road / won't trigger (see snappedRegions).
      offRoad: p.speakableLat == null && inRegions.some((r) => snappedRegions.has(r.slug)),
      narrationStatus,
      // True once the cluster's fused telling is RELEASED — at which point this place is live via that
      // clip and its own clip (if any) no longer serves. `false` while the fused clip is merely staged,
      // because nothing has changed for a rider yet.
      coveredByCluster,
      suspiciousDuration: clip?.suspiciousDuration ?? false,
      // Stale = the narration grounded on a now-changed facts_hash. narrationStatus already encodes this;
      // surface it on the dedicated axis too (un-clipped pois are never stale).
      staleFacts: narrationStatus === 'stale',
      attributed: clip?.attributed ?? true,
      // region-release-gate: a clip exists but is STAGED (not yet public) until released. Only
      // meaningful when a clip exists (narrationStatus !== 'none').
      released: clip?.released ?? false,
      excludedReason: p.excludedReason,
      // ⚠ ARRAYS. A poi in two overlapping regions belongs to both; the console must not pick one.
      regionSlugs: inRegions.map((r) => r.slug),
      regionNames: inRegions.map((r) => r.name),
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
// ⚠ Takes a POI id, and a clustered member has no clip of its own — its telling hangs off the CLUSTER.
// So this resolves the subject the same way the sheet does: the poi's own narration when it has one,
// else its cluster's fused telling. Without that, the only way to publish a regenerated fused clip is
// a whole-region release, which also stamps every other staged clip in the bbox.
app.post('/admin/pois/:poiId/narration/release', async (c) => {
  const poiId = c.req.param('poiId')
  if (!UUID_RE.test(poiId)) return c.json({ error: 'not_found' }, 404)
  const [poi] = await db.select({ clusterId: pois.clusterId }).from(pois).where(eq(pois.id, poiId)).limit(1)

  // ⚠⚠ ELSE, NOT OR — and the difference published clips nobody had heard. Until 2026-08-02 the
  // subject was `or(poiId = X, clusterId = C)` fed straight into an UPDATE, and an UPDATE has no
  // LIMIT: for a clustered member that still carried its own solo clip, ONE click stamped BOTH that
  // clip and the cluster's staged fused telling. Neither the operator nor the UI could see it — the
  // GET above is `eq(narrations.poiId, poiId)`, so the tab renders and plays the SOLO clip only, and
  // `.returning()` was destructured to a single row, so the response reported one release. Release is
  // monotonic and irreversible by invariant (docs/decisions/region-release-gate.md), so a fused clip
  // speaking for dozens of members went public forever, silently, from a button labelled "Release
  // this clip". The route's own comment above already said "else"; only the code disagreed.
  //
  // So resolve the subject FIRST, as a genuine else, and update exactly that row by id.
  const cols = { id: narrations.id, releasedAt: narrations.releasedAt }
  const [own] = await db.select(cols).from(narrations).where(eq(narrations.poiId, poiId)).limit(1)
  const target =
    own ??
    (poi?.clusterId
      ? (
          await db.select(cols).from(narrations).where(eq(narrations.clusterId, poi.clusterId)).limit(1)
        )[0]
      : undefined)

  if (!target) return c.json({ error: 'not_found' }, 404)
  // An already-released clip is a no-op success, not a 404 — the client shows the right state.
  if (target.releasedAt) return c.json({ releasedAt: target.releasedAt, alreadyReleased: true })

  const [row] = await db
    .update(narrations)
    .set({ releasedAt: new Date() })
    .where(and(eq(narrations.id, target.id), isNull(narrations.releasedAt)))
    .returning({ releasedAt: narrations.releasedAt })
  if (row) return c.json({ releasedAt: row.releasedAt })
  // Lost a race with a concurrent release: it IS released now, just not by us — so re-read the
  // stamp rather than echoing `target.releasedAt`, which is null by construction at this point.
  const [now] = await db
    .select({ releasedAt: narrations.releasedAt })
    .from(narrations)
    .where(eq(narrations.id, target.id))
    .limit(1)
  return c.json({ releasedAt: now?.releasedAt ?? null, alreadyReleased: true })
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
  /** Non-null ⇒ hidden from NEW drives (audio kept; saved drives keep the stop). */
  excludedReason: string | null
  /** The legibility GROUP this poi belongs to, or null when it stands alone (most of them). Written by
   *  `classify-treatments`; INERT until phase 4 fuses the audio. `subjectName` is the member that IS the
   *  group (a `…Historic District` entity) or null when none names it — a null is honest, not missing
   *  data. `isSubject` marks whether the poi being viewed is that one. */
  cluster: {
    id: string
    treatment: string
    title: string
    isSubject: boolean
    subjectName: string | null
    /** The OTHER places in the group (this poi excluded). */
    others: { id: string; name: string }[]
  } | null
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
  clusterId?: string | null
}): Promise<CorrectionsPayload> {
  // ⚠ ONE PHASE, three independent reads. These were serial, which under neon-http is three round trips
  // for a sheet the operator is waiting on — and the dependency that appeared to force the order was not
  // real: the members query keyed on `c.id`, but `c.id` IS `poi.clusterId` (that is what the cluster row
  // was selected by), and the overrides key only on source/sourceId. Same trade `GET /admin/runs/:id/
  // scores` already documents: the rare branch pays a little so the common one is fast.
  // ⚠ The one cost, deliberately accepted: a poi whose `cluster_id` dangles issues a members query whose
  // result is then discarded. That is a broken FK, not a normal read.
  const clusterId = poi.clusterId ?? null
  const [clusterRows, members, rows] = await Promise.all([
    clusterId
      ? db
          .select({
            id: poiClusters.id,
            treatment: poiClusters.treatment,
            title: poiClusters.title,
            subjectPoiId: poiClusters.subjectPoiId,
          })
          .from(poiClusters)
          .where(eq(poiClusters.id, clusterId))
          .limit(1)
      : [],
    clusterId
      ? db.select({ id: pois.id, name: pois.name }).from(pois).where(eq(pois.clusterId, clusterId)).orderBy(pois.name)
      : [],
    db
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
      .orderBy(desc(poiOverrides.updatedAt)),
  ])

  // Resolve the grouping into one renderable shape so the console needs no second round-trip.
  const c = clusterRows[0]
  const cluster: CorrectionsPayload['cluster'] = c
    ? {
        id: c.id,
        treatment: c.treatment,
        title: c.title,
        isSubject: c.subjectPoiId != null && c.subjectPoiId === poi.id,
        subjectName: members.find((m) => m.id === c.subjectPoiId)?.name ?? null,
        others: members.filter((m) => m.id !== poi.id),
      }
    : null

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
    // Non-null ⇒ this poi is HIDDEN from new drives. Surfaced here because it is
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
      sheetHash: pois.sheetHash,
      factsFetchedAt: pois.factsFetchedAt,
      createdAt: pois.createdAt,
      updatedAt: pois.updatedAt,
    })
    .from(pois)
    .where(eq(pois.id, id))
  if (!row) return c.json({ error: 'not_found' }, 404)
  // ⚠ Report the GROUNDING hash under `factsHash`, matching the list endpoint. The Facts tab prints
  // this next to the clip's own hash on the Narration tab, and a clip stamps the GROUNDING value — so
  // returning the raw `facts_hash` here would show an enriched poi two digests that never match and
  // read as a permanent defect. `sheetHash` rides along for the detail view; the raw facts digest is
  // deliberately not surfaced, since nothing compares against it.
  const { sheetHash, ...poi } = row
  return c.json({ poi: { ...poi, factsHash: groundingHash(row), sheetHash } })
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
        clusterId: pois.clusterId,
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
        clusterId: pois.clusterId,
      })
      .from(pois)
      .where(eq(pois.id, id))
      .limit(1)
  )[0]
  if (!poi) return c.json({ error: 'not_found' }, 404)

  const kind = body.kind
  const operator = c.get('adminEmail')

  // ⚠ Set by the two branches that WRITE to `pois`, straight off their own UPDATE. It replaces a
  // re-select of four columns this route had just written itself — one extra round trip on every save,
  // for a value the write already had in hand. The `fact_edit` / `retire` branches leave it undefined
  // on purpose: they touch `poi_overrides` only, so the row loaded above is still current for them.
  let updated: PoiFreshCols | undefined

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
      ;[updated] = await db.update(pois).set({ speakableLat: null, speakableLng: null }).where(eq(pois.id, id)).returning(poiFreshCols)
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
      ;[updated] = await db.update(pois).set({ speakableLat: lat, speakableLng: lng }).where(eq(pois.id, id)).returning(poiFreshCols)
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
      ;[updated] = await db.update(pois).set({ excludedReason: null }).where(eq(pois.id, id)).returning(poiFreshCols)
    } else {
      const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
      if (!reason) {
        return c.json({ error: 'bad_request', message: '`reason` is required — an exclusion documents itself (or pass clear:true).' }, 400)
      }
      if (reason.length > MAX_REASON_LEN) {
        return c.json({ error: 'bad_request', message: `\`reason\` must be ≤ ${MAX_REASON_LEN} chars.` }, 400)
      }
      // ⚠ Same hazard as DELETE, and it surprised us for the same reason: excluding a member sets
      // `excluded_reason`, which drops it from `isNarratableStoryPoi` → `tellableMembers` → the
      // member set the API recomputes a fused clip's geometry from. So an "exclude" on a member of a
      // RELEASED group moves (or kills) a live clip, despite this action being documented as cheap and
      // reversible. It is reversible for a SOLO place; it is not for a released group's geometry.
      const liveGroup = await releasedClusterFor(id)
      if (liveGroup) {
        return c.json(
          {
            error: 'conflict',
            message:
              `"${poi.name}" is one of the places a RELEASED fused telling speaks for. Excluding it ` +
              'changes where that clip fires in drives riders have already downloaded. Regenerate the ' +
              "group's telling first, or exclude the whole group.",
          },
          409,
        )
      }
      console.log(`[admin] ${operator} EXCLUDED ${poi.name} (${poi.source}:${poi.sourceId}) — ${reason}`)
      ;[updated] = await db
        .update(pois)
        .set({ excludedReason: `${reason} (by ${operator})` })
        .where(eq(pois.id, id))
        .returning(poiFreshCols)
    }
  } else {
    return c.json(
      { error: 'bad_request', message: 'unknown `kind` — expected fact_edit | retire | speakable | exclude.' },
      400,
    )
  }

  // The refreshed payload, with NO re-read: a branch that changed these columns handed them back from
  // its own UPDATE, and a branch that didn't leaves the row loaded at the top of this route still true.
  const fresh = updated ?? poi
  return c.json(
    await correctionsForPoi({
      source: poi.source,
      sourceId: poi.sourceId,
      speakableLat: fresh?.speakableLat ?? null,
      speakableLng: fresh?.speakableLng ?? null,
      speakableRoadClass: fresh?.speakableRoadClass ?? null,
      excludedReason: fresh?.excludedReason ?? null,
      id,
      clusterId: poi.clusterId,
    }),
  )
})

// Hard-DELETE one POI — ONLY when it is ORPHANED (no narration references it). narrations.poiId
// is onDelete:'cascade', so the DB would happily drop the narration with the poi — but a POI carrying
// a narration is referenced BY DEFINITION, and the fix there is to regenerate or correct it, not
// delete it; we refuse with a clean 409. An orphaned POI carries no narration, so there are no orphan
// R2 clips to sweep. poi_overrides are keyed by (source, source_id), survive the row, and re-apply on
// re-discovery — left intact.
/** Is this poi named by a cluster whose fused telling is ALREADY RELEASED?
 *
 *  ⚠ Removing such a member is not a corpus edit — it silently rewrites a LIVE clip. The API derives a
 *  fused telling's trigger point per request from its surviving members
 *  (apps/api/src/clusters.ts: `clusterTrigger(pts)`; `if (!trigger) continue`), so dropping members
 *  MOVES where a released clip fires inside drives riders already downloaded, and dropping the last
 *  tellable one deletes that clip from every drive that selected it — a drive they paid a
 *  non-refundable credit for, with no error anywhere.
 *
 *  Gated on RELEASED, not on "has a narration" (founder call 2026-08-02): released is the irreversible
 *  one-way latch, while a staged fused clip is unpublished scratch that a regenerate fixes for free.
 *  This mirrors `coveredByCluster` on GET /admin/pois, which the corpus table already renders. */
async function releasedClusterFor(poiId: string): Promise<{ clusterId: string } | null> {
  const [poi] = await db.select({ clusterId: pois.clusterId }).from(pois).where(eq(pois.id, poiId)).limit(1)
  if (!poi?.clusterId) return null
  const [fused] = await db
    .select({ id: narrations.id })
    .from(narrations)
    .where(and(eq(narrations.clusterId, poi.clusterId), isNotNull(narrations.releasedAt)))
    .limit(1)
  return fused ? { clusterId: poi.clusterId } : null
}

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

  // ⚠ `refs` counts narrations.poi_id ONLY, and a clustered member has no clip of its own — its
  // telling hangs off the CLUSTER. So this guard read 0 and waved through a delete that rewrites a
  // live fused clip. See releasedClusterFor.
  const live = await releasedClusterFor(id)
  if (live) {
    return c.json(
      {
        error: 'conflict',
        message:
          `"${poi.name}" is one of the places a RELEASED fused telling speaks for. Deleting it moves ` +
          'where that clip fires in drives riders have already downloaded — and removing the last one ' +
          'deletes the clip from those drives. Exclude the group or regenerate its telling first.',
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

/** The credit-ledger rollup, in ONE place because two routes report it and the operator reads their
 *  numbers as the same number: the users list (grouped by userId) and the grant response (one user).
 *  remaining = SUM(amount), the live balance; granted = SUM of grant amounts, the lifetime cap;
 *  used = the consumed magnitude — consumes are stored NEGATIVE, so the sum is negated back to a count. */
const creditSummaryCols = {
  remaining: sql<number>`coalesce(sum(${creditEntries.amount}), 0)::int`,
  granted: sql<number>`coalesce(sum(${creditEntries.amount}) filter (where ${creditEntries.kind} = 'grant'), 0)::int`,
  used: sql<number>`coalesce(-sum(${creditEntries.amount}) filter (where ${creditEntries.kind} = 'consume'), 0)::int`,
}

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
        ...creditSummaryCols,
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
// founder-go gate; it IS an append-only mutation, so the client confirms. The amount>0 + kind:'grant'
// satisfies the ledger's sign check.
//
// ⚠ EXACTLY-ONCE COMES FROM THE CLIENT'S KEY. Until 2026-08-02 this minted
// `admin_grant:${crypto.randomUUID()}` per REQUEST and omitted onConflictDoNothing — so it was the
// only ledger write in the repo with no exactly-once property at all, while the schema's
// `idempotency_key UNIQUE` sat there unused and both API paths (`free:<userId>`, `drive:<driveId>`)
// have a deterministic key AND the conflict clause. A double-click or a retried POST wrote two grants.
// The client now mints one uuid per dialog and reuses it across retries, exactly as `POST /drives`
// does with its per-card key. A missing/!uuid key is rejected rather than silently made unique again.
//
// ⚠ ANONYMOUS ACCOUNTS ARE REFUSED, mirroring the automatic path in apps/api/src/auth.ts. An
// anonymous row is a real `user` row, so this route used to accept it and report a cheerful
// granted/remaining — but `/drives*` is behind requireAccount, so the credit can never be spent, and
// the moment the rider signs up the plugin hard-deletes that row and `purgeUserData` takes the grant
// with it. A comp that silently evaporates is worse than a refusal that explains itself (INV-4).
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
  const clientKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : ''
  if (!UUID_RE.test(clientKey)) {
    return c.json({ error: 'bad_request', message: '`idempotencyKey` must be a uuid.' }, 400)
  }

  // credit_entries.userId is a soft (un-FK'd) ref to user.id — validate the account exists here.
  const [account] = await db
    .select({ id: user.id, email: user.email, isAnonymous: user.isAnonymous })
    .from(user)
    .where(eq(user.id, id))
    .limit(1)
  if (!account) return c.json({ error: 'not_found' }, 404)
  if (account.isAnonymous) {
    return c.json(
      {
        error: 'anonymous_account',
        message:
          'This is a pre-signup anonymous session, not an account. Credits here can never be spent ' +
          '(/drives is behind requireAccount) and are deleted the moment the rider signs up. Grant ' +
          'to their real account after they create one.',
      },
      409,
    )
  }

  const operator = c.get('adminEmail')
  const reason = note ? `admin grant by ${operator}: ${note}` : `admin grant by ${operator}`
  console.log(`[admin] ${operator} granted ${amount} credit(s) to ${account.email} (${id})`)

  await db
    .insert(creditEntries)
    .values({
      userId: id,
      amount,
      kind: 'grant',
      source: 'admin_grant',
      reason,
      idempotencyKey: `admin_grant:${clientKey}`,
    })
    // Exactly-once: a retry or a double-click carries the SAME key and lands nothing the second time.
    .onConflictDoNothing({ target: creditEntries.idempotencyKey })

  // Return the refreshed credit summary so the row updates in place without a full refetch race.
  const [summary] = await db
    .select(creditSummaryCols)
    .from(creditEntries)
    .where(eq(creditEntries.userId, id))
  return c.json({
    id,
    granted: summary?.granted ?? amount,
    used: summary?.used ?? 0,
    remaining: summary?.remaining ?? amount,
  })
})

/* -------------------------------------------------------------------------- */
/*  drives — the rider-owned artifact. Read-only, plus ONE hard delete.          */
/* -------------------------------------------------------------------------- */

// ⚠ THE CONSOLE DOES NOT AUTHOR DRIVES, and these routes deliberately offer no create/edit. A drive is
// minted by the rider at POST /drives against a credit they spent, and its `selection` is FROZEN at
// that moment; editing one here would rewrite something a rider paid for and already downloaded. What
// an operator actually needs is DIAGNOSIS — "what did the planner build, and does it still play?" — so
// the list carries the shape of each route and the detail resolves every frozen stop against the LIVE
// corpus (content resolves by subject id, so a regenerated telling silently changes what a saved drive
// says; that is by design, and this is where you can see it).

/** The drive-list projection. `stopCount`/`authored` are computed in SQL so the list never ships the
 *  heavy `selection` + `route_provenance` jsonb — a drive's polyline and manifest are detail-only. */
const driveListCols = {
  id: drives.id,
  userId: drives.userId,
  label: drives.label,
  startName: drives.startName,
  endName: drives.endName,
  distanceMeters: drives.distanceMeters,
  durationSeconds: drives.durationSeconds,
  bboxMinLat: drives.bboxMinLat,
  bboxMinLng: drives.bboxMinLng,
  bboxMaxLat: drives.bboxMaxLat,
  bboxMaxLng: drives.bboxMaxLng,
  // Frozen stop count. CASE-guarded like the POI fact-sheet counts: `selection` is NOT NULL and always
  // an array today, but jsonb_array_length ERRORS (not nulls) on a non-array, which would 500 the whole
  // page over one malformed row.
  stopCount: sql<number>`case when jsonb_typeof(${drives.selection}) = 'array' then jsonb_array_length(${drives.selection}) else 0 end`,
  // Was the route LLM-proposed (Create-a-Drive) rather than picked outright? `routeProvenance.authoring`
  // is present only when the planner resolved the endpoints — the "why this route exists" trail.
  authored: sql<boolean>`(${drives.routeProvenance} -> 'authoring') is not null`,
  createdAt: drives.createdAt,
  deletedAt: drives.deletedAt,
}

/** Owner lookup for a set of drives. `drives.user_id` is a SOFT ref across the auth-pool boundary (no
 *  FK — see the schema), so a miss is possible and MEANINGFUL: it means the account is gone but its
 *  drives outlived it, i.e. `purgeUserData` did not run. Reported as a null owner, never hidden. */
async function ownersByIdFor(userIds: string[]) {
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return new Map<string, { id: string; name: string; email: string; isAnonymous: boolean }>()
  const rows = await db
    .select({ id: user.id, name: user.name, email: user.email, isAnonymous: user.isAnonymous })
    .from(user)
    .where(inArray(user.id, ids))
  return new Map(rows.map((u) => [u.id, { ...u, isAnonymous: u.isAnonymous ?? false }]))
}

// Every rider drive, newest first — INCLUDING soft-deleted ones (a rider's "remove from my list" is
// itself something an operator wants to see; the row carries `deletedAt` and the client badges it).
//
// Region is DERIVED, never stored (geometry-first-regions): a drive freezes its route's bounding
// rectangle, so its region(s) are the regions whose bbox that rectangle OVERLAPS. Boxes may overlap, so
// a drive can belong to several — and to NONE, which is a real answer (a route outside every configured
// region), not missing data.
app.get('/admin/drives', async (c) => {
  const [rows, regionRows] = await Promise.all([
    db.select(driveListCols).from(drives).orderBy(desc(drives.createdAt)),
    db.select({ slug: regions.slug, displayName: regions.displayName, bbox: regions.bbox }).from(regions),
  ])
  const regionBoxes = regionBoxesOf(regionRows)
  const owners = await ownersByIdFor(rows.map((r) => r.userId))

  const result = rows.map((d) => {
    const rect = { minLat: d.bboxMinLat, minLng: d.bboxMinLng, maxLat: d.bboxMaxLat, maxLng: d.bboxMaxLng }
    const inRegions = regionBoxes.filter((b) => bboxOverlapsRect(b.box, rect))
    return {
      id: d.id,
      label: d.label,
      startName: d.startName,
      endName: d.endName,
      distanceMeters: d.distanceMeters,
      durationSeconds: d.durationSeconds,
      stopCount: Number(d.stopCount ?? 0),
      authored: d.authored,
      createdAt: d.createdAt,
      deletedAt: d.deletedAt,
      owner: owners.get(d.userId) ?? null,
      // ⚠ ARRAYS, same as a POI's — a drive crossing two overlapping regions belongs to both.
      regionSlugs: inRegions.map((r) => r.slug),
      regionNames: inRegions.map((r) => r.name),
    }
  })
  return c.json({ drives: result })
})

// One drive, with its frozen route + the manifest resolved against the LIVE corpus.
//
// Each stop names a SUBJECT (a poi, or a poi_clusters row for a fused telling) — the same
// `selectionSubject` coalesce the API replay path uses, so the console and the player can never
// disagree about which stops a saved drive still has. Three states are worth an operator's attention
// and none of them are visible from the drives row alone:
//   • silent    — nothing resolves for the subject any more, so the player DROPS this stop.
//   • staged    — the clip exists but isn't released. Not a defect on a saved drive: the owner replay
//                 path deliberately skips the release filter (a frozen selection was paid for).
//   • replaced  — the live narration id differs from the one frozen here. Also not a defect — content
//                 resolves live by subject on purpose — but it means this drive now says something
//                 different from what it said when the rider bought it.
app.get('/admin/drives/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'not_found' }, 404)

  const [drive] = await db
    .select({
      ...driveListCols,
      polyline: drives.polyline,
      routeSig: drives.routeSig,
      routeProvenance: drives.routeProvenance,
      selection: drives.selection,
      updatedAt: drives.updatedAt,
    })
    .from(drives)
    .where(eq(drives.id, id))
    .limit(1)
  if (!drive) return c.json({ error: 'not_found' }, 404)

  const selection: DriveSelection = Array.isArray(drive.selection) ? drive.selection : []
  const subjects = selection.map((item) => selectionSubject(item))
  const poiIds = [...new Set(subjects.flatMap((s) => (s?.kind === 'poi' ? [s.id] : [])))]
  const clusterIds = [...new Set(subjects.flatMap((s) => (s?.kind === 'cluster' ? [s.id] : [])))]

  // The live state of each subject's telling. Narrations are keyed by subject via the XOR'd
  // poi_id/cluster_id columns, so the two sides are separate reads — a fused telling is NOT reachable
  // through a member's poi_id, which is the bug the schema comment warns about.
  // ⚠ The owner lookup rides ALONG here rather than after. It only ever needed `drive.userId`, which is
  // in hand from the query above, so running it afterwards made this route three serial phases instead
  // of two — a whole neon-http round trip of spinner on every detail open, bought nothing.
  const [poiRows, clusterRows, poiNarrations, clusterNarrations, regionRows, owners] = await Promise.all([
    poiIds.length
      ? db.select({ id: pois.id, name: pois.name, kind: pois.kind }).from(pois).where(inArray(pois.id, poiIds))
      : [],
    clusterIds.length
      ? db.select({ id: poiClusters.id, title: poiClusters.title, treatment: poiClusters.treatment })
          .from(poiClusters)
          .where(inArray(poiClusters.id, clusterIds))
      : [],
    poiIds.length
      ? db
          .select({
            id: narrations.id,
            subjectId: narrations.poiId,
            form: narrations.form,
            releasedAt: narrations.releasedAt,
            durationMs: narrations.audioDurationMs,
          })
          .from(narrations)
          .where(inArray(narrations.poiId, poiIds))
      : [],
    clusterIds.length
      ? db
          .select({
            id: narrations.id,
            subjectId: narrations.clusterId,
            form: narrations.form,
            releasedAt: narrations.releasedAt,
            durationMs: narrations.audioDurationMs,
          })
          .from(narrations)
          .where(inArray(narrations.clusterId, clusterIds))
      : [],
    db.select({ slug: regions.slug, displayName: regions.displayName, bbox: regions.bbox }).from(regions),
    ownersByIdFor([drive.userId]),
  ])

  const nameById = new Map<string, { name: string; detail: string | null }>([
    ...poiRows.map((p) => [p.id, { name: p.name, detail: p.kind }] as const),
    ...clusterRows.map((cl) => [cl.id, { name: cl.title, detail: cl.treatment }] as const),
  ])
  const narrationBySubject = new Map(
    [...poiNarrations, ...clusterNarrations].flatMap((n) => (n.subjectId ? [[n.subjectId, n] as const] : [])),
  )

  const stops = selection.map((item, i) => {
    const subject = subjects[i]
    const live = subject ? narrationBySubject.get(subject.id) : undefined
    const named = subject ? nameById.get(subject.id) : undefined
    return {
      // The frozen `seq` is what the player orders by; fall back to the array index for a legacy item
      // that predates it rather than reporting a misleading 0.
      seq: typeof item.seq === 'number' ? item.seq : i,
      // null ⇒ an UNREADABLE item: neither subjectId nor the legacy poiId is present, so nothing can
      // resolve it. The API drops such a stop; say so instead of rendering a blank row.
      subjectId: subject?.id ?? null,
      subjectKind: subject?.kind ?? null,
      // null when the subject id resolves to no poi/cluster row — the place itself was deleted.
      name: named?.name ?? null,
      detail: named?.detail ?? null,
      frozenNarrationId: item.narrationId ?? null,
      alongSec: item.alongSec ?? null,
      triggerLat: item.triggerLat ?? null,
      triggerLng: item.triggerLng ?? null,
      narration: live
        ? { id: live.id, form: live.form, releasedAt: live.releasedAt, durationMs: live.durationMs }
        : null,
    }
  })

  const rect = {
    minLat: drive.bboxMinLat,
    minLng: drive.bboxMinLng,
    maxLat: drive.bboxMaxLat,
    maxLng: drive.bboxMaxLng,
  }
  const inRegions = regionBoxesOf(regionRows).filter((b) => bboxOverlapsRect(b.box, rect))

  return c.json({
    drive: {
      id: drive.id,
      label: drive.label,
      startName: drive.startName,
      endName: drive.endName,
      distanceMeters: drive.distanceMeters,
      durationSeconds: drive.durationSeconds,
      stopCount: Number(drive.stopCount ?? 0),
      authored: drive.authored,
      createdAt: drive.createdAt,
      updatedAt: drive.updatedAt,
      deletedAt: drive.deletedAt,
      owner: owners.get(drive.userId) ?? null,
      regionSlugs: inRegions.map((r) => r.slug),
      regionNames: inRegions.map((r) => r.name),
      routeSig: drive.routeSig,
      bbox: rect,
      // [lng, lat] pairs — the order polylineBbox reads (apps/api/src/drive-geometry.ts).
      polyline: drive.polyline ?? [],
      routeProvenance: drive.routeProvenance,
    },
    stops,
  })
})

// HARD-DELETE one drive. The only destructive action this console has over RIDER-OWNED data, so it is
// gated twice: the client makes the operator type the drive's id, and the request must carry that same
// id back in `{ confirm }`. That second gate is not ceremony — it is what stops a bare
// `curl -X DELETE /admin/drives/<id>` (or a mis-wired client) from deleting on the strength of a URL
// alone, and it is the "count, authorise and ACT from ONE expression" rule: the id the dialog NAMES is
// the id the body carries and the id the DELETE runs on.
//
// What it does NOT touch, deliberately:
//   • AUDIO / narrations — shared corpus rows a drive only references. Deleting a drive must never
//     remove a telling other drives (and other riders) still play.
//   • The CREDIT — the ledger is append-only and a delete emits no `reverse` entry, exactly as the
//     rider's own delete doesn't (docs/decisions/credit-ledger.md). If the intent is to make the rider
//     whole, grant credits on the Users page; that is a separate, visible act.
// A hard delete (not a `deleted_at` stamp) because the soft delete is the RIDER's own gesture — an
// operator setting it would be indistinguishable from the rider hiding the drive themselves.
app.delete('/admin/drives/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'not_found' }, 404)

  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json({ error: 'bad_request', message: 'a JSON body is required' }, 400)
  }
  if (body.confirm !== id) {
    return c.json(
      {
        error: 'confirm_required',
        message: 'Deleting a drive requires `confirm` to equal the drive id being deleted.',
      },
      400,
    )
  }

  const [drive] = await db
    .select({ id: drives.id, userId: drives.userId, label: drives.label })
    .from(drives)
    .where(eq(drives.id, id))
    .limit(1)
  if (!drive) return c.json({ error: 'not_found' }, 404)

  const operator = c.get('adminEmail')
  console.log(`[admin] ${operator} hard-deleted drive ${id} (owner ${drive.userId}, label ${drive.label ?? '—'})`)
  await db.delete(drives).where(eq(drives.id, id))

  return c.json({ ok: true, id })
})

// Serve the built SPA. In prod the Hono service serves it (one Cloud Run service behind IAP);
// in local dev vite serves the UI and proxies /admin + /health here, so this dir is absent and
// these 404 harmlessly. IAP gates the whole service at ingress, so the static assets need no
// in-app gate (only /health is intentionally open, for Cloud Run probes that bypass IAP).
const WEB_ROOT = process.env.ADMIN_WEB_ROOT ?? './public'
app.use('/*', serveStatic({ root: WEB_ROOT }))
// SPA fallback — every client-side route returns index.html (the route table lives in client/router.tsx;
// enumerating it here only ever drifted).
app.get('*', serveStatic({ path: `${WEB_ROOT}/index.html` }))

const port = Number(process.env.PORT ?? 8788)

// ⚠⚠ idleTimeout IS LOAD-BEARING HERE TOO, and this console needs it MORE than apps/api does.
// Bun's default is 10 SECONDS and it fires WHILE A HANDLER IS STILL RUNNING (measured in apps/api on
// 2026-08-01: a 16s handler had its socket closed at ~12s). Two admin routes structurally exceed that:
//   • POST /admin/places/draft — one Opus call, max_tokens 16_000, up to MAX_DRAFT_TARGET places. The
//     dialog's own copy says "this takes ~30s". It could therefore NEVER have completed: the socket
//     died at ~12s, the operator saw a network error, and the Anthropic call billed to completion
//     regardless.
//   • POST /admin/places/curate — 2 Google Places round-trips per draft, then a loop of upserts.
//     Its failure mode is worse than a failed read: the handler is never aborted, so the writes still
//     land. The operator is shown a FAILURE while curated `places` rows — the planner's wire-level
//     endpoint allowlist (INV-1/INV-2) — are committed to production.
//     ⚠ BOTH LOOPS ARE NOW POOLED (CURATE_CONCURRENCY), which is what bought the headroom back: the
//     160-draft cap was ~130s serial at the measured ~0.8s/draft — inside the 240 below, but not
//     generously — and is roughly a fifth of that now. The writes-land-anyway case above is still the
//     thing to protect, so it remains the reason this timeout is load-bearing; raising
//     MAX_CURATE_DRAFTS is no longer the same cliff, but it is still bound by the draft step and by
//     what an operator can actually review (see that constant).
// This is the paid path that seeds that allowlist, and it has never been run (memory: the Tahoe
// curation is still founder-gated).
// 240s: Bun hard-caps idleTimeout at 255 (verified — 256 throws), and Cloud Run's own request timeout
// (300s, unset in cloudbuild.admin.yaml so the default applies) stays the outer bound.
const IDLE_TIMEOUT_SEC = 240

// ⚠ BIND LOOPBACK WHEN THE BYPASS IS ON. Bun's default hostname is 0.0.0.0 — every interface — while
// `bun run dev:admin` sets ADMIN_DEV_BYPASS=1, which makes requireAdmin admit EVERY request with no
// header at all (auth.ts). Against the SAME Neon and R2 as production, with delete authority and the
// ability to dispatch paid Cloud Run jobs. So on any shared wifi, or to any node on the tailnet the
// iOS dev builds already use, `curl http://<laptop>:8788/admin/...` was the whole console.
// ⚠ Bun's printed banner says "localhost" even when it binds the wildcard, so the URL in the terminal
// actively hides this — trust `lsof -nP -iTCP:8788 -sTCP:LISTEN`, not the banner.
// Deployed is unaffected: Cloud Run needs 0.0.0.0, and NODE_ENV=production already makes the bypass
// inert, so this narrows only the case that is dangerous.
const hostname = process.env.ADMIN_DEV_BYPASS === '1' ? '127.0.0.1' : '0.0.0.0'

// Bun serves a default export of the shape { port, fetch }.
export default { port, hostname, idleTimeout: IDLE_TIMEOUT_SEC, fetch: app.fetch }
