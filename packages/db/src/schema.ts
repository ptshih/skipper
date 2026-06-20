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
 *  null for scenic pois (wikidata pins with no Wikipedia article). The curated narration sheet is NOT here — it's the separate typed
 *  `pois.fact_sheet` column (+ `enriched_at`; see `FactSheetEntry`). `extract` = the full article (the
 *  enricher's input + audit source + the un-enriched grounding fallback). A real interface now (was
 *  `Record<string,unknown>`): the bag's shape is STABLE — the extensible/curated part moved to
 *  `fact_sheet` — so typed access beats hand-written casts. */
export interface PoiFacts {
  extract: string
  title: string
  url: string
  pageId: number
  // NOTE: the Wikidata QID is NOT here anymore — it was hoisted to the first-class `pois.qid`
  // column (the canonical identity + dedup key). Discovery rebuilds candidates from that column,
  // not a jsonb dig. Legacy rows may still carry a vestigial `facts.qid` until their next sweep.
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
 * owns no `pois` row — coordinate-keyed Macrostrat geology, QID-keyed Wikidata
 * structured facts, or a `google_places` break-anchor name (which now lives in its OWN
 * `places` table, NOT `pois` — so `google_places` is an attribution source only, never a
 * `poiSourceEnum` member). `narrations.attribution` is therefore an ARRAY — one entry per
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
 * How a DRIVE's frozen route was authored — recorded on `drives.routeProvenance`. Always records the
 * final frozen waypoints + Google Routes totals; `authoring` is present when the endpoints were
 * LLM-proposed (Create-a-Drive resolves the A→B anchors, then materializes + freezes the route) —
 * the "why this route exists" trail.
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
 * route order: a place NARRATION, referenced 1:1 via its poi — content resolves LIVE so a regenerated
 * telling auto-improves a saved drive. The STRUCTURE is frozen at create time (which items, order,
 * snapped trigger geometry); only a narration's audio resolves live. buildDrive (engine) produces
 * the items. (V2: asides — placeless intro/outro framing — were deleted; see geometry-first-regions.md.)
 */
export type DriveSelectionItem = {
  kind: 'narration'
  seq: number
  poiId: string
  narrationId: string
  alongSec: number
  triggerLat: number
  triggerLng: number
  approachHeadingDeg: number
}
export type DriveSelection = DriveSelectionItem[]

/* -------------------------------------------------------------------------- */
/*  Enums — keep these in lockstep with the Zod enums in @skipper/shared        */
/* -------------------------------------------------------------------------- */

// Discovery sources for a `pois` row — Wikidata-spine ONLY. Every POI has a Wikidata QID
// (`pois.qid`, the canonical identity): `wikipedia` = a story place with an article; `wikidata` =
// a scenic pin (a named bay/beach with no article) discovered + owned from Wikidata (CC0 name).
// `google_places` is NOT here — Google break anchors are a different identity universe (no QID,
// keyed by the Google place_id) and live in their OWN `places` table; they're an ATTRIBUTION
// source only (a break clip credits the Places name → AttributionSnapshot keeps `google_places`,
// so that union stays a superset of this enum by two: + macrostrat + google_places).
export const poiSourceEnum = pgEnum('poi_source', ['wikipedia', 'wikidata'])

// NO `joke_level` pgEnum: v2 CUT the joke notch — there is ONE delivery voice (the corny
// telling). Delivery variation returns later as DIFFERENT NARRATORS (a per-narration persona
// key), not a corniness notch column. See docs/decisions/cut-joke-notch.md.

// A NARRATION's treatment/depth — the "what kind of telling" axis. `story`/`scenic`/`break` are
// the drive-stop forms; `wave` is the roam call-out; `bside` is a deferred "tell me more". Mirror
// with the Zod `narrationForm` enum.
export const narrationFormEnum = pgEnum('narration_form', ['story', 'scenic', 'break', 'wave', 'bside'])

// A POI's DELIVERY REGISTER — how the TTS voice READS this place (pace/space/energy), a stable
// property of the place classified once from its Wikidata P31 type (see classify-register.ts) and
// stored on `pois`. Picks a `ttsStyleFor` style suffix on the shared persona base. Mirror with the
// Zod `deliveryRegister` enum (@skipper/shared).
export const deliveryRegisterEnum = pgEnum('delivery_register', ['landscape', 'story', 'town', 'civic'])

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
/*  Shared narration columns — spread into `narrations`.                        */
/* -------------------------------------------------------------------------- */

// The narration payload a player consumes: the script + its synthesized clip + frozen
// provenance. Spread into `narrations`; a row goes live only post-synthesis (audio_url NOT NULL).
const narrationColumns = {
  // The narration text. Nullable through generation; a row only goes live once filled.
  script: text('script'),
  // R2 object KEY (private). The API presigns it after the freemium tier check. NOT NULL — a
  // narration row is only ever inserted post-synthesis (the studio pipeline's narration insert,
  // `generate-narrations.ts`), so the DB enforces the "every live narration has audio" invariant
  // at the boundary, not just in app code.
  audioUrl: text('audio_url').notNull(),
  audioDurationMs: integer('audio_duration_ms').notNull(),
  // Frozen attribution — an ARRAY, one entry per source this clip drew on (Wikipedia
  // CC BY-SA + Macrostrat CC BY + Wikidata CC0, etc.). The studio pipeline MUST populate it for
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
    // The region's bbox — "lng_min,lat_min,lng_max,lat_max". Drives the POI-discovery sweep and
    // the geometry-first point-in-bbox region test. Null = use the studio pipeline's built-in
    // default (currently the Tahoe basin).
    bbox: text('bbox'),
    // Region rollout latch (region-release-gate). NULL = DRAFT: the region is still being tuned and
    // NONE of its POIs are public. Non-null = RELEASED: the region is open. This is the operator-facing
    // control surface — releasing a region (admin POST /admin/regions/:slug/release) stamps this AND
    // bulk-stamps `released_at` on every still-staged narration in the region bbox (auto-release-all).
    // MONOTONIC — only ever set, never cleared (irreversible by design; un-release would orphan saved
    // drives + invalidate offline downloads). See docs/decisions/region-release-gate.md.
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('regions_slug_uq').on(t.slug)],
)

