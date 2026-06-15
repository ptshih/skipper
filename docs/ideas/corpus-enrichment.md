# Enrich the corpus, not the telling — a shared `enrich` step + the curated fact well

> **Status:** PROMOTED to a build-ready spec 2026-06-15 → [docs/specs/corpus-enrichment-spec.md](../specs/corpus-enrichment-spec.md)
> (build still gated on an explicit greenlight + the ear-test). **Correction:** "distill" below is
> imprecise — the spec makes the well **verbatim SELECTION** (the enricher picks which verbatim
> spans/bundles to keep, NEVER rewrites them), the grounding-safety invariant. This doc stays as the
> vision; the spec is the build truth. Originally captured 2026-06-15 as: IDEA (pre-spec). Spun out of the
> 2026-06-15 facts-depth work (`docs/decisions/region-corpus-discovery.md` "Facts depth — DONE"):
> once the full article is fetched + stored ONCE at the sweep, the natural next move is to also
> ENRICH it once at the corpus level (the scout) instead of per-tour-stop — which also lets the
> `DEEP_EXTRACT_CHARS` cap migrate from the raw extract to a bounded curated well. Validate ROI
> before building (see §Validate first). Pairs with [[enrichment-scout]], [[region-corpus-discovery]],
> [[tour-data-model-zero-reuse]] (principle #1), and [[free-roam-mode]].

## The core idea

Enrichment is a property of the **place**, not the **telling**. Principle #1 says *fetch FACTS once
per place; generate NARRATION per tour*. The enrichment **scout** today violates that: it lives on
the narration side and re-derives a place's grounded facts (Wikidata key facts, geology) **per tour
stop**, every time a tour visits — and roam gets **no** scout at all (the alpha cut), so it narrates
the bare Wikipedia extract.

Move enrichment **up to the corpus**: a distinct `enrich` step scouts each story poi **once** and
stores the result on `pois.facts`. Then BOTH tours and roam read the enriched facts — roam gets
enrichment for free, and the scout cost is amortized once-per-place instead of paid per-telling
(today a place on 3 tours is scouted 3×).

This is the same move we just made for the Wikipedia extract (deepen-per-gen → fetch-once-at-sweep),
one layer up: enrich-per-stop → enrich-once-at-corpus.

## The op sequence

```
discover (free)  → sweep WDQS + MediaWiki into pois (full article extract, normalized)
enrich   (PAID)  → per story poi, ONCE: scout reads the article + fetches Wikidata/place-geology,
                   SELECTS verbatim spans/bundles into a bounded curated FACT WELL (+ provenance) onto pois.facts
generate (PAID)  → tours + roam narration grounds on the WELL (not the raw extract)
```

Keeping `enrich` a **distinct, founder-gated** step (it SPENDS — the scout is a bounded tool-using
agent, `SCOUT_MODEL` × `SCOUT_MAX_TOOL_TURNS`, run across the whole eligible corpus ~315) preserves
the "discovery is free" property and makes the enrichment cost explicit.

## The place / route split

The scout fetches two kinds of enrichment:

- **Place-level** — Wikidata key facts (by QID) + geology at the place **centroid**. Properties of
  the place → **move to the corpus** (shared by tours + roam). Roam (a placeless centroid) wants
  exactly this half.
- **Route-level** — geology at the **road-snapped trigger** ("the rock under your tires" as you
  approach on *this* road). Genuinely route-specific → **stays at tour generation.**

## The cap migration (why `DEEP_EXTRACT_CHARS` can then be dropped)

`DEEP_EXTRACT_CHARS` (4000) exists to bound **narration input**: today narration grounds DIRECTLY on
`facts.extract`, fed to every narration call × eval/regen passes × every roam clip. So the cap is
really "how much text the narrator chews per call."

If `enrich` selects the article's best verbatim spans into a **bounded curated well** that narration grounds on, the cap
**moves** rather than disappears:

- **Raw `extract`** = the enricher's INPUT — one read **per place, amortized** → can be uncapped (or
  a generous enricher-input cap just to bound that one read). No more fetch-time fact loss.
- **The curated well** = narration's INPUT — ×many calls → **this** is now where the bound lives.

That's the right place for the bound: stop paying for trivia on every narration call, stop losing
deep facts at fetch time, and the selection keeps the most *narratable* verbatim material (charm, not an
encyclopedia dump).

⚠ **Trap:** the *current* scout is an ADDER (include/exclude fetched enrichment bundles; the extract
is kept whole in the well). Dropping the cap requires the enrich step to also **select verbatim spans
of the extract** into the bounded well. Uncapping WITHOUT that selection just hands narration a bigger raw blob (more
cost + "lost in the middle"). So the cap drop is **part of** the enrich-step design, never standalone.

## What it buys

- **Roam enrichment for free** (the question that started this — no per-clip scout).
- **Scout cost amortized** once-per-place, not per-telling.
- **No fetch-time fact loss** (raw extract uncapped) + **bounded, curated narration input** (the well).
- Consistency: tours and roam ground on the same enriched, attributed facts.

## Costs / tradeoffs

- `enrich` SPENDS (LLM) and runs over the whole eligible corpus — founder-gated; a distinct paid op.
- `pois.facts` grows a **well + provenance** structure (the scout's facts carry source/sourceId/
  license for the frozen attribution snapshot). Storage break-freely is fine; `factsHash` covers the
  well so staleness still works (re-`enrich`/re-sweep re-derives).
- Tours stop re-scouting place facts; they only add the route-level geology at gen.
- Needs a decision doc + a `pois.facts` shape (extract + well + attributions) before building.

## Validate first

We just made roam ~3× richer **for free** (the 1200→4000 extract change). Per the "validate ROI
before infra" discipline, **ear-test roam encounters on the richer extract first.** If they already
feel grounded + charming, this can wait. If they feel thin — especially places with a dry Wikipedia
body but a rich Wikidata/geology story — then corpus-enrichment is the right (and architecturally
clean) build, and the cap migration rides along with it.
