// Create-a-Drive (V2) — a user-owned, on-demand A→B drive assembled from REUSED roam narrations.
//
//   GET  /drives/anchors          -> a region's pickable START/END anchors (real places, exact coords)
//   POST /drives/propose          -> preview the route for a picked A→B (cheap; no persist, no credit)
//   POST /drives                  -> generate + persist the confirmed drive (free-account gated; counts a credit)
//   GET  /drives                  -> the caller's saved drives (one card each)
//   GET  /drives/:id              -> replay a saved drive's frozen manifest (narration content resolves LIVE)
//   POST /drives/:id/assets/sign  -> re-presigned clip URLs (offline refresh), keyed by seq
//   DELETE /drives/:id            -> soft-delete (remove from list); CAP-NEUTRAL — a spent credit is never refunded
//
// A drive is "roam, pre-ordered for your route": the rider PICKS the endpoints from the region's real
// anchors; the route is Google's (materializeRoute) and the SELECTION is deterministic (engine
// buildDrive over the shared narration corpus). Nothing here synthesizes audio — it picks + paces
// existing roam clips. The drive's
// STRUCTURE freezes into `drives.selection`; each narration's CONTENT resolves live via its poi, so a
// regenerated telling auto-improves a saved drive. Ownership lives on `drives.user_id` (a drive is
// user-owned, never shared content). Anonymous callers get roam only — the whole module
// is behind requireAccount.

import { Hono, type Context } from 'hono'
import { and, asc, between, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { creditEntries, drives, driveDemand, narrations, places, pois, regions, selectionSubject } from '@skipper/db/schema'
import type { DriveSelection, DriveSelectionItem, Polyline, RouteProvenance } from '@skipper/db/schema'
import { polylineBbox } from './drive-geometry'
import { materializeRoute, type Waypoint } from '@skipper/routing'
import {
  buildDrive,
  candidateTriggerRadiusM,
  DRIVE_MIN_GAP_SEC,
  driveMaxStops,
  OFF_ROUTE_MAX_M,
  type DriveCandidate,
  type LngLat,
} from '@skipper/engine'
import { CLUSTER_VARIETY_KEY, loadClusterTellings, notSupersededByServedCluster, type ClusterTelling } from './clusters'
import {
  createDriveRequest,
  driveProposeRequest,
  type DriveClip,
  type DriveClipForm,
  type DriveManifest,
  varietyKey,
  type RegionAnchor,
} from '@skipper/shared'
import { isAdmin, requireAccount, withSession, type ApiEnv } from './entitlements'
import { creditSummary, driveConsumeEntry, ensureFreeGrant } from './credits'
import { DRIVE_CREATE_RATE, MAX_DRIVE_BODY_BYTES, MAX_PLAN_ANCHORS, readBoundedText } from './limits'
import { rateLimit } from './rate-limit'
import { withRetry } from './retry'
import { audioUnavailable, contentTypeForKey, presignGet } from './storage'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Where a rider who runs out of free drives is sent. `hello@skipper.fm` is the founder rule for every
 *  PUBLISHED address (same inbox as the legal pages, the support page and the in-app report link) —
 *  never a personal address. Env-overridable with the same default as ./email's reply-to, so a redirect
 *  is a config change rather than a code edit.
 *  ⚠ This address must actually be READ by a human: since 2026-07-31 it is the only route past the
 *  free-drive wall, so an unmonitored inbox turns a friendly top-up into a dead end. */
const SUPPORT_EMAIL = process.env.EMAIL_REPLY_TO ?? 'hello@skipper.fm'

// Drive credits live in the user-owned `credit_entries` LEDGER (see ./credits + the decision doc), NOT
// a count of drive rows. Every account is granted `FREE_DRIVE_CAP` credits once — but that amount is
// FROZEN into the grant row, so user-facing numbers read `granted` from the ledger, never the env
// constant (which only describes what the NEXT account will get). Each generated drive
// CONSUMES one (atomically, co-committed with the drive insert); a delete never refunds (no reverse is
// emitted). There is no uncapped tier — a comp is a large admin grant. Beyond the free allotment, a
// one-time credit pack is the planned unlock (Apple IAP / Google Play fast-follow).

// Drive pacing (DRIVE_MIN_GAP_SEC / driveMaxStops) is single-sourced in @skipper/engine so the
// API's selection matches the engine's.

/* --------------------------------- helpers -------------------------------- */

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

/** The pickable START/END/MIDPOINT anchors in a region's bbox — served to the client (GET
 *  /drives/anchors). These are the region's CURATED set of endpoint-eligible `places` (real,
 *  recognizable Google hubs — towns, marinas, lookouts — curated offline by `curate-places`), with
 *  coords RESOLVED + STORED at curation. So the rider picks FROM/TO from a stored short list with NO
 *  runtime Places call and NO geocode hop — endpoints are grounded by construction. Region membership
 *  is point-in-bbox (geometry-first; `places` carries no region_id). `kind` is the humanized Google
 *  `primary_type` (display only); `featured` floats the popular subset to the top of the picker.
 *  (SUPERSEDES the interim POI-corpus join — see docs/designs/places-endpoints-spec.md.) */
export async function loadRegionAnchors(bbox: string | null): Promise<RegionAnchor[]> {
  const p = (bbox ?? '').split(',').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return []
  const [lngMin, latMin, lngMax, latMax] = p as [number, number, number, number]
  const rows = await withRetry(
    () =>
      db
        .select({ id: places.id, name: places.name, lat: places.lat, lng: places.lng, primaryType: places.primaryType, featured: places.featured })
        .from(places)
        .where(and(eq(places.endpointEligible, true), between(places.lat, latMin, latMax), between(places.lng, lngMin, lngMax)))
        // ⚠ ORDER BY IS NOT COSMETIC HERE, AND IT IS NOT ABOUT THE PICKER.
        // From 1.1 this set IS the planner's allowlist, and it rides inside the CACHED system-prompt
        // prefix on EVERY rider turn. Postgres guarantees no row order without an ORDER BY, so an
        // unsorted list can come back permuted between requests — byte-different prefix, cache miss,
        // full-price re-read of the whole prefix, on a call that spends on every request forever.
        // A silent ~10x cost regression with nothing failing. Sort by a stable key.
        .orderBy(asc(places.name), asc(places.id))
        // ⚠ And BOUND it. The set grows with every paid `curate-places` run, and an unbounded list
        // in a per-request prompt is an unbounded per-request bill. The cap is deliberately far above
        // today's 26 so it never truncates a real region silently — it is a ceiling, not a page size.
        .limit(MAX_PLAN_ANCHORS),
    { label: 'drive.anchors' },
  )
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    // Humanize the raw Google primaryType for the picker subtitle (e.g. 'scenic_spot' → 'scenic spot'); null when absent.
    kind: r.primaryType ? r.primaryType.replace(/_/g, ' ') : null,
    featured: r.featured,
  }))
}