// NOTE: the `personas` table was DROPPED 2026-06-19 (migration 0014) — it was un-consumed scaffolding
// (its only FK reader, `segments.persona_id`, went with `segments` in the V2 collapse; nothing else
// read it). v2 resolves the one host in CODE via `personaFromKey('skipper')` and bakes it into the
// audio; playback shows a fixed `'Skipper'`. The host DEFINITION lives in @skipper/studio's
// PersonaDef (the highest-leverage file). The table REBUILDS when region-skippers ship (M4) — at which
// point a per-region presentation identity (name/tagline/backstory/portrait) needs a home again.

/* -------------------------------------------------------------------------- */
/*  pois — a shared narratable PLACE (Wikidata universe; facts/coords)           */
/* -------------------------------------------------------------------------- */

// The shared facts cache for NARRATABLE places: a place's facts are SHARED by every drive/roam
// that visits it. Narration is NOT here — it is drive/roam-owned (see narrations). Every poi is a
// Wikidata-discovered place keyed by its QID (`qid`, the canonical identity). Google break anchors
// are a DIFFERENT universe (no QID) and live in `places`, not here.
export const pois = pgTable(
  'pois',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // CANONICAL identity — the Wikidata QID. The cross-source dedup key that survives a place's
    // scenic↔story tier flip across re-sweeps (where `source`/`source_id` change but the place is
    // the SAME). NOT NULL: every poi is Wikidata-discovered, so a QID always exists. Hoisted out of
    // `facts` (was `facts.qid`) so discovery + enrichment read it as a column, never a jsonb dig.
    qid: text('qid').notNull(),
    // The per-source NATIVE handle (which external source + its native id): `wikipedia` + pageId for
    // a story place, `wikidata` + QID for a scenic pin. This is attribution/provenance, NOT the dedup
    // key anymore — a tier flip rewrites it in place on the qid-keyed row.
    source: poiSourceEnum('source').notNull(),
    sourceId: text('source_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind'),
    // DELIVERY REGISTER — how the TTS voice reads this place (landscape/story/town/civic), classified
    // once from the Wikidata P31 type (classify-register.ts) + an LLM fallback for the ambiguous tail.
    // Nullable: an unclassified place reads on the `story` base (ttsStyleFor defaults null→story), so
    // this is additive — populating it differentiates the read, never breaks an un-backfilled place.
    deliveryRegister: deliveryRegisterEnum('delivery_register'),
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
    // PRIMARY dedup invariant: one row per Wikidata QID. Catches a scenic↔story tier flip that
    // (source, source_id) misses (the place keeps its QID while source/source_id change).
    uniqueIndex('pois_qid_uq').on(t.qid),
    // SECONDARY: per-source native-id uniqueness (a pageId / a QID is unique within its source).
    // Still true, kept as a guard; no longer the dedup arbiter.
    uniqueIndex('pois_source_source_id_uq').on(t.source, t.sourceId),
    index('pois_kind_idx').on(t.kind),
    // Bounding-box prefilter for /roam (and any near-a-point query) — bounds the scan instead
    // of loading every roam narration globally before the haversine pass.
    index('pois_lat_lng_idx').on(t.lat, t.lng),
  ],
)

