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
  check,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

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
 * Lives on the `tracks` row now (narration is tour/roam-owned; there is no shared
 * content cache). `source` is the ATTRIBUTION source, a SUPERSET of `poiSourceEnum`
 * (a POI's discovery source): a clip can blend a Wikipedia POI with enrichment that
 * owns no `pois` row — coordinate-keyed Macrostrat geology, or QID-keyed Wikidata
 * structured facts. `tracks.attribution` is therefore an ARRAY — one entry per
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

/**
 * How a tour's frozen route was authored — set by the admin (Create Tour) flow, the only way
 * tours are created now (seeded shells + committed route artifacts are gone). Always records the
 * final frozen waypoints + Routes totals; `authoring` is present when the route was LLM-proposed
 * + human-approved in the admin console (the "why this route exists" trail).
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
// on the narration (tracks) at M3.

export const tourStatusEnum = pgEnum('tour_status', ['draft', 'generating', 'ready', 'failed'])

// A TRACK's treatment/depth — the "what kind of telling" axis, now a per-TRACK property (a
// segment can carry several forms). `story`/`scenic`/`break` are the tour-stop forms (the old
// stop_type); `wave`/`bside` are the roam/tell-me-more forms the model now has room for. The
// wire DTO (`tourStopView.stopType`, 3 values) is a projection of a tour track's form — for
// tour data the form is always one of the first three. Mirror with the Zod `trackForm` enum.
export const trackFormEnum = pgEnum('track_form', ['story', 'scenic', 'break', 'wave', 'bside'])

// poi_overrides is now fact-corrections ONLY (the side_anchor coordinate moved onto
// `pois.speakable_lat/lng`), so the kind discriminator is GONE. `upstream_status` tracks the
// contribute-back workflow (agent DRAFTS a Wikipedia correction, human SUBMITS it — never
// autonomous bot edits, per WP:BOT/COI norms).
export const upstreamStatusEnum = pgEnum('upstream_status', [
  'not_filed', // confirmed + corrected locally; nothing filed with the source yet
  'filed', // a correction (edit or talk-page post) has been submitted upstream
  'merged', // the source accepted the fix — the local find-string should now no-op
  'reverted', // the source rejected/reverted the fix — local override stays load-bearing
  'not_applicable', // nothing to file (our judgment, not the source's error)
])

// A drive's FRAME pieces (the intro/outro — see tour_frames, the renamed tour_brackets).
// Kept as a pgEnum (typo-safe) and mirrored by the Zod `frameKind` enum in @skipper/shared.
export const frameKindEnum = pgEnum('frame_kind', ['intro', 'outro'])

/* -------------------------------------------------------------------------- */
/*  Shared narration columns — spread into BOTH `tracks` and `tour_frames`.     */
/* -------------------------------------------------------------------------- */

// The narration payload a player consumes: the script + its synthesized clip + frozen
// provenance. A `track` (place-anchored, via its segment) and a `tour_frame` (placeless
// intro/outro) carry the SAME deliverable shape, so they share this spread (enforced by
// `bun run lint:track-columns`). Frames leave `attribution`/`factsHash` null (no place-facts).
const trackColumns = {
  // The narration text. Nullable through generation; a row only goes live once filled.
  script: text('script'),
  // R2 object KEY (private). Stops/roam: clips are keyed per-track; the API presigns it
  // after the freemium tier check.
  audioUrl: text('audio_url'),
  audioDurationMs: integer('audio_duration_ms'),
  // Frozen attribution — an ARRAY, one entry per source this clip drew on (Wikipedia
  // CC BY-SA + Macrostrat CC BY + Wikidata CC0, etc.). The generator MUST populate it for
  // every wikipedia-grounded clip (CC BY-SA is legal, not optional).
  attribution: jsonb('attribution').$type<AttributionSnapshot[]>(),
  // The pois.facts_hash this narration grounded on. NULL for tellings that don't ground on
  // facts (scenic/break, and every frame) → never fact-stale. Stale iff DISTINCT FROM the
  // segment's poi.facts_hash.
  factsHash: text('facts_hash'),
}

/* -------------------------------------------------------------------------- */
/*  regions — minimal keying TABLE (not a pgEnum). Adding a region = an INSERT.  */
/* -------------------------------------------------------------------------- */

export const regions = pgTable(
  'regions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull(), // 'lake-tahoe' (the key)
    displayName: text('display_name').notNull(), // 'Lake Tahoe' (spoken + shown in the picker)
    // Optional bbox for the sweep_roam_pois discovery job — "lng_min,lat_min,lng_max,lat_max".
    // Null = use the generator's built-in default (currently the Tahoe basin).
    discoveryBbox: text('discovery_bbox'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('regions_slug_uq').on(t.slug)],
)

/* -------------------------------------------------------------------------- */
/*  personas — the HOST, first-class and DECOUPLED from region                  */
/* -------------------------------------------------------------------------- */

// Identity in the TABLE, recipe in CODE (the persona/region split). The display identity
// (name/tagline/backstory/art/voice-sample) lives here so it can be the `segments.persona_id`
// FK target and be edited without a deploy; the GENERATION recipe — the system prompt + the
// personal kit + the TTS style — stays in @skipper/generator's PersonaDef (the highest-leverage
// file, version-controlled, never shipped to the client), bridged by `persona_key`.
//
// Decoupled from region by design (D5): a tour is one host; a roam sweep runs for a region →
// its host. The persona is ASSIGNED at generation and FROZEN on `segments.persona_id` — never
// derived from coordinates. Adding region #2 = an INSERT here + a code PersonaDef.
//
// NOTE (v1): the client host display is still served by apps/api `host.ts` (region-keyed); this
// table is the generation-provenance FK target. Wiring `hostIdentity` to read from here is a
// later step gated on backfilling tagline/backstory/art so the display doesn't regress.
export const personas = pgTable(
  'personas',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Stable slug bridging to the code PersonaDef recipe (rename-safe; the FK uses `id`). */
    personaKey: text('persona_key').notNull(),
    name: text('name').notNull(),
    tagline: text('tagline'),
    backstory: text('backstory'),
    portraitUrl: text('portrait_url'),
    voiceSampleUrl: text('voice_sample_url'),
    /** SERVER-ONLY — the TTS voice id (e.g. "Charon"). Never projected to the client. */
    voiceId: text('voice_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('personas_key_uq').on(t.personaKey)],
)

/* -------------------------------------------------------------------------- */
/*  pois — a shared PLACE (facts/coords, deduped per external source)           */
/* -------------------------------------------------------------------------- */

// The ONLY cache in the model: a place's facts are SHARED by every tour/roam that visits it.
// Narration is NOT here — it is tour/roam-owned (see segments + tracks).
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
    // The "where to look" anchor for side-of-road content — a place's vantage point, SHARED
    // and surviving a facts re-fetch (relocated off poi_overrides.side_anchor). Nullable: most
    // places speak from their own pin; only a misleading centroid needs an override. The side
    // (left/right) stays COMPUTED per-segment from approach_heading_deg × this anchor.
    speakableLat: doublePrecision('speakable_lat'),
    speakableLng: doublePrecision('speakable_lng'),
    summary: text('summary'),
    facts: jsonb('facts').$type<PoiFacts>(),
    // FACTS freshness: facts_fetched_at = the TTL clock; facts_hash = change detector
    //   (changes only on a material change). A track is fact-stale iff its facts_hash IS
    //   DISTINCT FROM this row's facts_hash (joined via segment.poiId), for tracks whose
    //   facts_hash is set.
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
/*  poi_overrides — curated FACT corrections for places whose SOURCE is wrong   */
/* -------------------------------------------------------------------------- */

// The fix layer for UPSTREAM source errors. The grounding gate verifies script ↔ sheet, so it
// is structurally blind to a sheet whose source is wrong (found live: Wikipedia's "Leonard" for
// Lennart Palme; the Pope Estate's builder/decade). Each row is ONE documented correction — a
// literal find→replace on the fetched extract — applied by the generator at fetch time (the seam
// every fact flows through), so the corrected text reaches the narration sheet, pois.facts, and
// facts_hash identically, and old tracks become detectably stale.
//
// Keyed by the pois dedup identity (source, source_id), NOT poiId: overrides apply at FETCH
// time, before generation has upserted the place, so the poi row may not exist yet.
//
// Fact corrections ONLY now (the side_anchor coordinate moved to `pois.speakable_lat/lng`):
//   find/replace — a literal substring edit on the fetched extract ('' deletes the match).
//   Applies ONLY to Wikipedia-fetched prose today (geology/wikidata enrichment lines do not
//   pass the fetch seam). An unmatched find is a no-op — but the generator WARNS on it, because
//   "source healed" and "source reworded, still wrong" are indistinguishable without a human look.
//
// Discipline: a row is a repair of a VERIFIABLE error, never an editorial rewrite — `reason` is
// mandatory. `upstream_status` tracks contributing the fix back (agent drafts, human submits).
// Bootstrap rows: packages/db/seed/poi-overrides.ts.
export const poiOverrides = pgTable(
  'poi_overrides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    source: poiSourceEnum('source').notNull(),
    sourceId: text('source_id').notNull(),
    /** Human label for the place (audit readability; never used by apply logic). */
    name: text('name').notNull(),
    /** Exact substring to find in the fetched extract. */
    find: text('find'),
    /** Replacement text ('' deletes the match). */
    replace: text('replace'),
    /** Why the source is wrong — every row documents itself. */
    reason: text('reason').notNull(),
    /** The authoritative source for the correction (not the erroneous one). */
    sourceUrl: text('source_url'),
    upstreamStatus: upstreamStatusEnum('upstream_status').notNull().default('not_filed'),
    /** The filed correction (talk-page post / edit diff URL) once upstream_status = filed+. */
    upstreamUrl: text('upstream_url'),
    /** Retire a HEALED override without deleting it. An inactive row is skipped at load — no
     *  apply, no missed-edit warn, no cache-suspect — but its updated_at bump still busts caches
     *  that adopted the now-withdrawn correction, and it stays on the books for provenance.
     *  Covers the "source removed the text" case the find=replace no-op retire can't. */
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One row per correction identity. NULLS NOT DISTINCT so a place can carry at most one
    // override per find-string (and find may be null for forward use).
    unique('poi_overrides_identity_uq').on(t.source, t.sourceId, t.find).nullsNotDistinct(),
    index('poi_overrides_source_idx').on(t.source, t.sourceId),
  ],
)

/* -------------------------------------------------------------------------- */
/*  tours — the whole self-contained DRIVE (route + the generation that fills it)*/
/* -------------------------------------------------------------------------- */

// `corridors` is MERGED IN: a tour carries its OWN polyline, distance/duration, headline,
// start/end anchors, and region. One tour = one catalog card; there is no direction/family and
// no duration/interest variant matrix (those are deferred axes). `region_id` is a MANUAL FK set
// at creation — never derived from geometry.
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
    // Route — absorbed from the old `corridors` table; a frozen rail, authored once via the
    // Routes API and never re-derived.
    polyline: jsonb('polyline').$type<Polyline>().notNull(),
    distanceMeters: integer('distance_meters'),
    durationSeconds: integer('duration_seconds'),
    summary: text('summary'),
    // How the route was authored — set by the admin Create Tour flow (tours are authored at
    // runtime now; seeded shells are gone). Null only for a pre-provenance row. See RouteProvenance.
    routeProvenance: jsonb('route_provenance').$type<RouteProvenance>(),
    // End-anchors {name, lat, lng}: naming, intro/outro anchoring, the GPS-start pin, and the
    // proximity recommender.
    startAnchorName: text('start_anchor_name').notNull(),
    startAnchorLat: doublePrecision('start_anchor_lat').notNull(),
    startAnchorLng: doublePrecision('start_anchor_lng').notNull(),
    endAnchorName: text('end_anchor_name').notNull(),
    endAnchorLat: doublePrecision('end_anchor_lat').notNull(),
    endAnchorLng: doublePrecision('end_anchor_lng').notNull(),
    // NOTE: there is NO joke-notch column. The Dad-Joke-O-Meter notch is a generation-time INPUT
    // (baked into the audio), not stored state — M1 is dadpocalypse-only. When the 1-N notch ships
    // (M3) it lands on the NARRATION (tracks), never here: a notch describes a telling, not a route.
    status: tourStatusEnum('status').notNull().default('draft'),
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
/*  segments — a place-anchor (the composition root). Stop when tour-bound, roam */
/*  when not. Treatment/depth lives on its tracks, never here.                   */
/* -------------------------------------------------------------------------- */

// A segment is a location's chapter: the shared PLACE (poi) + WHERE it speaks (trigger geometry)
// + WHO tells it (frozen persona). It carries NO `kind` and NO `context` — treatment is per-TRACK
// (`form`), and context is DERIVED (tour_id set = a tour stop; tour_id null = a roam encounter).
// A place can have BOTH a tour segment and a roam segment (different tellings, zero cross-feed).
export const segments = pgTable(
  'segments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // The shared PLACE this segment narrates. NOT NULL — frames (intro/outro) are placeless and
    // live in their own `tour_frames` table, so this FK never relaxes.
    poiId: uuid('poi_id')
      .notNull()
      .references(() => pois.id, { onDelete: 'restrict' }),
    // Tour stop when set; free-roam encounter when null. The context discriminator (D3).
    tourId: uuid('tour_id').references(() => tours.id, { onDelete: 'cascade' }),
    // The FROZEN host of this telling (assigned at generation). A live FK, not provenance —
    // restrict so a persona can't be deleted out from under its segments.
    personaId: uuid('persona_id')
      .notNull()
      .references(() => personas.id, { onDelete: 'restrict' }),
    // Ordering within a tour. NULL for roam (CHECK keeps it in lockstep with tour_id).
    seq: integer('seq'),
    // TRIGGER POINT: the poi snapped onto the route (nearest point on the frozen polyline) + the
    // route heading there, computed once at generation. Null for roam (un-snapped centroids).
    triggerLat: doublePrecision('trigger_lat'),
    triggerLng: doublePrecision('trigger_lng'),
    approachHeadingDeg: integer('approach_heading_deg'),
    // Trigger floor (m), not the rule — the player uses speed-adaptive lead time. Null = default.
    radiusM: integer('radius_m'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // tour stop ⇒ both set; roam ⇒ both null. The context invariant, enforced.
    check('segments_tour_seq_ck', sql`(${t.tourId} is null) = (${t.seq} is null)`),
    // Stable ordering: one segment per position within a tour (NULLs are distinct, so any number
    // of roam segments coexist).
    uniqueIndex('segments_tour_seq_uq').on(t.tourId, t.seq),
    index('segments_poi_idx').on(t.poiId),
    index('segments_tour_idx').on(t.tourId),
    index('segments_persona_idx').on(t.personaId),
  ],
)

/* -------------------------------------------------------------------------- */
/*  tracks — the narration units (1:N per segment). What the phone plays.        */
/* -------------------------------------------------------------------------- */

// A track is the dry narration STEM for a segment in one `form` (the bed is the rider's audio /
// client driveMusic, mixed at playback — not stored). 1:N per segment lets a place carry several
// tellings (a `story` + a future `bside`, a roam `wave` + `story`), keyed unique by
// (segment, form, variant). A track is owned by its segment's context; tours and roam never
// cross-feed (zero-reuse, cleaner shape). A row only goes live once script + audio are filled.
export const tracks = pgTable(
  'tracks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    segmentId: uuid('segment_id')
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    form: trackFormEnum('form').notNull(),
    /** Distinguishes multiple tracks of the same form (e.g. alternate B-sides). 0 = the canonical. */
    variant: integer('variant').notNull().default(0),
    ...trackColumns,
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('tracks_segment_form_variant_uq').on(t.segmentId, t.form, t.variant),
    index('tracks_segment_idx').on(t.segmentId),
  ],
)

