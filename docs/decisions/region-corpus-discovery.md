# Region-corpus discovery (discovery-first reorder)

**Status:** ⚠ **CONSUMER SUPERSEDED by V2 (2026-06-19); the SWEEP survives.** The discovery-first
reorder's region-corpus SWEEP is still live (`discover-pois.ts` → `pois`), but its original consumer
— tour generation off the segments/tracks model — was DROPPED by migration `0009` (V2, 2026-06-18,
which removed `tours`/`segments`/`tracks`/`tour_frames`). The live model is `pois ─1:1─ narrations`
(shared atom) + user-owned `drives`; the live generate step is `generate-narrations.ts`. Current
truth: the schema (`packages/db/src/schema.ts`) and `docs/decisions/tour-data-model-zero-reuse.md`
(itself now "ENTITY MODEL SUPERSEDED by V2"). The history below is preserved as written; present-tense
tour claims are corrected inline.

⚠ **Amended 2026-08-02 (1.1):** the SWEEP is still live and still the point of this record, but its
OTHER consumer is gone too — roam was removed. Read "Generate roam" (§2b) and "the first-day artifacts
are Roam + user-owned Drives" as **the user-owned DRIVE, alone**. The corpus is unchanged: one shared
`pois` substrate, one telling per subject, assembled per drive.

**Note (2026-06-19):** two discovery-mechanic details below are now superseded by later records —
(a) `pois` dedups on the **Wikidata QID** (`pois_qid_uq`), not `(source, source_id)` (now a secondary
guard); the corpus is a Wikidata spine (`docs/decisions/geometry-first-regions.md`, schema). (b) The
committed `packages/db/seed/` directory is GONE (removed 2026-06-19): regions/poi-overrides/speakable
are admin-console-curated, and `materializeRoute` moved to `@skipper/routing`. Read the
"deduped by `(source, source_id)`" and "seed is now just …" lines below as historical.

**Originally BUILT 2026-06-12.** Tour generation no longer discovered POIs live; it selected
from a shared region corpus that a discovery sweep populates first. Seeded draft shells +
committed curated-route artifacts are gone. Superseded the
"tour generate discovers its own route box" flow. Paired with
`docs/decisions/tour-data-model-zero-reuse.md` (the segments/tracks model it rode on) and the
Wikidata discovery spine (`pipeline/wikidata-discovery.ts`).

## The reorder