/* -------------------------------------------------------------------------- */
/*  places — Google break anchors (a DIFFERENT identity universe from pois)     */
/* -------------------------------------------------------------------------- */

// Break stops (rest/food/gas pull-offs) are NOT narratable POIs — they have no Wikidata QID, no
// facts, and no story. They live here, in their OWN table, keyed by the Google `place_id` (this
// table's QID-equivalent). SINGLE-SOURCE by design: only ever driven by Google Places — do not add
// other sources here. A break clip credits the Places name via `narrations.attribution`
// (`google_places`), but break NARRATIONS — when un-deferred — get their OWN `detours` table
// (place-anchored break audio), NEVER the pois-bound `narrations` (which is 1:1 with a poi). Today
// this is just the anchor cache; break-stop selection + audio (the `detours` table) are DEFERRED
// (CLAUDE.md), so nothing references this at runtime yet.
export const places = pgTable(
  'places',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // The Google Places API id (the "PID") — this table's canonical identity + dedup key.
    placeId: text('place_id').notNull(),
    name: text('name').notNull(),
    // Google `primaryType` (e.g. 'american_restaurant') — the raw category; the SPOKEN kind is
    // derived from it (studio's `spokenKind`) at use, not stored. Nullable: Places may omit it.
    primaryType: text('primary_type'),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One row per Google place_id — the dedup invariant.
    uniqueIndex('places_place_id_uq').on(t.placeId),
    // Bounding-box prefilter for along-route break search.
    index('places_lat_lng_idx').on(t.lat, t.lng),
  ],
)

/* -------------------------------------------------------------------------- */
/*  detours — place-anchored BREAK audio (the `places` sibling of narrations)   */
/* -------------------------------------------------------------------------- */

