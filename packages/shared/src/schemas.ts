import { z } from 'zod'
import { attributionSource, driveClipForm, jokeLevel, platform } from './enums'

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
export type RegionList = z.infer<typeof regionList>

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
export type AttributionList = z.infer<typeof attributionList>

/**
 * A public data-source credit for the app-wide "Sources & Licenses" screen (NOT per-clip —
 * that's `attribution`, frozen on the tour_stop). Served by GET /sources so a NEW fact
 * source (Wikidata, OSM, public-domain texts…) credits correctly with a backend deploy,
 * never an App Store release. Keep in step with the generator's actual sources.
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
export type SourcesResponse = z.infer<typeof sourcesResponse>

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
export type VersionResponse = z.infer<typeof versionResponse>

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
export type SignedClip = z.infer<typeof signedClip>

/** A presigned stop clip, keyed by the stop's seq. */
export const signedStopClip = signedClip.extend({ seq: z.number().int() })
export type SignedStopClip = z.infer<typeof signedStopClip>

/* -------------------------------------------------------------------------- */
/*  Free-roam (ALPHA surface — docs/ideas/free-roam-mode.md)                    */
/* -------------------------------------------------------------------------- */

/** GET /roam — one free-roam encounter pin: a place + its presigned roam clip. */
export const roamPin = z.object({
  poiId: z.uuid(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  durationMs: z.number().int(),
  /** Kind-aware proximity radius (m) — roam pins are un-snapped POI centroids, so areal
   *  places (a peak's summit, a lake's open water) need a wider trigger floor than a
   *  building. Optional for wire-compat; the server always sends it. */
  radiusM: z.number().int().optional(),
  url: z.url(),
  /** MIME type derived server-side from the R2 key (see signedClip.contentType). */
  contentType: z.string(),
})
export type RoamPin = z.infer<typeof roamPin>

/** GET /roam?lat=&lng=&radiusKm= — every roam-narratable place near a point. */
export const roamManifest = z.object({ pins: z.array(roamPin) })
export type RoamManifest = z.infer<typeof roamManifest>

/* -------------------------------------------------------------------------- */
/*  Create-a-Drive (V2) — a user-owned, on-demand A→B drive over reused narrations */
/* -------------------------------------------------------------------------- */

/** POST /drives/propose — resolve a free-text "where to" prompt + preview the route. The rider types
 *  ONE conversational line ("from the casino district out to Emerald Bay, scenic way"); the LLM pulls
 *  BOTH endpoints from it. A suggested-drive chip ("Emerald Bay loop") is just a canned prompt. Cheap;
 *  persists nothing, no credit. */
export const driveProposeRequest = z.object({
  regionId: z.uuid(),
  prompt: z.string().min(1).max(400),
})
export type DriveProposeRequest = z.infer<typeof driveProposeRequest>

const resolvedEndpoint = z.object({ name: z.string(), lat: z.number(), lng: z.number() })

/** The proposed route to CONFIRM before generating: resolved endpoints + a route preview. */
export const driveProposal = z.object({
  regionId: z.uuid(),
  start: resolvedEndpoint,
  end: resolvedEndpoint,
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
  regionId: z.uuid(),
  start: resolvedEndpoint,
  end: resolvedEndpoint,
  jokeLevel: jokeLevel.optional(),
})
export type CreateDriveRequest = z.infer<typeof createDriveRequest>

/** One played item in a drive: a place NARRATION or a placeless INTERLUDE, with its presigned clip.
 *  A superset of roamPin (a narration) + the framing beats — the player's single clip shape. */
export const driveClip = z.object({
  /** ≥0 for a real stop in route order; framing/interludes use negative sentinels the player maps. */
  seq: z.number().int(),
  form: driveClipForm,
  poiId: z.uuid().nullish(),
  name: z.string().nullish(),
  /** Trigger point (the narration snapped to THIS route). Null for clock-anchored interludes. */
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
  /** Offline-staleness token — see tourStopView.revisedAt. */
  revisedAt: z.iso.datetime().nullish(),
})
export type DriveClip = z.infer<typeof driveClip>

/** POST /drives result / GET /drives/:id — the playable drive: route + ordered clips. */
export const driveManifest = z.object({
  /** Null for an unsaved/ephemeral manifest; set once persisted + owned. */
  driveId: z.uuid().nullable(),
  label: z.string(),
  regionId: z.uuid().nullish(),
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
  regionId: z.uuid().nullish(),
  startName: z.string().nullish(),
  endName: z.string().nullish(),
  distanceMeters: z.number().int().nullish(),
  durationSeconds: z.number().int().nullish(),
  clipCount: z.number().int(),
  createdAt: z.iso.datetime(),
})
export type DriveSummary = z.infer<typeof driveSummary>
export const driveList = z.object({ drives: z.array(driveSummary) })
export type DriveList = z.infer<typeof driveList>

/** POST /drives/:id/assets/sign — re-presigned clip URLs (offline refresh), keyed by seq. */
export const signedDriveAudio = z.object({ clips: z.array(signedStopClip) })
export type SignedDriveAudio = z.infer<typeof signedDriveAudio>
