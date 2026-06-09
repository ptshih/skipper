import {
  pgTable,
  pgEnum,
  uuid,
  text,
  jsonb,
  doublePrecision,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { user } from './auth-schema'

/* -------------------------------------------------------------------------- */
/*  Shared JSON shapes (compile-time only; jsonb does not enforce these)        */
/* -------------------------------------------------------------------------- */

/** Frozen, precomputed route geometry as [lng, lat] coordinate pairs. */
export type Polyline = [number, number][]

/** Free-form structured facts about a place. */
export type PoiFacts = Record<string, unknown>

/**
 * Attribution snapshot frozen at narration time so credit stays correct even if
 * the source POI row is later edited (e.g. Wikipedia CC BY-SA requirements).
 *
 * Lives on the `tour_stops` row now (narration is tour-owned; there is no
 * `poi_content`). `source` is the ATTRIBUTION source, a SUPERSET of `poiSourceEnum`
 * (a POI's discovery source): a clip can blend a Wikipedia POI with enrichment that
 * owns no `pois` row — coordinate-keyed Macrostrat geology, or QID-keyed Wikidata
 * structured facts. `tour_stops.attribution` is therefore an ARRAY — one entry per
 * source the clip drew on — so a multi-source clip credits each (Wikipedia CC BY-SA +
 * Macrostrat CC BY + Wikidata CC0, etc.). Keep this union in lockstep with the Zod
 * `attributionSource` enum in @skipper/shared.
 */
export type AttributionSnapshot = {
  source: 'wikipedia' | 'google_places' | 'macrostrat' | 'wikidata'
  sourceId: string
  title?: string
  url?: string
  license?: string // e.g. "CC BY-SA 4.0", "CC BY 4.0", "CC0"
  retrievedAt?: string // ISO-8601
}

/** Generic, non-volatile break-stop metadata (no baked live data). */
export type StopMeta = Record<string, unknown>

/* -------------------------------------------------------------------------- */
/*  Enums — keep these in lockstep with the Zod enums in @skipper/shared        */
/* -------------------------------------------------------------------------- */

// Discovery sources for a `pois` row. `wikidata` joined when discovery flipped to the
// Wikidata spine: a scenic pin (a named bay/beach with no Wikipedia article) is discovered
// AND owns its `pois` row from Wikidata (CC0 name), so wikidata is now a discovery source,
// not just an enrichment-attribution one. (Macrostrat stays attribution-only — it never owns
// a `pois` row — so the AttributionSnapshot union remains a superset of this enum by one.)
export const poiSourceEnum = pgEnum('poi_source', ['wikipedia', 'google_places', 'wikidata'])

// NO `joke_level` pgEnum: the Dad-Joke-O-Meter notch is a generation-time INPUT, never a
// stored column (M1 = dadpocalypse-only — see `tours`). The notch VOCABULARY lives as the
// `jokeLevel` Zod enum in @skipper/shared; re-add a pgEnum here only when a notch column lands
// on the narration (tour_stops) at M3.

export const tourStatusEnum = pgEnum('tour_status', ['draft', 'generating', 'ready', 'failed'])

export const stopTypeEnum = pgEnum('stop_type', ['story', 'scenic', 'break'])

// A drive's FRAME pieces (the intro/outro brackets — see tour_brackets). Kept as a
// pgEnum (typo-safe) and mirrored by the Zod `bracketKind` enum in @skipper/shared.
export const bracketKindEnum = pgEnum('bracket_kind', ['intro', 'outro'])

/* -------------------------------------------------------------------------- */
/*  regions — minimal keying TABLE (not a pgEnum). Adding a region = an INSERT.  */
/* -------------------------------------------------------------------------- */

// Host-presentation columns (portrait/voice-sample URLs, the /regions feed) are
// deferred to the 2nd region; for now a region is just its key + spoken name.
export const regions = pgTable(
  'regions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull(), // 'lake-tahoe' (the key)
    displayName: text('display_name').notNull(), // 'Lake Tahoe' (spoken + shown in the picker)
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('regions_slug_uq').on(t.slug)],
)

/* -------------------------------------------------------------------------- */
/*  pois — a shared PLACE (facts/coords, deduped per external source)           */
/* -------------------------------------------------------------------------- */