// The ONE break telling for a `places` anchor — 1:1 with its place (UNIQUE place_id), the way
// `narrations` is 1:1 with a poi. A break clip names the place + category ("a rest spot's coming
// up") spoken by the region's host; it bakes NO volatile data and NO facts — so there is NO
// `facts_hash` column here (a break is never fact-stale, unlike a story narration). A row exists
// only post-synthesis (`audio_url` NOT NULL), so the DB enforces "a silent break never rides a
// drive". STUB: the schema is here, but break-stop selection + audio generation are DEFERRED
// (CLAUDE.md) — nothing writes or reads this table yet.
export const detours = pgTable(
  'detours',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    placeId: uuid('place_id')
      .notNull()
      .references(() => places.id, { onDelete: 'cascade' }),
    // The break clip script (nullable through generation; a row only goes live once filled).
    script: text('script'),
    // R2 object KEY (private). NOT NULL — a row is only inserted post-synthesis, so the DB enforces
    // the "every break has audio" invariant at the boundary, not just in app code.
    audioUrl: text('audio_url').notNull(),
    audioDurationMs: integer('audio_duration_ms').notNull(),
    // Frozen attribution — credits the Google Places NAME (`google_places`). A break bakes no fact
    // text, so this is the only credit (and there is deliberately no facts_hash — nothing to stale).
    attribution: jsonb('attribution').$type<AttributionSnapshot[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  // UNIQUE place_id = the 1:1 invariant (and the lookup index for the break join).
  (t) => [uniqueIndex('detours_place_uq').on(t.placeId)],
)

/* -------------------------------------------------------------------------- */
/*  poi_overrides — curated FACT corrections for places whose SOURCE is wrong   */
/* -------------------------------------------------------------------------- */

// The fix layer for UPSTREAM source errors. The grounding gate verifies script ↔ sheet, so it
// is structurally blind to a sheet whose source is wrong (found live: Wikipedia's "Leonard" for
// Lennart Palme; the Pope Estate's builder/decade). Each row is ONE documented correction — a
// literal find→replace on the fetched extract — applied by the studio pipeline at fetch time (the seam
// every fact flows through), so the corrected text reaches the narration sheet, pois.facts, and
// facts_hash identically, and old narrations become detectably stale.
//
// Keyed by the pois dedup identity (source, source_id), NOT poiId: overrides apply at FETCH
// time, before generation has upserted the place, so the poi row may not exist yet.
//
// Fact corrections ONLY now (the side_anchor coordinate moved to `pois.speakable_lat/lng`):
//   find/replace — a literal substring edit on the fetched extract ('' deletes the match).
//   Applies ONLY to Wikipedia-fetched prose today (geology/wikidata enrichment lines do not
//   pass the fetch seam). An unmatched find is a no-op — but the studio pipeline WARNS on it, because
//   "source healed" and "source reworded, still wrong" are indistinguishable without a human look.
//
// Discipline: a row is a repair of a VERIFIABLE error, never an editorial rewrite — `reason` is
// mandatory. `upstream_status` tracks contributing the fix back (agent drafts, human submits).
// Rows are curated through the admin console (the seed-bootstrap CLI was removed 2026-06-19).
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
/*  V2 — narrations / drives / drive_demand                                     */
/*  The roam-first model: pois ──1:1── narrations (the shared telling); roam is  */
/*  a MODE over them; a `drive` is a user-owned ordered sequence of them. (Tour  */
/*  tables tours/segments/tracks/tour_frames dropped in 0009; asides — placeless */
/*  framing — dropped in 0018, see docs/decisions/geometry-first-regions.md.)    */
/* -------------------------------------------------------------------------- */

// The ONE shared telling of a place — 1:1 with its poi (UNIQUE poi_id). The atom: roam plays these by
// proximity and every drive REFERENCES them (narration content resolves live via poi_id; nothing else
// owns it). The old roam `tracks` hoisted to hang directly off the poi — no segment, no `variant` (one
// telling per place; multi-telling axes — authored tours, region-skippers — are deferred and re-expand
// storage then; the joke notch was CUT, not deferred). Persona is baked into the single telling (one
// host per region in v2). A
// row goes live only post-synthesis (audio_url NOT NULL, via narrationColumns).
export const narrations = pgTable(
  'narrations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    poiId: uuid('poi_id')
      .notNull()
      .references(() => pois.id, { onDelete: 'cascade' }),
    // story|scenic|wave|bside — the telling's treatment (1:1, so no `variant`). 'break' is enum-
    // valid (wire lockstep) but CHECK-excluded here: breaks live in `detours`, not narrations.
    form: narrationFormEnum('form').notNull(),
    ...narrationColumns,
    // The release latch (region-release-gate). NULL = STAGED (auto-gate passed + persisted, but not
    // public): generation always writes NULL, so a fresh/regenerated telling lands staged. Non-null =
    // RELEASED: the public read paths (GET /roam, buildDrive corpus) serve a clip ONLY when this is set;
    // a `tester` user bypasses the filter and hears staged clips in-app. MONOTONIC by invariant — only
    // ever set (via a region release or a per-clip release), NEVER cleared — so nothing public ever
    // disappears (no drive orphans / no yanked downloads). The regen upsert deliberately omits this from
    // its `set` clause, so re-telling a clip preserves its release state. See
    // docs/decisions/region-release-gate.md.
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // UNIQUE poi_id = the 1:1 invariant (and the lookup index for roam/drive joins).
    uniqueIndex('narrations_poi_uq').on(t.poiId),
    // CC BY-SA legal floor. A STORY clip is fact-grounded (Wikipedia, etc.), so it MUST freeze its
    // attribution — shipping Wikipedia-derived audio with no credit is a license violation. Other
    // forms (scenic/break/wave) ground on no facts and carry none, hence a form-CONDITIONAL CHECK
    // rather than a NOT NULL column. Today only the write-chain (resolveStoryGrounding →
    // factSheetToAttribution) guarantees this; the constraint makes it structural. Widen the form
    // exemption if a fact-grounded scenic/bside ever ships.
    check(
      'narrations_story_attribution',
      sql`${t.form} <> 'story' OR (${t.attribution} IS NOT NULL AND jsonb_array_length(${t.attribution}) > 0)`,
    ),
    // Hard invariant: a BREAK is NOT a narration row — break audio lives place-anchored in `detours`.
    // `'break'` stays in the pg enum only to keep `narration_form` in lockstep with the wire
    // `narrationForm`/`driveClipForm` projection; this CHECK makes "never stored here" structural.
    check('narrations_form_not_break', sql`${t.form} <> 'break'`),
  ],
)

