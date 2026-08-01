import { z } from 'zod'
import { attributionSource, driveClipForm, platform } from './enums'

/** A single [lng, lat] pair (GeoJSON axis order). */
export const coordinate = z.tuple([z.number(), z.number()])
export type Coordinate = z.infer<typeof coordinate>

/** A frozen, precomputed route geometry. */
export const polyline = z.array(coordinate)
export type Polyline = z.infer<typeof polyline>

/** A region — the minimal keying entity (a tour/drive belongs to one). */
export const region = z.object({
  id: z.uuid(),
  slug: z.string(),
  displayName: z.string(),
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
 */
export const attributionList = z.array(attribution)
/** The frozen-attribution array as a TYPE. Exported because API handlers that serve attribution
 *  need to annotate it, and the only previous way to name it was to reach through a DTO that
 *  happened to carry one — which made an unrelated DTO's
 *  removal a compile error in a handler that has nothing to do with it. */
export type AttributionList = z.infer<typeof attributionList>

/**
 * A public data-source credit for the app-wide "Sources & Licenses" screen (NOT per-clip —
 * that's `attribution`, frozen on the `narrations` row). Served by GET /sources so a NEW fact
 * source (Wikidata, OSM, public-domain texts…) credits correctly with a backend deploy,
 * never an App Store release. Keep in step with the studio pipeline's actual sources.
 */
export const dataSource = z.object({
  /** Display name of the source, e.g. "Wikipedia". */
  name: z.string(),
  /** What this source contributes to a drive — plain + accurate, no volatile claims. */
  use: z.string(),
  /** Short license code (shown as a tappable badge), or null when not a public-content license. */
  license: z.string().nullable(),
  /** Canonical license deed — satisfies CC's "provide a link to the license". */
  licenseUrl: z.url().optional(),
  /** The source's own home, for credit. */
  sourceUrl: z.url(),
  /** One-line plain-language gloss of the obligation (attribution, share-alike, …). */
  note: z.string().optional(),
})
export type DataSource = z.infer<typeof dataSource>

/** GET /sources — the app-wide data-source/license catalog (anonymous; public legal info). */
export const sourcesResponse = z.object({ sources: z.array(dataSource) })

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
export const regionAnchorList = z.object({ anchors: z.array(regionAnchor) })

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

/** Ordered intermediate waypoints between start and end — the route is materialized as
 *  [start, ...via, end]. A LOOP is `end === start` with one `via` midpoint (a turnaround), so a
 *  round trip is a real out-and-back (start==end alone is a degenerate zero-distance route). Capped
 *  to bound the single Routes call.
 *  ⚠ `via` GOES THROUGH THE ALLOWLIST TOO. It was `z.array(resolvedEndpoint)` while start/end were
 *  being hardened, which satisfied "reject a non-anchor ENDPOINT" exactly while still shipping 8
 *  arbitrary billable coordinates. Guarding both ends of a route and leaving the middle open is not a
 *  partial guarantee — it is none. */
const via = z.array(anchorId).max(8).optional()

/** POST /drives/propose — preview the route for a picked START→END (+ optional via midpoints) before
 *  spending a credit. The endpoints were chosen from the region's anchors (GET /drives/anchors), so we
 *  just materialize the route + count stories. Persists nothing, no credit — the confirm interstitial. */
export const driveProposeRequest = z.object({
  start: anchorId,
  end: anchorId,
  via,
})
export type DriveProposeRequest = z.infer<typeof driveProposeRequest>

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
  viaResolved: z.array(resolvedEndpoint).max(8).optional(),
  polyline,
  distanceMeters: z.number().int(),
  durationSeconds: z.number().int(),
  routeSig: z.string(),
  /** Rough # of narratable places along the route (for the confirm screen). */
  estStopCount: z.number().int().nullish(),
})
export type DriveProposal = z.infer<typeof driveProposal>

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
  /** Credit balance, or `null`/absent = uncapped (paid) OR an older server without the field — the
   *  client renders the "N free drives left" hint only when present (nullish = degrade to hidden). */
  credits: driveCredits.nullish(),
})
export type DriveList = z.infer<typeof driveList>

/** POST /drives/:id/assets/sign — re-presigned clip URLs (offline refresh), keyed by seq. */
export const signedDriveAudio = z.object({ clips: z.array(signedStopClip) })
export type SignedDriveAudio = z.infer<typeof signedDriveAudio>
