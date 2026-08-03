import { z } from 'zod'
import { attributionSource, driveClipForm, platform } from './enums'

/** A single [lng, lat] pair (GeoJSON axis order). */
export const coordinate = z.tuple([z.number(), z.number()])
export type Coordinate = z.infer<typeof coordinate>

/** A frozen, precomputed route geometry. */
export const polyline = z.array(coordinate)
export type Polyline = z.infer<typeof polyline>

/** A region — the minimal keying entity (a drive belongs to one). */
export const region = z.object({
  id: z.uuid(),
  slug: z.string(),
  displayName: z.string(),
  /** A few curated endpoint NAMES from this region — names only, no ids, no coordinates. Feeds the
   *  tappable example asks and the in-persona offline/outage copy, so rider-facing strings never
   *  hardcode a place name. It is DECORATION, never an input: the client must not turn one of these
   *  back into an endpoint — a request names an endpoint by ANCHOR ID and only the server holds the
   *  mapping (INV-1). Names are already public (the planner speaks them on turn one, anonymously); the
   *  id mapping is what stays server-side, because an id is the only thing that can bill a Routes call.
   *  ⚠ `.catch([])`, NOT `.default([])`. GET /regions is critical path (it supplies the regionId every
   *  POST /drives/plan carries) and the mobile client turns ANY DTO parse failure into a blocking
   *  "please update the app" wall (apps/mobile/src/lib/api.ts `parseDto`). `.default()` only covers a
   *  MISSING key — a null or a malformed element still throws, so one sloppy `?? null` in a handler
   *  would brick the whole home screen over a cosmetic field. `.catch()` degrades to "no examples",
   *  which every consumer already renders (a freshly-curated region has none).
   *  ⚠ No `.max()` here either: a count bound on a RESPONSE schema can only ever break deployed
   *  clients (and under `.catch` it would silently blank the field, worse). The count is server
   *  policy — apps/api/src/example-anchors.ts. */
  exampleAnchors: z.array(z.string()).catch([]),
})
export type Region = z.infer<typeof region>

/** GET /regions — the pickable regions (for the Create-a-Drive region selector). Anonymous. */
export const regionList = z.object({ regions: z.array(region) })

/** Attribution snapshot frozen at generation time (keeps CC BY-SA / CC BY credit correct). */
export const attribution = z.object({
  source: attributionSource,
  sourceId: z.string(),
  title: z.string().optional(),
  url: z.url().optional(),
  license: z.string().optional(),
  retrievedAt: z.iso.datetime().optional(),
})
export type Attribution = z.infer<typeof attribution>

/**
 * A clip's frozen attribution: an ARRAY, one entry per source it drew on (Wikipedia +
 * Macrostrat, etc.). Stored as a jsonb array on `narrations` — there is no legacy
 * single-object shape to tolerate (zero-reuse, no users → clean array contract).
 *
 * ⚠ `.catch([])` for the SAME reason `region.exampleAnchors` carries one, and the stakes are higher
 * here: this rides the anonymous `/drives/propose` response (and `/sample`), the mobile client turns
 * ANY DTO parse failure into a blocking "please update the app" wall (apps/mobile/src/lib/api.ts
 * `parseDto`), and the value is a FROZEN blob the studio pipeline wrote — nothing re-validates it on
 * the way out. So a fifth `attributionSource` value, a stamp that isn't strict ISO, or one malformed
 * `url` would kill an ALREADY-BILLED propose over an ⓘ button. `.catch()`, not `.default()`: a
 * default only covers a MISSING key, while a null or a bad element still throws. Every consumer
 * already renders the empty case (scenic/break clips ground on no sources at all).
 * ⚠ The cost, stated honestly: one bad element drops the WHOLE credit list for that clip, and
 * Wikipedia's CC BY-SA credit is legal rather than optional. It is still the better failure — a wall
 * presents no credit AND no clip AND no app — but it means a drift in what the pipeline freezes
 * shows up as silently missing credit, not as an error. The credit's real guard stays where it is
 * enforceable: the form-conditional CHECK on `narrations` (packages/db).
 * ⚠ RESPONSE-ONLY. Never reuse this to validate attribution on the way IN (a studio write, an admin
 * edit) — a `.catch` on a write silently discards exactly what the licence requires us to keep.
 */