// A user-owned DRIVE: an ordered sequence of place narrations along a frozen route.
// Ownership lives HERE on `user_id` (a drive is user-owned, never a shared content table); anonymous
// callers get roam only. References shared narrations; mints no narration. The frozen
// `selection` manifest is replayed verbatim on re-open (structure frozen; narration content live).
export const drives = pgTable(
  'drives',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Soft ref to the auth `user.id` (TEXT) — auth runs on a SEPARATE neon-serverless pool, so a
    // DB-level FK isn't enforceable here; validated at the app boundary.
    userId: text('user_id').notNull(),
    label: text('label'),
    startName: text('start_name'),
    startLat: doublePrecision('start_lat').notNull(),
    startLng: doublePrecision('start_lng').notNull(),
    endName: text('end_name'),
    endLat: doublePrecision('end_lat').notNull(),
    endLng: doublePrecision('end_lng').notNull(),
    polyline: jsonb('polyline').$type<Polyline>().notNull(),
    // The route's bounding rectangle, derived from `polyline` at create — a STALE-PROOF cache (the
    // polyline is frozen per drive, so this never drifts, unlike a materialized region stamp). The
    // geometry-first replacement for a region FK: a drive's region(s) are DERIVED by intersecting
    // this bbox with regions, NEVER stored. Also the spatial prefilter for "POIs along this route."
    // See docs/decisions/geometry-first-regions.md.
    bboxMinLat: doublePrecision('bbox_min_lat').notNull(),
    bboxMinLng: doublePrecision('bbox_min_lng').notNull(),
    bboxMaxLat: doublePrecision('bbox_max_lat').notNull(),
    bboxMaxLng: doublePrecision('bbox_max_lng').notNull(),
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
    // Soft-delete tombstone — a "remove from my list" action. Read paths (list / replay / sign)
    // filter `deleted_at IS NULL`. Credits are NO LONGER coupled to this: a credit is consumed via
    // the `credit_entries` ledger at generation, and delete emits no `reverse`, so a delete never
    // refunds — without the old "tombstone keeps counting toward the cap" hack. NULL = live.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('drives_user_idx').on(t.userId), index('drives_route_sig_idx').on(t.routeSig)],
)

// Shared route-sig DEMAND counter — instrumentation ONLY in v2 (the cache-warming / authored-tour
// graduation job that CONSUMES it is deferred behind a real route-concentration histogram). One row
// per normalized route signature.
export const driveDemand = pgTable('drive_demand', {
  routeSig: text('route_sig').primaryKey(),
  hits: integer('hits').notNull().default(0),
  distinctUsers: integer('distinct_users').notNull().default(0),
  lastHitAt: timestamp('last_hit_at', { withTimezone: true }).defaultNow().notNull(),
  warmedAt: timestamp('warmed_at', { withTimezone: true }),
})

