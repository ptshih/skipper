# Tour data model (canonical)

**Status:** ✅ **BUILT + live-migrated 2026-06-08** (commits `d0f2ba6` schema + cascade, `f1396cf` the
applied migration baseline; the canonical preview was regenerated into this model = tour `9ac50db5`). The
design below is now the SHIPPED entity model, not a proposal. It remains the **single source of truth** for
the entity model + migration; `docs/tour-structure-spec.md` is superseded on the data model (it keeps only
the `tour_brackets` design + the narration quality gate), and `docs/tour-structure-handoff.md` defers here
for schema. Supersedes the "`pois` + `poi_content` are a cache" half of CLAUDE.md principle #1.

⚠ **No users → the migration was clean + DESTRUCTIVE** (the live dev DB was wiped — `DROP SCHEMA` — and
rebuilt from a single fresh baseline `0000_worried_hellcat.sql`; no back-compat, no data fold). The DDL in §3
matches `packages/db/src/schema.ts` as shipped.

The model rests on three decisions, in order:
1. **Zero-reuse** — facts shared, narration tour-owned (§1).
2. **Every tour is independent** — no direction/reverse/family; a tour is the whole self-contained drive,
   so `corridors` merges into `tours` (§2, §3).
3. **No variant matrix** — duration/notch/interests are not pre-generated tours; one tour = one card (§2).

## 1. Zero-reuse: shared facts, tour-owned narration

**Tour 1's Camp Richardson is ALWAYS a different telling from Tour 2's, even though both resolve to the
same Wikipedia POI.** So:
- **FACTS are SHARED** — deduped once per place (`pois`).
- **NARRATION is TOUR-OWNED** — generated per tour, **never shared or reused** across tours.

This maps *"Persona lives in DELIVERY, never in FACTS"* onto storage: **FACTS = the shared `pois` row;
DELIVERY = the per-tour `tour_stops` row.** The previous model keyed narration by
`(poi, persona, voice, joke_level)` — a content cache asserting "same place + params ⇒ same telling,"
which is wrong for this product (and was the root of design-review **B1**: two tours over the same POI
clobbering the shared clip). Zero-reuse deletes the assertion and the blocker together.

**Cost:** we re-narrate every shared place per tour. At M1 (one tour) that's zero — it's today's
generate-and-use behavior. At breadth it's GCP credits on a toy, not a scaling wall.

## 2. Every tour is independent (no direction, no family, no variant matrix)

A tour is a **self-contained drive**: its own route (polyline + endpoints), ordered stops, intro/outro,
name, and narration. There is **no "direction" / "reverse" / "forward" concept and no "drive family."** An
S→N Emerald Bay run and an N→S run are **two independent peer tours** (each its own road-correct route +
anchors + stops + narration), related only via the **nearby/proximity recommender** (anchor-coord
distance) — never paired in the schema. The "direction" is just the tour's own start→end anchors.

- **`corridors` merges into `tours`** — a tour carries its own geometry (the old shared-route table is
  gone). Design-review **B3** ("reverse-polyline source") dissolves; the "both directions? / 2× cost"
  heuristic is moot — authoring the other way is just authoring another independent tour.

**No variant matrix.** Duration, notch, and interests are NOT pre-generated as separate tours (that's
catalog fatigue). **One tour per route = one catalog card.**
- **duration** = skip stops (player-side trim) — DEFERRED, no schema now.
- **notch** (dad-joke-meter) = "1-N off a tour": a per-stop narration dimension the user picks as a
  **setting**, not separate cards. M1 ships `dadpocalypse` only (N=1). The 1-N narration variants are DEFERRED.
- **interests** = a stop filter (stop tags) — DEFERRED.

So `tours.durationBucket` and `tours.interests[]` are **dropped**; `tours.jokeLevel` stays as the one
generated notch.

## 3. Entity model

