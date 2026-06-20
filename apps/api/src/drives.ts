// Create-a-Drive (V2) — a user-owned, on-demand A→B drive assembled from REUSED roam narrations.
//
//   POST /drives/propose          -> resolve free-text A→B + preview the route (cheap; no persist, no credit)
//   POST /drives                  -> generate + persist the confirmed drive (free-account gated; counts a credit)
//   GET  /drives                  -> the caller's saved drives (one card each)
//   GET  /drives/:id              -> replay a saved drive's frozen manifest (narration content resolves LIVE)
//   POST /drives/:id/assets/sign  -> re-presigned clip URLs (offline refresh), keyed by seq
//   DELETE /drives/:id            -> soft-delete (remove from list); CAP-NEUTRAL — a spent credit is never refunded
//
// A drive is "roam, pre-ordered for your route": the LLM does ONLY endpoint resolution; the route is
// Google's (materializeRoute) and the SELECTION is deterministic (engine buildDrive over the shared
// narration corpus). Nothing here synthesizes audio — it picks + paces existing roam clips. The drive's
// STRUCTURE freezes into `drives.selection`; each narration's CONTENT resolves live via its poi, so a
// regenerated telling auto-improves a saved drive. Ownership lives on `drives.user_id` (a drive is
// user-owned, never shared content). Anonymous callers get roam only — the whole module
// is behind requireAccount.

import Anthropic from '@anthropic-ai/sdk'
import { Hono, type Context } from 'hono'
import { and, between, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { creditEntries, drives, driveDemand, narrations, pois, regions } from '@skipper/db/schema'
import type { DriveSelection, DriveSelectionItem, Polyline, RouteProvenance } from '@skipper/db/schema'
import { geocodeBoundsFor, polylineBbox } from './drive-geometry'
import { materializeRoute, type Waypoint } from '@skipper/routing'
import {
  buildDrive,
  DRIVE_MIN_GAP_SEC,
  driveMaxStops,
  OFF_ROUTE_MAX_M,
  radiusForKind,
  type DriveCandidate,
} from '@skipper/engine'
import {
  CLAUDE_MODELS,
  createDriveRequest,
  driveProposeRequest,
  type DriveClip,
  type DriveClipForm,
  type DriveManifest,
} from '@skipper/shared'
import { isTester, requireAccount, withSession, type ApiEnv } from './entitlements'
import { FREE_DRIVE_CAP, creditSummary, driveConsumeEntry, ensureFreeGrant } from './credits'
import { withRetry } from './retry'
import { contentTypeForKey, presignGet } from './storage'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Drive credits live in the user-owned `credit_entries` LEDGER (see ./credits + the decision doc), NOT
// a count of drive rows. A free account is granted FREE_DRIVE_CAP credits once; each generated drive
// CONSUMES one (atomically, co-committed with the drive insert); a delete never refunds (no reverse is
// emitted). 'paid' (comped) accounts bypass the gate. Beyond the free allotment, a one-time credit pack
// is the planned unlock (Apple IAP / Google Play fast-follow).

// Drive pacing (DRIVE_MIN_GAP_SEC / driveMaxStops) is single-sourced in @skipper/engine so the
// API's selection matches the engine's.

const PROPOSE_MODEL = process.env.DRIVE_PROPOSE_MODEL ?? CLAUDE_MODELS.sonnet
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'

/* --------------------------------- helpers -------------------------------- */

function mapsKey(): string {
  const k = process.env.GOOGLE_MAPS_API_KEY
  if (!k) throw new Error('GOOGLE_MAPS_API_KEY is not set')
  return k
}

/** A clip's wire form. Roam narrations are story|scenic|break|wave; `bside` never reaches a drive,
 *  but coerce it to `story` so the manifest always validates against the driveClipForm enum. */
function toClipForm(form: string): DriveClipForm {
  switch (form) {
    case 'scenic':
    case 'break':
    case 'wave':
      return form
    default:
      return 'story' // story + the (never-expected) bside
  }
}


async function geocode(address: string, bounds?: string): Promise<{ lat: number; lng: number } | null> {
  const url = new URL(GEOCODE_URL)
  url.searchParams.set('address', address)
  url.searchParams.set('key', mapsKey())
  if (bounds) url.searchParams.set('bounds', bounds)
  const res = await fetch(url)
  if (!res.ok) return null
  const json = (await res.json()) as {
    results?: { geometry?: { location?: { lat: number; lng: number } } }[]
  }
  const loc = json.results?.[0]?.geometry?.location
  return loc ? { lat: loc.lat, lng: loc.lng } : null
}

const RESOLVE_TOOL: Anthropic.Tool = {
  name: 'resolve_endpoints',
  description:
    "Read the rider's one free-text request and resolve the START and END of the drive they want, " +
    'each to a real, geocodable place WITHIN the named region. Prefer an evocative landmark, scenic ' +
    'overlook, town, or notable POI over a bare street address. If they describe a LOOP (out and back, ' +
    'a round trip), set start and end to the same place. Both endpoints MUST be inside the region.',
  input_schema: {
    type: 'object',
    properties: {
      start: { type: 'string', description: 'A real, geocodable place name in the region for the start.' },
      end: { type: 'string', description: 'A real, geocodable place name in the region for the end (=start for a loop).' },
      inRegion: { type: 'boolean', description: 'False if the request clearly falls outside the region.' },
    },
    required: ['start', 'end', 'inRegion'],
    additionalProperties: false,
  },
}

/** LLM endpoint resolution — pulls a clean in-region START + END from the rider's ONE conversational
 *  prompt. The ONLY model call in the create flow (route + selection are deterministic). Cheap model. */
async function resolveEndpointsFromPrompt(
  regionName: string,
  prompt: string,
): Promise<{ start: string; end: string; inRegion: boolean }> {
  const client = new Anthropic()
  const response = await client.messages.create({
    model: PROPOSE_MODEL,
    max_tokens: 512,
    tools: [RESOLVE_TOOL],
    tool_choice: { type: 'tool', name: 'resolve_endpoints' },
    messages: [
      {
        role: 'user',
        content: [
          `Region: ${regionName}.`,
          `The rider said: "${prompt}".`,
          'Resolve the START and END of the drive they want via the resolve_endpoints tool. Favor a',
          'scenic, recognizable landmark when the request is vague; set start = end for a loop.',
        ].join('\n'),
      },
    ],
  })
  const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!call) throw new Error('the model returned no endpoint resolution')
  const out = call.input as { start: string; end: string; inRegion: boolean }
  return { start: out.start, end: out.end, inRegion: out.inRegion !== false }
}