**Before:** every tour generate called `discoverWikidataPois(routeBox)` live (a WDQS sweep of the
route's bounding box), while roam separately swept the basin into `pois` via `discover-pois.ts`.
Two discovery paths over the same Wikidata spine; tours re-discovered on every run; tours were
pre-seeded as draft shells from committed `tour-specs.ts` + `seed/data/*.json` route artifacts.

**After — one substrate, three steps:**

1. **Discover a region → the shared corpus.** `discover-pois.ts` (the existing bbox sweep) is
   the canonical first step: it discovers every Wikidata-pinned place in a region's bbox, tiers
   them, and upserts STORY rows (Wikipedia prose) + SCENIC pins into `pois`, deduped by
   `(source, source_id)`. The bbox is a generation-op PARAMETER / a per-region default in code —
   `regions` stays geometry-free (D4 of the segments/tracks refactor holds).
2a. **Generate.** _(V2: tours are deferred; the live generate step is `generate-narrations.ts`,
   which narrates the `pois` corpus 1:1 into `narrations`.)_ Historically `generate-tour.ts` read
   candidates from the corpus (via `pipeline/region-corpus.ts::loadCandidatePoisInBox` — that module
   was DELETED once the V2 collapse left it with no importer), scoped to the route's bounding box, and
   rebuilt the SAME `WikiPoi` shape the
   spine emitted — no live WDQS. An empty corpus throws at `$0` ("discover the region first") before
   any paid call. Selection (`select.ts`) and the facts deepen (`loadFreshPoiFacts`) downstream are
   unchanged.
2b. **Generate roam.** Already narrates the corpus — unchanged.

## Why

- **One discovery substrate.** Tours + roam draw from the identical `pois` corpus, so a place
  curated once (a `poi_overrides` fact-edit, a `pois.speakable` anchor) benefits both, and there
  is no duplicated sweep. Tour generates get faster + deterministic (no live WDQS latency/etiquette
  mid-run).
- **Lossless from the pool.** The sweep stores the full discovery payload in `pois.facts` for STORY
  rows — `{extract, title, url, pageId, qid}` — so the (now-deleted) corpus loader could reconstruct the
  `WikiPoi` (incl. the Wikidata `qid` enrichment join) without calling WDQS. SCENIC rows
  (`source 'wikidata'`) carry no prose, exactly as before.
- **No seeded shells.** The seed is now just `regions` + `personas` + `poi_overrides`. _(V2: tours
  are DEFERRED — the first-day artifacts are Roam + user-owned Drives. `materializeRoute` survives but
  now freezes user-owned DRIVE routes — `apps/api/src/drives.ts` — not admin-authored tours.)_ The
  seed-time materialize CLI + `tour-specs.ts` + `seed/data/*.json` + the `wikidata-spine-diff` artifact
  tool were deleted. The two curated Tahoe routes are re-authored through the new system (they were
  not valuable enough to preserve).

## Operator flow (admin)

_(V2: the live corpus pipeline is three steps.)_ Discover region (`discover_pois --apply`) →
`enrich_pois` (paid fact-sheet scout) → `generate_narrations` for the corpus. The empty-corpus guard
makes the ordering self-enforcing. (The old "author a route → `generate` the draft" tour steps are
gone — tours are deferred in V2; user-owned drives freeze their own route via `materializeRoute` at
runtime, see `apps/api/src/drives.ts`.)

## Deferred / open

- **Facts depth — DONE 2026-06-15 (the "real step 1").** The sweep eagerly fetches the FULL article at
  discovery time (`fetchFullExtracts`) and stores it NORMALIZED (`toFacts(...).join(' ')`) in
  `facts.extract` (no separate lead field; `facts.extract` IS the full article, hashed once at sweep).
  Generation READS it — BOTH the roam AND tour per-run deepens are removed (`generate-tour.ts` no longer
  imports `loadFreshPoiFacts`/`fetchFullExtracts`/`FACTS_TTL_HOURS`); normalizing at the sweep makes the
  sweep/tour/roam hashes IDENTICAL (no recompute drift). Override-freshness moved to `refetch_facts`
  (now fetches the FULL article + re-applies overrides) / a re-sweep — not a per-run fetch.
  `fetchFullExtracts` dropped the MediaWiki-clamped `exchars` (hard cap 1200), pulling full plaintext
  self-truncated to `DEEP_EXTRACT_CHARS=4000`. The sweep stores the FULL extract for every story-tier
  candidate regardless of length — the arbitrary 800-char `STORY_MIN_EXTRACT` eligibility floor was
  REMOVED 2026-06-16 (see `corpus-enrichment.md`): the stored extract is the enricher's raw input, and
  whether an article is rich enough to narrate is the enrich step's call (build a sheet or defer), not a
  guessed cutoff. This went the OPPOSITE way from the old "lazy facts" idea (fetch less,
  later) — so that idea is now MORE appealing as a future optimization: the eager full-fetch makes the
  sweep heavier (one MediaWiki call per story poi). Revisit lazy/region-scale fetching if a big
  region's sweep gets slow.
- **Region-keyed bbox — DONE 2026-06-19.** The CLIs take `--region <slug>` and resolve it to the
  region's discovery bbox (`studio/src/pipeline/region.ts`); `--bbox` is gone. "Discover region X" is
  one command (`discover-pois --region x`). See `docs/decisions/geometry-first-regions.md`.
- **Rename — DONE 2026-06-15.** The sweep feeds tours too, so it's no longer roam-named:
  `sweep-roam-pois.ts` → `discover-pois.ts`, and the gen-job kind moved OFF the pg enum to a
  plain `text` column (the `jobKind` vocabulary is single-sourced in `@skipper/shared`; migration
  `0005_jobkind_to_text` dropped `gen_job_kind` + renamed the value `sweep_roam_pois` →
  `sweep_region_pois`). Rationale: a churning, observability-only label is the wrong shape for a
  rigid pg enum — adding/renaming a kind is now a code edit, not a migration.
