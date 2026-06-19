# Story-stop enrichment: the scout (judgment) replaces the char-count sparse-gates

**Status (2026-06-09):** built, wired, and MEASURED-IN (`packages/generator/src/pipeline/scout.ts`,
called from `enrich-pois.ts` via `buildCorpusFactSheet`); the old `GEOLOGY_STORY_MAX_FACT_CHARS` / `WIKIDATA_STORY_MAX_FACT_CHARS` /
`GEOLOGY_ICONIC_STOPS` constants are deleted. Scenic geology is untouched (a contract, not a
heuristic). The before/after eval on the canonical corridor passed the ship-gate — see "Measured".

## What changed

Whether a STORY stop gets geology (Macrostrat) and/or Wikidata key facts — and how the
narration is cued to use them — was decided by three hardcoded heuristics:

- fact sheet under **700 chars** → geology ("sparse" cue),
- fact sheet under **700 chars** → Wikidata,
- a hand-curated per-corridor allowlist (`GEOLOGY_ICONIC_STOPS`) for rich stops where the
  rock IS the headline ("iconic" cue), with a coordinate rule riding it (iconic → query the
  landmark point; sparse → the road/trigger point).

Now a bounded tool-using agent (the **scout**, Opus) runs ONCE per place at the corpus
`enrich` step (`buildCorpusFactSheet`, writing `pois.fact_sheet` — a shared sheet tours AND
roam later READ via `resolveStoryGrounding`): it reads the story poi's article, judges what
the telling is missing, fetches candidate enrichment, reads what came back, and finalizes —
including or excluding each fetched bundle and picking the cue
(`headline`→ the old `iconic`, `supporting`→ the old `sparse`) and the geology coordinate
(`road` vs `landmark`). This is step 2 of the agentic-generation build: judgment inside the
rails, replacing thresholds that were always proxies for judgment (700 was tuned to one
corridor's gap; the allowlist had one entry and would never scale across regions — M4 wants
Yosemite/Moab without a hand-tuned list per drive).

## Why agency is SAFE here (the load-bearing argument)

The scout chooses what to **gather**, never what is **true**:

- Its tools are keyed to the stop's OWN identifiers (its QID, its two candidate
  coordinates), baked in by the pipeline — the model supplies no free-form arguments, so it
  cannot fetch the wrong place's facts.
- Every well line arrives **verbatim** from a sourced fetcher with provenance
  (source/sourceId/license) for the frozen attribution snapshot; inclusion is all-or-nothing
  per bundle (enforced in code: `finalize` can only reference fetched bundles, and an
  include-without-fetch is dropped — unit-tested).
- The scout never writes narration; it only assembles the well `narrateStop` grounds on.
  "Persona lives in DELIVERY, never in FACTS" is untouched.

## Bounds + failure shape

`SCOUT_MAX_TOOL_TURNS` (5) model turns and `SCOUT_MAX_TOKENS` (1000) output per turn; a hit
cap or any error yields **no enrichment for that stop** — logged, non-fatal, the same blast
radius as a fetcher failure under the old gates. `SKIPPER_SCOUT=off` skips the pass;
`SKIPPER_GEOLOGY=off` / `SKIPPER_WIKIDATA=off` withhold the corresponding tool.

## Deliberately NOT scout tools

- **`placesNearby`** (listed in the original handoff's tool sketch): excluded. Places data
  is VOLATILE (the break-stop invariant: name + kind only, nothing volatile baked into a
  frozen clip); a story stop enriched with nearby-business facts would freeze exactly what
  that invariant exists to keep out. Revisit only with a non-volatile field-mask argument.
- **Free-text Wikipedia search**: the scout may not pull other pages' prose onto this
  stop's sheet — co-located landmarks already arrive via the merge machinery with their own
  attribution. Future sources (NRHP, Twain/Muir corpus) should land as stop-keyed fetchers
  in the same shape.

## Measured (the ship condition)

The handoff's rule: the scout ships only if it beats the heuristics on the eval panel per
dollar. Before/after on the canonical corridor (emerald-bay-run, dry-run pairs, both
Opus-narrated, scored by the same offline eval CLI — grounding Opus + charm Opus, both on `JUDGMENT_MODEL`
after the 2026-06-09 Sonnet→Opus upgrade), 2026-06-09:

| dimension | gates (before) | scout (after) |
| --- | --- | --- |
| grounding (gate) | 0.92 — 9/14 stops flagged, 11 ungrounded claims | **0.97 — 5/14 stops, 7 claims** |
| charm (advisory) | 0.69, pass | 0.68, pass (judge-noise wash) |
| diversity (advisory) | 0.91 (1 stop) | 0.91 (1 stop) |
| tts (gate) | 1.00 | 1.00 |
| enrichment bundles | 5 geology + 3 wikidata | **3 geology + 2 wikidata** |

Verdict: **ship**. Better grounding with FEWER, better-chosen bundles (selectivity is the
mechanism: 6 of 11 story stops got an explicit reasoned "nothing — the sheet is rich /
the fetch added nothing", and the scout reproduced the hand-curated Emerald Bay
geology-as-headline call from the sheet alone). Scout cost ≈ 11 stops × 2–3 short Opus
turns ≈ $0.15/tour — noise against the narration spend. Caveat: a single stochastic
sample (different narration rolls + judge variance between runs); the standing eval panel
keeps measuring every future run, so a regression would surface on the scorecard.