/** A resolved, geocoded endpoint. */
interface ResolvedEndpoint {
  name: string
  lat: number
  lng: number
}

/** Quantize a coordinate to ~110 m for the route signature. */
const qz = (n: number): string => n.toFixed(3)

/** Shape-aware route signature (the demand + future cache-warming key; instrumentation only in v2).
 *  Quantized endpoints + a coarse polyline fingerprint, so two routes that share endpoints but differ
 *  in shape (e.g. a loop vs. a there-and-back) don't collide. No region prefix — a drive stores no
 *  region; its extent IS its bbox/endpoints. */
function routeSigOf(start: ResolvedEndpoint, end: ResolvedEndpoint, polyline: Polyline): string {
  const a = `${qz(start.lat)},${qz(start.lng)}`
  const b = `${qz(end.lat)},${qz(end.lng)}`
  return `${a}->${b}|${polyline.length}`
}

/** A narration corpus row mapped for both candidate selection and manifest assembly. */
interface NarrationRow {
  narrationId: string
  poiId: string
  form: string
  key: string
  durationMs: number
  attribution: DriveClip['attribution']
  revisedAt: Date | null
  name: string
  kind: string | null
  lat: number
  lng: number
}

/** Load every roam narration whose POI falls within the route's bounding box (padded by the off-route
 *  ceiling) — the candidate set buildDrive snaps + paces. A few hundred rows per region, so a bbox
 *  prefilter beats PostGIS. Keyed by poiId (the buildDrive ⇄ narration join).
 *
 *  Release gate (region-release-gate): by default only RELEASED clips (released_at NOT NULL) are
 *  eligible, so a non-tester's drive can never pick up a staged clip. `includeStaged` (a tester) lifts
 *  the filter. The build-time filter is sufficient — drives are owner-only and release is monotonic, so
 *  a built drive's clips stay valid forever; the drive-load resolve path needs no further filter. */