/** A resolved endpoint (a picked anchor), as the server produced it. */
interface ResolvedEndpoint {
  name: string
  lat: number
  lng: number
}

/**
 * Turn the anchor IDS a request carries into real endpoints — the wire-level enforcement of INV-1.
 *
 * ⚠ THIS MUST RUN BEFORE ANY ROUTES CALL, and it is the only thing standing between an anonymous
 * request and a billed Google Routes call for arbitrary points. Requests used to carry
 * `{name, lat, lng}` straight into `materializeRoute`; an id cannot express an off-list point, and
 * every row is re-checked for `endpoint_eligible` HERE rather than trusted from whenever the client
 * last fetched the anchor list — a place can be de-curated between a rider's picker load and their tap.
 *
 * ⚠ Re-asserts eligibility in the QUERY, not after: a row that exists but is no longer eligible must be
 * indistinguishable from one that never existed, or the 400 becomes an oracle for the curated set.
 *
 * ⚠ Order is the caller's, not the database's. `inArray` returns rows in whatever order Postgres likes,
 * and these are ROUTE WAYPOINTS — reordering them silently produces a different (still billable) drive.
 *
 * Returns null when ANY id is unknown or ineligible; the caller 400s. Deliberately all-or-nothing: a
 * partial resolve would route a rider somewhere they did not ask to go.
 */
async function hydrateAnchors(ids: string[]): Promise<ResolvedEndpoint[] | null> {
  if (ids.length === 0) return []
  const unique = [...new Set(ids)]
  const rows = await withRetry(
    () =>
      db
        .select({ id: places.id, name: places.name, lat: places.lat, lng: places.lng })
        .from(places)
        .where(and(inArray(places.id, unique), eq(places.endpointEligible, true))),
    { label: 'drive.hydrateAnchors' },
  )
  const byId = new Map(rows.map((r) => [r.id, { name: r.name, lat: r.lat, lng: r.lng }]))
  const out: ResolvedEndpoint[] = []
  for (const id of ids) {
    const hit = byId.get(id)
    if (!hit) return null // unknown OR de-curated — same answer either way (see above)
    out.push(hit)
  }
  return out
}

/** The 400 an off-list endpoint gets. ⚠ Says nothing about WHICH id failed or whether it exists —
 *  the response must not become a probe for the curated set. The rider-facing half is the planner's
 *  job (an in-persona "don't know that one"), never a geocode. */
const NOT_AN_ANCHOR = {
  error: 'unknown_anchor',
  message: "I don't know one of those spots — pick one from the list and I'll plot it.",
} as const

/** Build the ordered Routes waypoints for a drive: [start, ...via, end]. A LOOP is end===start with a
 *  single `via` midpoint, so it materializes as a real out-and-back (start==end alone is a degenerate
 *  zero-distance route). materializeRoute routes through the middle waypoints as Routes intermediates. */
