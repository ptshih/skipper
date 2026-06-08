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
 * Attribution snapshot frozen at generation time so credit stays correct even
 * if the source POI row is later edited (e.g. Wikipedia CC BY-SA requirements).
 *
 * `source` is the ATTRIBUTION source, a SUPERSET of `poiSourceEnum` (a POI's
 * discovery source): a clip can blend a Wikipedia POI with coordinate-keyed
 * enrichment that owns no `pois` row (Macrostrat geology). poi_content.attribution
 * is therefore an ARRAY — one entry per source the clip drew on — so a multi-source
 * clip credits each (Wikipedia CC BY-SA + Macrostrat CC BY, etc.). Keep this union
 * in lockstep with the Zod `attributionSource` enum in @skipper/shared.
 */
export type AttributionSnapshot = {
  source: 'wikipedia' | 'google_places' | 'macrostrat'
  sourceId: string
  title?: string
  url?: string
  license?: string // e.g. "CC BY-SA 4.0", "CC BY 4.0"
  retrievedAt?: string // ISO-8601
}

/** Generic, non-volatile break-stop metadata (no baked live data). */
export type StopMeta = Record<string, unknown>

/* -------------------------------------------------------------------------- */
/*  Enums — keep these in lockstep with the Zod enums in @skipper/shared        */
/* -------------------------------------------------------------------------- */

export const poiSourceEnum = pgEnum('poi_source', ['wikipedia', 'google_places'])

export const jokeLevelEnum = pgEnum('joke_level', ['off', 'mild', 'dad', 'dadpocalypse'])

export const tourStatusEnum = pgEnum('tour_status', ['draft', 'generating', 'ready', 'failed'])

export const stopTypeEnum = pgEnum('stop_type', ['story', 'scenic', 'break'])

// persona + duration_bucket are poi_content / tour cache-key dimensions, so the
// DB enforces them (mirrors the Zod enums) — a typo can't fragment the dedup key.
export const personaEnum = pgEnum('persona', ['skipper'])

export const durationBucketEnum = pgEnum('duration_bucket', ['short', 'standard', 'long'])

/* -------------------------------------------------------------------------- */
/*  corridors — hand-curated routes                                            */
/* -------------------------------------------------------------------------- */

export const corridors = pgTable(
  'corridors',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    region: text('region').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    // Frozen, precomputed route geometry.
    polyline: jsonb('polyline').$type<Polyline>().notNull(),
    // Frozen Routes-API totals for the route. Nullable (older rows predate these);
    // the generator paces stops by drive TIME and uses durationSeconds when set,
    // falling back to a speed estimate when null.
    distanceMeters: integer('distance_meters'),
    durationSeconds: integer('duration_seconds'),
    summary: text('summary'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('corridors_slug_uq').on(t.slug)],
)

/* -------------------------------------------------------------------------- */
/*  pois — a place (deduped per external source)                               */
/* -------------------------------------------------------------------------- */

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
/*  poi_content — generated narration + audio cache                            */
/* -------------------------------------------------------------------------- */

export const poiContent = pgTable(
  'poi_content',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    poiId: uuid('poi_id')
      .notNull()
      .references(() => pois.id, { onDelete: 'cascade' }),
    persona: personaEnum('persona').notNull(),
    voice: text('voice').notNull(),
    jokeLevel: jokeLevelEnum('joke_level').notNull(),
    // Generated narration script.
    script: text('script').notNull(),
    // R2 object URL for the rendered audio (null until synthesized).
    audioUrl: text('audio_url'),
    audioDurationMs: integer('audio_duration_ms'),
    // Human spot-check flag.
    reviewed: boolean('reviewed').default(false).notNull(),
    // Frozen attribution at generation time — an ARRAY, one entry per source the clip
    // drew on (Wikipedia + Macrostrat geology, etc.). NULLABLE here, but the M1
    // generator MUST populate it for every wikipedia-sourced clip (CC BY-SA is legal,
    // not optional) — enforced in the generation checklist + human-review gate. (jsonb,
    // so the object→array widening needs no SQL migration; legacy single-object rows,
    // if any, are read tolerantly via the Zod union in @skipper/shared.)
    attribution: jsonb('attribution').$type<AttributionSnapshot[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Cache key: one row per (poi, persona, voice, joke_level).
    uniqueIndex('poi_content_key_uq').on(t.poiId, t.persona, t.voice, t.jokeLevel),
  ],
)

/* -------------------------------------------------------------------------- */
/*  tours — an assembled tour                                                  */
/* -------------------------------------------------------------------------- */