async function loadCorpusForRoute(
  polyline: Polyline,
  includeStaged = false,
): Promise<Map<string, NarrationRow>> {
  const { minLat, minLng, maxLat, maxLng } = polylineBbox(polyline)
  const midLat = (minLat + maxLat) / 2
  const padM = OFF_ROUTE_MAX_M + 200
  const padLat = padM / 111_320
  const cos = Math.cos((midLat * Math.PI) / 180)
  const padLng = padM / (111_320 * (Math.abs(cos) > 1e-6 ? Math.abs(cos) : 1e-6))

  const rows = await withRetry(
    () =>
      db
        .select({
          narrationId: narrations.id,
          poiId: narrations.poiId,
          form: narrations.form,
          key: narrations.audioUrl,
          durationMs: narrations.audioDurationMs,
          attribution: narrations.attribution,
          revisedAt: narrations.updatedAt,
          name: pois.name,
          kind: pois.kind,
          lat: pois.lat,
          lng: pois.lng,
        })
        .from(narrations)
        .innerJoin(pois, eq(pois.id, narrations.poiId))
        .where(
          and(
            between(pois.lat, minLat - padLat, maxLat + padLat),
            between(pois.lng, minLng - padLng, maxLng + padLng),
            includeStaged ? undefined : isNotNull(narrations.releasedAt),
          ),
        ),
    { label: 'drive.corpus' },
  )
  const map = new Map<string, NarrationRow>()
  for (const r of rows) {
    map.set(r.poiId, {
      narrationId: r.narrationId,
      poiId: r.poiId,
      form: r.form,
      key: r.key,
      durationMs: r.durationMs,
      attribution: (r.attribution ?? undefined) as DriveClip['attribution'],
      revisedAt: r.revisedAt,
      name: r.name,
      kind: r.kind,
      lat: r.lat,
      lng: r.lng,
    })
  }
  return map
}

const candidateOf = (r: NarrationRow): DriveCandidate => ({
  poiId: r.poiId,
  audioKey: r.key,
  audioDurationMs: r.durationMs,
  lat: r.lat,
  lng: r.lng,
  kind: r.kind,
  name: r.name,
})

/** Resolve a frozen `selection` into presigned, playable driveClips (narration content LIVE via the
 *  corpus). Throws if presigning fails (the caller maps it to 503). Every selection item is a place
 *  narration in v2 (asides — the placeless framing — were deleted; see geometry-first-regions.md). */
function manifestClips(selection: DriveSelection, corpusById: Map<string, NarrationRow>): DriveClip[] {
  const clips: DriveClip[] = []
  for (const item of selection) {
    const n = corpusById.get(item.poiId)
    if (!n) continue // the poi/narration was deleted since freeze — drop the stale stop
    clips.push({
      seq: item.seq,
      form: toClipForm(n.form),
      poiId: n.poiId,
      name: n.name,
      lat: item.triggerLat,
      lng: item.triggerLng,
      triggerRadiusM: radiusForKind(n.kind),
      approachHeadingDeg: item.approachHeadingDeg,
      alongSec: item.alongSec,
      durationMs: n.durationMs,
      url: presignGet(n.key),
      contentType: contentTypeForKey(n.key),
      ...(n.attribution ? { attribution: n.attribution } : {}),
      ...(n.revisedAt ? { revisedAt: n.revisedAt.toISOString() } : {}),
    })
  }
  return clips
}

/* --------------------------------- routes --------------------------------- */

export const driveRoutes = new Hono<ApiEnv>()

// Everything in this module needs a free account (anonymous = roam only).
driveRoutes.use('*', withSession, requireAccount)

/**
 * POST /drives/propose — resolve free-text A→B into in-region anchors + preview the route. Cheap:
 * one small LLM call (only when a hint lacks coords) + geocoding + ONE Routes call. Persists nothing,
 * counts no credit — the confirm-before-spend interstitial so we never generate a wrong drive.
 */
