import { z } from 'zod'
import {
  attributionSource,
  durationBucket,
  interest,
  jokeLevel,
  persona,
  poiSource,
  stopType,
  tourStatus,
} from './enums'

/** A single [lng, lat] pair (GeoJSON axis order). */
export const coordinate = z.tuple([z.number(), z.number()])
export type Coordinate = z.infer<typeof coordinate>

/** A frozen, precomputed route geometry. */
export const polyline = z.array(coordinate)
export type Polyline = z.infer<typeof polyline>

/** A hand-curated route. The rails: never derived, never trimmed in v1. */
export const corridor = z.object({
  id: z.uuid(),
  region: z.string(),
  name: z.string(),
  slug: z.string(),
  polyline,
  summary: z.string().nullish(),
})
export type Corridor = z.infer<typeof corridor>

/** A real place. Deduped per (source, sourceId). */
export const poi = z.object({
  id: z.uuid(),
  source: poiSource,
  sourceId: z.string(),
  name: z.string(),
  kind: z.string().nullish(),
  lat: z.number(),
  lng: z.number(),
  summary: z.string().nullish(),
})
export type Poi = z.infer<typeof poi>

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
 * Macrostrat, etc.). Tolerant of a legacy single-object row (pre-array clips) by
 * normalizing it to a one-element array on read.
 */
export const attributionList = z
  .union([attribution, z.array(attribution)])
  .transform((a) => (Array.isArray(a) ? a : [a]))
export type AttributionList = z.infer<typeof attributionList>

/**
 * A public data-source credit for the app-wide "Sources & Licenses" screen (NOT per-clip —
 * that's `attribution`, frozen on poi_content). Served by GET /sources so a NEW fact source
 * (Wikidata, OSM, public-domain texts…) credits correctly with a backend deploy, never an
 * App Store release. Keep in step with the generator's actual sources + `attributionSource`.
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

/** Generated narration + audio. The cache: one per (poi, persona, voice, jokeLevel). */
export const poiContent = z.object({
  id: z.uuid(),
  poiId: z.uuid(),
  persona,
  voice: z.string(),
  jokeLevel,
  script: z.string(),
  audioUrl: z.string().nullish(),
  audioDurationMs: z.number().int().nullish(),
  reviewed: z.boolean(),
  attribution: attributionList.nullish(),
})
export type PoiContent = z.infer<typeof poiContent>

/** An ordered stop pointing at cached content. */
export const tourStop = z.object({
  id: z.uuid(),
  tourId: z.uuid(),
  seq: z.number().int(),
  poiId: z.uuid(),
  poiContentId: z.uuid().nullish(),
  stopType,
  /** Floor, not the rule — the player uses speed-adaptive lead time. */
  triggerRadiusM: z.number().int(),
  /** Heading gate only applies above ~5 mph; null = ignore heading. */
  approachHeadingDeg: z.number().int().nullish(),
})
export type TourStop = z.infer<typeof tourStop>

/** An assembled tour: a curated corridor + ordered stops at a fixed duration. */
export const tour = z.object({
  id: z.uuid(),
  corridorId: z.uuid(),
  durationBucket,
  interests: z.array(interest),
  persona,
  jokeLevel,
  status: tourStatus,
  /** hash(corridorId + duration + interests + persona + jokeLevel). Nullable in v1. */
  routeSig: z.string().nullish(),
})
export type Tour = z.infer<typeof tour>

/** The "assemble a tour" request. Flex = duration + interests + persona/jokeLevel. */
export const tourRequest = z.object({
  corridorId: z.uuid(),
  durationBucket,
  interests: z.array(interest).default([]),
  persona: persona.default('skipper'),
  jokeLevel: jokeLevel.default('dadpocalypse'),
})
export type TourRequest = z.infer<typeof tourRequest>

/* -------------------------------------------------------------------------- */
/*  API response DTOs (apps/api ⇄ clients). Lightweight, no internal columns.   */
/* -------------------------------------------------------------------------- */

