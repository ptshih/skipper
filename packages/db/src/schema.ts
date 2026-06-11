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
  unique,
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

/**
 * How a tour's frozen route was authored — the DB-resident form of the committed
 * seed/data/<slug>.json provenance, set for admin (Create Tour) authored tours. Always
 * records the final frozen waypoints + Routes totals; `authoring` is present when the route
 * was LLM-proposed + human-approved in the admin console (the "why this route exists" trail).
 */
export type RouteProvenance = {
  source: 'google-routes-v2'
  waypoints: { label: string; lat: number; lng: number }[]
  distanceMeters: number
  durationSeconds: number
  materializedAt: string // ISO-8601
  authoring?: {
    model: string
    prompt: {
      regionSlug: string
      roughStart: string
      roughEnd: string
      loopOrDirection: string
      vibe?: string
    }
    /** The LLM's named proposal BEFORE human edits (the approved set is `waypoints`). */
    proposed: { label: string; lat: number; lng: number; rationale?: string }[]
  }
}

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

// poi_overrides vocabulary (typo-safe like stop_type). `kind` discriminates the two
// correction shapes; `upstream_status` tracks the contribute-back workflow (agent DRAFTS a
// Wikipedia correction, human SUBMITS it — never autonomous bot edits, per WP:BOT/COI norms).
export const poiOverrideKindEnum = pgEnum('poi_override_kind', ['fact_edit', 'side_anchor'])
export const upstreamStatusEnum = pgEnum('upstream_status', [
  'not_filed', // confirmed + corrected locally; nothing filed with the source yet
  'filed', // a correction (edit or talk-page post) has been submitted upstream
  'merged', // the source accepted the fix — the local find-string should now no-op
  'reverted', // the source rejected/reverted the fix — local override stays load-bearing
  'not_applicable', // nothing to file (e.g. a side_of_road call — our judgment, not their error)
])

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
    // FACTS freshness: facts_fetched_at = the TTL clock; facts_hash = change detector
    //   (changes only on a material change). The READ side shipped 2026-06-10
    //   (generator persist.loadFreshPoiFacts: a regen reuses facts within FACTS_TTL_HOURS
    //   unless a newer poi_overrides row invalidates them); a SCHEDULED re-fetch sweep is
    //   still unbuilt. A tour_stop is fact-stale iff its facts_hash IS DISTINCT FROM this
    //   row's facts_hash (joined on poiId), for stops whose facts_hash is set.
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
/*  poi_overrides — curated corrections for places whose SOURCE is wrong        */
/* -------------------------------------------------------------------------- */

