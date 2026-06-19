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

/** The raw fetched Wikipedia article + its provenance for a STORY poi (built by `buildStoryFacts`);
 *  null for scenic/break rows. The curated narration sheet is NOT here — it's the separate typed
 *  `pois.fact_sheet` column (+ `enriched_at`; see `FactSheetEntry`). `extract` = the full article (the
 *  enricher's input + audit source + the un-enriched grounding fallback). A real interface now (was
 *  `Record<string,unknown>`): the bag's shape is STABLE — the extensible/curated part moved to
 *  `fact_sheet` — so typed access beats hand-written casts. */
export interface PoiFacts {
  extract: string
  title: string
  url: string
  pageId: number
  qid?: string
}

/**
 * One VERBATIM span of a story poi's curated FACT SHEET (`pois.fact_sheet`) — a sentence/section
 * the corpus `enrich` step SELECTED from the article, or a discrete fact a sourced fetcher returned
 * (Wikidata key fact, Macrostrat geology). The enricher chooses WHICH spans to keep, NEVER what they
 * say — `text` is always verbatim from `source` (the "persona lives in DELIVERY, never FACTS"
 * invariant mapped onto storage; see docs/specs/corpus-enrichment-spec.md §2). Narration grounds on
 * the fact sheet; `narrations.attribution` is frozen from the distinct `(source, sourceId, license, url)` here.
 * `source` is a subset of `AttributionSnapshot['source']` (the fact-bearing sources only).
 */
export type FactSheetEntry = {
  text: string
  // The fact-BEARING attribution sources — `google_places` is excluded (it bears no fact text,
  // only a break-stop name + kind). Kept as a subset of AttributionSnapshot['source'] so the two
  // can't drift.
  source: Exclude<AttributionSnapshot['source'], 'google_places'>
  sourceId: string
  license: string
  url?: string
}

/**
 * Attribution snapshot frozen at narration time so credit stays correct even if
 * the source POI row is later edited (e.g. Wikipedia CC BY-SA requirements).
 *
 * Lives on the `narrations` row now (narration is drive/roam-owned; there is no shared
 * content cache). `source` is the ATTRIBUTION source, a SUPERSET of `poiSourceEnum`
 * (a POI's discovery source): a clip can blend a Wikipedia POI with enrichment that
 * owns no `pois` row — coordinate-keyed Macrostrat geology, or QID-keyed Wikidata
 * structured facts. `narrations.attribution` is therefore an ARRAY — one entry per
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

/**
 * A DRIVE's frozen, ordered manifest (the `drives.selection` jsonb). One entry per played item in
 * route order: a place NARRATION (referenced 1:1 via its poi — content resolves LIVE so a regenerated
 * telling auto-improves a saved drive) or a generic ASIDE (intro/outro/clock beat). The STRUCTURE
 * is frozen at create time (which items, order, snapped trigger geometry); only a narration's audio
 * resolves live. buildDrive (drive-core) produces the narration items; the API weaves the asides.
 */
export type DriveSelectionItem =
  | {
      kind: 'narration'
      seq: number
      poiId: string
      narrationId: string
      alongSec: number
      triggerLat: number
      triggerLng: number
      approachHeadingDeg: number
    }
  | { kind: 'aside'; seq: number; asideId: string; alongSec: number }
export type DriveSelection = DriveSelectionItem[]

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
// on the narration at M3.

// A NARRATION's treatment/depth — the "what kind of telling" axis. `story`/`scenic`/`break` are
// the drive-stop forms; `wave` is the roam call-out; `bside` is a deferred "tell me more". Mirror
// with the Zod `narrationForm` enum.
export const narrationFormEnum = pgEnum('narration_form', ['story', 'scenic', 'break', 'wave', 'bside'])

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

/* -------------------------------------------------------------------------- */
/*  Shared narration columns — spread into `narrations` (+ future aside reuse). */
/* -------------------------------------------------------------------------- */

