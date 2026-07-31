# Create-a-Drive architecture (V2 roam-first)

**Status:** ✅ BUILT 2026-06-18. The full V2 migration shipped: the `narrations`/`drives`/`asides`
schema (migration 0009 dropped the legacy `tours`/`segments`/`tracks`/`tour_frames` from the live DB, 459
paid clips preserved), the `/drives` API (propose → `buildDrive` → persist) + `GET /regions`, the mobile
Create-a-Drive flow (conversational prompt → map-hero confirm → preview) + Roam-first home, and the
studio/admin/sim rewires onto narrations. OPEN: simulator verification of the live create→drive runtime;
pre-gen aside/bracket library; route-demand cache. Product rationale + the decision journey live in
[../designs/roam-first-create-a-drive.md](../designs/roam-first-create-a-drive.md). Designed via a
3-architecture × 3-judge-lens workflow + a 4-lens terminology audit, then founder-refined.

> **Supersession addendum (2026-06-19).** Three pieces of the data model below have since been
> overtaken; the body is preserved as the V2-cutover record, read these as the current truth:
> - **`asides` was DELETED, not built as described.** Placeless intro/outro/beat framing was dropped
>   from V2 (returns in v3); there is no `asides` table or `aside refs` in the `drives` manifest today
>   (schema; `geometry-first-regions.md`).
> - **Regions are GEOMETRY-FIRST — no `region_id` FK.** `drives` stores its route bbox and derives
>   region by intersect; the `region_id` columns named below (on `drives`, `asides`, `drive_demand`)
>   are gone. See `geometry-first-regions.md`.
> - **Drive credits are a LEDGER, not a `count(drives)` cap.** Consumption + balance live in the
>   append-only `credit_entries` table (a credit is spent at `POST /drives`, never refunded on
>   delete). See `credit-ledger.md`. The "N=10 cap / refunded on failure" wording below is the
>   pre-ledger framing.

> **Supersession addendum (2026-06-20).** The endpoint INPUT model changed: free-text → **structured
> pickers**. The "conversational prompt → LLM resolves each endpoint to an in-region anchor + geocode"
> flow (steps 1–2 below) is GONE — it opened too many edge cases (a "loop" prompt resolved start==end →
> a zero-distance route that crashed the proposal; the name→geocode hop mislocated endpoints, e.g.
> "Tahoe City" → South Lake Tahoe ~28 km off; vague spans were ambiguous). The rider now **PICKS** a
> start + end from the region's real narratable anchors (exact coords, on-content, in-region by
> construction): new `GET /drives/anchors?regionId=` serves the pickable list, and `POST /drives/propose`
> now takes the chosen `{start,end}` and only materializes the route + counts stories (no LLM, no
> geocoding). The mobile create screen is FROM/TO pickers, not a text box. "LLM does ONLY endpoint
> resolution" is now "the rider picks the endpoints; the route + selection stay deterministic."
>
> **Loops.** A round trip is a "Round trip" toggle that swaps the END picker for a MIDPOINT picker:
> the DTOs carry an optional ordered `via` waypoint list, and a loop is `end === start` with one `via`
> midpoint → the route materializes as start→midpoint→start (a real out-and-back, not a degenerate
> zero-distance route). One-way mode disables "Plan the drive" when start == end.

> **Supersession addendum (2026-07-16).** The couch **PREVIEW is CUT.** The old flow "Push to preview
> (couch sim via `buildPreviewTimeline`) → start drive" (step 5 below) is GONE: create-success now lands
> on the drive-detail page, which IS the mini-preview — tap a stop (List row or Map pin) to hear that one
> clip. `?mode=preview`, `buildPreviewTimeline`, and the preview clock in `useDrive` are deleted; the
> player is `sim | live` only. Read every "preview" step below as "the drive-detail mini-preview." See
> [detail-page-mini-preview.md](./detail-page-mini-preview.md).

> **Curated-Places picker addendum (2026-06-20).** The pickable anchor SOURCE changed: the interim
> picker read the 459-POI corpus (`loadRegionAnchors` over `narrations`⋈`pois`) — noisy, and it let an
> endpoint land off any natural gateway. It now reads a per-region **CURATED set of Google Places**
> (towns, marinas, lookouts) — the `places` table, role-tagged `endpoint_eligible`/`break_eligible`
> + `featured`, coords RESOLVED + STORED once at curation, so the runtime picker makes ZERO live Places
> calls. The set is built by an interactive admin `/places` Curate flow (Opus draft → the founder prunes
> → Places Autocomplete+Details resolve, bbox-restricted → role-tagged upsert) — split so the founder
> reviews the exact draft before paying to resolve it — plus a `curate-places` studio CLI for terminal
> use. Region
> membership stays point-in-bbox (geometry-first, no `region_id`). The wire shape is unchanged but for
> `regionAnchor.featured` (the popular subset, floated to the top of the picker). `loadCorpusForRoute`
> (the story layer that rides the route) is untouched. Full spec + the go-sequence:
> [../designs/places-endpoints-spec.md](../designs/places-endpoints-spec.md).