driveRoutes.post('/propose', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'bad_request', message: 'Invalid JSON body.' }, 400)
  }
  const parsed = driveProposeRequest.safeParse(body)
  if (!parsed.success) return c.json({ error: 'bad_request', message: 'regionId and a prompt are required.' }, 400)
  const { regionId, prompt } = parsed.data
  if (!UUID_RE.test(regionId)) return c.json({ error: 'bad_request', message: 'regionId must be a uuid.' }, 400)

  const regionRows = await withRetry(
    () =>
      db
        .select({ slug: regions.slug, name: regions.displayName, bbox: regions.bbox })
        .from(regions)
        .where(eq(regions.id, regionId))
        .limit(1),
    { label: 'drive.region' },
  )
  const region = regionRows[0]
  if (!region) return c.json({ error: 'not_found', message: 'Unknown region.' }, 404)
  const bounds = geocodeBoundsFor(region.bbox)

  // The LLM pulls a START + END from the rider's one conversational prompt.
  let resolved: { start: string; end: string; inRegion: boolean }
  try {
    resolved = await resolveEndpointsFromPrompt(region.name, prompt)
  } catch (e) {
    console.error('[api] drive propose LLM failed', e)
    return c.json({ error: 'propose_failed', message: "Couldn't make sense of that. Try naming where to start and where to end up." }, 502)
  }
  if (!resolved.inRegion) {
    return c.json(
      { error: 'out_of_region', message: `That's outside ${region.name}. Keep the start and end inside the region.` },
      422,
    )
  }

  // Geocode the resolved names (region-biased so "Inspiration Point" resolves locally).
  const [startGeo, endGeo] = await Promise.all([
    geocode(`${resolved.start}, ${region.name}`, bounds),
    geocode(`${resolved.end}, ${region.name}`, bounds),
  ])
  if (!startGeo || !endGeo) {
    return c.json({ error: 'unresolved', message: 'Could not locate one of those places. Try a more specific name.' }, 422)
  }
  const startEp: ResolvedEndpoint = { name: resolved.start, ...startGeo }
  const endEp: ResolvedEndpoint = { name: resolved.end, ...endGeo }

  let route
  try {
    route = await materializeRoute([
      { label: startEp.name, lat: startEp.lat, lng: startEp.lng },
      { label: endEp.name, lat: endEp.lat, lng: endEp.lng },
    ] satisfies Waypoint[])
  } catch (e) {
    console.error('[api] drive propose route failed', e)
    return c.json({ error: 'no_route', message: "Couldn't find a drivable route between those points." }, 422)
  }

  // Accurate est. stop count: run the real selection (pure, free) so the confirm screen matches.
  // A tester previews over staged clips too, so the proposed count matches what they'll build.
  const corpus = await loadCorpusForRoute(route.polyline, isTester(c.get('session')))
  const stops = buildDrive({
    polyline: route.polyline,
    totalSec: route.durationSeconds,
    candidates: [...corpus.values()].map(candidateOf),
    minGapSec: DRIVE_MIN_GAP_SEC,
    maxStops: driveMaxStops(route.durationSeconds),
  })

  return c.json({
    start: startEp,
    end: endEp,
    polyline: route.polyline,
    distanceMeters: Math.round(route.distanceMeters),
    durationSeconds: Math.round(route.durationSeconds),
    routeSig: routeSigOf(startEp, endEp, route.polyline),
    estStopCount: stops.length,
  })
})

/**
 * POST /drives — generate + persist the confirmed drive. Free-account gated (above); enforces the
 * free-tier drive cap; materializes the route, runs the deterministic selection over the shared
 * narration corpus, freezes the STRUCTURE into `drives.selection`, bumps demand, and returns the
 * playable manifest. Mints no audio (reuses roam clips), so it spends only Routes + a DB write.
 */