// The fix layer for UPSTREAM source errors. The grounding gate verifies script ↔ sheet, so
// it is structurally blind to a sheet whose source is wrong (found live 2026-06-09:
// Wikipedia's "Leonard" for Lennart Palme; the Pope Estate's builder/decade). Each row is
// ONE documented correction, applied by the generator at fetch time (the seam every fact
// flows through), so the corrected text reaches the narration sheet, pois.facts, and
// facts_hash identically — and old tour_stops become detectably stale.
//
// Keyed by the pois dedup identity (source, source_id), NOT poiId: overrides apply at FETCH
// time, before generation has upserted the place, so the poi row may not exist yet.
//
// Two correction kinds (the `kind` discriminator):
//   fact_edit   — literal find→replace on the fetched extract text (find/replace columns).
//                 Applies ONLY to Wikipedia-fetched prose today (geology/wikidata enrichment
//                 lines do not pass the fetch seam). An unmatched find is a no-op — but the
//                 generator WARNS on it, because "source healed" and "source reworded, still
//                 wrong" are indistinguishable without a human look. `source_url` is the
//                 AUTHORITATIVE source justifying the correction.
//   side_anchor — a corrected COORDINATE for the place's speakable content (lat/lng columns),
//                 used ONLY for the side-of-road computation when the source pin misleads
//                 (an inland park centroid whose famous content is lakeside). Deliberately a
//                 coordinate, not a stored 'left'/'right': side flips with travel direction,
//                 and S→N / N→S are peer tours — the heading-aware geometry resolves the
//                 anchor to the correct side per drive. Trigger geometry untouched.
//
// Discipline: a row is a repair of a VERIFIABLE error, never an editorial rewrite — `reason`
// is mandatory. The eval CLI's --veracity dimension is the CATCH side; a human adjudicates
// its findings into rows here. `upstream_status` then tracks contributing the fix back to
// the source (agent drafts, human submits). Bootstrap rows: packages/db/seed/poi-overrides.ts.
export const poiOverrides = pgTable(
  'poi_overrides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    source: poiSourceEnum('source').notNull(),
    sourceId: text('source_id').notNull(),
    /** Human label for the place (audit readability; never used by apply logic). */
    name: text('name').notNull(),
    kind: poiOverrideKindEnum('kind').notNull(),
    /** fact_edit: exact substring to find in the fetched extract. */
    find: text('find'),
    /** fact_edit: replacement text ('' deletes the match). */
    replace: text('replace'),
    /** side_anchor: where the place's SPEAKABLE content actually is (side computation only). */
    sideAnchorLat: doublePrecision('side_anchor_lat'),
    sideAnchorLng: doublePrecision('side_anchor_lng'),
    /** Why the source is wrong / why the geometry misleads — every row documents itself. */
    reason: text('reason').notNull(),
    /** fact_edit: the authoritative source for the correction (not the erroneous one). */
    sourceUrl: text('source_url'),
    upstreamStatus: upstreamStatusEnum('upstream_status').notNull().default('not_filed'),
    /** The filed correction (talk-page post / edit diff URL) once upstream_status = filed+. */
    upstreamUrl: text('upstream_url'),
    /** Retire a HEALED override without deleting it. An inactive row is skipped at load —
     *  no apply, no missed-edit warn, no cache-suspect — but its updated_at bump still busts
     *  caches that adopted the now-withdrawn correction, and it stays on the books for
     *  provenance. Covers the "source removed the text" case the find=replace no-op retire
     *  can't (the find no longer matches, so the row would warn every run forever). */
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One row per correction identity. NULLS NOT DISTINCT so a place can carry at most ONE
    // side_anchor row (find is null there) while fact_edits stay distinct by find-string.
    unique('poi_overrides_identity_uq')
      .on(t.source, t.sourceId, t.kind, t.find)
      .nullsNotDistinct(),
    index('poi_overrides_source_idx').on(t.source, t.sourceId),
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
    // How the route was authored (admin Create Tour). Null for the original seed-authored
    // tours, whose provenance lives in the committed seed/data/<slug>.json. See RouteProvenance.
    routeProvenance: jsonb('route_provenance').$type<RouteProvenance>(),
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
    // FORWARD-COMPAT PLACEHOLDER for the M4-deferred human-review gate. Declared but never
    // read/written yet — no review workflow exists; don't assume one. (Same on tour_brackets.)
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
    // FORWARD-COMPAT PLACEHOLDER for the M4-deferred human-review gate — same as tour_stops.reviewed:
    // declared but never read/written yet, no review workflow exists.
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
/*  roam_clips — ROAM-owned narration (free-roam mode; the THIRD owner)         */
/* -------------------------------------------------------------------------- */

// Free-roam's telling of a place. The zero-reuse model has THREE narration owners now:
// pois = shared FACTS, tour_stops = a TOUR's telling, roam_clips = the ROAM telling
// (one per POI in v0 — replayed for every roamer of the region, exactly as a tour's
// clip replays for every driver of that tour). Tours and roam NEVER cross-feed.
// A row only lands COMPLETE (script + audio together — the ready-gate invariant,
// mapped onto roam), so existence = playable; there is no status column.
// Background: docs/ideas/free-roam-mode.md.
export const roamClips = pgTable(
  'roam_clips',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    poiId: uuid('poi_id')
      .notNull()
      .references(() => pois.id, { onDelete: 'cascade' }),
    // ── ROAM-owned narration (never shared with tour_stops) ──
    script: text('script').notNull(),
    // R2 object KEY, per-CLIP unique: roam/<poiId>/<clipId>.<ext>. A regen mints a new
    // key (the old object orphans for sweep-orphans), so live bytes are never
    // overwritten in place — same property bracket keys earned (see generator storage.ts).
    audioUrl: text('audio_url').notNull(),
    audioDurationMs: integer('audio_duration_ms').notNull(),
    // Frozen attribution — MANDATORY for wikipedia-grounded clips (CC BY-SA).
    attribution: jsonb('attribution').$type<AttributionSnapshot[]>(),
    // The pois.facts_hash this telling grounded on — the staleness contract,
    // identical to tour_stops (stale iff DISTINCT FROM pois.facts_hash).
    factsHash: text('facts_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  // v0: ONE roam telling per place (B-side/wave variants are a later, destructive migration).
  (t) => [uniqueIndex('roam_clips_poi_uq').on(t.poiId)],
)

export const roamClipsRelations = relations(roamClips, ({ one }) => ({
  poi: one(pois, {
    fields: [roamClips.poiId],
    references: [pois.id],
  }),
}))

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
/*  eval_runs / eval_scores — the DURABLE eval record (observability, not state) */
/* -------------------------------------------------------------------------- */

// The eval loop's system of record (decided 2026-06-09 after a best-practices survey —
// see docs/decisions/fact-overrides-and-veracity.md): every eval platform converges on
// "the run is a DB record keyed to a pinned artifact; local files are dev transport".
// Two tables, Langfuse-style: a run row (with the full GenerateResult artifact as jsonb —
// ~100KB, squarely in-DB territory) + one score row per (run × stop × dimension), with
// judge and HUMAN verdicts as the same primitive distinguished by `source` — so judge↔human
// calibration is a GROUP BY, and run-over-run regression is a join on the stable place
// identity (poi source/source_id; stop ids regenerate, places don't).
//
// These tables are OBSERVABILITY, never product state: nothing in the player/API reads
// them, and a dry-run generation MAY write here (recording the eval is the point) while
// still writing no tour state.

export const evalRunKindEnum = pgEnum('eval_run_kind', [
  'generation', // the in-pipeline panel that runs inside generateTour (live or dry)
  'offline_audit', // the eval CLI scoring an artifact after the fact
])
export const evalScoreSourceEnum = pgEnum('eval_score_source', ['judge', 'human'])

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** The tour the artifact came from; survives as slug if the tour row is deleted. */
    tourId: uuid('tour_id').references(() => tours.id, { onDelete: 'set null' }),
    slug: text('slug').notNull(),
    kind: evalRunKindEnum('kind').notNull(),
    dryRun: boolean('dry_run').notNull().default(false),
    /** Best-effort provenance pins for run-over-run comparison. */
    gitSha: text('git_sha'),
    narrationModel: text('narration_model'),
    judgeModel: text('judge_model'),
    /** The scorecard's gate verdict (AND of gate dimensions). */
    pass: boolean('pass').notNull(),
    /** Per-dimension rollup scores (0..1; null = dimension not run) — the trend columns. */
    groundingScore: doublePrecision('grounding_score'),
    ttsScore: doublePrecision('tts_score'),
    diversityScore: doublePrecision('diversity_score'),
    charmScore: doublePrecision('charm_score'),
    veracityScore: doublePrecision('veracity_score'),
    /** The full GenerateResult artifact (scripts + fact wells + embedded scorecard). */
    artifact: jsonb('artifact').$type<Record<string, unknown>>().notNull(),
    /** The TourScorecard this run produced (the offline CLI's may differ from the embedded one). */
    scorecard: jsonb('scorecard').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('eval_runs_slug_idx').on(t.slug, t.createdAt)],
)

