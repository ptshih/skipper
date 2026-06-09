import { z } from 'zod'
import { attributionSource, bracketKind, jokeLevel, poiSource, stopType, tourStatus } from './enums'

/** A single [lng, lat] pair (GeoJSON axis order). */
export const coordinate = z.tuple([z.number(), z.number()])
export type Coordinate = z.infer<typeof coordinate>

/** A frozen, precomputed route geometry. */
export const polyline = z.array(coordinate)
export type Polyline = z.infer<typeof polyline>

/** A region — the minimal keying entity (a tour belongs to one). */
export const region = z.object({
  id: z.uuid(),
  slug: z.string(),
  displayName: z.string(),
})
export type Region = z.infer<typeof region>

/** A real place. Deduped per (source, sourceId). FACTS are shared; narration is not. */
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
 * Macrostrat, etc.). Tolerant of a legacy single-object row by normalizing it to a
 * one-element array on read.
 */
export const attributionList = z
  .union([attribution, z.array(attribution)])
  .transform((a) => (Array.isArray(a) ? a : [a]))
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
 * An ordered stop that OWNS its narration (per tour). The R2 audio KEY is internal and
 * never exposed; the player learns audio availability from `audioDurationMs` and gets a
 * playable URL from the /sign endpoint.
 */
export const tourStop = z.object({
  id: z.uuid(),
  tourId: z.uuid(),
  seq: z.number().int(),
  poiId: z.uuid(),
  stopType,
  script: z.string().nullish(),
  audioDurationMs: z.number().int().nullish(),
  attribution: attributionList.nullish(),
  /** Floor, not the rule — the player uses speed-adaptive lead time. */
  triggerRadiusM: z.number().int(),
  /** Heading gate only applies above ~5 mph; null = ignore heading. */
  approachHeadingDeg: z.number().int().nullish(),
})
export type TourStop = z.infer<typeof tourStop>

/** A drive's FRAME piece (intro/outro). Placeless; fired by drive lifecycle, not geofence. */
export const tourBracket = z.object({
  id: z.uuid(),
  tourId: z.uuid(),
  kind: bracketKind,
  script: z.string().nullish(),
  audioDurationMs: z.number().int().nullish(),
})
export type TourBracket = z.infer<typeof tourBracket>

/** A tour: the whole self-contained drive (route + endpoints + ordered stops + brackets). */
export const tour = z.object({
  id: z.uuid(),
  regionId: z.uuid(),
  slug: z.string(),
  headline: z.string(),
  polyline,
  distanceMeters: z.number().int().nullish(),
  durationSeconds: z.number().int().nullish(),
  summary: z.string().nullish(),
  startAnchorName: z.string(),
  startAnchorLat: z.number(),
  startAnchorLng: z.number(),
  endAnchorName: z.string(),
  endAnchorLat: z.number(),
  endAnchorLng: z.number(),
  // No jokeLevel: the notch is a generation INPUT, not stored tour state (see @skipper/shared
  // enums `jokeLevel`). `tourRequest` below carries it as the generation knob.
  status: tourStatus,
  routeSig: z.string().nullish(),
  isPreview: z.boolean(),
})
export type Tour = z.infer<typeof tour>

/** The "generate a tour" request. A tour is defined by its route slug; M1 = dadpocalypse. */
export const tourRequest = z.object({
  slug: z.string(),
  jokeLevel: jokeLevel.default('dadpocalypse'),
})
export type TourRequest = z.infer<typeof tourRequest>

/* -------------------------------------------------------------------------- */
/*  API response DTOs (apps/api ⇄ clients). Lightweight, no internal columns.   */
/* -------------------------------------------------------------------------- */

/**
 * GET /tours — one card per tour (the whole catalog; no polyline). A tour is the whole
 * self-contained drive now (corridors merged in), so this replaces the old
 * /corridors + /corridors/:id/tours pair. Carries the region (for the location filter)
 * and the endpoints (for the card title), but never the route geometry.
 */
export const tourListItem = z.object({
  id: z.uuid(),
  slug: z.string(),
  headline: z.string(),
  regionSlug: z.string(),
  regionName: z.string(),
  startAnchorName: z.string(),
  endAnchorName: z.string(),
  summary: z.string().nullish(),
  distanceMeters: z.number().int().nullish(),
  durationSeconds: z.number().int().nullish(),
  isPreview: z.boolean(),
  /** A glanceable hook of the tour's marquee places (story/scenic anchors), e.g.
   *  "Emerald Bay & Vikingsholm" — so a tour card has an identity without a tap.
   *  Nullish: pre-teaser rows degrade to no hook. */
  teaser: z.string().nullish(),
})
export type TourListItem = z.infer<typeof tourListItem>
export const tourList = z.object({ tours: z.array(tourListItem) })
export type TourList = z.infer<typeof tourList>

/** A stop as the player needs it: location + trigger + whether it has audio. */
export const tourStopView = z.object({
  seq: z.number().int(),
  stopType,
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  triggerRadiusM: z.number().int(),
  approachHeadingDeg: z.number().int().nullish(),
  audioDurationMs: z.number().int().nullish(),
})
export type TourStopView = z.infer<typeof tourStopView>

/** A bracket as the player needs it: which frame + how long. Audio comes from /sign. */
export const tourBracketView = z.object({
  kind: bracketKind,
  audioDurationMs: z.number().int().nullish(),
})
export type TourBracketView = z.infer<typeof tourBracketView>

/**
 * The narrating host's display identity, resolved SERVER-SIDE from the tour's region.
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

/** GET /tours/:id — the drive: route + endpoints, the narrating host, intro/outro, stops. */
export const tourDetail = z.object({
  tour: z.object({
    id: z.uuid(),
    slug: z.string(),
    headline: z.string(),
    regionId: z.uuid(),
    status: tourStatus,
    isPreview: z.boolean(),
    polyline,
    distanceMeters: z.number().int().nullish(),
    durationSeconds: z.number().int().nullish(),
    summary: z.string().nullish(),
    startAnchor: z.object({ name: z.string(), lat: z.number(), lng: z.number() }),
    endAnchor: z.object({ name: z.string(), lat: z.number(), lng: z.number() }),
  }),
  region: z.object({ slug: z.string(), displayName: z.string() }),
  host: hostIdentity,
  intro: tourBracketView.nullish(),
  outro: tourBracketView.nullish(),
  stops: z.array(tourStopView),
})
export type TourDetail = z.infer<typeof tourDetail>

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

/**
 * POST /tours/:id/assets/sign — presigned audio URLs for the drive. `stops` are keyed
 * by seq; `intro`/`outro` are the bracket clips (null until a tour has them — the player
 * may ignore them until bracket playback lands).
 */
export const signedAudio = z.object({
  stops: z.array(signedStopClip),
  intro: signedClip.nullish(),
  outro: signedClip.nullish(),
})
export type SignedAudio = z.infer<typeof signedAudio>