export const tours = pgTable(
  'tours',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    corridorId: uuid('corridor_id')
      .notNull()
      .references(() => corridors.id, { onDelete: 'restrict' }),
    durationBucket: durationBucketEnum('duration_bucket').notNull(),
    // Selected interest tags.
    interests: text('interests').array().notNull().default([]),
    persona: personaEnum('persona').notNull(),
    jokeLevel: jokeLevelEnum('joke_level').notNull(),
    status: tourStatusEnum('status').notNull().default('draft'),
    // Route signature hash — M4 cache/dedup forward-compat. Nullable in v1; do
    // NOT add a (unique) index until M4 actually queries/dedupes on it.
    routeSig: text('route_sig'),
    // Marks the single anonymous-playable sample tour (freemium "sample, then sign
    // up"). NOT ownership — tours stay anonymous/shareable; this just flags which
    // tour a guest may fetch/play without an account.
    isPreview: boolean('is_preview').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('tours_corridor_idx').on(t.corridorId), index('tours_status_idx').on(t.status)],
)

/* -------------------------------------------------------------------------- */
/*  tour_stops — ordered stops pointing at content                             */
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
    // Every stop anchors to a POI location (including break stops).
    poiId: uuid('poi_id')
      .notNull()
      .references(() => pois.id, { onDelete: 'restrict' }),
    // Null for break / not-yet-generated stops. NOTE (M4): set-null on a deleted
    // poi_content row does NOT demote tours.status from 'ready' — when cache
    // invalidation lands, pair content deletes with tour re-validation.
    poiContentId: uuid('poi_content_id').references(() => poiContent.id, {
      onDelete: 'set null',
    }),
    stopType: stopTypeEnum('stop_type').notNull(),
    triggerRadiusM: integer('trigger_radius_m').notNull().default(120),
    // TRIGGER POINT: the stop's POI snapped onto the route (nearest point on the
    // frozen polyline), plus the route's heading of travel at that point. Computed
    // once at generation time so the in-car player triggers as the vehicle passes
    // the POI's point ON THE ROAD (POIs sit 400–650 m off the road on Tahoe
    // corridors) and can run a heading gate WITHOUT re-snapping every stop at load.
    // Nullable for back-compat: tours generated BEFORE these columns existed leave
    // them null until backfilled (backfill-trigger-points.ts), and the player/sim
    // then falls back to snapping the POI live. The generator always writes a value
    // for new stops (a degenerate <2-vertex route would write 0, but corridors are
    // dense frozen polylines, so that path is unreachable in practice).
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
    index('tour_stops_content_idx').on(t.poiContentId),
  ],
)

/* -------------------------------------------------------------------------- */
/*  saved_tours — a free account's saved tours (M2 auth)                        */
/* -------------------------------------------------------------------------- */

// Tours stay anonymous/shareable: ownership is NOT a column on `tours`. A
// signed-in user saves a tour through this join (userId -> Better Auth user.id,
// which is text). On anonymous->account link, move rows from the guest user here.
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

export const corridorsRelations = relations(corridors, ({ many }) => ({
  tours: many(tours),
}))

export const poisRelations = relations(pois, ({ many }) => ({
  content: many(poiContent),
  stops: many(tourStops),
}))

export const poiContentRelations = relations(poiContent, ({ one, many }) => ({
  poi: one(pois, {
    fields: [poiContent.poiId],
    references: [pois.id],
  }),
  stops: many(tourStops),
}))

export const toursRelations = relations(tours, ({ one, many }) => ({
  corridor: one(corridors, {
    fields: [tours.corridorId],
    references: [corridors.id],
  }),
  stops: many(tourStops),
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
  content: one(poiContent, {
    fields: [tourStops.poiContentId],
    references: [poiContent.id],
  }),
}))

/* -------------------------------------------------------------------------- */
/*  Inferred row types (import via the "@skipper/db/schema" subpath, aliased)   */
/* -------------------------------------------------------------------------- */

export type Corridor = typeof corridors.$inferSelect
export type NewCorridor = typeof corridors.$inferInsert
export type Poi = typeof pois.$inferSelect
export type NewPoi = typeof pois.$inferInsert
export type PoiContent = typeof poiContent.$inferSelect
export type NewPoiContent = typeof poiContent.$inferInsert
export type Tour = typeof tours.$inferSelect
export type NewTour = typeof tours.$inferInsert
export type TourStop = typeof tourStops.$inferSelect
export type NewTourStop = typeof tourStops.$inferInsert
export type SavedTour = typeof savedTours.$inferSelect
export type NewSavedTour = typeof savedTours.$inferInsert