function routeWaypoints(start: ResolvedEndpoint, end: ResolvedEndpoint, via?: ResolvedEndpoint[]): Waypoint[] {
  return [start, ...(via ?? []), end].map((p) => ({ label: p.name, lat: p.lat, lng: p.lng }))
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
  /** The corpus map key, and what a frozen selection item names: `pois.id` for a place telling,
   *  `poi_clusters.id` for a FUSED one. Mirrors the `narrations_subject_xor` CHECK one level up —
   *  a telling is about exactly one subject, so exactly one id identifies it. */
  subjectId: string
  subjectKind: 'poi' | 'cluster'
  /** NULL for a fused telling. ⚠ Do NOT substitute the cluster id here: pointing `poi_id` at one
   *  member of a group was the design that got replaced, precisely because it makes a false statement
   *  every downstream reader inherits (see the `poiClusters` schema comment). */
  poiId: string | null
  form: string
  key: string
  durationMs: number
  attribution: DriveClip['attribution']
  revisedAt: Date | null
  name: string
  kind: string | null
  lat: number
  lng: number
  /** True when lat/lng is a road-snapped speakable anchor (not the raw centroid) — tightens the
   *  trigger floor at manifest time (`triggerRadiusForKind`). Set once in `rowsToCorpus`. */
  anchored: boolean
  /** Coarse variety bucket (@skipper/shared `varietyKey`) — `kind` when it exists, else derived from
   *  the Wikidata types. Keeps the selector from narrating four houses in a row. */
  varietyKey: string | null
  /** An EXPLICIT trigger floor, set only for a fused telling — a cluster has no `kind`, so the radius
   *  vocabulary can't answer and the geometry supplies it (`clusterTrigger`). Undefined for a poi,
   *  which keeps deriving from kind/anchored exactly as before. Read through
   *  `candidateTriggerRadiusM` so selection and the manifest can never disagree. */
  triggerRadiusM?: number
  /** True when this fused telling's group is too spread out for any single point to represent it.
   *  Carried here for ONE reason: `buildDrive` must be able to SEE that, so it can refuse it — a
   *  drive's selection is frozen at create, and a wide group frozen as a mis-placed point is permanent
   *  for that rider. ⚠ Dropping it at the mapper below silently re-admits the group as a capped 600 m
   *  point — which is exactly what this code path did until 2026-07-30.
   *  ⚠ Keyed on the GEOMETRY, never on the presence of a served hull: the hull is one answer to this
   *  condition and is going away with roam, and a refusal that keys on an answer flips to an admission
   *  the moment that answer is deleted. */
  tooWideForPoint?: boolean
}

/** The shared corpus projection + poi join. BOTH loaders (route-bbox and explicit-poiId) select these
 *  exact columns, so the NarrationRow shape lives in ONE place and can't drift between the two read
 *  paths. A fresh builder per call (the appended single-use `.where()` differs by path). */
const narrationCorpusSelect = () =>
  db
    .select({
      narrationId: narrations.id,
      // `pois.id`, not `narrations.poi_id`: identical under the innerJoin below, but NOT NULL, so a
      // CLUSTER telling (poi_id null — see the narrations schema) can never enter the drive corpus
      // keyed by a null. The join already excludes them; selecting the poi's own id makes the TYPE
      // say so instead of relying on a runtime coincidence.
      poiId: pois.id,
      form: narrations.form,
      key: narrations.audioUrl,
      durationMs: narrations.audioDurationMs,
      attribution: narrations.attribution,
      revisedAt: narrations.updatedAt,
      name: pois.name,
      kind: pois.kind,
      lat: pois.lat,
      lng: pois.lng,
      // Road-snapped trigger anchor (snap-speakable-anchors): when present, NarrationRow.lat/lng carries
      // it instead of the centroid, so a road-adjacent POI places + triggers off the ROAD point (1b
      // step 1). Null for off-road POIs → falls back to the pin, today's behavior.
      speakableLat: pois.speakableLat,
      speakableLng: pois.speakableLng,
      // Wikidata P31 labels — the VARIETY bucket for the built world, where `kind` is null by design.
      wikidataTypes: pois.wikidataTypes,
    })
    .from(narrations)
    .innerJoin(pois, eq(pois.id, narrations.poiId))

/** Map corpus rows to NarrationRow by subjectId (the buildDrive ⇄ narration join key), preferring the
 *  road-snapped anchor over the centroid. Shared by both loaders. */
function rowsToCorpus(rows: Awaited<ReturnType<typeof narrationCorpusSelect>>): Map<string, NarrationRow> {
  const map = new Map<string, NarrationRow>()
  for (const r of rows) {
    map.set(r.poiId, {
      narrationId: r.narrationId,
      subjectId: r.poiId,
      subjectKind: 'poi',
      poiId: r.poiId,
      form: r.form,
      key: r.key,
      durationMs: r.durationMs,
      attribution: (r.attribution ?? undefined) as DriveClip['attribution'],
      revisedAt: r.revisedAt,
      name: r.name,
      kind: r.kind,
      lat: r.speakableLat ?? r.lat,
      lng: r.speakableLng ?? r.lng,
      anchored: r.speakableLat != null && r.speakableLng != null,
      varietyKey: varietyKey(r.kind, r.wikidataTypes),
    })
  }
  return map
}

/** The same mapping for the OTHER subject kind. A fused telling has no `kind` (so no kind-derived
 *  radius) and no single anchor — its geometry is derived from the members it names, in ./clusters —
 *  so it arrives with its trigger point and floor already resolved. */