```ts
// regions — minimal keying TABLE (not a pgEnum). Adding a region = an INSERT, not a migration.
// Host-presentation columns (portrait/voice-sample URLs, the /regions feed) deferred to the 2nd region.
export const regions = pgTable('regions', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull(),                 // 'lake-tahoe'  (the key)
  displayName: text('display_name').notNull(),  // 'Lake Tahoe'  (spoken in narration + shown in the picker)
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => [uniqueIndex('regions_slug_uq').on(t.slug)])

// pois — shared PLACE: facts/coords, deduped once per source. The ONLY cache in the model.
export const pois = pgTable('pois', {
  id: uuid('id').defaultRandom().primaryKey(),
  source: poiSourceEnum('source').notNull(),
  sourceId: text('source_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind'),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  summary: text('summary'),
  facts: jsonb('facts').$type<PoiFacts>(),
  // FACTS freshness (COLUMNS ship now; the re-fetch/TTL MECHANISM is DEFERRED — §4):
  //   facts_fetched_at = TTL clock; facts_hash = change detector (changes only on material change).
  factsHash: text('facts_hash'),
  factsFetchedAt: timestamp('facts_fetched_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('pois_source_source_id_uq').on(t.source, t.sourceId),
  index('pois_kind_idx').on(t.kind),
])

// poi_content — DROPPED (narration moves onto tour_stops; no shared content cache).

// tours — the whole self-contained DRIVE (route + the generation that fills it). `corridors` MERGED IN:
// the tour carries its OWN polyline, distance/duration, headline, start/end anchors, region. One tour =
// one catalog card; no direction/family; no duration/interest variants.
export const tours = pgTable('tours', {
  id: uuid('id').defaultRandom().primaryKey(),
  regionId: uuid('region_id').notNull().references(() => regions.id, { onDelete: 'restrict' }),
  slug: text('slug').notNull(),
  headline: text('headline').notNull(),   // marquee POI ("Emerald Bay"); display name = "[headline], [start] to [end]"
  // Route — absorbed from the old `corridors` table; a frozen rail, authored once via the Routes API.
  polyline: jsonb('polyline').$type<Polyline>().notNull(),
  distanceMeters: integer('distance_meters'),
  durationSeconds: integer('duration_seconds'),
  summary: text('summary'),
  // End-anchors {name, lat, lng}: naming, intro/outro anchoring, GPS-start pin, and the proximity recommender.
  startAnchorName: text('start_anchor_name').notNull(),
  startAnchorLat: doublePrecision('start_anchor_lat').notNull(),
  startAnchorLng: doublePrecision('start_anchor_lng').notNull(),
  endAnchorName: text('end_anchor_name').notNull(),
  endAnchorLat: doublePrecision('end_anchor_lat').notNull(),
  endAnchorLng: doublePrecision('end_anchor_lng').notNull(),
  // Per-tour generation params (NOT a content cache key). jokeLevel = the one notch generated (M1: dadpocalypse).
  jokeLevel: jokeLevelEnum('joke_level').notNull(),
  status: tourStatusEnum('status').notNull().default('draft'),
  routeSig: text('route_sig'),            // optional tour-dedup, forward-compat
  isPreview: boolean('is_preview').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('tours_slug_uq').on(t.slug),
  index('tours_region_idx').on(t.regionId),
  index('tours_status_idx').on(t.status),
])
// DROPPED vs today: corridorId (no corridors table), persona (→ region), durationBucket, interests[].

// tour_stops — ordered stops that OWN their narration (the telling, per tour).
export const tourStops = pgTable('tour_stops', {
  id: uuid('id').defaultRandom().primaryKey(),
  tourId: uuid('tour_id').notNull().references(() => tours.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  // The shared PLACE this stop narrates. Stays NOT NULL — intro/outro are NOT stops: they live in their
  // own `tour_brackets` frame table (§ below), so this FK never relaxes (design-review B2 resolved by
  // restructuring, not nulling).
  poiId: uuid('poi_id').notNull().references(() => pois.id, { onDelete: 'restrict' }),
  stopType: stopTypeEnum('stop_type').notNull(),
  // ── Tour-OWNED narration (was poi_content; NEVER shared across tours) ──
  script: text('script'),
  audioUrl: text('audio_url'),            // R2 object KEY, TOUR-scoped: clips/<tourId>/<stopId>.<ext>
  audioDurationMs: integer('audio_duration_ms'),
  attribution: jsonb('attribution').$type<AttributionSnapshot[]>(),  // frozen at THIS stop's gen time
  reviewed: boolean('reviewed').default(false).notNull(),
  // The pois.facts_hash this stop's narration was generated from. NULL for stops that don't ground on
  // facts (scenic/break) → never fact-stale. Stale iff facts_hash IS DISTINCT FROM pois.facts_hash (§4).
  factsHash: text('facts_hash'),
  // ── Trigger geometry ──
  triggerRadiusM: integer('trigger_radius_m').notNull().default(120),
  triggerLat: doublePrecision('trigger_lat'),
  triggerLng: doublePrecision('trigger_lng'),
  approachHeadingDeg: integer('approach_heading_deg'),
  meta: jsonb('meta').$type<StopMeta>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('tour_stops_tour_seq_uq').on(t.tourId, t.seq),
  index('tour_stops_poi_idx').on(t.poiId),
])

// tour_brackets — the drive's FRAME (intro/outro). NOT stops: placeless by construction, fired by drive
// LIFECYCLE not geofence, so they get their own homogeneous table (Option B). Keeps tour_stops strict
// (poiId NOT NULL) and the geofence engine pure. (Research-backed: Fowler STI/CTI, Karwin — see the
// design review; CTI is the deferred upgrade path if mid-drive non-geofenced playables ever land.)
export const tourBrackets = pgTable('tour_brackets', {
  id: uuid('id').defaultRandom().primaryKey(),
  tourId: uuid('tour_id').notNull().references(() => tours.id, { onDelete: 'cascade' }),
  kind: bracketKindEnum('kind').notNull(),          // 'intro' | 'outro'
  script: text('script'),
  audioUrl: text('audio_url'),                      // clips/<tourId>/intro.mp3, clips/<tourId>/outro.mp3
  audioDurationMs: integer('audio_duration_ms'),
  reviewed: boolean('reviewed').default(false).notNull(),
  // No poiId, no trigger coords, no attribution — brackets are about the DRIVE, carry no place-facts.
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => [uniqueIndex('tour_brackets_tour_kind_uq').on(t.tourId, t.kind)])  // exactly one intro + one outro
```