driveRoutes.post('/', async (c) => {
  const userId = c.get('session')?.user.id
  if (!userId) return c.json({ error: 'account_required', message: 'Create a free account to make a drive.' }, 401)

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'bad_request', message: 'Invalid JSON body.' }, 400)
  }
  const parsed = createDriveRequest.safeParse(body)
  if (!parsed.success) return c.json({ error: 'bad_request', message: 'start{name,lat,lng} and end{name,lat,lng} are required.' }, 400)
  const { start, end, idempotencyKey } = parsed.data

  // The drive id is the client's idempotencyKey when supplied (a v4 UUID, stable across retries),
  // else server-minted. Using it AS the id makes a lost-ACK network retry hit the existing PK + the
  // `drive:<id>` consume key (in the co-committed batch below) and no-op — exactly-once create + charge.
  const id = idempotencyKey ?? crypto.randomUUID()

  // Idempotent replay: if that drive already exists for this user, return it WITHOUT re-running Routes,
  // re-charging, or hitting the credit gate. Without this, a lost-ACK retry on the user's LAST credit
  // would 403 (`drive_limit_reached`) even though the original request already committed their drive.
  // Falls through to a normal create when nothing exists yet (first attempt, or a prior attempt that
  // died before the co-committed insert).
  if (idempotencyKey) {
    const existing = await loadOwnedDriveById(userId, id)
    if (existing) {
      try {
        return c.json(await manifestForStoredDrive(existing))
      } catch (e) {
        console.error('[api] drive create idempotent-replay presign failed', e)
        return c.json({ error: 'audio_unavailable', message: 'Audio is warming up. Give it a moment and try again.' }, 503)
      }
    }
  }

  // Free-tier credit gate (paid is uncapped). The balance is the user-owned ledger (SUM of grants −
  // consumes), NOT a count of drive rows — a delete never refunds because no `reverse` is emitted, so
  // there's no tombstone-counting hack to maintain. `ensureFreeGrant` lazily materializes the one-time
  // free allotment on first touch. This is a pre-check (cheap; avoids the paid route/LLM work for a
  // user with no credits); the actual consume is co-committed with the drive insert below.
  if (c.get('tier') === 'free') {
    await ensureFreeGrant(userId)
    const { remaining } = await creditSummary(userId)
    if (remaining < 1) {
      return c.json(
        {
          error: 'drive_limit_reached',
          message: `You've used all ${FREE_DRIVE_CAP} of your free drives. A credit pack to make more is coming soon.`,
          cap: FREE_DRIVE_CAP,
        },
        403,
      )
    }
  }

  let route
  try {
    route = await materializeRoute([
      { label: start.name, lat: start.lat, lng: start.lng },
      { label: end.name, lat: end.lat, lng: end.lng },
    ] satisfies Waypoint[])
  } catch (e) {
    console.error('[api] drive create route failed', e)
    return c.json({ error: 'no_route', message: "Couldn't find a drivable route between those points." }, 422)
  }

  // Release gate: a tester builds over staged clips too; everyone else gets released-only. The frozen
  // selection then references whatever was eligible at build time (monotonic → stays valid). (region-release-gate)
  const corpus = await loadCorpusForRoute(route.polyline, isTester(c.get('session')))
  const stops = buildDrive({
    polyline: route.polyline,
    totalSec: route.durationSeconds,
    candidates: [...corpus.values()].map(candidateOf),
    minGapSec: DRIVE_MIN_GAP_SEC,
    maxStops: driveMaxStops(route.durationSeconds),
  })

  // GUARD: an empty selection must NOT persist. buildDrive returns [] when nothing rides the route
  // (sparse corpus, everything off-route, or a degenerate/zero-length route — the likeliest cause
  // being a LOOP whose start≈end collapsed to a near-zero route). A saved 0-stop drive is unplayable
  // AND burns a LIFETIME credit (the row counts toward the cap and is never refunded), so reject with
  // a 422 BEFORE the insert + demand bump. The loop-aware log keeps that root cause visible for the
  // verification pass instead of masking it behind the generic message (runbook Finding 1/2).
  if (stops.length === 0) {
    const loopish = Math.abs(start.lat - end.lat) < 1e-4 && Math.abs(start.lng - end.lng) < 1e-4
    console.warn(
      `[api] drive create produced 0 stops — rejecting before persist (${start.name} → ${end.name}, ` +
        `loopish=${loopish}, candidates=${corpus.size}, durationSec=${Math.round(route.durationSeconds)})`,
    )
    return c.json(
      {
        error: 'no_stories',
        message:
          "The skipper couldn't find any stories along that route. Try different start and end points, or a longer drive.",
      },
      422,
    )
  }

  // Freeze the structure: a narration selection item per stop (content resolves live via poiId).
  const selection: DriveSelection = stops.map(
    (s): DriveSelectionItem => ({
      kind: 'narration',
      seq: s.seq,
      poiId: s.poiId,
      narrationId: corpus.get(s.poiId)!.narrationId,
      alongSec: s.alongSec,
      triggerLat: s.triggerLat,
      triggerLng: s.triggerLng,
      approachHeadingDeg: s.approachHeadingDeg,
    }),
  )

  const startEp: ResolvedEndpoint = { name: start.name, lat: start.lat, lng: start.lng }
  const endEp: ResolvedEndpoint = { name: end.name, lat: end.lat, lng: end.lng }
  const routeSig = routeSigOf(startEp, endEp, route.polyline)
  const bbox = polylineBbox(route.polyline)
  const label = `${start.name} → ${end.name}`
  const provenance: RouteProvenance = {
    source: 'google-routes-v2',
    waypoints: route.provenance.waypoints,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    materializedAt: route.provenance.materializedAt,
  }

  const driveValues: typeof drives.$inferInsert = {
    id,
    userId,
    label,
    startName: start.name,
    startLat: start.lat,
    startLng: start.lng,
    endName: end.name,
    endLat: end.lat,
    endLng: end.lng,
    polyline: route.polyline,
    bboxMinLat: bbox.minLat,
    bboxMinLng: bbox.minLng,
    bboxMaxLat: bbox.maxLat,
    bboxMaxLng: bbox.maxLng,
    distanceMeters: Math.round(route.distanceMeters),
    durationSeconds: Math.round(route.durationSeconds),
    routeProvenance: provenance,
    routeSig,
    selection,
  }
  // Charge the credit ATOMICALLY with the drive insert (db.batch co-commits on neon-http) so we can
  // never half-commit a charge-without-drive or a drive-without-charge. Both inserts are ON CONFLICT
  // DO NOTHING (idempotency_key for the consume, the PK for the drive), so a retry that reuses the same
  // (now client-stable) id cleanly no-ops instead of erroring on the unique violation — the consume is
  // keyed on the drive id, so a drive charges exactly one credit even under retry. Free tier only —
  // paid (comped) accounts insert the drive without a consume. (The free-tier balance was pre-checked
  // above; with a client-stable id even a concurrent resubmit shares the consume key, so the only
  // residual TOCTOU is two GENUINELY-DISTINCT creates racing the pre-check — bounded to 1, negligible.)
  if (c.get('tier') === 'free') {
    await withRetry(
      () =>
        db.batch([
          db
            .insert(creditEntries)
            .values(driveConsumeEntry(userId, id))
            .onConflictDoNothing({ target: creditEntries.idempotencyKey }),
          db.insert(drives).values(driveValues).onConflictDoNothing({ target: drives.id }),
        ]),
      { label: 'drive.insert' },
    )
  } else {
    await withRetry(
      () => db.insert(drives).values(driveValues).onConflictDoNothing({ target: drives.id }),
      { label: 'drive.insert' },
    )
  }

  // Demand instrumentation (route-concentration signal; the cache-warming job that consumes it is
  // deferred). distinctUsers is a rough lower bound — exact per-user dedup isn't worth a join here.
  await withRetry(
    () =>
      db
        .insert(driveDemand)
        .values({ routeSig, hits: 1, distinctUsers: 1, lastHitAt: new Date() })
        .onConflictDoUpdate({
          target: driveDemand.routeSig,
          set: { hits: sql`${driveDemand.hits} + 1`, lastHitAt: new Date() },
        }),
    { label: 'drive.demand' },
  ).catch((e) => console.error('[api] drive demand bump failed (non-fatal)', e))

  const manifest: DriveManifest = {
    driveId: id,
    label,
    polyline: route.polyline,
    distanceMeters: Math.round(route.distanceMeters),
    durationSeconds: Math.round(route.durationSeconds),
    clips: [],
  }
  try {
    manifest.clips = manifestClips(selection, corpus)
  } catch (e) {
    console.error('[api] drive create presign failed', e)
    // The drive IS saved; the client can re-fetch GET /drives/:id once R2 settles.
    return c.json({ ...manifest, warning: 'audio_unavailable' })
  }
  return c.json(manifest)
})