function clusterRowsToCorpus(rows: ClusterTelling[], into: Map<string, NarrationRow>): Map<string, NarrationRow> {
  for (const r of rows) {
    into.set(r.clusterId, {
      narrationId: r.narrationId,
      subjectId: r.clusterId,
      subjectKind: 'cluster',
      poiId: null,
      form: r.form,
      key: r.key,
      durationMs: r.durationMs,
      attribution: (r.attribution ?? undefined) as DriveClip['attribution'],
      revisedAt: r.revisedAt,
      name: r.name,
      kind: null,
      lat: r.lat,
      lng: r.lng,
      // The derived point is NOT a road-snapped anchor (it can sit off-road by design — see
      // `clusterTrigger`), so this stays false and the explicit radius below does the work instead.
      anchored: false,
      varietyKey: CLUSTER_VARIETY_KEY,
      triggerRadiusM: r.triggerRadiusM,
      // Carried so buildDrive can REFUSE it — see NarrationRow.tooWideForPoint and the admission loop
      // in @skipper/engine's drive-select. A wide group must not be frozen into a drive as a point.
      tooWideForPoint: r.tooWideForPoint,
    })
  }
  return into
}

/** Load every roam narration whose POI falls within the route's bounding box (padded by the off-route
 *  ceiling) — the candidate set buildDrive snaps + paces. A few hundred rows per region, so a bbox
 *  prefilter beats PostGIS. Keyed by poiId (the buildDrive ⇄ narration join).
 *
 *  Release gate (region-release-gate): by default only RELEASED clips (released_at NOT NULL) are
 *  eligible, so a non-admin's drive can never pick up a staged clip. `includeStaged` (an admin) lifts
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

  // ⚠ Fused tellings FIRST — which ones we serve is what decides which members to suppress (see
  // notSupersededByServedCluster).
  // ⚠ Loads EVERY fused telling, including the ones too wide for a point. The refusal lives ONE level
  // down, in buildDrive's second admission rule, which knows the route geometry. Withholding here too
  // would double-gate — and worse, it would suppress those groups' MEMBERS with nothing replacing
  // them (see notSupersededByServedCluster). One rule, in the place that can judge it.
  const clusters = await withRetry(
    () => loadClusterTellings({ includeStaged }),
    { label: 'drive.clusterCorpus' },
  )
  const rows = await withRetry(
    () =>
      narrationCorpusSelect().where(
        and(
          between(pois.lat, minLat - padLat, maxLat + padLat),
          between(pois.lng, minLng - padLng, maxLng + padLng),
          includeStaged ? undefined : isNotNull(narrations.releasedAt),
          // Legibility gate: a poi carrying an `excluded_reason` exists but cannot be TOLD as a stop
          // (today: numbered highways, whose coordinate is an arbitrary point on a line you're on for
          // twenty minutes). Filtered at BUILD only — see loadCorpusByPoiIds for why the replay path
          // deliberately does not. `prune-corpus.ts` sets it; the reason string says which rule fired.
          isNull(pois.excludedReason),
          // A clustered member stops being a drive candidate once its cluster has a fused telling
          // this caller can see (spec §4.2). BUILD path only — `loadCorpusBySubjectIds` deliberately
          // does not re-adjudicate a frozen drive's stops, exactly as with `excluded_reason`.
          notSupersededByServedCluster(clusters.map((c) => c.clusterId)),
        ),
      ),
    { label: 'drive.corpus' },
  )
  return clusterRowsToCorpus(clusters, rowsToCorpus(rows))
}

const candidateOf = (r: NarrationRow): DriveCandidate => ({
  poiId: r.subjectId,
  audioKey: r.key,
  audioDurationMs: r.durationMs,
  lat: r.lat,
  lng: r.lng,
  kind: r.kind,
  name: r.name,
  // Load-bearing for selection, not cosmetic: an anchored stop triggers off the TIGHT 250 m floor, so
  // buildDrive needs it to know how close the car must actually get before this stop can play.
  anchored: r.anchored,
  varietyKey: r.varietyKey,
  // Only a cluster sets this; a poi leaves it undefined and keeps deriving from kind/anchored.
  ...(r.triggerRadiusM != null ? { triggerRadiusM: r.triggerRadiusM } : {}),
  // Set only for a group too wide for a point. buildDrive refuses these outright rather than snapping
  // the enclosing-circle centre to the route — see the second admission rule.
  ...(r.tooWideForPoint ? { tooWideForPoint: true } : {}),
})

/** Resolve a frozen `selection` into presigned, playable driveClips (narration content LIVE via the
 *  corpus). Throws if presigning fails (the caller maps it to 503). Every selection item is a place
 *  narration in v2 (asides — the placeless framing — were deleted; see geometry-first-regions.md). */