/* -------------------------------------------------------------------------- */
/*  credit_entries — the user-owned credit LEDGER (append-only; balance = SUM).  */
/* -------------------------------------------------------------------------- */

// Credits are a USER-OWNED, append-only ledger — NOT a count of `drives` rows. Each row is one
// immutable credit movement; a user's balance is SUM(amount). This decouples billing from the
// content table (the old `count(drives incl. tombstones)` was a documented anti-pattern: no audit
// trail, no idempotency, no refund/grant semantics). See docs/decisions/credit-ledger.md.
//   kind:   grant (+) | consume (−) | reverse (± compensating: refund clawback / make-good)
//   source: free_tier (the lifetime free allotment — the only one LIVE today) | apple_iap |
//           google_play | admin_grant. The provider sources + admin make-goods are RESERVED: the
//           IAP/Play purchase plumbing is deferred (idempotency keys on the provider txn —
//           Apple transactionId / Google purchaseToken; see the decision doc).
export const creditEntryKindEnum = pgEnum('credit_entry_kind', ['grant', 'consume', 'reverse'])
export const creditSourceEnum = pgEnum('credit_source', [
  'free_tier',
  'apple_iap',
  'google_play',
  'admin_grant',
])

export const creditEntries = pgTable(
  'credit_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Soft ref to the auth `user.id` (TEXT) — auth runs on a SEPARATE neon-serverless pool, so a
    // DB-level FK isn't enforceable here (same as `drives.user_id`); validated at the app boundary.
    userId: text('user_id').notNull(),
    // Signed units of "one credit = one drive generation": +N grant, −1 consume, ± reverse.
    amount: integer('amount').notNull(),
    kind: creditEntryKindEnum('kind').notNull(),
    // Where the credits CAME FROM — meaningful only for a `grant`. NULL for consume/reverse (a debit
    // has no funding source).
    source: creditSourceEnum('source'),
    // Human/audit note (e.g. the drive id a consume paid for, or a make-good reason).
    reason: text('reason'),
    // Exactly-once key for the movement — the dedupe target. Free grant: `free:<userId>`. Consume:
    // `drive:<driveId>` (a drive charges exactly one credit). A future purchase grant keys on the
    // provider txn (`apple_iap:<transactionId>` / `google_play:<purchaseToken>`); a refund reverse on
    // `reverse:<that key>`. ON CONFLICT DO NOTHING makes grant/consume idempotent under retry.
    idempotencyKey: text('idempotency_key').notNull().unique(),
    // Reserved for promo credits with an expiry; NULL = lifetime (the only kind today). The balance
    // calc IGNORES this until FIFO/expiring-first consumption is built (lifetime-only in v2).
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('credit_entries_user_idx').on(t.userId),
    // Sign floor for the SUM(amount) balance. The balance trusts the kind→sign convention; a
    // wrong-sign movement (a +1 "consume", a negative "grant") would silently corrupt every
    // balance and hand out free drives. grant > 0, consume < 0, reverse non-zero (± by design).
    // Every live row (+N grants, −1 consumes) already satisfies it — pure defense-in-depth.
    check(
      'credit_entries_amount_sign',
      sql`(${t.kind} = 'grant' AND ${t.amount} > 0) OR (${t.kind} = 'consume' AND ${t.amount} < 0) OR (${t.kind} = 'reverse' AND ${t.amount} <> 0)`,
    ),
  ],
)

/* -------------------------------------------------------------------------- */
/*  eval_runs / eval_scores — the DURABLE eval record (observability, not state) */
/* -------------------------------------------------------------------------- */

