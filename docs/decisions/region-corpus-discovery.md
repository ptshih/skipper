# Region-corpus discovery (discovery-first reorder)

**Status:** ✅ **BUILT 2026-06-12.** Tour generation no longer discovers POIs live; it selects
from a shared region corpus that a discovery sweep populates first. Seeded draft shells +
committed curated-route artifacts are gone — tours are authored at runtime. Supersedes the
"tour generate discovers its own route box" flow. Pairs with
`docs/decisions/tour-data-model-zero-reuse.md` (the segments/tracks model this rides on) and the
Wikidata discovery spine (`pipeline/wikidata-discovery.ts`).

## The reorder

**Before:** every tour generate called `discoverWikidataPois(routeBox)` live (a WDQS sweep of the
route's bounding box), while roam separately swept the basin into `pois` via `sweep-region-pois.ts`.
Two discovery paths over the same Wikidata spine; tours re-discovered on every run; tours were
pre-seeded as draft shells from committed `tour-specs.ts` + `seed/data/*.json` route artifacts.

**After — one substrate, three steps:**

1. **Discover a region → the shared corpus.** `sweep-region-pois.ts` (the existing bbox sweep) is
   the canonical first step: it discovers every Wikidata-pinned place in a region's bbox, tiers
   them, and upserts STORY rows (Wikipedia prose) + SCENIC pins into `pois`, deduped by
   `(source, source_id)`. The bbox is a generation-op PARAMETER / a per-region default in code —
   `regions` stays geometry-free (D4 of the segments/tracks refactor holds).
2a. **Generate a tour.** `generate-tour.ts` reads candidates from the corpus
   (`pipeline/region-corpus.ts::loadCandidatePoisInBox`), scoped to the route's bounding box, and
   rebuilds the SAME `WikiPoi` shape the spine emitted — no live WDQS. An empty corpus throws at
   `$0` ("discover the region first") before any paid call. Selection (`select.ts`) and the facts
   deepen (`loadFreshPoiFacts`) downstream are unchanged.
2b. **Generate roam.** Already narrates the corpus — unchanged.

## Why

- **One discovery substrate.** Tours + roam draw from the identical `pois` corpus, so a place
  curated once (a `poi_overrides` fact-edit, a `pois.speakable` anchor) benefits both, and there
  is no duplicated sweep. Tour generates get faster + deterministic (no live WDQS latency/etiquette
  mid-run).
- **Lossless from the pool.** The sweep stores the full discovery payload in `pois.facts` for STORY
  rows — `{extract, title, url, pageId, qid}` — so `loadCandidatePoisInBox` reconstructs the
  `WikiPoi` (incl. the Wikidata `qid` enrichment join) without calling WDQS. SCENIC rows
  (`source 'wikidata'`) carry no prose, exactly as before.
- **No seeded shells.** The seed is now just `regions` + `personas` + `poi_overrides`. Tours are
  AUTHORED at runtime via the admin Create flow (`materializeRoute` survives; the seed-time
  materialize CLI + `tour-specs.ts` + `seed/data/*.json` + the `wikidata-spine-diff` artifact tool
  were deleted). The two curated Tahoe routes are re-authored through the new system (they were
  not valuable enough to preserve).

## Operator flow (admin)

Discover region (`sweep_region_pois --apply`) → author a route (Create tour → `materializeRoute`) →
`generate` the draft → (optionally) `generate_roam` for the corpus. The empty-corpus guard makes
the ordering self-enforcing.

## Deferred / open

- **Facts depth — DONE 2026-06-15 (the "real step 1").** The sweep eagerly fetches the FULL article at
  discovery time (`fetchDeepExtracts`) and stores it NORMALIZED (`toFacts(...).join(' ')`) in
  `facts.extract` (no separate lead field; `facts.extract` IS the full article, hashed once at sweep).
  Generation READS it — BOTH the roam AND tour per-run deepens are removed (`generate-tour.ts` no longer
  imports `loadFreshPoiFacts`/`fetchDeepExtracts`/`FACTS_TTL_HOURS`); normalizing at the sweep makes the
  sweep/tour/roam hashes IDENTICAL (no recompute drift). Override-freshness moved to `refetch_facts`
  (now fetches the FULL article + re-applies overrides) / a re-sweep — not a per-run fetch.
  `fetchDeepExtracts` dropped the MediaWiki-clamped `exchars` (hard cap 1200), pulling full plaintext
  self-truncated to `DEEP_EXTRACT_CHARS=4000`. Eligibility (`STORY_MIN_EXTRACT`) measures the full
  article (800, ear-tunable). This went the OPPOSITE way from the old "lazy facts" idea (fetch less,
  later) — so that idea is now MORE appealing as a future optimization: the eager full-fetch makes the
  sweep heavier (one MediaWiki call per story poi). Revisit lazy/region-scale fetching if a big
  region's sweep gets slow.
- **Region-keyed bbox.** Today the sweep's bbox is a default/`--bbox`. A `region → bbox` map keyed
  by slug would make "discover region X" one command. Trivial to add when region #2 lands.
- **Rename — DONE 2026-06-15.** The sweep feeds tours too, so it's no longer roam-named:
  `sweep-roam-pois.ts` → `sweep-region-pois.ts`, and the gen-job kind moved OFF the pg enum to a
  plain `text` column (the `jobKind` vocabulary is single-sourced in `@skipper/shared`; migration
  `0005_jobkind_to_text` dropped `gen_job_kind` + renamed the value `sweep_roam_pois` →
  `sweep_region_pois`). Rationale: a churning, observability-only label is the wrong shape for a
  rigid pg enum — adding/renaming a kind is now a code edit, not a migration.