// The ONLY cache in the model: a place's facts are SHARED by every tour that visits
// it. Narration is NOT here — it is tour-owned (see tour_stops).
export const pois = pgTable(
  'pois',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Attribution: which external source and its native id.
    source: poiSourceEnum('source').notNull(),
    sourceId: text('source_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind'),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    summary: text('summary'),
    facts: jsonb('facts').$type<PoiFacts>(),
    // FACTS freshness (COLUMNS ship now; the re-fetch/TTL MECHANISM is DEFERRED):
    //   facts_fetched_at = TTL clock; facts_hash = change detector (changes only on
    //   a material change). A tour_stop is fact-stale iff its facts_hash IS DISTINCT
    //   FROM this row's facts_hash (joined on poiId), for stops whose facts_hash is set.
    factsHash: text('facts_hash'),
    factsFetchedAt: timestamp('facts_fetched_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One row per (source, source_id) — primary dedup invariant.
    uniqueIndex('pois_source_source_id_uq').on(t.source, t.sourceId),
    index('pois_kind_idx').on(t.kind),
  ],
)

/* -------------------------------------------------------------------------- */
/*  tours — the whole self-contained DRIVE (route + the generation that fills it)*/
/* -------------------------------------------------------------------------- */

// `corridors` is MERGED IN: a tour carries its OWN polyline, distance/duration,
// headline, start/end anchors, and region. One tour = one catalog card; there is no
// direction/family and no duration/interest variant matrix (those are deferred axes).
export const tours = pgTable(
  'tours',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    regionId: uuid('region_id')
      .notNull()
      .references(() => regions.id, { onDelete: 'restrict' }),
    slug: text('slug').notNull(),
    // Marquee POI ("Emerald Bay"); display name = "[headline], [start] to [end]".
    headline: text('headline').notNull(),
    // Route — absorbed from the old `corridors` table; a frozen rail, authored once
    // via the Routes API and never re-derived.
    polyline: jsonb('polyline').$type<Polyline>().notNull(),
    distanceMeters: integer('distance_meters'),
    durationSeconds: integer('duration_seconds'),
    summary: text('summary'),
    // End-anchors {name, lat, lng}: naming, intro/outro anchoring, the GPS-start pin,
    // and the proximity recommender.
    startAnchorName: text('start_anchor_name').notNull(),
    startAnchorLat: doublePrecision('start_anchor_lat').notNull(),
    startAnchorLng: doublePrecision('start_anchor_lng').notNull(),
    endAnchorName: text('end_anchor_name').notNull(),
    endAnchorLat: doublePrecision('end_anchor_lat').notNull(),
    endAnchorLng: doublePrecision('end_anchor_lng').notNull(),
    // NOTE: there is NO joke-notch column. The Dad-Joke-O-Meter notch is a generation-time
    // INPUT (baked into the narration audio), not stored tour STATE — M1 is dadpocalypse-only,
    // so a stored notch would carry no information. When the 1-N notch ships (M3) it lands on
    // the NARRATION (tour_stops), never here: a notch describes a telling, not a route.
    status: tourStatusEnum('status').notNull().default('draft'),
    // Optional tour-dedup hash — M4 forward-compat. Do NOT add a (unique) index until
    // M4 actually queries/dedupes on it.
    routeSig: text('route_sig'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('tours_slug_uq').on(t.slug),
    index('tours_region_idx').on(t.regionId),
    index('tours_status_idx').on(t.status),
  ],
)

/* -------------------------------------------------------------------------- */
/*  tour_stops — ordered stops that OWN their narration (per tour)              */
/* -------------------------------------------------------------------------- */

export const tourStops = pgTable(
  'tour_stops',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tourId: uuid('tour_id')
      .notNull()
      .references(() => tours.id, { onDelete: 'cascade' }),
    // Ordering within the tour.
    seq: integer('seq').notNull(),
    // The shared PLACE this stop narrates. Stays NOT NULL — intro/outro are NOT stops;
    // they live in their own `tour_brackets` frame table, so this FK never relaxes.
    poiId: uuid('poi_id')
      .notNull()
      .references(() => pois.id, { onDelete: 'restrict' }),
    stopType: stopTypeEnum('stop_type').notNull(),
    // ── Tour-OWNED narration (was poi_content; NEVER shared across tours) ──
    script: text('script'),
    // R2 object KEY, TOUR-scoped: clips/<tourId>/<stopId>.<ext>. Private; the API
    // presigns it after the freemium tier check.
    audioUrl: text('audio_url'),
    audioDurationMs: integer('audio_duration_ms'),
    // Frozen attribution — an ARRAY, one entry per source this clip drew on (Wikipedia
    // CC BY-SA + Macrostrat CC BY + Wikidata CC0, etc.). Nullable, but the generator
    // MUST populate it for every wikipedia-sourced clip (CC BY-SA is legal, not optional).
    attribution: jsonb('attribution').$type<AttributionSnapshot[]>(),
    reviewed: boolean('reviewed').default(false).notNull(),
    // The pois.facts_hash this stop's narration was generated from. NULL for stops that
    // don't ground on facts (scenic/break) → never fact-stale. Stale iff facts_hash IS
    // DISTINCT FROM pois.facts_hash (joined on poiId).
    factsHash: text('facts_hash'),
    // ── Trigger geometry ──
    triggerRadiusM: integer('trigger_radius_m').notNull().default(120),
    // TRIGGER POINT: the stop's POI snapped onto the route (nearest point on the frozen
    // polyline), plus the route's heading of travel at that point. Computed once at
    // generation time so the in-car player triggers as the vehicle passes the POI's
    // point ON THE ROAD and can run a heading gate without re-snapping every stop.
    triggerLat: doublePrecision('trigger_lat'),
    triggerLng: doublePrecision('trigger_lng'),
    approachHeadingDeg: integer('approach_heading_deg'),
    // Generic break-stop fields only (no baked volatile data).
    meta: jsonb('meta').$type<StopMeta>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Stable ordering: one stop per position within a tour.
    uniqueIndex('tour_stops_tour_seq_uq').on(t.tourId, t.seq),
    index('tour_stops_poi_idx').on(t.poiId),
  ],
)