/** GET /drives — the caller's saved drives, newest first (no geometry; one card each). */
driveRoutes.get('/', async (c) => {
  const userId = c.get('session')?.user.id
  if (!userId) return c.json({ error: 'account_required' }, 401)
  const rows = await withRetry(
    () =>
      db
        .select({
          driveId: drives.id,
          label: drives.label,
          startName: drives.startName,
          endName: drives.endName,
          distanceMeters: drives.distanceMeters,
          durationSeconds: drives.durationSeconds,
          // Count clips in SQL rather than hauling the full selection jsonb back just to .length it
          // (selection is jsonb NOT NULL, so no null-handling needed).
          clipCount: sql<number>`jsonb_array_length(${drives.selection})`,
          createdAt: drives.createdAt,
        })
        .from(drives)
        .where(and(eq(drives.userId, userId), isNull(drives.deletedAt)))
        .orderBy(desc(drives.createdAt)),
    { label: 'drive.list' },
  )
  // Proactive "N free drives left" hint, from the user-owned credit LEDGER (free tier only). `credits`
  // is null for paid (uncapped) so the client shows nothing; `remaining` is the spendable balance and
  // `cap` the lifetime granted (for "N of M" framing). ensureFreeGrant materializes the allotment so a
  // brand-new free user reads the full balance even before their first drive. `remaining` is clamped at
  // 0 so a future refund clawback can't surface as a negative count.
  let credits: { remaining: number; cap: number } | null = null
  if (c.get('tier') === 'free') {
    await ensureFreeGrant(userId)
    const { remaining, granted } = await creditSummary(userId)
    credits = { remaining: Math.max(0, remaining), cap: granted }
  }
  return c.json({
    drives: rows.map((r) => ({
      driveId: r.driveId,
      label: r.label ?? `${r.startName ?? 'Start'} → ${r.endName ?? 'End'}`,
      startName: r.startName,
      endName: r.endName,
      distanceMeters: r.distanceMeters,
      durationSeconds: r.durationSeconds,
      clipCount: r.clipCount,
      createdAt: r.createdAt.toISOString(),
    })),
    credits,
  })
})