/** GET /corridors — one row (no polyline; that comes with a tour). */
export const corridorListItem = z.object({
  id: z.uuid(),
  slug: z.string(),
  region: z.string(),
  name: z.string(),
  summary: z.string().nullish(),
  distanceMeters: z.number().int().nullish(),
  durationSeconds: z.number().int().nullish(),
})
export type CorridorListItem = z.infer<typeof corridorListItem>
export const corridorList = z.object({ corridors: z.array(corridorListItem) })
export type CorridorList = z.infer<typeof corridorList>

/** GET /corridors/:id/tours — ready tours for a corridor (catalog metadata; play is gated). */
export const tourListItem = z.object({
  id: z.uuid(),
  durationBucket,
  persona,
  jokeLevel,
  isPreview: z.boolean(),
  /** A glanceable hook of the tour's marquee places (story/scenic anchors), e.g.
   *  "Emerald Bay & Vikingsholm" — so a tour card has an identity without a tap.
   *  Nullish: pre-teaser clients/rows degrade to no hook. */
  teaser: z.string().nullish(),
})
export type TourListItem = z.infer<typeof tourListItem>
export const corridorTours = z.object({ tours: z.array(tourListItem) })
export type CorridorTours = z.infer<typeof corridorTours>

/** A stop as the player needs it: location + trigger + whether it has audio. */
export const tourStopView = z.object({
  seq: z.number().int(),
  stopType,
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  triggerRadiusM: z.number().int(),
  approachHeadingDeg: z.number().int().nullish(),
  poiContentId: z.uuid().nullish(),
  audioDurationMs: z.number().int().nullish(),
})
export type TourStopView = z.infer<typeof tourStopView>

/**
 * The narrating host's display identity, resolved SERVER-SIDE from the tour's `persona`.
 * The app RENDERS this; it must never bundle host identity itself, so a new region/host
 * ships with a backend deploy, never an App Store release. The GENERATION persona (system
 * prompt, kit, voice) stays in @skipper/generator and never reaches the client. Art is a
 * URL (R2), never a bundled asset — same reason.
 */
export const hostIdentity = z.object({
  /** Display name, e.g. "Skipper" — the lock-screen Now Playing artist + meet-your-host title. */
  name: z.string(),
  /** One-liner for the meet-your-host card. */
  tagline: z.string().nullish(),
  /** A few sentences of in-voice backstory (DELIVERY, never facts). */
  backstory: z.string().nullish(),
  /** R2 URL for the host portrait/badge. Null until art exists — never a bundled asset. */
  portraitUrl: z.url().nullish(),
  /** R2 URL for a short "hear the host" sample. Null until one exists. */
  voiceSampleUrl: z.url().nullish(),
})
export type HostIdentity = z.infer<typeof hostIdentity>

/** GET /tours/:id — the tour, its corridor polyline, the narrating host, and ordered stops. */
export const tourDetail = z.object({
  tour: z.object({
    id: z.uuid(),
    corridorId: z.uuid(),
    durationBucket,
    persona,
    jokeLevel,
    status: tourStatus,
    isPreview: z.boolean(),
  }),
  corridor: z.object({ name: z.string(), region: z.string(), polyline }).nullish(),
  host: hostIdentity,
  stops: z.array(tourStopView),
})
export type TourDetail = z.infer<typeof tourDetail>

/** POST /tours/:id/assets/sign — presigned audio URLs by stop. */
export const signedClip = z.object({
  seq: z.number().int(),
  url: z.url(),
  /** The clip's MIME type (e.g. "audio/mpeg"), derived server-side from the R2 key's
   *  extension. The format is DATA, not an assumption: the player can stay format-agnostic
   *  and the offline download (Phase 3) writes the right extension instead of hardcoding
   *  `.wav` or parsing the presigned URL. Robust to mixed mp3/legacy-wav clips. */
  contentType: z.string(),
  durationMs: z.number().int().nullish(),
})
export const signedAudio = z.object({ urls: z.array(signedClip) })
export type SignedAudio = z.infer<typeof signedAudio>