## Context

V2 inverts the hierarchy: **Roam** (ambient) + **Create a Drive** (on-demand A→B) are the first-day
experiences; the hand-authored **Tour is deferred**. V1 never shipped to live users, so V2 **breaks
freely** — storage AND the wire contract (the additive-only posture in
[api-versioning-posture.md](api-versioning-posture.md) is suspended for this one cutover). Create-a-Drive
reuses pre-generated roam narration (no realtime TTS) — "roam, pre-ordered for your route."

## Data model — one atom + sequences over it

`segments` and `tour_frames` **DISSOLVE**. Zero-reuse ([tour-data-model-zero-reuse.md](tour-data-model-zero-reuse.md))
scopes DOWN to govern only narration-kind #3 (deferred authored flavor); roam + drives are shared/region-owned.

```
ATOM     pois ──1:1── narrations   the ONE shared telling (persona baked, region-scoped;
                                    form = story|scenic|break|wave, NO variant)
FLAVOR   asides                 shared, generic, NON-poi: intro/outro + clock-anchored "beats"
         authored flavor            DEFERRED, per-tour, zero-reuse — the only per-sequence narration
ROAM  = a MODE (no table): RoamEngine plays a region's narration atoms by proximity
DRIVE = a stored USER-OWNED sequence (table `drives`): manifest [narration refs + aside refs] + per-route geom
TOUR  = the same sequence shape, CURATED (no owner) + authored flavor.   DEFERRED.
```

**Three narration kinds; zero-reuse governs only #3:** (1) `narrations` 1:1/shared (the atom);
(2) `asides` region+persona/shared/generic; (3) authored flavor per-tour/zero-reuse/DEFERRED.

**DDL (destructive migration — no users):**
- DROP `segments`, `tracks`, `tour_frames`.
- `narrations` — `poi_id` PK/unique (1:1), `form` (story|scenic|break|wave), `script`, `audio_url`,
  `audio_duration_ms`, `attribution`, `facts_hash`. (= old `tracks` minus segment + variant.)
- `asides` — `id`, `region_id` (nullable = global), `persona_key`, `kind`
  (intro|outro|quarter|half|last_stretch|…), `variant`, `script`, `audio_url`, `audio_duration_ms`.
- `drives` — `id`, `user_id` (text, NOT NULL → auth `user.id`, app-boundary validated), `region_id`,
  `label`, `start_name/lat/lng`, `end_name/lat/lng`, `polyline` jsonb, `distance_meters`,
  `duration_seconds`, `route_provenance` jsonb, `route_sig` (text, INDEXED), `selection` jsonb (the
  ordered manifest: narration refs + aside refs + snapped trigger geom + alongSec), `created_at`,
  `updated_at`. Indexes on `user_id` and `route_sig`.
- `drive_demand` — `route_sig` PK, `region_id`, `hits`, `distinct_users`, `last_hit_at`, `warmed_at`
  (instrumentation ONLY; the warming job + route cache are deferred behind this histogram).

**Preserves the hard invariant:** no `createdBy` on `tours`. Ownership lives on `drives.user_id` (a
user-side table), references shared `narrations`, mints nothing. A drive **freezes STRUCTURE** (POIs,
order, trigger geometry, aside slots); **narration CONTENT resolves live** via `poi_id` (a
regenerated telling auto-improves a saved drive; a deleted POI → skip).

**Vocabulary (schema vs UI):** `drives` keeps "drive" in code AND UI (founder accepted the ~442-hit
`drive`/`Drive` identifier collision over `trips`). `narrations` → UI **"stop"** (drive) / **"story"**
(roam), never "narration". `asides` unlabeled in UI ("beat" = the spoken concept).
`poi`/`region`/`persona`/`fact_sheet` strictly internal.

## The flow (two-phase, credit-aware)

1. **Pick region** (explicit picker; bounds the LLM; out-of-region → error). Tahoe at launch, Yosemite
   fast-follow. Also: LLM **suggested A↔B + loops** per region — coverage-grounded, precomputed/cached,
   not live-per-open; tapping skips free-text resolution. Cold-start before `drive_demand` has data.