// The automated quality gate's system of record (V2, 2026-06-19). A RUN is one
// generate-narrations pass over a region's corpus; a SCORE is one (poi × dimension) verdict
// from the inline panel. Keyed to the V2 atom — the poi (id + qid) — not a tour. The gate is
// FAIL-CLOSED: a clip whose GATE dimension (grounding/tts) can't come clean after the bounded
// optimize() retakes is WITHHELD (no narration persisted) and recorded here with withheld=true,
// so the admin sees exactly which places were held back and why.
//
// OBSERVABILITY, never product state: nothing in the player/API reads these; a dry run MAY
// write here (recording the eval is the point) while persisting no narration. Simplified from
// the V1 design (dropped the 100KB artifact blob + the redundant scorecard jsonb + the
// charm/veracity columns the automated gate never runs).

export const evalRunKindEnum = pgEnum('eval_run_kind', [
  'generation', // the inline panel inside generate-narrations (live or dry)
  'offline_audit', // a CLI scoring the existing corpus after the fact
])
export const evalScoreSourceEnum = pgEnum('eval_score_source', ['judge', 'human'])

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** The region slug whose corpus this run covered — NULL for a whole-corpus (explicit-id) run
     *  that spans no single region (the admin surfaces NULL as "All"). */
    region: text('region'),
    kind: evalRunKindEnum('kind').notNull(),
    dryRun: boolean('dry_run').notNull().default(false),
    /** Provenance pins for run-over-run comparison. */
    gitSha: text('git_sha'),
    narrationModel: text('narration_model'),
    judgeModel: text('judge_model'),
    /** Gate verdict: every SHIPPED clip cleared every GATE dimension. */
    pass: boolean('pass').notNull(),
    /** Run tallies — the at-a-glance summary. */
    total: integer('total').notNull(),
    shipped: integer('shipped').notNull(),
    withheld: integer('withheld').notNull(),
    /** Per-dimension mean score (0..1; null = not run). Only the dims the automated gate
     *  runs: grounding/tts (gates) + diversity (advisory). */
    groundingScore: doublePrecision('grounding_score'),
    ttsScore: doublePrecision('tts_score'),
    diversityScore: doublePrecision('diversity_score'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('eval_runs_region_idx').on(t.region, t.createdAt)],
)

export const evalScores = pgTable(
  'eval_scores',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => evalRuns.id, { onDelete: 'cascade' }),
    /** The V2 case identity — the poi row (nullable: a poi may be pruned later). */
    poiId: uuid('poi_id').references(() => pois.id, { onDelete: 'set null' }),
    /** Canonical cross-source key, denormalized for the regression join across runs. */
    qid: text('qid'),
    /** Place name at eval time, denormalized for a readable admin report. */
    name: text('name'),
    dimension: text('dimension').notNull(),
    /** judge = an automated evaluator; human = an adjudication added later (calibration). */
    source: evalScoreSourceEnum('source').notNull().default('judge'),
    pass: boolean('pass').notNull(),
    /** 0..1 (1 = clean) — the StopEval score. */
    value: doublePrecision('value').notNull(),
    /** True when this clip was WITHHELD (a GATE dim stayed dirty after the retakes).
     *  Denormalized onto every one of the poi's rows so "show held-back places" is a flat filter. */
    withheld: boolean('withheld').notNull().default(false),
    findings: jsonb('findings').$type<string[]>().notNull(),
    /** Dimension payload (grounding → ClaimVerdict[]) — the actual report content. */
    detail: jsonb('detail'),
    /** The WITHHELD clip's best-attempt script, so the report can show the held-back telling (a
     *  false-positive sanity check). Set ONLY for a withheld clip + denormalized onto its rows; a
     *  shipped clip's script lives in `narrations`, so this stays null there. */
    script: text('script'),
    /** Free-text annotation (human rows). */
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('eval_scores_run_idx').on(t.runId),
    // The regression join: same place + dimension across runs.
    index('eval_scores_case_idx').on(t.qid, t.dimension),
  ],
)

/* -------------------------------------------------------------------------- */
/*  studio_jobs — the OPERATIONAL record of a cloud studio-ops run (admin console)  */
/* -------------------------------------------------------------------------- */

// eval_runs is the QUALITY record (scores + artifact); studio_jobs is the EXECUTION record
// (who/what/when/status/cost) of a studio-ops CLI run as a Cloud Run Job. Written ONLY by
// pipeline/job-progress.ts when STUDIO_JOB_ID is set, so the laptop CLI never touches it.
// OBSERVABILITY — nothing in the player/API reads it.

