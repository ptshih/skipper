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
 */
export type AttributionSnapshot = {
  source: 'wikipedia' | 'google_places'
  sourceId: string
  title?: string
  url?: string
  license?: string // e.g. "CC BY-SA 4.0"
  retrievedAt?: string // ISO-8601
}

/** Generic, non-volatile break-stop metadata (no baked live data). */
export type StopMeta = Record<string, unknown>

/* -------------------------------------------------------------------------- */
/*  Enums                                                                      */
/* -------------------------------------------------------------------------- */

export const poiSourceEnum = pgEnum('poi_source', ['wikipedia', 'google_places'])

export const jokeLevelEnum = pgEnum('joke_level', ['off', 'mild', 'dad', 'dadpocalypse'])

export const tourStatusEnum = pgEnum('tour_status', ['draft', 'generating', 'ready', 'failed'])

export const stopTypeEnum = pgEnum('stop_type', ['story', 'scenic', 'break'])

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
    persona: text('persona').notNull(),
    voice: text('voice').notNull(),
    jokeLevel: jokeLevelEnum('joke_level').notNull(),
    // Generated narration script.
    script: text('script').notNull(),
    // R2 object URL for the rendered audio (null until synthesized).
    audioUrl: text('audio_url'),
    audioDurationMs: integer('audio_duration_ms'),
    // Human spot-check flag.
    reviewed: boolean('reviewed').default(false).notNull(),
    // Frozen attribution at generation time.
    attribution: jsonb('attribution').$type<AttributionSnapshot>(),
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
    durationBucket: text('duration_bucket').notNull(),
    // Selected interest tags.
    interests: text('interests').array().notNull().default([]),
    persona: text('persona').notNull(),
    jokeLevel: jokeLevelEnum('joke_level').notNull(),
    status: tourStatusEnum('status').notNull().default('draft'),
    // Route signature hash for dedup/cache — nullable in v1.
    routeSig: text('route_sig'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('tours_corridor_idx').on(t.corridorId),
    index('tours_status_idx').on(t.status),
    index('tours_route_sig_idx').on(t.routeSig),
  ],
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
    // Null for break / not-yet-generated stops.
    poiContentId: uuid('poi_content_id').references(() => poiContent.id, {
      onDelete: 'set null',
    }),
    stopType: stopTypeEnum('stop_type').notNull(),
    triggerRadiusM: integer('trigger_radius_m').notNull().default(120),
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
/*  Inferred types                                                             */
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