2. Free-text origin + destination → **`POST /drives/propose`**: a CHEAP LLM resolves each to the best
   in-region anchor (a real landmark/POI/break-stop payoff terminus) + an accurate route preview.
   Persists nothing, no credit. (Loops: the LLM resolves "around the lake" → waypoints; `materializeRoute`
   takes a waypoint ARRAY; `route_sig` must be SHAPE-AWARE so loops don't collide on endpoints.)
3. **Confirm or modify** (re-propose is free).
4. → **`POST /drives`**: deterministic `buildDrive` over reused narrations + asides, persist the
   owned `drives` row, bump `drive_demand`. **Consumes 1 credit (refunded on failure).**
5. Push to **preview** (couch sim via `buildPreviewTimeline`) → **start drive** (live GPS).

- **LLM does ONLY endpoint resolution**; route = `materializeRoute` (Google Routes v2), selection =
  deterministic `buildDrive` (keeps drives fast/frozen/reproducible). No TTS on the path → ~1–2s.
- **Loading = persona-voiced "thinking" phases** (theatrical for v2; don't pad past the real work).
- Sparse route → "not enough here, try a different start/end" (no auto-handoff). Degenerate-route bounds
  ADMIN-configurable.

## Access + monetization

**Anonymous = Roam ONLY.** Creating a drive requires a FREE account (create-action wall at
account-creation — earlier than the play/preview wall; a doctrine refinement for user-GENERATED
artifacts). Free tier caps at **N = 10** drives (admin-tunable); beyond → **one-time credit packs**
(Apple IAP consumables — not a subscription; shares IAP groundwork with the tip-jar idea). Cap ships in
core; the credit IAP is a fast-follow.

## Key engineering decisions

- **`buildDrive()` is NEW in `engine`** (named `buildDrive`, not `generateDrive` — the drive
  simulator already owns `generateDrive` for GPS-fix generation; "drive" stays the product verb +
  `POST /drives`. NOT a refactor of `selectStops`): co-located dedupe
  **inverts to pick-one** (can't fuse finished `.m4a`s); ranks by along-route fit + real
  `audioDurationMs` best-fit + variety; runs server-side AND on-device (offline re-pace). Shared
  pacing (`buildRouteSnapper`, `projectQueueLag`) lives in `engine/pacing.ts`, imported by
  `buildDrive` (the legacy `selectStops`/`selectBreaks`/`snapOf` tour-generation pipeline was removed in
  the V2 migration this doc documents as shipped).
- **Asides = pre-generated GENERIC** (intro/outro + clock-anchored beats). Live-gen / name-
  personalized brackets POSTPONED (measured synth latency too fragile for the mandatory first beat).
  Placed like `selectBreaks` via negative-sentinel seqs (extend `INTRO_SEQ`/`OUTRO_SEQ` in
  `engine/preview.ts` to N asides).
- **`route_sig` + `drive_demand` ship as instrumentation only**; the route cache-warming /
  authored-graduation infra is deferred behind a real route-concentration histogram (charm-not-scale).
- **Offline:** reuse `downloadDrive`'s byte-freeze (`apps/mobile/src/lib/offline.ts`) — store BYTES, not
  presigned URLs; re-presign the stable R2 key at assemble time.

## Build phases

- **P1 — selection core (engine).** Pin `selectStops` tests → extract `engine/pacing.ts` →
  `buildDrive()` + unit tests. Zero spend, no schema, no UI. **(DONE 2026-06-18: the 4 route-geometry
  helpers single-sourced into `engine/geo.ts` (re-exported via `pipeline/geo.ts`, `selectStops`
  untouched); new `engine/pacing.ts` (`buildRouteSnapper` + `projectQueueLag`) + `engine/drive-select.ts`
  (`buildDrive`); both packages typecheck clean + 63 engine tests pass + studio `geo`/`select`
  regression green. UNCOMMITTED.)**
- **P2 — thinnest demoable slice.** `POST /drives/propose` + `POST /drives` + `@skipper/shared` DTOs +
  minimal free-text A→B screen → couch preview. (Needs a free account; persists.)
- **P3 — asides library.** Generic intro/outro + clock beats. **ONE founder-gated paid synth run.**
- **P4 — ownership + credit cap + offline + live drive.**
- **Deferred:** credit IAP, route cache-warming, `tours` (authored).

## Doctrine edits — land WITH the schema-migration phase, NOT before (code is truth)

When the migration (DROP segments/tracks/tour_frames; add narrations/asides/drives) lands, in the
SAME commit update: **CLAUDE.md** (principle #1 → the atom/sequence model + zero-reuse scoped to authored
flavor; the hard invariants → `drives` ownership + the create-action account wall + 1:1 narration; a V2
milestone; stack notes), **[api-versioning-posture.md](api-versioning-posture.md)** (one-time V2 break
suspension), **[tour-data-model-zero-reuse.md](tour-data-model-zero-reuse.md)** (scope down). CLAUDE.md is
at its line ceiling — these are in-place swaps, not additions.
