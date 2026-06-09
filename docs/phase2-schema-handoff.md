# Phase 2 handoff — migrate the schema to the simplified tour model

**For:** a fresh agent executing Phase 2 of the directional-tours/intro-outro build (now simplified).
**From:** a long design session (2026-06-08). Phase 1 is DONE + committed.

> ✅ **EXECUTED 2026-06-08 — steps 2a–2g all done** (commits `d0f2ba6` source cascade, `f1396cf` migration
> baseline, `ecc78a0` bracket playback). All packages typecheck + tests green; the live dev DB was migrated
> (clean `DROP SCHEMA` + single fresh baseline `0000_worried_hellcat.sql`) and re-seeded; the canonical
> preview was regenerated into the new model (tour `9ac50db5`, 10 stops + intro/outro brackets, presign-
> verified). This doc is kept as the record of what landed. The one piece intentionally left for the NEXT
> phase is the **generation-side per-region persona registry** (a §4 gotcha + tour-structure-handoff Phase 3)
> — not needed while there is a single region (Tahoe/Skipper).
>
> ⚠ **(original note) RE-GROUND BEFORE TOUCHING CODE** if revisiting — line numbers/snippets here are
> 2026-06-08 and will have shifted. Verify with `git log --oneline -15`.

## 0. Read first
- **`docs/tour-data-model-zero-reuse.md` — THE CANONICAL entity model + migration.** This handoff just
  executes it; if anything here disagrees with it, the canonical doc wins.
- `CLAUDE.md` — invariants + **"no users yet → clean DESTRUCTIVE migrations, no back-compat."**
- `docs/tour-structure-handoff.md` — the full Phase 1–6 arc (Phase 1 done; this is Phase 2).

## 1. What's already done (do NOT redo)
- **Phase 1 — narration prompt + intro/outro modes** (committed `67e9313`, `7860b3f`): `skipper.ts`
  quality-gated (1–2 best groaners, kit→intro, no pun-chains, no-mini-recap); `lint.ts` kit-budget
  inverted to a ban; `models.ts` warmer TTS prompt; `judge-voice.ts` fixed; **`SKIPPER_BRACKET_PROMPT`
  + `narrateIntro`/`narrateOutro` + `buildIntroSheet`/`buildOutroSheet`** in `narrate.ts` (verified, 97 tests).
- Voice/codec: `gemini-3.1-flash-tts-preview` + 32k MP3 + Algenib. Multi-source facts (Wikidata +
  Macrostrat), `attribution` is an ARRAY, `/sources`, `/sign` returns `contentType`. GPS Phase 2 player.

## 2. The model (one paragraph)
Every tour is **independent** (no direction/reverse/family — S→N and N→S are two peer tours related only
via the proximity recommender). **`corridors` merges into `tours`** — a tour is the whole self-contained
drive (route + content). **Zero-reuse:** facts shared on `pois`, narration tour-owned on `tour_stops`,
`poi_content` dropped. **`tour_brackets`** holds intro/outro (Option B). **No variant matrix** —
duration/notch/interests are NOT separate tours (deferred); M1 ships **one tour per route, dadpocalypse
only**. **`regions`** = a minimal table. See the canonical doc for the full DDL.

## 3. Scope + sequence
The schema change cascades through the whole data layer — `@skipper/db`, `@skipper/shared`, the generator
pipeline, the DB seed, and the API. **No users ⇒ land it all together, destructively** (don't try to keep
intermediate states green). Steps 2a–2e restore `tsc`/tests green offline; 2f/2g are the live checkpoints.

### 2a. Schema + shared DTOs (the model) — `tsc` will break here; 2b–2d restore it
- **`packages/db/src/schema.ts`** — apply the canonical-doc DDL: add `regions`; **merge `corridors` into
  `tours`** (`tours` gains `polyline`, `distance_meters`, `duration_seconds`, `summary`, `headline`, the
  six `start/end_anchor_*` cols, `region_id` FK; DROP `corridorId`, `persona`, `durationBucket`,
  `interests`); DROP the `corridors` + `poi_content` tables; `tour_stops` += `script`/`audio_url`/
  `audio_duration_ms`/`attribution`/`reviewed`/`facts_hash`, DROP `poi_content_id`; add `tour_brackets` +
  `bracketKindEnum`; `pois` += `facts_hash`/`facts_fetched_at`; DROP `personaEnum`. Fix `relations` +
  the inferred-type exports (drop `Corridor`/`PoiContent`; add `Region`/`TourBracket`).