export const attributionList = z.array(attribution).catch([])
/** The frozen-attribution array as a TYPE. Exported because API handlers that serve attribution
 *  need to annotate it, and the only previous way to name it was to reach through a DTO that
 *  happened to carry one — which made an unrelated DTO's
 *  removal a compile error in a handler that has nothing to do with it. */
export type AttributionList = z.infer<typeof attributionList>

// ⚠ `dataSource`/`sourcesResponse` and `GET /sources` were cut in the 1.1 sweep. The catalog was
// served so a new fact source could be credited "without an App Store release" — but the app had to
// ship a byte-identical bundled fallback anyway (a legal page must render offline), so the release it
// was avoiding was never actually avoided, and the CC BY-SA source list had TWO homes that could
// disagree. One home now: `apps/mobile/src/lib/licenses.ts`. ⚠ This is the CATALOG only — per-clip
// `attribution`, frozen on the narration row, is untouched and is what the licence actually requires.

/**
 * The per-platform app-version policy. The client reads its OWN version, compares against
 * `minimum`/`recommended`, and decides the update gate (see `gateFor` in ./version). The
 * authoritative copy lives in apps/api server code, so the floor is raised by a BACKEND
 * deploy — never an App Store release. `storeUrl` deep-links the right store.
 */
export const versionPolicy = z.object({
  platform,
  /** Below this (semver "x.y.z") the client is FORCED to update (blocking wall). */
  minimum: z.string(),
  /** Below this (but at/above `minimum`) the client is NUDGED (dismissible). */
  recommended: z.string(),
  /** App Store / Play Store deep link for this platform. */
  storeUrl: z.url(),
})
export type VersionPolicy = z.infer<typeof versionPolicy>

/** GET /version — the per-platform update policy (anonymous; env-free). */
export const versionResponse = z.object({ policies: z.array(versionPolicy) })

/* -------------------------------------------------------------------------- */
/*  API response DTOs (apps/api ⇄ clients). Lightweight, no internal columns.   */
/* -------------------------------------------------------------------------- */

/** A single presigned audio clip. */
export const signedClip = z.object({
  url: z.url(),
  /** The clip's MIME type (e.g. "audio/mpeg"), derived server-side from the R2 key's
   *  extension. The format is DATA, not an assumption: the player stays format-agnostic
   *  and the offline download writes the right extension instead of hardcoding `.wav`. */
  contentType: z.string(),
  durationMs: z.number().int().nullish(),
})

/** A presigned stop clip, keyed by the stop's seq. */
export const signedStopClip = signedClip.extend({ seq: z.number().int() })

/** GET /sample — ONE curated "taste" clip, anonymous, for a rider OUTSIDE any coverage (the
 *  Cupertino reviewer, and every first-timer who opens the app 200 miles from Tahoe). A single
 *  hand-picked narration (server-side `SAMPLE_NARRATION_QID`) resolved to a presigned clip: no
 *  geography, because there is no map here, just the clip. `attribution` rides along because a taste
 *  presents the adapted work like any other surface (CC BY-SA).
 *  ⚠ Served at /roam/sample until 1.1; the path moved with roam's removal and there is NO alias —
 *  the wire may break freely (docs/decisions/api-versioning-posture.md). */
export const sample = z.object({
  // The clip's poi QID — lets the client pick the matching curated "postcard" artwork (qid→image),
  // and fall back to a generic frame if it doesn't recognize the place. Optional for wire-compat.
  qid: z.string().optional(),
  name: z.string(),
  url: z.url(),
  contentType: z.string(),
  durationMs: z.number().int(),
  attribution: attributionList.optional(),
})
export type Sample = z.infer<typeof sample>