export const evalScores = pgTable(
  'eval_scores',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => evalRuns.id, { onDelete: 'cascade' }),
    /** Stable cross-run case identity (the pois dedup key); null for pre-identity artifacts. */
    poiSource: text('poi_source'),
    poiSourceId: text('poi_source_id'),
    seq: integer('seq').notNull(),
    stopType: text('stop_type').$type<'story' | 'scenic' | 'break'>(),
    dimension: text('dimension').notNull(),
    /** judge = an automated evaluator; human = an adjudication row added later. */
    source: evalScoreSourceEnum('source').notNull().default('judge'),
    pass: boolean('pass').notNull(),
    /** 0..1 (1 = clean) — the StopEval score. */
    value: doublePrecision('value').notNull(),
    findings: jsonb('findings').$type<string[]>().notNull(),
    /** Dimension-specific payload (ClaimVerdict[] / VeracityVerdict[] / …). */
    detail: jsonb('detail'),
    /** Free-text annotation (human rows). */
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('eval_scores_run_idx').on(t.runId),
    // The regression join: same place + dimension across runs.
    index('eval_scores_case_idx').on(t.poiSource, t.poiSourceId, t.dimension),
  ],
)

/* -------------------------------------------------------------------------- */
/*  gen_jobs — the OPERATIONAL record of a cloud tour-ops run (admin console)    */
/* -------------------------------------------------------------------------- */