/* -------------------------------------------------------------------------- */
/*  tour_frames — the drive's FRAME (intro/outro). Placeless. (was tour_brackets)*/
/* -------------------------------------------------------------------------- */

// Placeless by construction, fired by drive LIFECYCLE not geofence, so they get their own
// homogeneous table — keeping `segments` strict (poiId NOT NULL) and the geofence engine pure.
// No poiId, no trigger coords; shares the `trackColumns` narration shape but leaves
// attribution/facts_hash null (a frame is about the DRIVE and carries no place-facts).
export const tourFrames = pgTable(
  'tour_frames',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tourId: uuid('tour_id')
      .notNull()
      .references(() => tours.id, { onDelete: 'cascade' }),
    kind: frameKindEnum('kind').notNull(), // 'intro' | 'outro'
    ...trackColumns,
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  // Exactly one intro + one outro per tour.
  (t) => [uniqueIndex('tour_frames_tour_kind_uq').on(t.tourId, t.kind)],
)

/* -------------------------------------------------------------------------- */
/*  eval_runs / eval_scores — the DURABLE eval record (observability, not state) */
/* -------------------------------------------------------------------------- */

// The eval loop's system of record: every eval platform converges on "the run is a DB record
// keyed to a pinned artifact; local files are dev transport". Two tables, Langfuse-style: a run
// row (with the full GenerateResult artifact as jsonb) + one score row per (run × stop ×
// dimension), with judge and HUMAN verdicts as the same primitive distinguished by `source`.
//
// OBSERVABILITY, never product state: nothing in the player/API reads them, and a dry-run
// generation MAY write here (recording the eval is the point) while writing no tour state.

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
    /** The track form being scored, as TEXT (observability, not the pgEnum). */
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
// (who/what/when/status/cost) of a tour-ops CLI run as a Cloud Run Job. Written ONLY by
// pipeline/job-progress.ts when GEN_JOB_ID is set, so the laptop CLI never touches it.
// OBSERVABILITY — nothing in the player/API reads it.

