# Build handoff — self-contained tours, intro/outro, region-keyed host

**For:** a fresh agent executing the build designed in `docs/tour-structure-spec.md`.
**From:** a long design session (2026-06-08). The spec is the **design** source of truth; this is
the **execution** guide + the prompt assets that live only in that session's chat.

> ✅ **UPDATED 2026-06-08 — reflects the final model.** The CANONICAL entity model + migration is
> **`docs/tour-data-model-zero-reuse.md`** — defer to it for all schema. The decisions:
> 1. **Zero-reuse:** `poi_content` DROPPED; FACTS shared on `pois` (+ `facts_hash`/`facts_fetched_at`, the
>    re-fetch mechanism deferred), NARRATION tour-owned on `tour_stops`; no content cache key.
> 2. **Option-B brackets:** intro/outro in a separate `tour_brackets` table — NOT `start`/`finish` stop-types.
> 3. **Every tour INDEPENDENT:** no `direction`/reverse/family. S→N & N→S = two PEER tours, related only
>    via the proximity recommender. **`corridors` MERGED into `tours`** (a tour = the whole self-contained drive).
> 4. **No variant matrix:** duration/notch/interests are NOT separate tours — one tour = one card
>    (`durationBucket`/`interests[]` dropped; notch = a per-stop setting; M1 = dadpocalypse only).
> 5. **regions = a minimal TABLE** (not a pgEnum); **no users → clean DESTRUCTIVE migration**, no back-compat.
>
> (Appendices A/B/C — the prompt assets — are unchanged and correct.)

> ⚠ **RE-GROUND BEFORE TOUCHING CODE.** Main moves constantly (multiple parallel streams). Read the
> current files; any line numbers/snippets here are 2026-06-08 and will have shifted. Verify with
> `git log --oneline -15` and re-read each file before editing.

> ⚠ **Two destructive checkpoints need explicit founder OK** (the permission classifier will also
> block them): the **DB schema migration** against the live Neon DB, and the **live regen** of the
> canonical preview. Do everything else first; pause at those.

---

## 0. Read these first
- `docs/tour-data-model-zero-reuse.md` — **the canonical entity model + migration** (read this for schema).
- `docs/tour-structure-spec.md` — keep ONLY §3 (`tour_brackets`) + §4 (narration quality gate); the rest
  (directionality / family / variant matrix) is SUPERSEDED (see its banner).
- `docs/scenic-stops-spec.md` — a **concurrent** design that is **BLOCKED on this build landing**,
  on the *same* `select.ts`/`generate.ts` seams. Coordinate: land this, then scenic stops. (NOTE: the
  earlier "share one synthetic-anchor scheme with intro/outro" coupling is RESOLVED — Option-B brackets
  are placeless and need no anchor, so they're DECOUPLED from scenic's `'curated'` POI source.)
- `CLAUDE.md` invariants (grounding, the facts/narration split, ready-gate, break-stop framing).

## 1. Current state (regrounded 2026-06-08) — what's built vs. yours

**Already built (do NOT redo):**
- **Voice/codec:** `gemini-3.1-flash-tts-preview` + 32k MP3 + Algenib, in `models.ts`. Duration via
  `pipeline/mp3.ts`. The `resynth-tour.ts` tool re-synths a tour's clips from stored scripts.
- **Host-agnostic PRESENTATION layer:** `apps/api/src/host.ts` = `Record<Persona, HostIdentity>`
  (name/tagline/backstory/portrait/voice-sample), served by the API; `HostIdentity` DTO in
  `@skipper/shared`. The "meet your skipper" data already exists. **This is the pattern your region
  registry mirrors.**
- **Multi-source facts:** Wikidata (CC0) + Macrostrat geology (CC BY) enrichment; `attribution` is
  now an **array** (`AttributionSnapshot[]`); `/sources` catalog; `/sign` returns `contentType`.
- **GPS Phase 2 player** (simulated fix source).

**Yours to build (none of this exists yet):**
- Quality-gated narration prompt + intro/outro narration modes.
- Region-keyed host **registry** (generation side) — replaces the `persona` enum + `PERSONA_VOICE`
  + hardcoded kit regexes; mirrors `host.ts`'s `Record<>` pattern.
- **The zero-reuse reshape:** drop `poi_content`; fold narration onto `tour_stops`
  (`script`/`audio_url`/`audio_duration_ms`/`attribution`/`reviewed`/`facts_hash`); add `pois.facts_hash`
  + `pois.facts_fetched_at`. (docs/tour-data-model-zero-reuse.md)
- Schema (canonical: docs/tour-data-model-zero-reuse.md): merge `corridors` into `tours` (route +
  `headline` + end-anchors + `region_id`); a minimal `regions` TABLE; the **`tour_brackets`** intro/outro
  table; drop `durationBucket`/`interests[]`/`persona`.