/** Owner-scoped drive load by EXPLICIT id — the shared core of loadOwnedDrive (URL param) and the
 *  POST /drives idempotent replay (body idempotencyKey). null on miss-or-not-yours-or-deleted, so we
 *  never reveal another user's drive and a soft-deleted drive reads as gone. */
async function loadOwnedDriveById(userId: string, id: string) {
  const rows = await withRetry(
    () =>
      db
        .select()
        .from(drives)
        .where(and(eq(drives.id, id), eq(drives.userId, userId), isNull(drives.deletedAt)))
        .limit(1),
    { label: 'drive.load' },
  )
  return rows[0] ?? null
}

/** Build a replay manifest from a STORED drive row: frozen structure + LIVE narration content (a
 *  regenerated telling auto-improves it), freshly presigned. Throws if presign fails — the caller maps
 *  that to a 503. Shared by GET /:id and the POST /drives idempotent replay. */
async function manifestForStoredDrive(drive: NonNullable<Awaited<ReturnType<typeof loadOwnedDriveById>>>): Promise<DriveManifest> {
  const poiIds = (drive.selection ?? []).filter((i) => i.kind === 'narration').map((i) => i.poiId)
  const corpus = poiIds.length ? await loadCorpusByPoiIds(poiIds) : new Map<string, NarrationRow>()
  return {
    driveId: drive.id,
    label: drive.label ?? `${drive.startName ?? 'Start'} → ${drive.endName ?? 'End'}`,
    polyline: drive.polyline,
    distanceMeters: drive.distanceMeters,
    durationSeconds: drive.durationSeconds,
    clips: manifestClips(drive.selection ?? [], corpus),
  }
}

/** Load a LIVE drive the caller OWNS (404 on miss-or-not-yours-or-deleted — never reveal another
 *  user's drive, and a soft-deleted drive reads as gone). */
async function loadOwnedDrive(c: Context<ApiEnv>) {
  const id = c.req.param('id')
  const userId = c.get('session')?.user.id
  if (!id || !UUID_RE.test(id) || !userId) return null
  return loadOwnedDriveById(userId, id)
}

/** Lean owner-scoped loader — only { id, selection }, for paths that re-presign but need no geometry
 *  (POST /:id/assets/sign). Same ownership scoping as loadOwnedDrive (id + userId + not-deleted +
 *  UUID guard); 404 on any miss. */