export const genJobKindEnum = pgEnum('gen_job_kind', [
  'generate', // run.ts — discover/narrate/eval/synthesize a tour
  'patch_clip', // patch-clip.ts — re-synth one track/frame clip
  'resynth', // resynth-tour.ts — re-synth every clip of a tour
  'resynth_roam_clip', // resynth-roam-clip.ts — re-synth one roam track
  'sweep_orphans', // sweep-orphans.ts — delete unreferenced R2 clips
  'sweep_roam_pois', // sweep-roam-pois.ts — fetch + upsert roam POIs
  'generate_roam', // generate-roam.ts — narrate + synthesize roam tracks
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
    /** patch_clip: the track/frame id; resynth/sweep: the tour id — an audit label. */
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
    /** Raw Cloud Run stdout captured after the execution settles. */
    outputLog: text('output_log'),
    /** LLM-generated one-paragraph summary of what the run did. */
    outputSummary: text('output_summary'),
    /** LLM-extracted structured metrics (kind-specific fields). */
    outputData: jsonb('output_data').$type<Record<string, unknown>>(),
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

export const personasRelations = relations(personas, ({ many }) => ({
  segments: many(segments),
}))

export const poisRelations = relations(pois, ({ many }) => ({
  segments: many(segments),
}))

export const toursRelations = relations(tours, ({ one, many }) => ({
  region: one(regions, {
    fields: [tours.regionId],
    references: [regions.id],
  }),
  segments: many(segments),
  frames: many(tourFrames),
}))

export const segmentsRelations = relations(segments, ({ one, many }) => ({
  tour: one(tours, {
    fields: [segments.tourId],
    references: [tours.id],
  }),
  poi: one(pois, {
    fields: [segments.poiId],
    references: [pois.id],
  }),
  persona: one(personas, {
    fields: [segments.personaId],
    references: [personas.id],
  }),
  tracks: many(tracks),
}))

export const tracksRelations = relations(tracks, ({ one }) => ({
  segment: one(segments, {
    fields: [tracks.segmentId],
    references: [segments.id],
  }),
}))

export const tourFramesRelations = relations(tourFrames, ({ one }) => ({
  tour: one(tours, {
    fields: [tourFrames.tourId],
    references: [tours.id],
  }),
}))

/* -------------------------------------------------------------------------- */
/*  Inferred row types (import via the "@skipper/db/schema" subpath, aliased)   */
/* -------------------------------------------------------------------------- */

export type Region = typeof regions.$inferSelect
export type NewRegion = typeof regions.$inferInsert
export type Persona = typeof personas.$inferSelect
export type NewPersona = typeof personas.$inferInsert
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
export type Segment = typeof segments.$inferSelect
export type NewSegment = typeof segments.$inferInsert
export type Track = typeof tracks.$inferSelect
export type NewTrack = typeof tracks.$inferInsert
export type TourFrame = typeof tourFrames.$inferSelect
export type NewTourFrame = typeof tourFrames.$inferInsert
export type GenJob = typeof genJobs.$inferSelect
export type NewGenJob = typeof genJobs.$inferInsert