- **One independent tour per route** generation + the regenerate tool.
- API/DTO (the tour = a drive `{ intro, outro, stops[] }`; drop the `PoiContent` DTO) + mobile catalog
  (**one card per tour**) + the bracket segments.

## 2. Validated decisions — carry these, do NOT re-derive

These were settled by ear / research this session:
- **Delivery = the "warmer" prompt** (Appendix A) — replaces the current `SKIPPER_TTS_STYLE_PROMPT`
  in `models.ts`. Founder picked it over "tightened"/"drier"/"bigger-beat".
- **Narration = quality-gated** (Appendix B): 1–2 best groaners scaled to material, dumb-over-clever,
  story-first, NO pun-chains, **kit banned from stops** (the kit's only home is the intro), no-bow,
  no-mini-recap, grounding ironclad. Two leak-fixes: oblique kit ("before my first cup") + mini-recap.
- **Intro/outro** (Appendix C): the kit lives in the intro; the sentimental bow lives in the outro.
- **Model:** every tour is INDEPENDENT (no direction/reverse/family); `corridors` MERGED into `tours`
  (a tour = the whole self-contained drive); one card per tour; related tours surface via the proximity
  recommender (deferred). NO variant matrix (duration=skip-stops, notch=per-stop setting, interests=stop
  filter — all deferred). region-keyed host (1:1); "Skipper" name kept *for now*.
- **Data model = ZERO-REUSE** (docs/tour-data-model-zero-reuse.md): FACTS shared on `pois` (TTL +
  `facts_hash`), NARRATION tour-owned on `tour_stops`, `poi_content` dropped, no content cache/reuse —
  "tour 1's Camp Richardson ≠ tour 2's." Region/persona/voice/notch are per-tour generation params.
- **Brackets = OPTION B** (spec §3): intro/outro in a separate placeless `tour_brackets` table — NOT
  stop-types; `tour_stops` stays strict (`poiId` NOT NULL); the geofence engine stays homogeneous.
  Triggers are player-owned lifecycle (intro on-start; outro on end-anchor OR tour-end). Research-backed
  (Fowler STI/CTI, Karwin); CTI is the deferred upgrade path.
- Everything else: see the spec.

## 3. Build phases (file-level)

> ✅ **STATUS 2026-06-08 — Phases 1, 2, 4, 5, 6 DONE + bracket playback** (commits `67e9313`/`7860b3f`
> Phase 1; `d0f2ba6`/`f1396cf` Phases 2/4/5 + the live migration + the canonical-preview regen of Phase 6;
> `ecc78a0` the intro/outro bracket PLAYBACK that Phase 5's caveat below flagged as missing). All packages
> typecheck + tests green. **The ONE remaining piece is Phase 3's _generation-side region/host registry_**
> (the `Record<Region, {host,voice,promptOverlay,kit,opener}>` + kit-guard rewire) — deliberately deferred:
> it only matters when a SECOND region/host lands. For the single Tahoe/Skipper region today, the existing
> `SKIPPER_SYSTEM_PROMPT` + `PERSONA_VOICE.skipper` + `host.ts` `hostForRegion` fallback cover it. Phase 3's
> OTHER bullets (zero-reuse write path, one-tour-per-route, `narrateIntro/Outro`→`persistBracket` ready-gate,
> `resynth-tour` tool) all landed with Phase 2.

**Phase 1 — Narration prompt + intro/outro modes (generator-only, safest, fully validated).**
- `packages/generator/src/persona/skipper.ts`: fold Appendix B in — recalibrate the DADPOCALYPSE
  rung to quality-gated (1–2 best, NOT "3–4 groaners"); ban the kit from stops (move it to the intro);
  strengthen no-bow to also forbid mini-recaps; reconcile the *other* density-endorsing spots that
  will now contradict the cap (the "rattle off a CHAIN" line, the Sand Harbor pun-chain calibration
  example, the "drop a quick dad joke between facts" line) — make them coherent with the cap.
- `packages/generator/src/pipeline/narrate.ts`: add `narrateIntro` + `narrateOutro` (Appendix C),
  persona-only, no fact sheet; notch-parameterized.
- `packages/generator/src/models.ts`: replace `SKIPPER_TTS_STYLE_PROMPT` with Appendix A (warmer).
- Verify: `cd packages/generator && bunx tsc --noEmit && bun test`. Commit.

**Phase 2 — Schema + migration** (CHECKPOINT — live DB).
- `packages/db/src/schema.ts` + `@skipper/shared/enums.ts`:
  - **Zero-reuse reshape** (zero-reuse doc §3/§6): `DROP TABLE poi_content`; add narration cols to
    `tour_stops` (`script`, `audio_url`, `audio_duration_ms`, `attribution`, `reviewed`, `facts_hash`)
    and drop `poi_content_id`; add `pois.facts_hash` + `pois.facts_fetched_at`.
  - **`tour_brackets`** table (intro/outro drive-frame): `(id, tourId→tours, kind ∈ {intro,outro},
    script, audio_url, audio_duration_ms, reviewed)` + a `bracket_kind` pgEnum. NO `poiId`, NO coords.
    (NOT `start`/`finish` stop-types — `stopType` enum is UNCHANGED.)
  - **`regions` TABLE** (minimal: `id, slug, display_name`; seed `('lake-tahoe','Lake Tahoe')`). `tours`
    gets a `region_id` FK; drop the `persona` column + the `persona` enum. (No pgEnum → no enum-value rename.)
  - **Merge `corridors` into `tours`:** `tours` absorbs `polyline` + distance/duration + `headline` + the
    two end-anchors `{name,lat,lng}` (start/end) + `region_id`; DROP the `corridors` table, plus
    `tours.durationBucket` + `tours.interests[]` (no variant matrix).
- Migration: `db:generate` + `db:migrate` (dotenvx) — clean + **DESTRUCTIVE** (no users → no back-compat,
  no data fold). It's all codegen-able (`CREATE TABLE regions`/`tour_brackets`, `ADD`/`DROP COLUMN`,
  `DROP TABLE poi_content`/`corridors`, `DROP TYPE persona`); the data lands fresh in the Phase-6 regen.

**Phase 3 — Generator: registry + one-tour-per-route generation + regen tool.**
- New **region/host registry** (generation side): `Record<Region, { host, voice, promptOverlay, kit,
  opener }>`; `Region` type = registry keys; make the kit-overuse lint/`generate.ts` guards read kit
  terms FROM it (not hardcoded). Mirror `host.ts`. Co-locate with or alongside `persona/`.
- **Zero-reuse write path:** narration is written onto `tour_stops` (no `upsertPoiContent`, no shared
  content rows); set `tour_stops.facts_hash` for fact-grounded (story) stops + stamp `pois.facts_hash`/
  `facts_fetched_at` on fetch. (The TTL re-fetch + staleness sweep are a DEFERRED roadmap TODO — no `FACTS_TTL` yet.)
- **One independent tour per route:** each tour is self-contained (own route + stops + narration); S→N and
  N→S are two separate tours authored independently (no "generate twice over one route," no family).
  drive-core needs NO traversal change — there is no direction concept.
- `narrateIntro`/`narrateOutro` (persona-only, no fact sheet) → write to **`tour_brackets`** via a new
  `persistBracket()` (NOT `upsertPoiContent`). **Ready-gate:** the two bracket inserts MUST co-commit in
  the same `finalizeTourReady` `db.batch` as `status='ready'` (today that batch is `tour_stops`-only).
  Brackets carry no attribution (no facts).
- Extend `resynth-tour.ts` (or a new tool) to regenerate the canonical preview's *scripts* (not just
  re-synth audio) at the new prompt + add the brackets; clip keys are tour-scoped (`clips/<tourId>/…`).