/* -------------------------------------------------------------------------- */
/*  Create-a-Drive (V2) — a user-owned, on-demand A→B drive over reused narrations */
/* -------------------------------------------------------------------------- */

// A SERVER-RESOLVED endpoint: the name + exact coords looked up from a curated `places` row. Only ever
// travels outbound now — see `anchorId` below for why a request can no longer carry one.
// lat/lng stay bounded to valid WGS84 (which also excludes ±Infinity; z.number() already rejects NaN):
// cheap, and the shape is still parsed on the client.
const resolvedEndpoint = z.object({
  name: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})

/** GET /drives/anchors?regionId= — the pickable START/END/MIDPOINT anchors for a region: a CURATED set
 *  of recognizable Google Places (towns, marinas, lookouts) with coords RESOLVED + STORED at curation,
 *  so the rider picks FROM / TO from a stored short list — no free text, no live geocoding/Places call,
 *  endpoints grounded by construction. `kind` is the humanized Google `primary_type` (display only);
 *  `featured` floats the popular subset to the top of the (short) picker. */
export const regionAnchor = z.object({
  /** The `places` row id — the ONLY thing a request may name an endpoint by (see `anchorId`). Already
   *  existed in the DB; it simply was never projected to the wire, which is what let requests carry
   *  free coordinates. */
  id: z.uuid(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  kind: z.string().nullable(),
  /** The curator-flagged popular subset, sorted to the top of the picker. `.default(false)` so an
   *  older server (pre-curated-Places) still parses — the client just renders no featured section. */
  featured: z.boolean().default(false),
})
export type RegionAnchor = z.infer<typeof regionAnchor>

/**
 * An endpoint, as a REQUEST may name it: the id of a curated `places` row, never a coordinate.
 *
 * ⚠ THIS IS THE WHOLE OF "GROUNDED BY CONSTRUCTION" (INV-1), and it is enforced at the WIRE rather
 * than asked for in a prompt. Requests used to carry `{name, lat, lng}`, which flowed straight into a
 * BILLED Google Routes call — so once /propose opens to anonymous riders (D14/D15), that shape is an
 * unauthenticated endpoint that bills Routes for any two points on Earth. An id cannot express a point
 * that is not on the curated list; the server re-asserts `endpoint_eligible` per row and 400s BEFORE
 * any Routes call. An off-list ask gets the in-persona "don't know that one" — never a geocode.
 */
const anchorId = z.uuid()

/** The most intermediate waypoints a route may carry — the bound on the single billed Routes call.
 *
 *  ⚠ ONE HOME, because three places must agree and only one of them fails loudly. The wire schema
 *  rejects an over-long `via`, but `translateRoute` (apps/api/src/plan-route.ts) drops a route that
 *  exceeds it AFTER the round-trip append, and a mismatch there is silent: the rider asks, the model
 *  answers, and the route dies as a `route_untranslatable` line nobody is watching. The planner
 *  tool's own `maxItems` is deliberately LOWER than this and is not derived from it — that one is
 *  model-facing headroom for the round-trip append, not a cap. */
export const MAX_ROUTE_VIA = 8

/** Ordered intermediate waypoints between start and end — the route is materialized as
 *  [start, ...via, end]. A LOOP is `end === start` with one `via` midpoint (a turnaround), so a
 *  round trip is a real out-and-back (start==end alone is a degenerate zero-distance route). Capped
 *  to bound the single Routes call.
 *  ⚠ `via` GOES THROUGH THE ALLOWLIST TOO. It was `z.array(resolvedEndpoint)` while start/end were
 *  being hardened, which satisfied "reject a non-anchor ENDPOINT" exactly while still shipping 8
 *  arbitrary billable coordinates. Guarding both ends of a route and leaving the middle open is not a
 *  partial guarantee — it is none. */
const via = z.array(anchorId).max(MAX_ROUTE_VIA).optional()

/** POST /drives/propose — preview the route for a picked START→END (+ optional via midpoints) before
 *  spending a credit. The endpoints were chosen from the region's anchors (GET /drives/anchors), so we
 *  just materialize the route + count stories. Persists nothing, no credit — the confirm interstitial. */
export const driveProposeRequest = z.object({
  start: anchorId,
  end: anchorId,
  via,
})
export type DriveProposeRequest = z.infer<typeof driveProposeRequest>

/** The anonymous rider's ONE taste of the product (D14): a single presigned clip drawn from THIS
 *  proposal's own selection, chosen server-side.
 *
 *  ⚠ IT IS AN OBJECT, NOT AN ARRAY, AND THAT IS THE GUARANTEE (INV-5). "Exactly one clip" is not a
 *  server-side length check a later edit can relax — it is the SHAPE. Turning this into a list is a
 *  wire break someone has to argue for, not a parameter a caller can raise. And the request carries no
 *  selector at all (`driveProposeRequest` above is start/end/via — no `seq`, `index`, `count` or
 *  `offset` anywhere), so the ONLY lever a caller has over which clip they receive is the ROUTE. That
 *  makes corpus enumeration cost one billed Google Routes call per clip, at the propose rate limit
 *  (`apps/api/src/limits.ts`), and still only ever yields the FIRST stop of each route.
 *
 *  ⚠ DELIBERATELY NOT `driveClip`. Reusing it would put `subjectId`, `lat`/`lng`, `triggerRadiusM`,
 *  `alongSec` and `seq` on an ANONYMOUS wire — exact trigger geometry for a corpus POI, plus a stable
 *  corpus key a stranger could correlate across routes — and would leave `z.array(driveClip)` one
 *  character away. A preview needs a name, a URL and a credit. Nothing else.
 *
 *  `attribution` is NOT decoration: Wikipedia is CC BY-SA, so any surface that presents the adapted
 *  work owes credit, and this is the most-seen anonymous surface there is. `sample` above carries it
 *  for exactly the same reason. */
export const drivePreviewClip = z.object({
  /** The place this clip is about — the card's label. Safe on an anonymous wire: the clip says the
   *  name out loud, so withholding the string protects nothing. */
  name: z.string(),
  /** Presigned R2 GET, short TTL (packages/storage owns the number). Private object; the URL expires.
   *  ⚠ Same presign, same TTL as an owner clip — the RELEASE FILTER on the build corpus, not the TTL,
   *  is what makes this safe to serve anonymously (INV-5). */
  url: z.url(),
  contentType: z.string(),
  durationMs: z.number().int().nullish(),
  attribution: attributionList.optional(),
})
export type DrivePreviewClip = z.infer<typeof drivePreviewClip>

/** The proposed route to CONFIRM before generating: the SERVER-resolved endpoints (name + coords, for
 *  display) alongside the ids that produced them, plus the route preview.
 *  ⚠ Both halves are here on purpose. The resolved shape is what the rider sees; the ids are what the
 *  create call must re-send, and echoing them means the client never has to reconstruct an endpoint
 *  from a display string — the failure mode that made free-text endpoints tempting in the first place. */
export const driveProposal = z.object({
  start: resolvedEndpoint,
  end: resolvedEndpoint,
  startId: anchorId,
  endId: anchorId,
  /** The via ANCHOR IDS as sent; `viaResolved` carries the same midpoints for display. */
  via,
  viaResolved: z.array(resolvedEndpoint).max(MAX_ROUTE_VIA).optional(),
  polyline,
  distanceMeters: z.number().int(),
  durationSeconds: z.number().int(),
  routeSig: z.string(),
  /** Rough # of narratable places along the route (for the confirm screen). */
  estStopCount: z.number().int().nullish(),
  /** ONE clip from this route, or null — the rider's taste BEFORE the wall (D14/INV-5).
   *  ⚠ NULL IS A NORMAL OUTCOME, not an error: a 0-stop route has no clip (see `estStopCount`), and a
   *  presign failure degrades to null rather than 503ing an otherwise-valid free preview. The client
   *  must render the card without it.
   *  `.nullish()` so the two absences stay distinguishable: the handler ALWAYS emits the key, so `null`
   *  means "this server, no clip" while `undefined` means "an older server that has no such field". */
  previewClip: drivePreviewClip.nullish(),
})
export type DriveProposal = z.infer<typeof driveProposal>

/* -------------------------------------------------------------------------- */
/*  The PLANNER — planning a drive by talking to the Skipper (1.1)              */
/* -------------------------------------------------------------------------- */

/** One line of the conversation. `skipper` is the assistant side; the client keeps BOTH and re-sends
 *  the whole transcript each turn (D10 — the server is stateless and there is NO `conversations`
 *  table; a transcript is transient rider content that `purgeUserData` must never have to chase). */
export const plannerTurn = z.object({
  role: z.enum(['rider', 'skipper']),
  text: z.string(),
})
export type PlannerTurn = z.infer<typeof plannerTurn>

/** POST /drives/plan — one conversational turn. Anonymous-capable (D14/D15).
 *
 *  ⚠ THE BOUNDS THAT MATTER ARE NOT ALL HERE, on purpose. The per-message and total-character caps
 *  live in `apps/api/src/limits.ts` because they price MODEL TOKENS, and @skipper/shared cannot import
 *  apps/api — while apps/mobile DOES import this file, so a cap value written here would ship into the
 *  app bundle and, worse, become a second home to drift from. What stays here is the SHAPE (this is a
 *  transcript of role/text pairs); what the handler enforces is the SIZE. The `.max()` below is a
 *  parse-level sanity bound only — the true message cap is MAX_PLAN_MESSAGES, enforced server-side. */
export const drivePlanRequest = z.object({
  /** Oldest first, ending with the rider's newest line. */
  turns: z.array(plannerTurn).min(1).max(100),
  /** Which region's skipper is being talked to. The anchor roster is resolved SERVER-side from this —
   *  the client never sends the allowlist, and could not be trusted with it if it did (INV-1). */
  regionId: z.uuid(),
})
export type DrivePlanRequest = z.infer<typeof drivePlanRequest>

/** The route the planner proposes once the rider says yes — already translated out of the model's own
 *  tool vocabulary into the shape `POST /drives/propose` takes, so the client re-sends it verbatim and
 *  never reconstructs an endpoint from a display string. */
export const plannedRoute = z.object({
  start: anchorId,
  end: anchorId,
  via,
  /** Rough drive length the rider asked for, in minutes. Advisory — the route is materialized from the
   *  endpoints, and Google decides the real duration. */
  targetMinutes: z.number().int().positive().nullish(),
})
export type PlannedRoute = z.infer<typeof plannedRoute>

/** What a planner turn hands back.
 *
 *  ⚠ `say` IS THE ONLY THING THE RIDER EVER SEES. Everything else on this object is machine-read. The
 *  model's reasoning, its tool call, and any vendor error are never echoed (INV-13). */
export const drivePlanResponse = z.object({
  say: z.string(),
  /** Present ONLY when the rider confirmed and the planner drew it up. Its absence is the normal case,
   *  not a failure — most turns are conversation. */
  route: plannedRoute.nullish(),
  /** True when the skipper has bowed out (D12) and the client should stop offering a reply box. Kept
   *  separate from `route` because a conversation can end WITHOUT a drive, and that is a real outcome
   *  rather than an error. */
  done: z.boolean().default(false),
})
export type DrivePlanResponse = z.infer<typeof drivePlanResponse>

/** POST /drives — generate + persist the confirmed drive (consumes a credit; account-gated). */
export const createDriveRequest = z.object({
  start: anchorId,
  end: anchorId,
  via,
  /** Client-minted v4 UUID, STABLE across retries of one logical create. The server uses it AS the
   *  drive id, so a lost-ACK network retry hits the existing drive PK + the `drive:<id>` consume
   *  idempotency key and no-ops — exactly-once create + charge of a non-refundable credit. Optional:
   *  an older client omits it → the server mints the id → no cross-request dedupe (today's behavior). */
  idempotencyKey: z.uuid().optional(),
})
export type CreateDriveRequest = z.infer<typeof createDriveRequest>

/** One played clip in a drive: a place narration, with its presigned clip — the player's single clip
 *  shape. (V2: the placeless framing/asides were deleted; see docs/decisions/geometry-first-regions.md.) */
export const driveClip = z.object({
  /** ≥0, in route order. */
  seq: z.number().int(),
  form: driveClipForm,
  /** ⚠ Null for a FUSED cluster telling, by design — it is not about any one poi. Kept for
   *  compatibility with readers that key on it; `subjectId` below is the honest identity. */
  poiId: z.uuid().nullish(),
  /** The narration's SUBJECT — a poi id or a `poi_clusters` id, disambiguated by `subjectKind`.
   *  ⚠ This is what the offline store keys on (INV-6/INV-16): server-side subject identity always
   *  existed but was never projected, so the client could not tell a fused telling apart from a
   *  missing one. Do NOT key a store on `poiId` (null for fused) or on `seq` (a position in ONE
   *  drive — the same telling has a different seq in every drive that includes it). */
  subjectId: z.uuid().nullish(),
  subjectKind: z.enum(['poi', 'cluster']).nullish(),
  name: z.string().nullish(),
  /** Trigger point (the narration snapped to THIS route). */
  lat: z.number().nullish(),
  lng: z.number().nullish(),
  triggerRadiusM: z.number().int().nullish(),
  approachHeadingDeg: z.number().int().nullish(),
  /** Along-route time (s) — ordering + clock-anchored placement. */
  alongSec: z.number(),
  durationMs: z.number().int().nullish(),
  /** Presigned clip URL (short TTL); null for a silent rest beat. */
  url: z.url().nullish(),
  contentType: z.string().nullish(),
  attribution: attributionList.optional(),
  /** Offline-staleness token — the narration's `updatedAt`, propagated to flag a stale offline clip. */
  revisedAt: z.iso.datetime().nullish(),
})
export type DriveClip = z.infer<typeof driveClip>

/** POST /drives result / GET /drives/:id — the playable drive: route + ordered clips. */
export const driveManifest = z.object({
  /** Null for an unsaved/ephemeral manifest; set once persisted + owned. */
  driveId: z.uuid().nullable(),
  label: z.string(),
  polyline,
  distanceMeters: z.number().int().nullish(),
  durationSeconds: z.number().int().nullish(),
  clips: z.array(driveClip),
})
export type DriveManifest = z.infer<typeof driveManifest>

/** GET /drives — one card per saved drive (the caller's own; no geometry). */
export const driveSummary = z.object({
  driveId: z.uuid(),
  label: z.string(),
  startName: z.string().nullish(),
  endName: z.string().nullish(),
  distanceMeters: z.number().int().nullish(),
  durationSeconds: z.number().int().nullish(),
  clipCount: z.number().int(),
  createdAt: z.iso.datetime(),
})
export type DriveSummary = z.infer<typeof driveSummary>
/** Free-tier credit balance from the user-owned ledger — for a proactive "N free drives left" hint. */
export const driveCredits = z.object({
  /** Spendable balance right now (clamped ≥ 0). */
  remaining: z.number().int(),
  /** Lifetime credits granted — for "N of <cap> left" framing. */
  cap: z.number().int(),
})

export const driveList = z.object({
  drives: z.array(driveSummary),
  /** Credit balance. `null`/absent = an older server without the field (today's handler always emits
   *  it) — the client renders the "N free drives left" hint only when present, so an absent balance
   *  degrades to hidden rather than to "unlimited". There is no uncapped tier to mean: premium is
   *  bought as CREDITS, so the ledger is always the answer (docs/decisions/cut-tiers.md). */
  credits: driveCredits.nullish(),
})
export type DriveList = z.infer<typeof driveList>

/** POST /drives/:id/assets/sign — re-presigned clip URLs (offline refresh), keyed by seq. */
export const signedDriveAudio = z.object({ clips: z.array(signedStopClip) })
export type SignedDriveAudio = z.infer<typeof signedDriveAudio>