- **`packages/shared/src/enums.ts`** — drop `persona`; add `bracketKind = z.enum(['intro','outro'])`.
  (`durationBucket`/`interest` are now unused — leave or remove; they're deferred axes.)
- **`packages/shared/src/schemas.ts`** — drop the `poiContent` + `corridor` DTOs; restructure `tour`
  (drop `corridorId`/`persona`; add `regionId`/route/anchors/`headline`/composed name); `tourStop` (drop
  `poiContentId`; add `script`/`audio`/`attribution`); add `region` + `tourBracket` DTOs and the
  **drive-detail shape `{ intro, outro, stops[] }`**. `tourRequest` loses duration/interests/persona
  (no variant matrix) — a tour is defined by its route+region, generated at dadpocalypse.

### 2b. Generator pipeline — restore green
- **`pipeline/persist.ts`** — drop `upsertPoiContent`; the tour carries its own route, so rework
  `createTour`/`loadCorridor` accordingly (the route is seeded onto the tour, §2c). Write narration onto
  `tour_stops` (a `writeStopNarration`, or fold into `finalizeTourReady`). Add **`persistBracket(tourId,
  kind, …)`**. `finalizeTourReady` co-commits the two brackets + flips `status='ready'` in ONE `db.batch`,
  and the ready-gate asserts every `tour_stops` row AND both brackets have audio. Stamp `pois.facts_hash`
  /`facts_fetched_at` when fetching a poi's facts (the re-fetch/TTL **LOOP is DEFERRED** — just stamp).
- **`pipeline/storage.ts`** — `clipKey` → `clips/<tourId>/<stopId>`; bracket keys `clips/<tourId>/intro|outro`.
- **`pipeline/generate.ts`** — wire the existing `narrateIntro`/`narrateOutro` → `persistBracket`; set
  `tour_stops.facts_hash` for fact-grounded (story) stops; the ready-gate.

### 2c. Seed — `packages/db/seed/` (`corridors.ts`, `materialize.ts`, `seed.ts`)
- Seed `regions` (`lake-tahoe`/`Lake Tahoe`) + the **tour shell(s)**: a curated route spec (waypoints +
  `headline` + curated start/end anchor names/coords + `region_id`) → `materialize` (Routes API) →
  insert a `tours` row (`polyline`/dist/dur/anchors/headline/region_id, `status='draft'`). The generator
  then fills the tour's stops + brackets. Drop the old corridors seed.

### 2d. API — `apps/api/`
- **`src/index.ts`**: `/corridors` → `/tours` (list tours, one per route; no polyline); drop
  `/corridors/:id/tours`; the tour-fetch returns the drive `{ intro, outro, stops[] }`; presign reads
  `tour_stops.audioUrl` + `tour_brackets.audioUrl`.
- **`src/host.ts`**: `Record<Persona>` → keyed by **region slug**; `hostForPersona` → `hostForRegion`.

### 2e. Verify offline (must be green before the checkpoints)
- `cd packages/generator && bunx tsc --noEmit && bun test`; `apps/api` + `packages/shared` typecheck;
  mobile `bun run check` if touched. A `--dry-run` generate (no live DB/GCP) produces a tour in the new
  shape end-to-end.

### 2f. CHECKPOINT — live migration (needs founder OK; destructive, live Neon)
- `bun run db:generate` → **review the generated SQL** → `bun run db:migrate`. Clean + destructive
  (`CREATE TABLE regions`/`tour_brackets`, `ADD`/`DROP COLUMN`, `DROP TABLE poi_content`/`corridors`,
  `DROP TYPE persona`). No data fold (no users). Re-seed (2c) after.

### 2g. CHECKPOINT — regenerate the canonical preview (needs founder OK; GCP cost, mutates live R2/DB)
- Regenerate the preview into the new shape (quality-gated scripts + warmer delivery + intro/outro
  brackets + tour-scoped clips). Verify through the presign path (ffprobe a clip, durations match, plays;
  **both brackets present**). Founder re-validates warmer + quality-gated by ear.

## 4. Gotchas
- **dotenvx + relative SA key:** run generator scripts from the **repo root**
  (`dotenvx run -f .env.development -- bun packages/generator/...`).
- **Module resolution:** generator scripts that import the package must live **inside** `packages/generator/`.
- **DEFERRED (do NOT build now):** the facts re-fetch/TTL loop + staleness sweep (just add+stamp the
  columns); the 1-N notch narration variants; duration=skip-stops; interest stop-tags. M1 = one tour,
  dadpocalypse.
- **Persona/kit terms are load-bearing** in `lint.ts`/`generate.ts` regexes — the generation **persona/host
  registry** (keying the kit guards off a region-keyed registry) is the NEXT phase (3); for Phase 2, just
  don't break the existing skipper guards when you drop the `persona` enum (the host lookup moves to region slug).
- **`drizzle-orm` neon-http is stateless** — co-commit the ready-gate via `db.batch`, no interactive txns.