// NO `gen_job_kind` pgEnum: the job-kind vocabulary CHURNS (a new ops script = a new kind) and the
// column is OBSERVABILITY-only (nothing reads it for logic), so it's a plain `text` column with the
// closed set single-sourced as the Zod `jobKind` enum in @skipper/shared (validated at the admin-api
// boundary). Adding/renaming a kind is then a code edit — no enum migration. (Was a pgEnum until
// 2026-06-15; migration 0005 dropped the type + renamed sweep_roam_pois → sweep_region_pois.)
export const studioJobStatusEnum = pgEnum('studio_job_status', [
  'queued', // row created (admin-api in v1), Job not yet running
  'running', // the Job flipped it on entry
  'succeeded', // clean exit
  'failed', // threw / terminal API error
  'canceled', // operator-stopped (reserved; no cancel path in v0)
])

export const studioJobs = pgTable(
  'studio_jobs',
  {
    // The row id IS the STUDIO_JOB_ID the Job receives: the admin-api mints it in v1; the hook
    // mints + inserts it for a gcloud-triggered v0 run.
    id: uuid('id').defaultRandom().primaryKey(),
    // Plain text — the closed set is the Zod `jobKind` enum in @skipper/shared (see note above).
    kind: text('kind').notNull(),
    status: studioJobStatusEnum('status').notNull().default('queued'),
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
    index('studio_jobs_created_idx').on(t.createdAt),
    index('studio_jobs_status_idx').on(t.status),
    // At most ONE active (queued/running) run per (kind, target) — the DB-enforced ATOMIC backstop for
    // the SELECT-then-insert idempotency guard in POST /admin/jobs, so a concurrent double-submit / retry
    // can't double-trigger a paid Cloud Run run. PARTIAL (active rows only) so a settled run frees the
    // target for a re-run. Keys on target_id, which buildJobArgs sets to MATCH the studio script's
    // beginJob (per-region for a region run) — so admin- and CLI-triggered runs of the same target agree
    // and two regions can run concurrently. (audit #1 / #9)
    uniqueIndex('studio_jobs_active_target_uq')
      .on(t.kind, t.targetId)
      .where(sql`${t.status} in ('queued', 'running')`),
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

export const placesRelations = relations(places, ({ one }) => ({
  detour: one(detours),
}))

export const detoursRelations = relations(detours, ({ one }) => ({
  place: one(places, { fields: [detours.placeId], references: [places.id] }),
}))

// (No drivesRelations: a drive stores no region FK — region is derived from its bbox geometry.
//  See docs/decisions/geometry-first-regions.md.)

/* -------------------------------------------------------------------------- */
/*  Inferred row types (import via the "@skipper/db/schema" subpath, aliased)   */
/* -------------------------------------------------------------------------- */

export type Region = typeof regions.$inferSelect
export type NewRegion = typeof regions.$inferInsert
export type Poi = typeof pois.$inferSelect
export type NewPoi = typeof pois.$inferInsert
export type Place = typeof places.$inferSelect
export type NewPlace = typeof places.$inferInsert
export type Detour = typeof detours.$inferSelect
export type NewDetour = typeof detours.$inferInsert
export type PoiOverride = typeof poiOverrides.$inferSelect
export type NewPoiOverride = typeof poiOverrides.$inferInsert
export type EvalRun = typeof evalRuns.$inferSelect
export type NewEvalRun = typeof evalRuns.$inferInsert
export type EvalScore = typeof evalScores.$inferSelect
export type NewEvalScore = typeof evalScores.$inferInsert
export type StudioJob = typeof studioJobs.$inferSelect
export type NewStudioJob = typeof studioJobs.$inferInsert
export type Narration = typeof narrations.$inferSelect
export type NewNarration = typeof narrations.$inferInsert
export type Drive = typeof drives.$inferSelect
export type NewDrive = typeof drives.$inferInsert
export type DriveDemand = typeof driveDemand.$inferSelect
export type NewDriveDemand = typeof driveDemand.$inferInsert