**Phase 4 — Shared DTO + API.**
- `@skipper/shared/schemas.ts`: tour detail = a drive `{ intro, outro, stops[] }` carrying route/anchors/
  region + the composed name (`[headline], [start] to [end]`); drop the `PoiContent` DTO; the stop DTO
  carries `script`/`audio`/`attribution`.
- `apps/api`: `host.ts` keyed by region slug; serve the bracket clips via `/sign`
  (`tour_brackets.audioUrl`, tour-scoped R2 keys) and the stop clips likewise; list tours (one per route).
  (Nearby/proximity recommender deferred to v2.)

**Phase 5 — Mobile.**
- `apps/mobile/app/preview/[id].tsx` + `@skipper/drive-core`: **prepend the intro bracket, append the
  outro bracket** around the stop timeline (intro plays first regardless of position; outro at end) —
  they're `tour_brackets` clips, NOT `PreviewStop`s, so they bracket the timeline rather than join the
  route-positioned stop list. The pure geofence engine still consumes only `tour_stops`; drive-core
  needs **no traversal param** (there is no direction concept). ✅ **DONE (`ecc78a0`):** a bracket is a
  clip with a sentinel seq (`INTRO_SEQ`/`OUTRO_SEQ` in drive-core); the preview emits intro/outro segments
  at the timeline head/tail, and `useDrive` queues the intro at `start()` and the outro at `reachedEnd`
  (the outro plays before the drive ends — the old "`finishDrive` plays nothing" gap is closed).
- Catalog: **one card per tour** (no direction/family/variant cards). Related tours surface only via the
  nearby/proximity recommender (deferred to the location-filter near-me, v2).