async function loadOwnedSelection(c: Context<ApiEnv>) {
  const id = c.req.param('id')
  const userId = c.get('session')?.user.id
  if (!id || !UUID_RE.test(id) || !userId) return null
  const rows = await withRetry(
    () =>
      db
        .select({ id: drives.id, selection: drives.selection })
        .from(drives)
        .where(and(eq(drives.id, id), eq(drives.userId, userId), isNull(drives.deletedAt)))
        .limit(1),
    { label: 'drive.loadSelection' },
  )
  return rows[0] ?? null
}

/** GET /drives/:id — replay a saved drive: frozen STRUCTURE + LIVE narration content (a regenerated
 *  telling auto-improves it). Re-presigns every clip. */
driveRoutes.get('/:id', async (c) => {
  const drive = await loadOwnedDrive(c)
  if (!drive) return c.json({ error: 'not_found' }, 404)
  try {
    return c.json(await manifestForStoredDrive(drive))
  } catch (e) {
    console.error('[api] drive replay presign failed', e)
    return c.json({ error: 'audio_unavailable', message: 'Audio is warming up. Give it a moment and try again.' }, 503)
  }
})

/** POST /drives/:id/assets/sign — re-presigned clip URLs (offline refresh), keyed by seq. */
driveRoutes.post('/:id/assets/sign', async (c) => {
  const drive = await loadOwnedSelection(c)
  if (!drive) return c.json({ error: 'not_found' }, 404)
  const poiIds = (drive.selection ?? []).filter((i) => i.kind === 'narration').map((i) => i.poiId)
  const corpus = poiIds.length ? await loadCorpusByPoiIds(poiIds) : new Map<string, NarrationRow>()
  try {
    const clips = manifestClips(drive.selection ?? [], corpus).map((cl) => ({
      seq: cl.seq,
      url: cl.url!,
      contentType: cl.contentType!,
      durationMs: cl.durationMs,
    }))
    return c.json({ clips })
  } catch (e) {
    console.error('[api] drive sign presign failed', e)
    return c.json({ error: 'audio_unavailable', message: 'Audio is warming up. Give it a moment and try again.' }, 503)
  }
})

/**
 * DELETE /drives/:id — remove a drive from the caller's list. SOFT-delete (sets deleted_at): the row
 * stays so it keeps counting toward the lifetime free-drive credit — deleting NEVER refunds a credit
 * (one is spent at generation). Owner-scoped + idempotent: 404 if it isn't yours or is already gone.
 * The shared narration audio is untouched — a drive only references it, never owns it.
 */
driveRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const userId = c.get('session')?.user.id
  if (!id || !UUID_RE.test(id) || !userId) return c.json({ error: 'not_found' }, 404)
  const deleted = await withRetry(
    () =>
      db
        .update(drives)
        .set({ deletedAt: new Date() })
        .where(and(eq(drives.id, id), eq(drives.userId, userId), isNull(drives.deletedAt)))
        .returning({ id: drives.id }),
    { label: 'drive.delete' },
  )
  if (deleted.length === 0) return c.json({ error: 'not_found' }, 404)
  return c.json({ ok: true })
})

/** Load narration corpus rows by an explicit poiId set (the GET-replay path — no route bbox). */
async function loadCorpusByPoiIds(poiIds: string[]): Promise<Map<string, NarrationRow>> {
  const rows = await withRetry(
    () =>
      db
        .select({
          narrationId: narrations.id,
          poiId: narrations.poiId,
          form: narrations.form,
          key: narrations.audioUrl,
          durationMs: narrations.audioDurationMs,
          attribution: narrations.attribution,
          revisedAt: narrations.updatedAt,
          name: pois.name,
          kind: pois.kind,
          lat: pois.lat,
          lng: pois.lng,
        })
        .from(narrations)
        .innerJoin(pois, eq(pois.id, narrations.poiId))
        .where(inArray(narrations.poiId, poiIds)),
    { label: 'drive.corpusByIds' },
  )
  const map = new Map<string, NarrationRow>()
  for (const r of rows) {
    map.set(r.poiId, {
      narrationId: r.narrationId,
      poiId: r.poiId,
      form: r.form,
      key: r.key,
      durationMs: r.durationMs,
      attribution: (r.attribution ?? undefined) as DriveClip['attribution'],
      revisedAt: r.revisedAt,
      name: r.name,
      kind: r.kind,
      lat: r.lat,
      lng: r.lng,
    })
  }
  return map
}