/* -------------------------------------------------------------------------- */
/*  tour_brackets — the drive's FRAME (intro/outro). NOT stops.                 */
/* -------------------------------------------------------------------------- */

// Placeless by construction, fired by drive LIFECYCLE not geofence, so they get their
// own homogeneous table (Option B). Keeps tour_stops strict (poiId NOT NULL) and the
// geofence engine pure. No poiId, no trigger coords, no attribution — brackets are
// about the DRIVE and carry no place-facts.
export const tourBrackets = pgTable(
  'tour_brackets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tourId: uuid('tour_id')
      .notNull()
      .references(() => tours.id, { onDelete: 'cascade' }),
    kind: bracketKindEnum('kind').notNull(), // 'intro' | 'outro'
    script: text('script'),
    audioUrl: text('audio_url'), // clips/<tourId>/intro.mp3, clips/<tourId>/outro.mp3
    audioDurationMs: integer('audio_duration_ms'),
    reviewed: boolean('reviewed').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  // Exactly one intro + one outro per tour.
  (t) => [uniqueIndex('tour_brackets_tour_kind_uq').on(t.tourId, t.kind)],
)

/* -------------------------------------------------------------------------- */
/*  saved_tours — a free account's saved tours (M2 auth)                        */
/* -------------------------------------------------------------------------- */

// Tours stay anonymous/shareable: ownership is NOT a column on `tours`. A signed-in
// user saves a tour through this join (userId -> Better Auth user.id, which is text).
export const savedTours = pgTable(
  'saved_tours',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    tourId: uuid('tour_id')
      .notNull()
      .references(() => tours.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('saved_tours_user_tour_uq').on(t.userId, t.tourId),
    index('saved_tours_user_idx').on(t.userId),
  ],
)

/* -------------------------------------------------------------------------- */
/*  Relations                                                                  */
/* -------------------------------------------------------------------------- */

export const regionsRelations = relations(regions, ({ many }) => ({
  tours: many(tours),
}))

export const poisRelations = relations(pois, ({ many }) => ({
  stops: many(tourStops),
}))

export const toursRelations = relations(tours, ({ one, many }) => ({
  region: one(regions, {
    fields: [tours.regionId],
    references: [regions.id],
  }),
  stops: many(tourStops),
  brackets: many(tourBrackets),
}))

export const tourStopsRelations = relations(tourStops, ({ one }) => ({
  tour: one(tours, {
    fields: [tourStops.tourId],
    references: [tours.id],
  }),
  poi: one(pois, {
    fields: [tourStops.poiId],
    references: [pois.id],
  }),
}))

export const tourBracketsRelations = relations(tourBrackets, ({ one }) => ({
  tour: one(tours, {
    fields: [tourBrackets.tourId],
    references: [tours.id],
  }),
}))

/* -------------------------------------------------------------------------- */
/*  Inferred row types (import via the "@skipper/db/schema" subpath, aliased)   */
/* -------------------------------------------------------------------------- */

export type Region = typeof regions.$inferSelect
export type NewRegion = typeof regions.$inferInsert
export type Poi = typeof pois.$inferSelect
export type NewPoi = typeof pois.$inferInsert
export type Tour = typeof tours.$inferSelect
export type NewTour = typeof tours.$inferInsert
export type TourStop = typeof tourStops.$inferSelect
export type NewTourStop = typeof tourStops.$inferInsert
export type TourBracket = typeof tourBrackets.$inferSelect
export type NewTourBracket = typeof tourBrackets.$inferInsert
export type SavedTour = typeof savedTours.$inferSelect
export type NewSavedTour = typeof savedTours.$inferInsert
