# Corpus enrichment — Build Spec

> **Status:** build-ready spec, UNBUILT — captured 2026-06-15. Promoted from
> [docs/ideas/corpus-enrichment.md](../ideas/corpus-enrichment.md) on a "move toward greenlight" from
> the founder; the BUILD itself is still gated on (a) an explicit greenlight and (b) the ear-test that
> roam encounters on the richer 4000-char extract actually need enrichment. §9 lists the open
> founder-calls. Pairs with `docs/decisions/enrichment-scout.md` (the scout this generalizes),
> `docs/decisions/region-corpus-discovery.md` (the corpus + ops sequence), and principle #1.

## 1. Why

Enrichment is a property of the **place**, not the **telling**. Today the enrichment scout lives on
the narration side and re-derives a place's grounded facts (Wikidata key facts, geology) **per tour
stop**, every visit — and roam gets **none** (the alpha cut), narrating the bare Wikipedia extract.

Move it up to the corpus: a distinct **`enrich`** step scouts each story poi **once** and stores a
curated, grounded **fact well** on `pois.facts`. Tours + roam both read it. Roam gets enrichment for
free; scout cost amortizes once-per-place; and the narration-input bound migrates from a positional
char cap to the curated well.

This is the same move already made for the Wikipedia extract (deepen-per-gen → fetch-once-at-sweep),
one layer up: enrich-per-stop → enrich-once-at-corpus.

## 2. THE invariant — verbatim selection, NEVER summarization

The well is built by **selection of verbatim spans**, never by an LLM rewriting/summarizing facts.
This is non-negotiable: the scout's safety property is *it chooses what to GATHER, never what is
TRUE* — every fact reaches narration **verbatim** from a sourced fetcher, upholding "persona lives in
DELIVERY, never FACTS / silence beats a hallucinated battle." An LLM that summarized the article into
a well would inject a hallucination surface into the FACTS layer — forbidden.