**`tours.jokeLevel`/voice** are per-tour generation params, NOT a content cache key (the
`(poi, persona, voice, joke_level)` key is gone; voice is still derived from persona via `PERSONA_VOICE`
in `models.ts`). When the 1-N notch lands, the narration grows from one-per-stop to N-per-stop (a child
dimension), and `jokeLevel` relocates from the tour to the narration.

## 4. Facts freshness (COLUMNS now, MECHANISM deferred)

The `facts_hash`/`facts_fetched_at` columns ship in this migration so the schema is forward-compatible,
but the **re-fetch loop + the staleness sweep are a DEFERRED roadmap TODO** (no `FACTS_TTL` value needed
yet). The intended mechanism, recorded so it isn't re-derived:

- **4A — Facts TTL (when to RE-FETCH):** before using a poi's facts for a new tour, if `facts_fetched_at`
  is null or older than `FACTS_TTL`, re-fetch facts (Wikipedia + Macrostrat/Wikidata), rewrite `facts`,
  recompute `facts_hash`, bump `facts_fetched_at`. This is the ONLY reuse in the system — facts reuse.
- **4B — Facts→narration staleness (when to REGENERATE):** a `tour_stop` needs regen iff
  `tour_stops.facts_hash IS DISTINCT FROM pois.facts_hash` (joined on `poiId`), for stops whose
  `facts_hash` is non-null. **Derived by hash, not an explicit flag** — chosen over a `revision` counter
  (a counter bumps on every write incl. no-op re-fetches → false-positive staleness; the hash is
  idempotent and keeps tours decoupled: a re-fetch writes only the `pois` row, dependents go stale by
  comparison, no cross-tour write). Scenic/break/bracket stops carry NULL `facts_hash` → never fact-stale.

## 5. What this dissolves (re the design review)

- **B1 — gone.** No shared content key ⇒ no two-writes-to-one-key collision.
- **B2 — resolved.** Intro/outro get their own `tour_brackets` table (Option B); `tour_stops.poiId` stays
  NOT NULL; the geofence engine keeps a homogeneous `tour_stops`.