- Pre-drive UI: where-to-start guidance + onboarding (NOT in the skipper's voice).

**Phase 6 — Live regen** (CHECKPOINT — needs explicit founder OK; costs GCP + mutates live R2/DB).
- Regenerate the canonical preview end-to-end: new scripts (quality-gated) + intro/outro brackets +
  warmer delivery + the `persona`→`region` change (drop `persona`, add `region_id`, seed the `regions`
  row) — **all in one regen pass**. Under zero-reuse the new clips are written **tour-scoped**
  (`clips/<tourId>/…`), so there is no R2 rekey to orphan (the old `clips/skipper/…` objects are swept as the regen writes fresh).
  Verify end-to-end through the presign path (as `resynth-tour` did: ffprobe a clip, durations match,
  plays; both brackets present). Founder re-validates warmer + quality-gated by ear on the full tour.

## 4. Gotchas
- **dotenvx + relative SA key:** run generator scripts from the **repo root** (`GOOGLE_APPLICATION_
  CREDENTIALS` is a relative path). `dotenvx run -f .env.development -- bun packages/generator/...`.
- **Module resolution:** generator scripts that import the package must live **inside**
  `packages/generator/` (transitive deps like `google-logging-utils` fail from outside the workspace).
- **Persona/kit terms are load-bearing in `lint.ts`/`generate.ts` regexes** — the registry move must
  keep those guards working (read terms from the registry).
- **No content cache key (zero-reuse).** Narration is tour-owned, so the old "`persona→region`
  content-key" and "`direction`-in-key (M4)" concerns are MOOT — directions narrate independently with
  no collision. The only invalidation that survives: a poi re-fetch that changes `pois.facts_hash` marks
  dependent (story) `tour_stops` stale → regenerate (zero-reuse doc §4B).

---

## Appendix A — Warmer delivery prompt (→ `SKIPPER_TTS_STYLE_PROMPT`)

> Read this as a warm road-trip tour guide letting friends in on jokes you all secretly enjoy —
> genuinely glad they came, a man who has told these corny jokes a thousand times and quietly loves
> every one. Keep the narration moving at a natural, easy talking pace, like a man telling you about
> the view out the window — relaxed but never sleepy, never dragging. Save the slow-down for the
> jokes: deliver them deadpan and fully committed, but with a confiding warmth, as if you and the
> riders both know it is corny and that is exactly why it is good. Never laugh at your own setup,
> never sing-song the punchline; land each one flat and matter-of-fact. Put a small pause right
> before the pun and a beat right after for the groan, then roll on. Let the sincere lines breathe,
> but keep everything else moving. Talking WITH friends, not at a crowd.

## Appendix B — Quality-gated narration (fold into the DADPOCALYPSE rung in `skipper.ts`)

QUALITY OVER QUANTITY: land your ONE best groaner per stop — funniest/dumbest/most eye-rolling pun
off the real material — and a SECOND only when the facts genuinely hand you another that lands as
hard. Never a third, never a stacked pun-chain on one word ("pure bliss, marital bliss, bliss
point"), never a forced joke. Dumb over clever (if a line is witty, make it dumber until it groans).
STORY-FIRST: a warm telling with the groaner(s) woven through, flowing spoken sentences (no choppy
"A rock. Balancing." fragments), real sincere beats carrying the rest. Thin stop → 0–1; rich stop →
2. **Kit banned from stops** (Ray/mechanic/truck/coffee live in the intro now — including oblique
refs like "before my first cup", "balance a checkbook"). **No bow / no mini-recap** close (end on a
concrete thing mid-stride; don't re-list what you just covered). Grounding ironclad: every joke
rides a real fact or is a fact-free groaner off road/water/weather; the fact survives the joke being
deleted; ZERO invented specifics. (Validated on the Olympics + D.L. Bliss stops by ear.)

## Appendix C — Intro / outro

**Intro** (persona-only, no fact sheet; fires on tour-START, not geofenced; position-agnostic):
welcome aboard + the trip's shape in REGION + drive framing by **destination + the trip's endpoints**
(name them descriptively, NEVER "you are now at Tahoe City") + **ONE big standalone personal KIT
joke** (the one joke freed from grounding — cousin Ray, the "Tuesday" mechanic, the cranky truck,
coffee). Doubles as "meet your host". Notch-scaled (off = sincere, no big joke). End pointing down
the road; no bow. *(Validated: the Ray "just keep the wet part on your left" opener.)*

**Outro** (fires on end-anchor OR tour-end): arrive + name the end-anchor + the **warm sign-off**
(the bow we ban everywhere else lives here) + a **notch-scaled closing groaner** + an optional
**intro callback** (bookend) + a **reserved tip-jar slot** (deferred). Notch-scaled.