So `enrich` picks **which** verbatim sentences/sections of the (uncapped) article to keep + **which**
fetched bundles (Wikidata/geology) to include. It never edits their text. The value over today's
positional 4000-char cap: *the most narratable verbatim facts, **wherever** they sit in the article*
(the "Major Ormsby was killed" line gets picked even when it's deep), instead of "the first 4000
chars."

## 3. Data model — `pois.facts` shape

Break-freely (storage). `pois.facts` for a story poi becomes:

```ts
{
  extract: string            // raw full article (verbatim, generous enricher-input cap — see §9).
                             //   the ENRICHER's input + re-enrichment/audit source. NOT narration input.
  well: Array<{              // the curated narration sheet — what generation grounds on (bounded).
    text: string             //   a VERBATIM span (an article sentence/section, or a fetched fact)
    source: 'wikipedia' | 'wikidata' | 'macrostrat'
    sourceId: string
    license: string          //   CC BY-SA 4.0 / CC0 / CC BY 4.0
    url?: string
  }>
  enrichedAt: string         // ISO; well provenance timestamp (distinct from facts_fetched_at)
  title: string; url: string; pageId: number; qid?: string   // unchanged
}
```

- **Narration grounds on `well`** (`toFacts(well.map(s => s.text).join(' '))`), not `extract`.
- **`factsHash` = hash of the well** (the grounding fingerprint). Re-`discover` (new extract) →
  re-`enrich` (new well) updates it; the track staleness contract (`track.factsHash` vs
  `poi.factsHash`) is unchanged, now keyed on the well.
- **Attribution** = the distinct `(source, sourceId, license, url)` in the well, frozen onto
  `tracks.attribution` at narration time (replaces today's per-fetch attribution assembly).

## 4. The `enrich` op

Ops sequence becomes: `discover` (free) → **`enrich` (paid, once)** → `generate` (paid).

- New CLI `packages/generator/src/enrich-region.ts` + `jobKind` `enrich_region` (add to the
  `@skipper/shared` `jobKind` enum + `jobs.ts` SCRIPTS + admin button). SOP-safe: previews (with a
  cost estimate) by default; writes only on `--apply`. `--bbox` scopes it (like the sweep).
- For each eligible story poi WITHOUT a fresh well (or `--force`): run the enricher (§5), build the
  well, upsert `pois.facts.well` + `factsHash` + `enrichedAt` (via `buildStoryFacts`-style helper, so
  key order stays hash-stable).
- **SPENDS** (LLM). Founder-gated. Rough cost: the scout (Opus-class, ≤5 turns) × the eligible corpus
  (~315 for Tahoe) ≈ **$15–40 one-time/region**, amortized across every tour + roam clip; re-run only
  on re-sweep / staleness. Rich sheets finalize fast (no inclusions), keeping the average low.

## 5. The enricher (generalize the scout)

Extend `pipeline/scout.ts` from an enrichment-bundle selector to a full **well builder**:

1. Input: the poi's raw `extract` (verbatim) + its identifiers (QID, centroid coords) — baked in by
   the pipeline, never free-form (the safety invariant).
2. The model SELECTS: (a) which verbatim article spans to keep, (b) which fetched bundles
   (`fetch_wikidata` by QID, `fetch_geology` at the **centroid** — §6) to include. Same include/
   exclude agency it has today, now also over article spans. Bounded by `SCOUT_MAX_TOOL_TURNS` /
   `SCOUT_MAX_TOKENS`; the model emits span ids / bundle choices, NOT text.
3. Output: the `well` array (§3) — verbatim spans + provenance. On any cap/error: fall back to the
   positional head of the extract (today's behavior) so a poi is never well-less.
4. Restraint stays a feature (its current prompt rule): a rich article wants few/no enrichment
   bundles; a thin one gets rounded out. For span selection: keep the narratable beats, drop list/
   demographic/admin trivia.

## 6. Place / route split

- **Place-level** (→ corpus well): Wikidata key facts (by QID) + geology at the **place centroid**.
  Shared by tours + roam.
- **Route-level** (→ stays at tour generation): geology at the **road-snapped trigger** ("the rock
  under your tires" as you approach on *this* road). A tour appends this to the well it reads from the
  corpus; roam (placeless) uses only the corpus well.

## 7. Generation integration + the cap migration

- **Roam** (`generate-roam`): grounds on `pois.facts.well`. No per-clip scout. (The original win.)
- **Tours** (`generate-tour.ts`): grounds on the corpus well + the route-level geology (§6); no per-stop
  place-fact scouting.
- **The 4000 raw-extract cap drops.** `extract` is now the enricher's input (a generous cap remains
  for enricher cost — §9). The **narration bound is the enricher's SELECTION** (the curated well) — NOT
  a char cap. The raw cap was needed only because narration grounded *directly* on a dumb positional
  truncation; the well is *curated*, so judgment is the bound. `fetchDeepExtracts` keeps pulling full
  plaintext; the positional truncation becomes the generous enricher-input cap.

## 8. Staleness

`factsHash` = hash(well). A `discover` re-fetch that materially changes the article → re-`enrich` →
new well → new hash → every track that grounded on the old well is stale (the existing contract).
Overrides (`poi_overrides`) apply at fetch time (already true for `fetchDeepExtracts`), so a re-enrich
after an override carries the correction into the well.

## 9. Open founder-calls (resolve before/at greenlight)

- **Scope — full corpus vs thin-only.** Enrich ALL eligible (~315, ~$15–40) or only THIN articles
  (full extract < N, where enrichment's marginal value is highest)? *Recommendation: thin-only first*
  (cheapest, best ROI), expand if the ear wants it.
- **Enricher-input cap.** Uncap `extract` entirely, or a generous cap (~12–20k chars) to bound the
  one-time enricher read on huge city articles? *Recommendation: generous cap (~12k).*
- **Well "budget" — a SELECTION TARGET, not a hard cap.** The well's bound is the enricher's judgment
  (restraint: a few strong facts for a ~150s telling), NOT a post-hoc char truncation — truncating
  would butcher a verbatim span (mid-sentence, broken provenance). The hard ceiling is already the
  enricher-input cap (the well is a subset of the input). Give the enricher a soft target as guidance;
  only backstop by dropping WHOLE lowest-value spans if it wildly over-selects, never by slicing one.
  (Facts-input cost is a rounding error vs the narration output — this is a noise/charm lever, which
  selection already handles, not a cost lever.)
- **Enricher model.** Keep Opus-class (calibration), or downgrade to Sonnet for the bulk enrich
  (selection is easier than narration judgment, and it's corpus-scale)? *Recommendation: try Sonnet
  for the bulk enrich, A/B a sample against Opus.*

## 10. Migration

`pois.facts` shape change is destructive-OK (no users; STORAGE break-freely). Procedure: re-`discover`
(extract already full) → `enrich --apply` to populate `well` on the corpus → drop the `STORY_MIN_EXTRACT`-on-`extract`
read in favor of the well (eligibility itself stays on `extract` length, unchanged). Existing pois
without a `well` fall back to the positional extract head until enriched.

## 11. Acceptance / validation

- **Ear-test (the real gate):** roam + tour scripts on the well read at least as charming/grounded as
  on the richer extract — and rescue ≥1 "deep fact" the positional cap missed.
- **Grounding:** every well span is verbatim from its cited source (no model-authored text in facts);
  attribution present for every story track (CC BY-SA invariant).
- **Hash stability:** the enricher is deterministic enough that re-enriching an unchanged article +
  unchanged overrides yields the same well hash (or accept re-hash on each enrich; document which).

## 12. Phasing

1. **Validate** (free/cheap): ear-test current richer-extract roam clips; confirm enrichment is
   wanted. If not → shelve, keep this spec.
2. **Thin-only enrich** of roam's corpus (cheapest slice), roam reads the well. Ear-test.
3. Full corpus + tour integration (well + route-geology) + drop the raw cap.