- **B3 — dissolved.** No "reverse" exists; each tour is independently routed, so there's no reverse
  polyline to source.
- **The `persona → region` change shrinks to almost nothing.** Region is now a minimal `regions` TABLE
  (not a pgEnum), so there's no `ALTER TYPE … RENAME VALUE`; the change is: drop `tours.persona`, add
  `tours.region_id` FK, insert one `regions` row. (The R2 clip path `clips/skipper/…` → `clips/lake-tahoe/…`
  is moot too — clip paths are tour-scoped `clips/<tourId>/…` now.)
- **M4 "earn the cache machinery" is cancelled for content.** The facts hash/TTL is the (deferred,
  lighter) replacement; `route_sig` tour-dedup survives as a separate optional concern.

## 6. Migration shape (Phase-2 CHECKPOINT — needs founder OK for cost/demo; live Neon DB)

Clean + **destructive** (no users → no back-compat, no data fold). Mostly `db:generate`-able:

- `CREATE TABLE regions (...)`; seed `('lake-tahoe', 'Lake Tahoe')`.
- `ALTER TABLE tours`: ADD `region_id` FK, `slug`, `headline`, `polyline`, `distance_meters`,
  `duration_seconds`, `summary`, the six `start/end_anchor_*` columns; **DROP** `corridor_id`, `persona`,
  `duration_bucket`, `interests`.
- `ALTER TABLE pois`: ADD `facts_hash`, `facts_fetched_at`.
- `ALTER TABLE tour_stops`: ADD `script`, `audio_url`, `audio_duration_ms`, `attribution`, `reviewed`,
  `facts_hash`; **DROP** `poi_content_id`.
- `CREATE TYPE bracket_kind AS ENUM ('intro','outro')`; `CREATE TABLE tour_brackets (...)`.
- `DROP TABLE poi_content`; `DROP TABLE corridors`; `DROP TYPE persona`.
- R2 clip paths become tour-scoped (`clips/<tourId>/<stopId>`, `clips/<tourId>/intro|outro`), written
  fresh during the canonical-preview regen (a generate-from-scratch, not a data copy).

## 7. Code surfaces that change (the build, not exhaustive)

- `pipeline/persist.ts`: drop `upsertPoiContent`; write narration onto `tour_stops`; `persistBracket()`
  for intro/outro; the merged `tours` is created with route+anchors+headline+region_id; the ready-gate
  `db.batch` co-commits the two `tour_brackets` inserts with `status='ready'`.
- `pipeline/storage.ts`: `clipKey` → `clips/<tourId>/<stopId>`; bracket keys `clips/<tourId>/intro|outro`.
- `pipeline/generate.ts`: ready-gate enumerates `tour_stops` + asserts both brackets have audio; set
  `tour_stops.facts_hash` for fact-grounded stops; `narrateIntro`/`narrateOutro` wired in.
- `packages/db/src/schema.ts`: drop `corridors`/`poi_content`/`personaEnum`; add `regions`/`tour_brackets`;
  restructure `tours`/`tour_stops`. `@skipper/shared`: drop `PoiContent` DTO; tour DTO = a drive
  `{ intro, outro, stops[] }` carrying the route/anchors/region; drop `persona`.
- `apps/api`: presign reads `tour_stops.audioUrl` + `tour_brackets.audioUrl`; `host.ts` keyed by region slug.
- `patch-clip.ts`: operates on a `tour_stop` (or `tour_bracket`) row.

## 8. Still open / deferred (not part of this change)

- **`FACTS_TTL` value + the re-fetch/staleness mechanism** — deferred roadmap TODO (§4).
- **1-N notch narration variants, duration skip-stops, interest stop-tags** — deferred (§2).
- **Host-presentation columns on `regions`** (portrait/voice-sample, `/regions` feed) — deferred to the 2nd region.
- **Whether to materialize a `needs_regen` worklist flag** from the §4B hash comparison.
- **`route_sig` tour-dedup / overlap guardrail** — relevant once breadth produces near-duplicate tours
  (two independent tours over ~the same road); a discovery-layer concern, computed from anchors.