// The narration payload a player consumes: the script + its synthesized clip + frozen
// provenance. Spread into `narrations`; a row goes live only post-synthesis (audio_url NOT NULL).
const narrationColumns = {
  // The narration text. Nullable through generation; a row only goes live once filled.
  script: text('script'),
  // R2 object KEY (private). Stops/roam: clips are keyed per-track; the API presigns it
  // after the freemium tier check. NOT NULL — a track/frame row is only ever inserted
  // post-synthesis (finalizeTourReady's atomic batch; the roam upsert), so the DB enforces
  // the "every stop/frame has audio" invariant at the boundary, not just in app code.
  audioUrl: text('audio_url').notNull(),
  audioDurationMs: integer('audio_duration_ms').notNull(),
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
    // Optional bbox for the region POI-discovery sweep — "lng_min,lat_min,lng_max,lat_max".
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

// The ONLY cache in the model: a place's facts are SHARED by every drive/roam that visits it.
// Narration is NOT here — it is drive/roam-owned (see narrations).
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
    // The curated, verbatim narration sheet (the corpus `enrich` step's output) — its OWN typed
    // column, NOT buried in the `facts` bag: a free re-sweep writes `facts` and never touches this,
    // so a paid enrichment is preserved by construction (no graft-back CASE). Narration grounds on
    // this when present, else the positional `facts.extract` head.
    factSheet: jsonb('fact_sheet').$type<FactSheetEntry[]>(),
    // When `fact_sheet` was built (the enrich stamp; the sheet's frozen credit instant). Hoisted out
    // of the bag so a re-enrich TTL can query it without parsing jsonb.
    enrichedAt: timestamp('enriched_at', { withTimezone: true }),
    // FACTS freshness: facts_fetched_at = the TTL clock; facts_hash = the grounding change detector.
    //   facts_hash hashes the FACT SHEET when enriched (the narration's real input), else the whole
    //   `facts` object. A narration is fact-stale iff its facts_hash IS DISTINCT FROM this row's
    //   facts_hash (joined via narration.poiId), for narrations whose facts_hash is set.
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
    // Bounding-box prefilter for /roam (and any near-a-point query) — bounds the scan instead
    // of loading every roam narration globally before the haversine pass.
    index('pois_lat_lng_idx').on(t.lat, t.lng),
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
// facts_hash identically, and old narrations become detectably stale.
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
/*  V2 — narrations / asides / drives / drive_demand                            */
/*  The roam-first model: pois ──1:1── narrations (the shared telling); roam is  */
/*  a MODE over them; a `drive` is a user-owned ordered sequence; asides are     */
/*  the generic placeless flavor. (The legacy tour tables — tours/segments/      */
/*  tracks/tour_frames — were dropped in migration 0009.)                        */
/* -------------------------------------------------------------------------- */

// The ONE shared telling of a place — 1:1 with its poi (UNIQUE poi_id). The atom: roam plays these by
// proximity and every drive REFERENCES them (narration content resolves live via poi_id; nothing else
// owns it). The old roam `tracks` hoisted to hang directly off the poi — no segment, no `variant` (one
// telling per place; multi-telling axes — authored tours, region-skippers, joke notches — are deferred
// and re-expand storage then). Persona is baked into the single telling (one host per region in v2). A
// row goes live only post-synthesis (audio_url NOT NULL, via narrationColumns).
export const narrations = pgTable(
  'narrations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    poiId: uuid('poi_id')
      .notNull()
      .references(() => pois.id, { onDelete: 'cascade' }),
    // story|scenic|break|wave — the telling's treatment (1:1, so no `variant`).
    form: narrationFormEnum('form').notNull(),
    ...narrationColumns,
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  // UNIQUE poi_id = the 1:1 invariant (and the lookup index for roam/drive joins).
  (t) => [uniqueIndex('narrations_poi_uq').on(t.poiId)],
)

// Generic, region/persona-owned FLAVOR woven BETWEEN place narrations: intro/outro brackets + the
// clock-anchored "halfway there" beats. Placeless (no poi, no facts → no attribution/factsHash).
// SHARED + reused across every drive in a region (the inverse of zero-reuse, which governs only the
// deferred authored rung). `kind` is plain text validated by the Zod `asideKind` enum at the
// boundary (the vocabulary churns — the pipeline_jobs.kind precedent). Starts EMPTY (filled by a
// founder-gated synth run); region_id null = a GLOBAL aside.
export const asides = pgTable(
  'asides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    regionId: uuid('region_id').references(() => regions.id, { onDelete: 'cascade' }),
    personaKey: text('persona_key').notNull(),
    kind: text('kind').notNull(),
    /** Distinguishes variants of the same (region, persona, kind) so a beat rarely repeats. */
    variant: integer('variant').notNull().default(0),
    script: text('script'),
    audioUrl: text('audio_url').notNull(),
    audioDurationMs: integer('audio_duration_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One row per (region, persona, kind, variant); NULLS NOT DISTINCT so a GLOBAL (null-region)
    // beat is still unique on its (persona, kind, variant).
    unique('asides_lookup_uq')
      .on(t.regionId, t.personaKey, t.kind, t.variant)
      .nullsNotDistinct(),
    index('asides_lookup_idx').on(t.regionId, t.personaKey, t.kind),
  ],
)

// A user-owned DRIVE: an ordered sequence of place narrations (+ asides) along a frozen route.
// Ownership lives HERE on `user_id` (a user-side table), NEVER on tours — preserving the
// anonymous/shareable-tour invariant. References shared narrations; mints no narration. The frozen
// `selection` manifest is replayed verbatim on re-open (structure frozen; narration content live).
export const drives = pgTable(
  'drives',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Soft ref to the auth `user.id` (TEXT) — auth runs on a SEPARATE neon-serverless pool, so a
    // DB-level FK isn't enforceable here; validated at the app boundary.
    userId: text('user_id').notNull(),
    regionId: uuid('region_id').references(() => regions.id, { onDelete: 'set null' }),
    label: text('label'),
    startName: text('start_name'),
    startLat: doublePrecision('start_lat').notNull(),
    startLng: doublePrecision('start_lng').notNull(),
    endName: text('end_name'),
    endLat: doublePrecision('end_lat').notNull(),
    endLng: doublePrecision('end_lng').notNull(),
    polyline: jsonb('polyline').$type<Polyline>().notNull(),
    distanceMeters: integer('distance_meters'),
    durationSeconds: integer('duration_seconds'),
    routeProvenance: jsonb('route_provenance').$type<RouteProvenance>(),
    // Shape-aware route signature (region + quantized endpoints + via-points) — the demand +
    // cache-warming key (instrumentation only in v2). Indexed.
    routeSig: text('route_sig').notNull(),
    selection: jsonb('selection').$type<DriveSelection>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    // Soft-delete tombstone. A free-drive CREDIT is spent at generation and NEVER refunded, so a
    // deleted drive STAYS as a row and keeps counting toward the lifetime cap — delete is a "remove
    // from my list" action, not a credit refund. Read paths (list / replay / sign) filter
    // `deleted_at IS NULL`; the cap counts ALL rows. NULL = live.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('drives_user_idx').on(t.userId), index('drives_route_sig_idx').on(t.routeSig)],
)

// Shared route-sig DEMAND counter — instrumentation ONLY in v2 (the cache-warming / authored-tour
// graduation job that CONSUMES it is deferred behind a real route-concentration histogram). One row
// per normalized route signature.
export const driveDemand = pgTable('drive_demand', {
  routeSig: text('route_sig').primaryKey(),
  regionId: uuid('region_id').references(() => regions.id, { onDelete: 'set null' }),
  hits: integer('hits').notNull().default(0),
  distinctUsers: integer('distinct_users').notNull().default(0),
  lastHitAt: timestamp('last_hit_at', { withTimezone: true }).defaultNow().notNull(),
  warmedAt: timestamp('warmed_at', { withTimezone: true }),
})

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
    /** The artifact's identity slug (the run is keyed to a pinned artifact, not a tour row). */
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
    /** The RunScorecard this run produced (the offline CLI's may differ from the embedded one). */
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
/*  pipeline_jobs — the OPERATIONAL record of a cloud tour-ops run (admin console)    */
/* -------------------------------------------------------------------------- */

// eval_runs is the QUALITY record (scores + artifact); pipeline_jobs is the EXECUTION record
// (who/what/when/status/cost) of a tour-ops CLI run as a Cloud Run Job. Written ONLY by
// pipeline/job-progress.ts when GEN_JOB_ID is set, so the laptop CLI never touches it.
// OBSERVABILITY — nothing in the player/API reads it.

// NO `gen_job_kind` pgEnum: the job-kind vocabulary CHURNS (a new ops script = a new kind) and the
// column is OBSERVABILITY-only (nothing reads it for logic), so it's a plain `text` column with the
// closed set single-sourced as the Zod `jobKind` enum in @skipper/shared (validated at the admin-api
// boundary). Adding/renaming a kind is then a code edit — no enum migration. (Was a pgEnum until
// 2026-06-15; migration 0005 dropped the type + renamed sweep_roam_pois → sweep_region_pois.)
export const pipelineJobStatusEnum = pgEnum('pipeline_job_status', [
  'queued', // row created (admin-api in v1), Job not yet running
  'running', // the Job flipped it on entry
  'succeeded', // clean exit
  'failed', // threw / terminal API error
  'canceled', // operator-stopped (reserved; no cancel path in v0)
])

export const pipelineJobs = pgTable(
  'pipeline_jobs',
  {
    // The row id IS the GEN_JOB_ID the Job receives: the admin-api mints it in v1; the hook
    // mints + inserts it for a gcloud-triggered v0 run.
    id: uuid('id').defaultRandom().primaryKey(),
    // Plain text — the closed set is the Zod `jobKind` enum in @skipper/shared (see note above).
    kind: text('kind').notNull(),
    status: pipelineJobStatusEnum('status').notNull().default('queued'),
    /** generate_narrations etc: the region slug. */
    targetSlug: text('target_slug'),
    /** An ops audit label (e.g. the poi/region id the job acted on). */
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
    index('pipeline_jobs_created_idx').on(t.createdAt),
    index('pipeline_jobs_status_idx').on(t.status),
  ],
)

/* -------------------------------------------------------------------------- */
/*  Relations                                                                  */
/* -------------------------------------------------------------------------- */

export const poisRelations = relations(pois, ({ one }) => ({
  narration: one(narrations),
}))

export const narrationsRelations = relations(narrations, ({ one }) => ({
  poi: one(pois, { fields: [narrations.poiId], references: [pois.id] }),
}))

export const asidesRelations = relations(asides, ({ one }) => ({
  region: one(regions, { fields: [asides.regionId], references: [regions.id] }),
}))

export const drivesRelations = relations(drives, ({ one }) => ({
  region: one(regions, { fields: [drives.regionId], references: [regions.id] }),
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
export type PipelineJob = typeof pipelineJobs.$inferSelect
export type NewPipelineJob = typeof pipelineJobs.$inferInsert
export type Narration = typeof narrations.$inferSelect
export type NewNarration = typeof narrations.$inferInsert
export type Aside = typeof asides.$inferSelect
export type NewAside = typeof asides.$inferInsert
export type Drive = typeof drives.$inferSelect
export type NewDrive = typeof drives.$inferInsert
export type DriveDemand = typeof driveDemand.$inferSelect
export type NewDriveDemand = typeof driveDemand.$inferInsert
