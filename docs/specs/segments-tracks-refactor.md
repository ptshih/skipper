# Segments / Tracks data-model refactor

> **Status:** BUILT 2026-06-12 — cutover executed on `main` (no worktree). The data-preserving
> `0010` below was DROPPED in favor of a clean NUKE (founder OK'd; no users): schema rewritten to
> the locked model, single fresh `0000` baseline, DB + R2 wiped + reseeded, every caller repointed
> (generator/api/admin/mobile/sim/drive-core/shared), `bun run check` green. Content REGEN (the 2
> tour shells + the roam corpus) runs separately via Cloud Run — the shells are reseeded as `draft`.
> **Zero-reuse SURVIVES** (D1); addendum recorded on `docs/decisions/tour-data-model-zero-reuse.md`.
> The migration section below is kept as the DESIGN record, but the nuke replaced its data-moves.
> DEFERRED to follow-ups: the `generateOneTrack` atom extraction; wiring client `hostIdentity` to
> read the `personas` table (still served region-keyed from `apps/api/host.ts`).

## TL;DR

Collapse the three narration owners (`tour_stops`, `tour_brackets`, `roam_clips`) into a clean
two-table model — **`segments`** (a place-anchor) + **`tracks`** (the narration units, 1:N per
segment) — plus **`tour_frames`** (renamed `tour_brackets`, placeless drive-frame) and a new
first-class **`personas`** table (the host, decoupled from region). Relocate side-of-road onto
`pois`, collapse `poi_overrides` to fact-corrections, and drop `saved_tours`. **Data-preserving**
(remap the existing 26 stops + 273 roam clips + 4 frames, keep all R2 audio, **zero regeneration**).

## The locked model

```
personas      id, persona_key (unique slug → code recipe), name, tagline, backstory,
              portrait_url, voice_sample_url, voice_id (server-only), timestamps
              -- identity in the table; the system prompt + kit stay in CODE (PersonaDef), keyed by persona_key

regions       UNCHANGED: id, slug, displayName, timestamps   -- manual tour attribute, no geometry

pois          + speakable_lat, speakable_lng (nullable)      -- side-of-road "where to look" anchor

poi_overrides fact-corrections ONLY: drop kind / side_anchor_lat / side_anchor_lng + the enum;
              unique index becomes (source, source_id, find) NULLS NOT DISTINCT

tours         UNCHANGED: region_id is a MANUAL FK set at creation (no derivation)

segments      id, poi_id NOT NULL→pois, tour_id?→tours (set=stop / null=roam),
              persona_id NOT NULL→personas (frozen host), seq?, trigger_lat?, trigger_lng?,
              approach_heading_deg?, radius_m?, timestamps
              CHECK ((tour_id IS NULL) = (seq IS NULL)); UNIQUE(tour_id,seq); idx poi/tour/persona

tracks        id, segment_id NOT NULL→segments, form (track_form), variant int default 0,
              ...trackColumns, timestamps;  UNIQUE(segment_id, form, variant)

tour_frames   id, tour_id NOT NULL→tours, kind (frame_kind: intro|outro), ...trackColumns, timestamps
              UNIQUE(tour_id, kind)   -- placeless; attribution/facts_hash stay null

-- ...trackColumns (shared Drizzle spread helper, enforced by a new lint:
--   script, audio_url, audio_duration_ms, attribution jsonb, facts_hash)
-- enums: NEW track_form('story','scenic','break','wave','bside'), frame_kind('intro','outro')
--        DROP stop_type, bracket_kind, poi_override_kind
-- DROPPED tables: tour_stops, roam_clips, tour_brackets, saved_tours
-- UNCHANGED: eval_runs, eval_scores, pipeline_jobs, auth tables
```

## Vocabulary (locked — keep doctrine in lockstep)

- **segment** = a location's chapter / place-anchor (the composition root).
- **track** = what the phone plays — the narration deliverable (player-side). Our `track` is the dry
  **narration stem**, NOT a wet mix (Skipper is stems/live-mix: the bed is the rider's audio /
  client `driveMusic`, composed at playback). Industry "track = wet mix" — note the deliberate divergence.
- **narration** = the pipeline-side artifact (the `script` + provenance face of a track row). NOT a table.
- **cut** = RESERVED for future archival/guest inserts (separate per-segment asset; not built).
- **frame** = placeless drive-structure (intro/outro), tour-owned (`tour_frames`).
- **persona** = the host; first-class. **bed/segue/SFX** = client-side, never stored.

## Decisions (the WHY — do not re-litigate)

- **D1 — Why segments+tracks (zero-reuse survives).** A segment's tracks can differ (`wave`/`story`/
  `bside`; tours' future tell-me-more B-side), so "what kind of telling" is a per-**track** property,
  not a place property → narration is a 1:N `tracks` child of a place-anchor `segment`. A track is
  still owned by its segment's context; tours and roam never cross-feed. Same rule, cleaner shape.
- **D2 — No `kind` on segment.** Treatment/depth lives on the track as `form`. Because a segment has
  many tracks of different forms, a single segment-level "kind" is impossible. This also killed a
  two-axis "story" collision (no `landmark` rename needed) and left the segment a neutral anchor.
- **D3 — No `context` on segment.** Derived from `tour_id` presence (set = tour stop; null = roam).
- **D4 — Region is MANUAL, tours-only, no geometry.** Tours are hand-curated; the author already knows
  the region (`tours.region_id` set at creation). POIs/roam have no region. Roam's host is a generation
  **batch parameter** (a sweep runs for a region → its host), frozen on `segment.persona_id` — never
  derived from coordinates. So `regions` stays as-is; adding region #2 = an INSERT + a code PersonaDef.
  (The earlier bbox/centroid/derivation exploration was over-engineering — dropped.)
- **D5 — Persona DECOUPLED from region, stored frozen.** `segments.persona_id → personas.id`
  (`onDelete restrict`), assigned at generation, frozen. Tours = one host; roam = the batch's host.
- **D6 — `persona_id` (uuid FK), not `persona_key`.** Consistent with the schema's uuid-surrogate
  convention; rename-safe. `persona_key` survives as the unique slug bridging to the code recipe.
  Persona is a stable internal entity (a live FK), NOT frozen-provenance like `attribution`.
- **D7 — Personas split: identity in the table, recipe in code.** Identity (name/tagline/backstory/
  portrait/voice_sample/voice_id) → `personas` (FK target, client-served via `hostIdentity`,
  no-deploy display edits). System prompt + kit → CODE (the highest-leverage file; must stay
  version-controlled/iterated; never reaches the client), keyed by `persona_key`.
- **D8 — Side-of-road kept, relocated.** Anchor → `pois.speakable_lat/lng` (a place's vantage,
  shared, survives re-fetch). `poi_overrides` collapses to fact-corrections. The side (left/right)
  stays computed per-segment from `approach_heading_deg` × the speakable anchor.
- **D9 — `saved_tours` removed.** Save-for-later cut entirely (table + API + mobile + the CLAUDE.md
  anonymous-tours line reworded: the no-ownership rule stays, the join mechanism goes).
- **D10 — `tour_frames`** (renamed `tour_brackets`): extensible `kind` (intro/outro now), shares
  `...trackColumns`. Interstitials/ads are separate FUTURE concerns (interstitials ≈ placeless
  pools; ads ≈ a commercial system) — do not anticipate them now.

## Grounded data facts (probed live 2026-06-12)

26 `tour_stops` (0 with `meta` → dropped as unused) · 273 `roam_clips` · 4 `tour_brackets` ·
1 `side_anchor` override → `pois.speakable` · 4 `fact_edit` overrides (stay) · 1 region · 0 `saved_tours`.

## The migration — `0010_segments_tracks.sql` (data-preserving)

Reuses old row ids as `segment` ids so the R2 keys (`clips/<tourId>/<stopId>`) and `pipeline_jobs.target_id`
audit refs stay valid. Hand-authored (drizzle-kit won't generate data-moves) — when wiring in, generate
the structural diff then merge the COPY block, or author as a custom migration with a matching snapshot.

```sql
-- A. New enums + personas
CREATE TYPE "track_form" AS ENUM ('story','scenic','break','wave','bside');
CREATE TYPE "frame_kind" AS ENUM ('intro','outro');
CREATE TABLE "personas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "persona_key" text NOT NULL, "name" text NOT NULL, "tagline" text, "backstory" text,
  "portrait_url" text, "voice_sample_url" text, "voice_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX "personas_key_uq" ON "personas" ("persona_key");
-- ⚑ phase 2: lift tagline/backstory/art from the code PersonaDef so hostIdentity display doesn't regress
INSERT INTO "personas" ("persona_key","name","voice_id") VALUES ('skipper','Skipper','Charon');

-- B. regions: UNCHANGED (manual tour attribute, no geometry — see D4)

-- C. pois gain speakable; migrate the 1 side_anchor in
ALTER TABLE "pois" ADD COLUMN "speakable_lat" double precision;
ALTER TABLE "pois" ADD COLUMN "speakable_lng" double precision;
UPDATE "pois" p SET "speakable_lat"=o."side_anchor_lat", "speakable_lng"=o."side_anchor_lng"
  FROM "poi_overrides" o
 WHERE o."kind"='side_anchor' AND o."source"=p."source" AND o."source_id"=p."source_id";

-- D. New core tables
CREATE TABLE "segments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "poi_id" uuid NOT NULL REFERENCES "pois"("id") ON DELETE restrict,
  "tour_id" uuid REFERENCES "tours"("id") ON DELETE cascade,
  "persona_id" uuid NOT NULL REFERENCES "personas"("id") ON DELETE restrict,
  "seq" integer, "trigger_lat" double precision, "trigger_lng" double precision,
  "approach_heading_deg" integer, "radius_m" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "segments_tour_seq_ck" CHECK (("tour_id" IS NULL) = ("seq" IS NULL)));
CREATE UNIQUE INDEX "segments_tour_seq_uq" ON "segments" ("tour_id","seq");
CREATE INDEX "segments_poi_idx" ON "segments" ("poi_id");
CREATE INDEX "segments_tour_idx" ON "segments" ("tour_id");
CREATE INDEX "segments_persona_idx" ON "segments" ("persona_id");

CREATE TABLE "tracks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "segment_id" uuid NOT NULL REFERENCES "segments"("id") ON DELETE cascade,
  "form" "track_form" NOT NULL, "variant" integer NOT NULL DEFAULT 0,
  "script" text, "audio_url" text, "audio_duration_ms" integer, "attribution" jsonb, "facts_hash" text,
  "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX "tracks_segment_form_variant_uq" ON "tracks" ("segment_id","form","variant");
CREATE INDEX "tracks_segment_idx" ON "tracks" ("segment_id");

CREATE TABLE "tour_frames" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tour_id" uuid NOT NULL REFERENCES "tours"("id") ON DELETE cascade,
  "kind" "frame_kind" NOT NULL,
  "script" text, "audio_url" text, "audio_duration_ms" integer, "attribution" jsonb, "facts_hash" text,
  "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX "tour_frames_tour_kind_uq" ON "tour_frames" ("tour_id","kind");

-- E. Copy data (segments before tracks; reuse old ids)
INSERT INTO "segments" ("id","poi_id","tour_id","persona_id","seq","trigger_lat","trigger_lng","approach_heading_deg","radius_m","created_at","updated_at")
SELECT ts."id", ts."poi_id", ts."tour_id", (SELECT "id" FROM "personas" WHERE "persona_key"='skipper'),
       ts."seq", ts."trigger_lat", ts."trigger_lng", ts."approach_heading_deg", ts."trigger_radius_m", ts."created_at", ts."updated_at"
  FROM "tour_stops" ts;
INSERT INTO "segments" ("id","poi_id","tour_id","persona_id","seq","trigger_lat","trigger_lng","approach_heading_deg","radius_m","created_at","updated_at")
SELECT rc."id", rc."poi_id", NULL, (SELECT "id" FROM "personas" WHERE "persona_key"='skipper'),
       NULL, NULL, NULL, NULL, NULL, rc."created_at", rc."updated_at"
  FROM "roam_clips" rc;
INSERT INTO "tracks" ("segment_id","form","variant","script","audio_url","audio_duration_ms","attribution","facts_hash","created_at","updated_at")
SELECT ts."id", ts."stop_type"::text::"track_form", 0, ts."script", ts."audio_url", ts."audio_duration_ms", ts."attribution", ts."facts_hash", ts."created_at", ts."updated_at"
  FROM "tour_stops" ts;
INSERT INTO "tracks" ("segment_id","form","variant","script","audio_url","audio_duration_ms","attribution","facts_hash","created_at","updated_at")
SELECT rc."id", 'story', 0, rc."script", rc."audio_url", rc."audio_duration_ms", rc."attribution", rc."facts_hash", rc."created_at", rc."updated_at"
  FROM "roam_clips" rc;
INSERT INTO "tour_frames" ("id","tour_id","kind","script","audio_url","audio_duration_ms","attribution","facts_hash","created_at","updated_at")
SELECT tb."id", tb."tour_id", tb."kind"::text::"frame_kind", tb."script", tb."audio_url", tb."audio_duration_ms", NULL, NULL, tb."created_at", tb."updated_at"
  FROM "tour_brackets" tb;

-- F. Drop old tables
DROP TABLE "saved_tours"; DROP TABLE "tour_stops"; DROP TABLE "roam_clips"; DROP TABLE "tour_brackets";

-- G. poi_overrides → fact-corrections only
ALTER TABLE "poi_overrides" DROP CONSTRAINT "poi_overrides_identity_uq";
DELETE FROM "poi_overrides" WHERE "kind"='side_anchor';
ALTER TABLE "poi_overrides" DROP COLUMN "kind", DROP COLUMN "side_anchor_lat", DROP COLUMN "side_anchor_lng";
CREATE UNIQUE INDEX "poi_overrides_identity_uq" ON "poi_overrides" ("source","source_id","find") NULLS NOT DISTINCT;

-- H. Drop dead enums
DROP TYPE "poi_override_kind"; DROP TYPE "stop_type"; DROP TYPE "bracket_kind";
```

## Cutover plan (do in a WORKTREE — breaks every caller at once)

1. **Schema + migration.** Rewrite `packages/db/src/schema.ts` to the model above (add the
   `trackColumns` spread helper; new `$inferSelect` types: `Segment`/`NewSegment`, `Track`,
   `TourFrame`, `Persona`; drop `TourStop`/`TourBracket`/`RoamClip`). Wire `0010` into drizzle so the
   journal/snapshot stay consistent. Add `scripts/lint-enums.ts`-style guard that `tracks` &
   `tour_frames` both spread `trackColumns`. Update `scripts/lint-enums.ts` pairs (track_form/frame_kind
   ⇄ their Zod twins; drop stop_type/bracket_kind). Show the SQL, then apply with `bun run db:migrate`.
2. **Generator persist.** Rewrite `persist.ts` / `generate.ts` / `generate-narrations.ts` to write
   `segments`+`tracks` (and `tour_frames`); **extract `generateOneTrack(segment, context, persona, {ground?})`**
   (the atom — already inlined in `generate-narrations.ts`; dogfood roam onto it; `{ground?}` is the seam for
   a future runtime grounding gate). `patch-clip` / `resynth*` operate on `tracks`. Persona is assigned
   here (tour = one host; roam = the sweep's host) and written to `segment.persona_id`.
3. **API + admin reads.** Repoint queries to `segments`+`tracks`, **mapping to the EXISTING wire DTOs**
   (`tourDetail`/`tourStopView`/`roamPin`/`signedAudio`) so the contract — and the mobile app — stay
   stable. `hostIdentity` now resolves from the `personas` table (via `segment.persona_id`). Update the
   admin console's attribution / unattributed-count / ear-pass queries.
4. **Mobile.** Remove the saved-tours screen + save button (the only forced client change).
5. **Docs.** CLAUDE.md (the three-owners invariant → segments/tracks; persona-region decoupling; the
   saved_tours line; side-of-road → `pois.speakable`); a dated addendum on
   `docs/decisions/tour-data-model-zero-reuse.md`; flip THIS spec's status to BUILT.

## Wire stability & remaining gaps

- **Wire stays stable** — this is storage-internal; the API projects `segments`+`tracks` onto the
  current DTOs. Mobile change = saved-tours removal only. (Pre-App-Store TestFlight, so even a wire
  change is allowed, but minimizing churn is the goal.)
- **⚑ Skipper identity backfill** (phase 2): lift `tagline`/`backstory`/`portrait`/`voice_sample` from
  the current code `PersonaDef` into the `personas` seed so `hostIdentity` display doesn't regress.
- **Before dropping**: grep generator/api/admin/mobile for every reference to `tour_stops` /
  `roam_clips` / `tour_brackets` / `saved_tours` / `stopType` / `side_anchor` and repoint.

## Provenance

Designed across a long session 2026-06-12. Enables the `generateOneTrack` atom → the future
"generation as a runtime capability" direction (session-pack, narrate-my-route, Skipper-FM) and the
runtime grounding gate. Related: `docs/decisions/tour-data-model-zero-reuse.md`,
`docs/ideas/free-roam-mode.md`, `docs/ideas/journey-layer.md`, `docs/research/autio-content-moat.md`.