function manifestClips(selection: DriveSelection, corpusById: Map<string, NarrationRow>): DriveClip[] {
  const clips: DriveClip[] = []
  for (const item of selection) {
    const n = corpusById.get(selectionSubject(item)?.id ?? '')
    if (!n) continue // the poi/cluster/narration was deleted since freeze — drop the stale stop
    clips.push({
      seq: item.seq,
      form: toClipForm(n.form),
      // Null for a fused telling. The wire field is already `nullish()` and nothing on the client
      // reads it (identity there is `seq`), so a fused clip simply omits it rather than claiming to
      // be about one of the places it names.
      poiId: n.poiId,
      // The honest identity (INV-16): a fused telling has a null `poiId` by design, so a client keying
      // an offline store on that field cannot tell a cluster clip apart from a broken one.
      subjectId: n.subjectId,
      subjectKind: n.subjectKind,
      name: n.name,
      lat: item.triggerLat,
      lng: item.triggerLng,
      triggerRadiusM: candidateTriggerRadiusM(n),
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
 * GET /drives/anchors?regionId= — the pickable START/END anchors for a region: real, narratable
 * places with exact coordinates. The Create-a-Drive form populates its FROM/TO pickers from this, so
 * the rider always chooses endpoints that are grounded by construction — no free text, no geocode hop.
 */
driveRoutes.get('/anchors', async (c) => {
  const regionId = c.req.query('regionId') ?? ''
  if (!UUID_RE.test(regionId)) return c.json({ error: 'bad_request', message: 'regionId (uuid) is required.' }, 400)
  const regionRows = await withRetry(
    () => db.select({ bbox: regions.bbox }).from(regions).where(eq(regions.id, regionId)).limit(1),
    { label: 'drive.anchors.region' },
  )
  const region = regionRows[0]
  if (!region) return c.json({ error: 'not_found', message: 'Unknown region.' }, 404)
  // Curated endpoints have no staging concept (they're admin-curated, not generated) — no admin/staged
  // branch here, unlike loadCorpusForRoute.
  const anchors = await loadRegionAnchors(region.bbox)
  return c.json({ anchors } satisfies { anchors: RegionAnchor[] })
})

/**
 * POST /drives/propose — preview the route for a rider-PICKED START→END before spending a credit.
 * Both endpoints come from the region's anchors (GET /drives/anchors) with exact coords, so this just
 * materializes the route + counts narratable stops. Persists nothing, no credit — the
 * confirm-before-spend interstitial. (No LLM/geocoding: endpoints are grounded by construction.)
 */
driveRoutes.post('/propose', async (c) => {
  const parsed = await readJsonBody(
    c,
    driveProposeRequest,
    'start and end must be anchor ids from GET /drives/anchors.',
    MAX_DRIVE_BODY_BYTES,
  )
  if (!parsed.ok) return parsed.res
  const { start: startId, end: endId, via: viaIds } = parsed.data

  // ⚠ BEFORE the Routes call — this is the billed boundary (INV-1). start, end AND every via.
  const hydrated = await hydrateAnchors([startId, ...(viaIds ?? []), endId])
  if (!hydrated) return c.json(NOT_AN_ANCHOR, 400)
  const startEp = hydrated[0]!
  const endEp = hydrated[hydrated.length - 1]!
  const via = hydrated.slice(1, -1)

  let route
  try {
    route = await materializeRoute(routeWaypoints(startEp, endEp, via))
  } catch (e) {
    console.error('[api] drive propose route failed', e)
    return c.json({ error: 'no_route', message: "Couldn't find a drivable route between those points." }, 422)
  }

  // Accurate est. stop count: run the real selection (pure, free) so the confirm screen matches.
  // An admin previews over staged clips too, so the proposed count matches what they'll build.
  const { stops } = await selectStopsForRoute(route, isAdmin(c.get('session')))

  // Echo the ids AND the resolved midpoints: the ids are what POST /drives must re-send, the resolved
  // shapes are what the confirm screen renders (and what marks a loop as a round trip).
  return c.json({
    start: startEp,
    end: endEp,
    startId,
    endId,
    ...(viaIds && viaIds.length ? { via: viaIds, viaResolved: via } : {}),
    polyline: route.polyline,
    distanceMeters: Math.round(route.distanceMeters),
    durationSeconds: Math.round(route.durationSeconds),
    routeSig: routeSigOf(startEp, endEp, route.polyline),
    estStopCount: stops.length,
  })
})

// Per-IP cap on the CREATE path — it fires a Google Routes call + consumes a credit + writes a row,
// the same spend profile /propose is rate-limited for (index.ts). Applied as route-level middleware so
// it scopes to EXACTLY POST / (the list GET, detail GET, re-sign POST, and delete under /drives stay
// uncapped — they're cheap reads or idempotent). Same per-instance in-memory first-cut as ./rate-limit.
const createDriveLimiter = rateLimit(DRIVE_CREATE_RATE)

/**
 * POST /drives — generate + persist the confirmed drive. Free-account gated (above); enforces the
 * free-tier drive cap; materializes the route, runs the deterministic selection over the shared
 * narration corpus, freezes the STRUCTURE into `drives.selection`, bumps demand, and returns the
 * playable manifest. Mints no audio (reuses roam clips), so it spends only Routes + a DB write.
 */
driveRoutes.post('/', createDriveLimiter, async (c) => {
  const userId = c.get('session')?.user.id
  if (!userId) return c.json({ error: 'account_required', message: 'Create a free account to make a drive.' }, 401)

  const parsed = await readJsonBody(
    c,
    createDriveRequest,
    'start and end must be anchor ids from GET /drives/anchors.',
    MAX_DRIVE_BODY_BYTES,
  )
  if (!parsed.ok) return parsed.res
  const { start: startId, end: endId, via: viaIds, idempotencyKey } = parsed.data

  // The drive id is the client's idempotencyKey when supplied (a v4 UUID, stable across retries),
  // else server-minted. Using it AS the id makes a lost-ACK network retry hit the existing PK + the
  // `drive:<id>` consume key (in the co-committed batch below) and no-op — exactly-once create + charge.
  const id = idempotencyKey ?? crypto.randomUUID()

  // `drives.id` is a GLOBAL primary key and the id IS the client's idempotencyKey, so ONE by-id lookup
  // disambiguates three cases before any spend:
  //   • exists & ours & live  → idempotent replay: return the saved manifest WITHOUT re-running Routes,
  //     re-charging, or hitting the credit gate. (Else a lost-ACK retry on the user's LAST credit would
  //     403 `drive_limit_reached` though their drive already committed.)
  //   • exists but NOT ours   → 409 conflict: a create would spend a Routes call and then no-op both
  //     batch inserts (PK + consume-key conflicts), handing this caller a 200 for a drive they can
  //     never load. Reject before spending. (Narrow: needs guessing another user's v4 UUID.)
  //   • absent | ours+deleted → fall through to a normal create (a soft-deleted id re-creates; the
  //     original charge already stood — delete never refunds).
  if (idempotencyKey) {
    const existing = (
      await withRetry(() => db.select().from(drives).where(eq(drives.id, id)).limit(1), { label: 'drive.idLookup' })
    )[0]
    if (existing && existing.userId !== userId) {
      return c.json({ error: 'conflict', message: 'That drive id is already in use. Use a fresh idempotency key.' }, 409)
    }
    if (existing && !existing.deletedAt) {
      try {
        return c.json(await manifestForStoredDrive(existing))
      } catch (e) {
        return audioUnavailable(c, 'drive create idempotent-replay', e)
      }
    }
  }

  // Credit gate — EVERY account spends from the user-owned ledger (there is no uncapped tier; a comp is
  // a large admin grant). The balance is SUM(grants − consumes), NOT a count of drive rows — a delete
  // never refunds because no `reverse` is emitted, so there's no tombstone-counting hack to maintain.
  // `ensureFreeGrant` lazily materializes the one-time allotment on first touch. This is a pre-check
  // (cheap; avoids the route/LLM work for a user with no credits); the consume is co-committed below.
  await ensureFreeGrant(userId)
  const { remaining, granted } = await creditSummary(userId)
  if (remaining < 1) {
    // ⚠ `granted`, NOT the FREE_DRIVE_CAP env constant. A grant's amount is FROZEN when written
    // (credits.ts), so the env value is what the NEXT account will get, not what this one got. They
    // diverge the moment they ever differ — and an admin comp is exactly that: `POST
    // /admin/users/:id/credits` grants up to 1000, so a comped rider who spends 510 was being told
    // "you've used all 10 of your free drives" while the admin console correctly showed 510. GET
    // /drives already reports `granted`; this path disagreeing with it was the bug.
    // ⚠ This string is the ONLY thing that tells a rider the top-up path exists — the client renders
    // the server message verbatim. Founder call 2026-07-31: the allotment stays small and the wall is a
    // CONVERSATION, not a paywall — anyone who runs out emails and gets more, free, until there is
    // actually something to sell. So the address is load-bearing copy, not a courtesy sign-off.
    // ⚠ Do NOT promise a credit pack here. It used to say "a credit pack to make more is coming soon",
    // which is a commitment to ship a purchase flow; nothing sells today and 2.0 may price differently.
    return c.json(
      {
        error: 'drive_limit_reached',
        message: `That's all ${granted} of your free drives — you've been busy. Email ${SUPPORT_EMAIL} and we'll top you up, free.`,
        cap: granted,
        supportEmail: SUPPORT_EMAIL,
      },
      403,
    )
  }

  // ⚠ BEFORE the Routes call — the same billed boundary /propose guards (INV-1). Deliberately placed
  // HERE rather than at parse time: the idempotent-replay path above returns without routing, and it
  // is the hot path for a lost-ACK retry, so it should not pay for a lookup it does not need. A rider
  // who reached this line has already passed the credit gate, so an off-list id costs them nothing.
  const hydrated = await hydrateAnchors([startId, ...(viaIds ?? []), endId])
  if (!hydrated) return c.json(NOT_AN_ANCHOR, 400)
  const start = hydrated[0]!
  const end = hydrated[hydrated.length - 1]!
  const via = hydrated.slice(1, -1)

  let route
  try {
    route = await materializeRoute(routeWaypoints(start, end, via))
  } catch (e) {
    console.error('[api] drive create route failed', e)
    return c.json({ error: 'no_route', message: "Couldn't find a drivable route between those points." }, 422)
  }

  // Release gate: an admin builds over staged clips too; everyone else gets released-only. The frozen
  // selection then references whatever was eligible at build time (monotonic → stays valid). (region-release-gate)
  const { corpus, stops } = await selectStopsForRoute(route, isAdmin(c.get('session')))

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

  // Freeze the structure: a narration selection item per stop (content resolves live via its subject).
  // ⚠ `DriveStop.poiId` is the engine's opaque candidate id, which is the SUBJECT id here — a poi's
  // for a place telling, a cluster's for a fused one. Both ids are written so a stale-shaped row can
  // never be produced by this path.
  const selection: DriveSelection = stops.map((s): DriveSelectionItem => {
    const n = corpus.get(s.poiId)!
    return {
      kind: 'narration',
      seq: s.seq,
      subjectId: n.subjectId,
      subjectKind: n.subjectKind,
      ...(n.poiId ? { poiId: n.poiId } : {}),
      narrationId: n.narrationId,
      alongSec: s.alongSec,
      triggerLat: s.triggerLat,
      triggerLng: s.triggerLng,
      approachHeadingDeg: s.approachHeadingDeg,
    }
  })

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
  // keyed on the drive id, so a drive charges exactly one credit even under retry. Every account
  // consumes (no uncapped tier).
  //
  // ⚠ KNOWN residual TOCTOU (not closed here): the balance pre-check (above) and this consume are two
  // separate neon-http round-trips, and the consume keys are DISTINCT per drive id — so N genuinely-
  // concurrent creates with DISTINCT idempotency keys can all pass a `remaining===1` pre-check and all
  // commit a −1, driving the balance to 1−N (and a delete never refunds). A client-stable id only
  // dedupes RETRIES of the SAME create, not distinct ones. The create rate-limit (createDriveLimiter,
  // 15/60s per IP) now bounds the blast radius; fully closing it needs DB-level per-user serialization
  // (an advisory lock + a conditional INSERT…SELECT WHERE balance>=1 inside this batch), deferred until
  // there's a DB-backed test harness to verify money-path SQL (today's credit tests are pure-surface).
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

  // Demand instrumentation (route-concentration signal; the cache-warming job that consumes it is
  // deferred). distinctUsers is a rough lower bound — exact per-user dedup isn't worth a join here.
  // FIRE-AND-FORGET + intentionally NOT withRetry-wrapped: the `hits + 1` upsert is the one
  // non-idempotent write on this path, so a commit-then-lost-response retry would double-count; and as
  // deferred instrumentation it must never add a DB round-trip (or retry backoff) to the rider's create
  // latency. Best-effort — a failure is logged and swallowed.
  void db
    .insert(driveDemand)
    .values({ routeSig, hits: 1, distinctUsers: 1, lastHitAt: new Date() })
    .onConflictDoUpdate({
      target: driveDemand.routeSig,
      set: { hits: sql`${driveDemand.hits} + 1`, lastHitAt: new Date() },
    })
    .catch((e) => console.error('[api] drive demand bump failed (non-fatal)', e))

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
    // ⚠ The drive IS saved and the credit already charged, so this must stay the retryable 503 every
    // sibling presign site answers with, NEVER a 200 the client reads as success. The create screen
    // reuses its idempotencyKey on retry → the idempotent replay re-presigns the saved drive once R2
    // settles (no double charge); GET /drives/:id recovers it too.
    return audioUnavailable(c, 'drive create', e)
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
  // Proactive "N drives left" hint, from the user-owned credit LEDGER (every account has a balance).
  // `remaining` is the spendable balance and `cap` the lifetime granted (for "N of M" framing).
  // ensureFreeGrant materializes the allotment so a brand-new user reads the full balance even before
  // their first drive. `remaining` is clamped at 0 so a future refund clawback can't surface negative.
  await ensureFreeGrant(userId)
  const { remaining, granted } = await creditSummary(userId)
  const credits = { remaining: Math.max(0, remaining), cap: granted }
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

/** Read a JSON body and validate it, or hand back the 4xx the caller should return.
 *
 *  Both write routes did this by hand, which meant the "Invalid JSON body." wording lived in two
 *  places while the per-route shape message lived in each. Only the shape message actually differs,
 *  so only that is a parameter.
 *
 *  ⚠ `maxBytes` is REQUIRED and undefaulted on purpose — a new caller has to state what it is willing
 *  to carry. This function's first act used to be `await c.req.json()`, which buffers an unbounded body
 *  into memory before anything can object: one unauthenticated request could carry a megabyte into the
 *  paid paths (INV-3). The bound is measured on the real stream and Content-Length is never consulted;
 *  see ./limits for why that distinction is the whole guarantee. */
async function readJsonBody<T>(
  c: Context,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  shapeMessage: string,
  maxBytes: number,
): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  const read = await readBoundedText(c.req.raw, maxBytes)
  // 413 — "Content Too Large" (RFC 9110 §15.5.14; "Payload Too Large" is the retired RFC 7231 name).
  // ⚠ Nothing is logged here, not even a truncation: this path is anonymously triggerable, so a log
  // line would be a free log-spam amplifier, and the body itself is rider content (INV-13).
  if (!read.ok) {
    return {
      ok: false,
      res: c.json({ error: 'payload_too_large', message: 'That request is too large. Try trimming it down.' }, 413),
    }
  }
  let body: unknown
  try {
    // NOT c.req.json() — readBoundedText already consumed the stream, and hono only caches bodies read
    // through its own accessors, so calling it here throws. An absent body arrives as '' and fails into
    // the same 400 as before.
    body = JSON.parse(read.text)
  } catch {
    return { ok: false, res: c.json({ error: 'bad_request', message: 'Invalid JSON body.' }, 400) }
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return { ok: false, res: c.json({ error: 'bad_request', message: shapeMessage }, 400) }
  return { ok: true, data: parsed.data }
}

/** Load the corpus along a frozen route and run the deterministic selection over it.
 *
 *  Shared by POST /drives/propose and POST /drives so the count the rider is shown on the confirm
 *  screen is produced by the SAME call that builds the drive they pay for. Two copies of this is how a
 *  preview starts promising a different number of stops than it delivers.
 *
 *  `admin` widens the corpus to staged clips as well as released ones (region-release-gate). */
async function selectStopsForRoute(route: { polyline: LngLat[]; durationSeconds: number }, admin: boolean) {
  const corpus = await loadCorpusForRoute(route.polyline, admin)
  const stops = buildDrive({
    polyline: route.polyline,
    totalSec: route.durationSeconds,
    candidates: [...corpus.values()].map(candidateOf),
    minGapSec: DRIVE_MIN_GAP_SEC,
    maxStops: driveMaxStops(route.durationSeconds),
  })
  // The corpus rides along: POST /drives reads it again to shape the persisted selection and to log
  // the candidate count, so returning only the stops would just make the caller re-load it.
  return { corpus, stops }
}

/** The narration rows a stored drive's frozen selection points at, keyed by subject id.
 *
 *  ⚠ Via `selectionSubject`, which absorbs the pre-fused item shape AND resolves the subject kind — a
 *  fused telling is named by its `cluster_id`, not a member's `poi_id`. Reaching into the item for a
 *  poi id directly is the mistake that made `narrations.poi_id → 3rd Street Flats` for a clip about
 *  downtown Reno. One definition, shared by the replay manifest and the offline re-sign. */
async function corpusForSelection(selection: DriveSelectionItem[]): Promise<Map<string, NarrationRow>> {
  const subjectIds = selection
    .filter((i) => i.kind === 'narration')
    .map((i) => selectionSubject(i)?.id)
    .filter((id): id is string => Boolean(id))
  return subjectIds.length ? await loadCorpusBySubjectIds(subjectIds) : new Map<string, NarrationRow>()
}

/** Build a replay manifest from a STORED drive row: frozen structure + LIVE narration content (a
 *  regenerated telling auto-improves it), freshly presigned. Throws if presign fails — the caller maps
 *  that to a 503. Shared by GET /:id and the POST /drives idempotent replay. */
async function manifestForStoredDrive(drive: NonNullable<Awaited<ReturnType<typeof loadOwnedDriveById>>>): Promise<DriveManifest> {
  const corpus = await corpusForSelection(drive.selection ?? [])
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
    return audioUnavailable(c, 'drive replay', e)
  }
})

/** POST /drives/:id/assets/sign — re-presigned clip URLs (offline refresh), keyed by seq. */
driveRoutes.post('/:id/assets/sign', async (c) => {
  const drive = await loadOwnedSelection(c)
  if (!drive) return c.json({ error: 'not_found' }, 404)
  const corpus = await corpusForSelection(drive.selection ?? [])
  try {
    const clips = manifestClips(drive.selection ?? [], corpus).map((cl) => ({
      seq: cl.seq,
      url: cl.url!,
      contentType: cl.contentType!,
      durationMs: cl.durationMs,
    }))
    return c.json({ clips })
  } catch (e) {
    return audioUnavailable(c, 'drive sign', e)
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

/** Load narration corpus rows by an explicit poiId set (the GET-replay path — no route bbox).
 *
 *  ⚠ Deliberately NO `excluded_reason` filter, unlike the build path. Exclusion is NOT monotonic the
 *  way the release gate is: releasing only ever ADDS eligibility, so filtering at build is sufficient,
 *  whereas excluding REMOVES it. Applying it here would silently shrink a drive the rider already paid
 *  a credit for — every stop that later got pruned would vanish from a saved drive, and the credit is
 *  never refunded. A drive's selection is frozen at build; this path resolves that frozen set's CONTENT
 *  and must not re-adjudicate which stops belong. New drives get the clean corpus; old drives keep
 *  what they bought. */
async function loadCorpusBySubjectIds(subjectIds: string[]): Promise<Map<string, NarrationRow>> {
  // A frozen selection names subjects of both kinds, and the id spaces are disjoint uuids — so both
  // queries run against the same list and each matches only its own. `includeStaged: true` on the
  // cluster side mirrors the poi side's deliberate absence of a release filter (see above): this path
  // resolves a frozen set's CONTENT and must not re-adjudicate eligibility.
  const [rows, clusters] = await Promise.all([
    withRetry(() => narrationCorpusSelect().where(inArray(narrations.poiId, subjectIds)), {
      label: 'drive.corpusByIds',
    }),
    // `includeStaged: true` because this path resolves a
    // FROZEN selection's content and must never re-adjudicate what belongs in it. A capability
    // withhold here would silently shrink a drive the rider paid a non-refundable credit for —
    // and would do it differently on different devices, since capability is per-request.
    withRetry(() => loadClusterTellings({ includeStaged: true, clusterIds: subjectIds }), {
      label: 'drive.clusterCorpusByIds',
    }),
  ])
  return clusterRowsToCorpus(clusters, rowsToCorpus(rows))
}
