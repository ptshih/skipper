# Corpus enrichment (the `enrich` step)

**Status:** ✅ **BUILT + RUN** (code shipped 2026-06-15; a paid `enrich --apply` has since been RUN
across all story-eligible POIs — **315 welled as of 2026-06-16** — so tours + roam now ground on real
wells, not the extract head. The founder ear-test (§11 of the spec) remains the acceptance gate.) The
corpus gained a distinct paid **`enrich`** op between discovery and generation: it
scouts each story poi **once** into a curated, grounded **"fact sheet"** on `pois.fact_sheet`, which
tours AND roam both ground on. Generalizes the per-tour-stop scout (`pipeline/scout.ts`) to the corpus
and gives **roam** enrichment for the first time. Built from `docs/specs/corpus-enrichment-spec.md`
(now BUILT). Pairs with `docs/decisions/region-corpus-discovery.md` (the corpus + ops sequence),
`docs/decisions/enrichment-scout.md` (the scout this generalizes), and principle #1.

**Update 2026-06-16 (the 800-char story floor REMOVED — the enricher decides):** the arbitrary
`STORY_MIN_EXTRACT = 800` char cutoff is GONE. It was only ever a cost pre-filter deciding whether to
spend a (sub-cent) enrich call, and the enricher ALREADY has the real gate — `buildCorpusFactSheet` returns `null`
(a clean, retryable DEFER) whenever it can't assemble a usable sheet from an article, and #1 then
downgrades the un-enriched poi to scenic (tours) / skips it (roam). So story-grade = "the enricher built
a fact sheet," NOT a guessed length. Changes: (a) the sweep stores `facts.extract` for EVERY story-tier
candidate (no sub-800 → name-pin demotion — that was the enricher's raw input it was throwing away);
(b) `classifyStoryEligibility` now gates on `source=wikipedia` + not-taste + HAS article text (empty
extract → `filtered-stub`), no char floor; (c) the redundant roam char floor + `--min-extract` knob are
deleted (the fact-sheet requirement subsumes them). This realizes the **correctness-over-cost** doctrine
(CLAUDE.md): the ~145 sub-800 wikipedia POIs (≈$0.50 to enrich, one-time, idempotent) now enter the paid
funnel and the model — not 800 — decides if each becomes a telling. CAVEAT (open): a thin article that
DOES enrich yields a tiny sheet → a short telling — fine for roam (encounters are short), thin for a tour
2-min story stop; whether to keep short-sheet POIs tour-scenic is an open ear-test call. A paid `enrich`
run over the sub-800 backlog (founder-gated) realizes the value.

**Update 2026-06-16 (the `well` → `fact_sheet` COLUMN move):** the curated sheet was hoisted OUT of the
`pois.facts` jsonb bag into its OWN typed column **`pois.fact_sheet`** (`FactSheetEntry[]`) + **`pois.enriched_at`**
(migration `0007`, copy-only backfill of the 315 live wells; the old `facts.well` is left in place — reversible).
WHY: the bag was `Record<string,unknown>` and the bimodal `extract`+`well` it created was the system's most
bug-prone surface (the order-invariant-hash + the graft-back `CASE`). With its own column: the graft-back `CASE`
is **DELETED** (a free re-sweep writes `facts` and can't touch `fact_sheet` — a plain coalesce preserves it),
the hash rule is `storyFactsHash(facts, factSheet)` (sheet-hash when enriched, byte-identical to the old
well-hash → the 315 rows' `facts_hash` stay valid, verified 315/315), and the ~grounding readers take a TYPED
`FactSheetEntry[]` instead of 33 hand-written casts. `WellSpan` → `FactSheetEntry`. (A later cleanup migration
will drop the redundant `facts.well`/`facts.enrichedAt` once everything's confirmed reading the column.)

**Identifier rename (2026-06-16, follow-up):** the "well" vocabulary that lingered in CODE after the column
move was renamed to "fact sheet" so names match storage: `buildWell` → **`buildCorpusFactSheet`**,
`EnrichResult.well` → **`.sheet`**, `wellToAttribution` → **`factSheetToAttribution`**, `hasWell` →
**`hasFactSheet`**, `ENRICH_WELL_TARGET_SPANS` → **`ENRICH_FACT_SHEET_TARGET_SPANS`**, the model-facing tool
`finalize_well` → **`finalize_fact_sheet`**, and `test/well-builder.test.ts` → `fact-sheet-builder.test.ts`.
NOT renamed: the eval/grounding "permitted well" (`buildGroundingWell` + the audit's `well` field) — a
distinct, still-valid concept ("the full bag of facts the narrator was given"), kept separate on purpose.

**Update 2026-06-15:** the `--thin-only`/`--thin-max` cost-slice was **REMOVED** — filtering enrich
candidates by article length is a cost proxy, not a product axis (`--limit`/`--max-cost` are the honest
cost knobs), so the enrich dialog always runs the full eligible corpus now. The story-eligibility floor
flag `filtered-thin` was renamed **`filtered-stub`** to end the name collision (the removed enrich slice
was *eligible-but-short*, < 2500 chars). NOTE: `filtered-stub` originally meant "< 800 chars"; since the
2026-06-16 floor removal (above) it means "no article text to enrich" (empty extract).

**Update 2026-06-15 (selection-driven enrich):** the enrich CTA is no longer region-bound — it acts on a
table **selection**. `enrich-region.ts` resolves the candidate set as an explicit `--include-ids` list
**XOR** a filter (`--bbox`/`--source`/`--query`, default = the whole corpus) `\ --exclude-ids`, then the
eligibility gate. (It is XOR, NOT a union: `isExplicit` requires include-ids with no filter; include-ids
sent alongside a filter falls to FILTER mode and the ids are ignored — the UI never sends both.) The admin
POIs table gained per-row + select-all checkboxes (Gmail two-tier: explicit ids vs "select all matching" →
a server-resolved filter), so server-side pagination later is a UI-only change with no contract change.
Region-enrich survives as `filter:{bbox}`; the old region-picker dialog is gone. (`--bbox` is now optional
— no bbox = whole corpus.)

**Update 2026-06-16 (selection-feature review fixes):** a review of the above found + fixed: a missing
**confirm gate** on the Enrich dialog (a one-click paid run with no "are you sure", unlike every sibling
op — now a `window.confirm` naming the scope); the **source dropdown** offered `osm`/`manual` (not in the
`poi_source` enum) and omitted `wikipedia` (the only enrichable source) — fixed to the real enum values,
and the dynamic source compare now casts `::text` so an unknown value matches nothing instead of throwing
(it threw before, crashing even a free preview); and the selection count now shows the **story-eligible**
subset (what actually runs + bills), not the raw row count.

**Update 2026-06-16 (adversarial review fixes, pre-paid-run):** a 6-dimension review before the first
paid run found + fixed a set of issues (commits `82b2139`, `82f4001`, `33b91e7`). The load-bearing ones:
(1) **facts hashing is now order-invariant** (`stableStringify`) — `pois.facts` is jsonb (reorders keys
on read-back), so the old `JSON.stringify` hash made a writer's `pois.facts_hash` differ from a reader's
`tracks.facts_hash`, marking every freshly-generated (esp. roam) clip perpetually stale; (2) **a re-sweep
now PRESERVES wells** (see Migration below — this REVERSES the prior "wipe by design"); (3) **selection
ranks on the narration-visible head** (`rankLen`), so a free re-discover that re-stores extracts at 12k
can't reorder which stops a tour picks; (4) **track attribution is deduped** across the well + the route
geology layer (centroid + trigger commonly share a Macrostrat `map_id`); (5) **enrich-region cost/error
guards** — a running `--max-cost` cap (not just a pre-spend estimate), an upfront `ANTHROPIC_READY` assert,
and an all-errored → fail-loud guard so a misconfigured paid run can't report "succeeded" having enriched
nothing. The verbatim-selection invariant reviewed CLEAN.

## What shipped

- **Data model** (`@skipper/db/schema`, `pipeline/persist.ts`): `WellSpan` type; `pois.facts` for a
  story poi gains `{ well: WellSpan[], enrichedAt }` once enriched. `buildStoryFacts` carries the
  well; **`storyFactsHash`** is THE grounding fingerprint switch — hash of the WELL when enriched
  (so a `discover` re-fetch that rewrites `extract` but yields the same well does NOT churn the hash,
  and `enrichedAt` never churns it), else `hashFacts` of the whole object (un-enriched, today's
  basis, byte-for-byte). `wellToAttribution` + `resolveStoryGrounding` (in `select.ts`) are the
  single well↔extract-head resolver both consumers use.
- **The enricher** (`pipeline/scout.ts` `buildWell`): the scout generalized to a well builder. The
  model SELECTS verbatim article spans **by id** + includes/excludes geology(centroid)/Wikidata
  bundles — never text (the §2 verbatim invariant). Bounded like the scout; injectable model call.
- **The CLI** (`enrich-region.ts`) + `jobKind` `enrich_region` (shared enum + `jobs.ts` SCRIPTS +
  `buildJobArgs` + admin RoamView **Enrich** button). SOP-safe: dry run makes NO model calls (free);
  `--apply` spends Anthropic only (no TTS/R2). Flags: `--limit`/`--force`/`--model`/`--bbox`/`--max-cost`.
- **Generation reads the well.** Roam (`generate-roam.ts`) and tours (`generate-tour.ts`) ground on
  `resolveStoryGrounding` — the sheet when enriched. **#1 (2026-06-16):** a STORY telling now REQUIRES a
  sheet — an un-enriched POI is downgraded to scenic (tours) / skipped (roam), NOT narrated from the
  extract head (which survives only as a defensive fallback). Co-located merges fold the member's SHEET too.
  Tours append ROUTE-level road geology (the scout, narrowed to road-only for enriched stops);
  place-level geology + Wikidata retire into the well for enriched stops (spec §6). Both stamp the
  clip `facts_hash` via `storyFactsHash`, so a fresh clip never reads stale.
- **Cap migration** (spec §7): `DEEP_EXTRACT_CHARS`(4000) → **`ENRICHER_INPUT_CHARS`(12000)** — the
  sweep now STORES the bigger raw article (the enricher's input) — plus **`NARRATION_FALLBACK_CHARS`**
  (4000) — the un-enriched read-time head cap, preserving today's narration length byte-for-byte.

## §9 founder-calls — resolved (all as configurable knobs, the real choice is at the PAID run)

- **Scope:** built BOTH, then `--thin-only`/`--thin-max` were **REMOVED 2026-06-15** — length-filtering
  the candidate set is a cost proxy, not a product axis. Enrich now always runs the full eligible corpus;
  `--limit`/`--max-cost` are the cost knobs (cheapest-FIRST ordering under a budget would be the honest
  way to recover the "stretch the spend" use, if ever wanted — see the §9 Update at the top).
- **Enricher-input cap:** `ENRICHER_INPUT_CHARS = 12_000` (the generous-cap recommendation).
- **Well budget:** a SOFT prompt target (`ENRICH_WELL_TARGET_SPANS = 16`), never a char truncation.
- **Enricher model:** default **Sonnet 4.6** (`--model opus` for the A/B). $3/$15 per MTok added to
  `MODEL_PRICING`.

## Deviations from the spec (deliberate)

- **Fallback (§5.3):** a poi the enricher can't build a well for is **left un-enriched** (logged,
  retryable on re-run), NOT baked with a degraded positional well. The read-time extract-head
  fallback covers it identically at narration time, so it's "never well-less" in effect — but
  recoverable, and a re-run can still build a real well.
- **Tour place-scout retirement is per-poi, not wholesale.** An enriched stop skips the place-level
  scout (geology landmark + Wikidata are in the well) and does route road-geology only; an
  un-enriched stop keeps the full scout. So **nothing changes until a paid `enrich` run exists** —
  the un-enriched path is byte-identical to today (the spec staged tour integration behind an
  ear-test that was skipped; this switch makes the change activate per-poi, founder-controlled).
- **Tours no longer re-derive poi facts from the narration sheet.** `prep` rebuilds the upserted
  facts from the CORPUS facts (full extract + well, preserved), so a tour gen can never clobber the
  well or shrink the stored extract.

## Migration / ops sequence

Destructive-OK (STORAGE break-freely; no users). Per region: re-`discover` (sweep now stores the
12k extract) → `enrich --apply` (populate `well`) → `generate`. **A re-sweep PRESERVES wells**
(2026-06-16, review-driven — REVERSES the prior "wipe by design"): `upsertPoi` refreshes `extract`/
`title` but grafts an existing `facts.well` + `enrichedAt` back on and keeps the well-hash, because a
free, idempotent, re-run-encouraged sweep must never destroy the PAID well (the old auto-wipe was a
costly footgun). A deliberate well rebuild goes through `refetch_facts` or a re-`enrich --force`, NOT a
routine re-discover. `refetch_facts` (`refetch-poi.ts`) now PRESERVES the well too (2026-06-16, Option A
— consistency with the sweep) and WARNS, when it refreshes an enriched poi's extract, that a fact-edit
correction living in a well span needs `enrich-region --include-ids <id> --force --apply` to reach the
well. **Caveat:** because neither op auto-invalidates, a re-sweep/refetch whose article changed materially
keeps the OLD well until you re-`enrich`; there is no automatic "extract changed → re-enrich" signal yet.
Un-enriched story POIs are downgraded to scenic (tours) / skipped (roam) until enriched (#1) — never
narrated from the raw extract head.

**One-time hash migration (heads-up):** the order-invariant hashing in `82b2139` (`stableStringify`) was
required to fix the roam staleness bug, but it changes the hash VALUE for the same content — so every
EXISTING `pois.facts_hash` (written by an old sweep) is "old-algorithm." Existing tracks read fresh today
(both `pois.facts_hash` and `tracks.facts_hash` are old-algorithm, so they still match), but the FIRST
re-sweep / refetch / generate after deploy recomputes `pois.facts_hash` canonically → it no longer matches
the old `tracks.facts_hash` → those tracks read STALE. That is the hash MIGRATION, not content drift; a
regen clears it and it rides along with the enrich + regen you're doing anyway. There is NO clean backfill
(a track's hash can't be recomputed without the facts it grounded on, which aren't stored), so the answer
is awareness — don't be alarmed by a one-time staleness wave after the first post-deploy re-sweep.

## Awaiting (the real gate)

The PAID `enrich --apply` run + the founder EAR-test (spec §11): roam/tour scripts on the well read
at least as charming/grounded as on the richer extract, and rescue ≥1 deep fact the positional cap
missed. Recommended first run: `enrich-region --limit 3` (smoke), then ear-test.
