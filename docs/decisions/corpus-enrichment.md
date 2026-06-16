# Corpus enrichment (the `enrich` step)

**Status:** ✅ **BUILT 2026-06-15** (code shipped; a real `enrich --apply` run is PAID + founder-gated,
not yet run). The corpus gained a distinct paid **`enrich`** op between discovery and generation: it
scouts each story poi **once** into a curated, grounded **"fact well"** on `pois.facts.well`, which
tours AND roam both ground on. Generalizes the per-tour-stop scout (`pipeline/scout.ts`) to the corpus
and gives **roam** enrichment for the first time. Built from `docs/specs/corpus-enrichment-spec.md`
(now BUILT). Pairs with `docs/decisions/region-corpus-discovery.md` (the corpus + ops sequence),
`docs/decisions/enrichment-scout.md` (the scout this generalizes), and principle #1.

**Update 2026-06-15:** the `--thin-only`/`--thin-max` cost-slice was **REMOVED** — filtering enrich
candidates by article length is a cost proxy, not a product axis (`--limit`/`--max-cost` are the honest
cost knobs), so the enrich dialog always runs the full eligible corpus now. The story-eligibility floor
flag `filtered-thin` was renamed **`filtered-stub`** to end the name collision (the floor = a *stub*,
< 800 chars, excluded; the removed enrich slice was *eligible-but-short*, < 2500 chars — a different
threshold entirely, which made one word mean two things).

**Update 2026-06-15 (selection-driven enrich):** the enrich CTA is no longer region-bound — it acts on a
table **selection**. `enrich-region.ts` now resolves the candidate set from `(filter ∪ --include-ids) \
--exclude-ids` (then the eligibility gate): a hand-picked id list, OR a filter (`--bbox`/`--source`/
`--query`, default = the whole corpus) minus deselected ids. The admin POIs table gained per-row +
select-all checkboxes (Gmail two-tier: explicit ids vs "select all matching" → a server-resolved filter),
so server-side pagination later is a UI-only change with no contract change. Region-enrich survives as
`filter:{bbox}`; the old region-picker dialog is gone. (`--bbox` is now optional — no bbox = whole corpus.)

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
  `resolveStoryGrounding(facts)` — the well when enriched, the **capped** extract head otherwise.
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
12k extract) → `enrich --apply` (populate `well`) → `generate`. **A re-sweep WIPES wells** (the
upsert overwrites `facts`) — by design (a changed extract invalidates its well); re-`enrich` after.
Existing un-enriched pois fall back to the extract head until enriched.

## Awaiting (the real gate)

The PAID `enrich --apply` run + the founder EAR-test (spec §11): roam/tour scripts on the well read
at least as charming/grounded as on the richer extract, and rescue ≥1 deep fact the positional cap
missed. Recommended first run: `enrich-region --limit 3` (smoke), then ear-test.