// eval_runs is the QUALITY record (scores + artifact); gen_jobs is the EXECUTION record
// (who/what/when/status/cost) of a tour-ops CLI run as a Cloud Run Job — generate /
// patch_clip / resynth / sweep_orphans. Closes the "no generation timing/logs" gap and
// drives the admin Runs view. Written ONLY by pipeline/job-progress.ts when GEN_JOB_ID is
// set, so the laptop CLI (no GEN_JOB_ID) never touches this table and stays byte-identical.
// Like eval_runs, it is OBSERVABILITY — nothing in the player/API reads it.
// Background: docs/specs/admin-ops-console-spec.md §4/§9.

export const genJobKindEnum = pgEnum('gen_job_kind', [
  'generate', // run.ts — discover/narrate/eval/synthesize a tour
  'patch_clip', // patch-clip.ts — re-synth one stop/bracket clip
  'resynth', // resynth-tour.ts — re-synth every clip of a tour
  'sweep_orphans', // sweep-orphans.ts — delete unreferenced R2 clips
])
export const genJobStatusEnum = pgEnum('gen_job_status', [
  'queued', // row created (admin-api in v1), Job not yet running
  'running', // the Job flipped it on entry
  'succeeded', // clean exit
  'failed', // threw / terminal API error
  'canceled', // operator-stopped (reserved; no cancel path in v0)
])

export const genJobs = pgTable(
  'gen_jobs',
  {
    // The row id IS the GEN_JOB_ID the Job receives: the admin-api mints it in v1; the hook
    // mints + inserts it for a gcloud-triggered v0 run.
    id: uuid('id').defaultRandom().primaryKey(),
    kind: genJobKindEnum('kind').notNull(),
    status: genJobStatusEnum('status').notNull().default('queued'),
    /** generate: the tour slug. */
    targetSlug: text('target_slug'),
    /** Set once known (generate backfills from the result; ops resolve it up front). */
    tourId: uuid('tour_id').references(() => tours.id, { onDelete: 'set null' }),
    /** patch_clip: the stop/bracket id; resynth/sweep: the tour id — an audit label. */
    targetId: text('target_id'),
    /** The exact CLI override args (process.argv.slice(2)) — audit + replay. */
    args: jsonb('args').$type<string[]>().notNull(),
    dryRun: boolean('dry_run').notNull().default(true),
    /** Best-effort progress label (per-phase ticking is a deferred enhancement). */
    phase: text('phase'),
    /** Exact LLM spend (+ TTS estimate later); null if the run crashed before finish. NOT
     *  GCP billing truth — see the spec §9 cost caveat. */
    costUsd: doublePrecision('cost_usd'),
    /** Link to the quality record this run produced (generate; null for ops + crashes). */
    evalRunId: uuid('eval_run_id').references(() => evalRuns.id, { onDelete: 'set null' }),
    /** The Cloud Run execution resource name — logs / cancel / the reconcile backstop. */
    cloudRunExecution: text('cloud_run_execution'),
    /** The IAP-asserted email in v1; 'cli' for a gcloud-triggered v0 run. */
    triggeredBy: text('triggered_by').notNull(),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('gen_jobs_created_idx').on(t.createdAt),
    index('gen_jobs_status_idx').on(t.status),
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
export type PoiOverride = typeof poiOverrides.$inferSelect
export type NewPoiOverride = typeof poiOverrides.$inferInsert
export type EvalRun = typeof evalRuns.$inferSelect
export type NewEvalRun = typeof evalRuns.$inferInsert
export type EvalScore = typeof evalScores.$inferSelect
export type NewEvalScore = typeof evalScores.$inferInsert
export type Tour = typeof tours.$inferSelect
export type NewTour = typeof tours.$inferInsert
export type TourStop = typeof tourStops.$inferSelect
export type NewTourStop = typeof tourStops.$inferInsert
export type TourBracket = typeof tourBrackets.$inferSelect
export type NewTourBracket = typeof tourBrackets.$inferInsert
export type RoamClip = typeof roamClips.$inferSelect
export type NewRoamClip = typeof roamClips.$inferInsert
export type SavedTour = typeof savedTours.$inferSelect
export type NewSavedTour = typeof savedTours.$inferInsert
export type GenJob = typeof genJobs.$inferSelect
export type NewGenJob = typeof genJobs.$inferInsert
