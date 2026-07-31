# Re-wiring the eval panel — an instrument over everything the LLM/TTS touches

> **Status:** SUPERSEDED-BY-BUILD 2026-06-19 → `docs/decisions/automated-grounding-gate.md`. This is the
> brainstorm record (a 4-proposal / 12-adversarial-judge design panel + code verification) that produced
> the staged plan. The founder then chose FULL AUTOMATION ("I don't want to manually sign-off on clips")
> — which collapsed the staging: Phase 1 (the inline grounding gate via `optimize()`) was greenlit and
> BUILT, not deferred, and made FAIL-CLOSED (a clip that can't pass is withheld + flagged in
> `eval_scores`, not shipped). Kept for the reasoning + the key no-op finding below. Code wins — the
> line/symbol anchors will drift; the live design is the decision record.

## Why this exists

V1 had an eval panel keyed to a *tour* (`RunScorecard.slug`, `StopEval.seq` = a tour-stop index). V2
dissolved tours (`segments`/`tracks`/`tour_frames` gone, migration `0009`); the V2 collapse unwired
the panel entirely. The founder ask that frames this re-wire (2026-06-19):

> the eval panel should apply to anything that the LLM or TTS touches, just in the context of POIs and
> Places in V2 instead of tours and tours in V1 — and it should replace `generate-narrations`'s current
> cheap guards, not run alongside them.

So the target isn't "put the grounding gate back" — it's **one unified quality instrument over every
LLM/TTS-touched artifact, keyed to V2 entities**, that *subsumes* the existing ad-hoc guards.

## What's already built (re-wiring is plumbing, not new machinery)

- **`eval/grounding.ts`** — `evaluateGrounding(input, decompose)` decomposes a script into atomic
  place-claims and classifies each grounded/ambient/ungrounded vs the permitted well. PASS = zero
  ungrounded. One forced-tool Opus call per artifact. The crown-jewel check.
- **`eval/grounding.ts:buildGroundingWell`** — a SHARED structural well builder, designed so the live
  pipeline and the auditor build the IDENTICAL well and "can never drift." This is the pre-built seam.
- **`eval/optimize.ts`** — the generic evaluator-optimizer: `optimize(initial, {evaluate, regenerate,
  maxRounds})`, accept-only-if-not-worse with a Pareto per-gate guard + a thrash guard. Provably can
  only hold-or-improve on a gate dimension. Documents exactly how V1 wired `regenerate = narrateStop`.
- **`eval/tts.ts`** — deterministic TTS-cleanliness (markdown/SSML/emoji leak). Free.
- **`eval/scorecard.ts` / `types.ts`** — pure aggregation + the `StopEval` shape and `DIMENSION_KIND`.
- **`pipeline/narrate.ts`** — `NarrationRequest.avoid: string[]` already renders a "REVISION NOTES —
  same facts, fresh take" block; `narrateStop` is the regen hook `optimize()` expects.
  `generate-narrations.ts` ALREADY loops one retake with avoid-notes for its two cheap guards.

So the loop, the gate, the well, and the regen hook all exist. The work is **re-keying + plumbing**.

## The finding that reshapes the naive instinct

The obvious idea — "catch the hallucination upstream at the enrich fact sheet, where it's cheapest" —
is **structurally a no-op**, and three independent judges + a direct code trace confirmed it:

- The enricher emits only span **IDs**, never text (`scout.ts:344` — "VERBATIM SELECTION, never
  summarization. The model emits SPAN IDS … never text"); the sheet line is built `text:
  input.spans[i]` (`scout.ts:505`). A Wikipedia sheet line therefore **cannot be invented or mangled
  at enrich time** — it is verbatim-from-the-extract by construction.
- The "free" faithfulness check everyone reaches for — `sheetDriftSpans` (`select.ts:95`,
  `source==='wikipedia' && !extract.includes(s.text)`) — is **guaranteed empty at write time**. It is
  a STALENESS detector (catches a later Wikipedia edit under a frozen sheet), not a hallucination gate.

The upstream failure that **does** exist is **selection veracity**: the model picking a verbatim-but-
*irrelevant or misleading* span, or wrong geology/Wikidata facts. That is invisible to a substring
check — it is advisory **veracity** (subjective, LLM-judged), exactly where doctrine already files it
(`veracity.ts`: "the human ear adjudicates … never an automated block"). Lesson: **don't spend Opus
re-verifying a tautology**; upstream coverage = an opt-in veracity probe, not a free gate.

## Recommended shape: "instrument-first, gate-on-greenlight"

The panel split on the doctrine fault line. The out-of-band advisory instrument won doctrine (9/10)
and cost/risk (8.5/10) but scored 5.5 on quality (a report has no shipped-quality delta until a human
re-runs generation). The inline soft-gate proposals won quality but quietly reinterpreted a reaffirmed
written deferral and added spend to a paid run. The synthesis stages them across that exact line.

### Phase 0 — re-key + the instrument (ship now; $0 default; no hot-path change; no doctrine cross)

- **Destructively re-key `eval/types.ts`** off V1 tours (`slug`/`runName`/`seq`) onto V2 entities: a
  `poiId`/`qid`-keyed corpus scorecard (region + bbox). The no-users / break-storage-freely posture
  licenses the rename. This IS the V2-scope directive, landed in the types.
- **Drop dead scope honestly:** `asides` (table dropped, migration `0019_drop_asides.sql`;
  `narrateIntro/Outro` survive only in a test), and V1's cross-stop **diversity** lint (wrong unit in
  V2 — roam encounters play minutes apart on unrelated drives, never as one tour). `places`/`detours`
  carry no script yet → noted deferred, not scoped.
- **Build `audit-corpus.ts`** — a read-only CLI sibling of `judge-voice.ts` over `pois ⋈ narrations`,
  emitting a **worst-first markdown scorecard with presigned audio links**. Free dimensions run always
  (TTS-cleanliness over the stored script + the promoted deterministic guards below); the paid
  grounding sweep is behind `--grounding` (founder-OK spend; roughly **$17–45 one-time** for the full
  ~459-clip Tahoe corpus given the 4k-token output cap, scopeable with `--bbox`/`--limit`, and it
  should skip non-story stops with empty wells). Hot path untouched → the paid gen run costs $0 extra.
- **Honesty fix (docs-ride-along):** flip `DIMENSION_KIND.grounding` from `'gate'` → `'advisory'` and
  delete the now-false "hard gate" comments in `types.ts`/`grounding.ts`/`index.ts`. The code currently
  claims a gate nothing runs — the exact doc↔code drift CLAUDE.md forbids.

### Fold the two cheap guards INTO the panel (replace, don't coexist)

`generate-narrations.ts`'s two inline guards (kit-ban + no-laterality, each one retake then
ship-with-warn) are a hand-rolled mini-eval-loop that predates the panel being wired. They map onto
panel dimensions: **no-laterality** is a grounding-class violation (a spatial fact not on the well);
**kit-ban** is what `diversity.ts` lints. Reimplement both as **free deterministic
`StopEval`-returning evaluators** and **delete the bespoke parallel retake path**. They're free +
deterministic + already-blessed, so they run inline with no spend and no doctrine cost, feeding the
same scorecard. Net: the ad-hoc system *becomes* the panel's cheapest dimensions — one retake policy,
one scorecard — a simplification, not net-new machinery.

### Phase 1 — graduate to the inline flywheel (ONLY behind an explicit greenlight)

This is where detection becomes *improvement*, and it is the one real decision.

- Wire the paid grounding gate inline in `generate-narrations.ts` as a **soft-gate** via the built
  `optimize()` loop: evaluate → one `avoid[]` retake → **ship-with-loud-warn, never block `ready`**.
  Grounding is the least-thrash-prone case for auto-retake (binary "zero ungrounded" target,
  Pareto-guarded). Flag-gated, **off by default** in alpha.
- **Required hardening first** (every cost/risk judge flagged it; verified plausible): a per-item
  `try/catch` around `evaluateGrounding` + fault-isolate the narrate batch — today only the *synth*
  batch is resilient, so one transient Opus 5xx mid-run aborts the whole paid run *after* narration $
  is spent; plus a **runtime** spend tally + abort (today `--max-cost` is a pre-flight estimate only);
  plus a corpus-level regen budget cap.
- **Surface the doctrine change as a `docs/decisions/` record + sign-off:** "grounding (near-objective,
  decomposable) graduates advisory → inline-soft-gate; veracity stays advisory-by-doctrine." Don't
  smuggle a reversal of a written deferral.

## The one decision

The *how* is solved (`optimize()`, `evaluateGrounding`, `buildGroundingWell`, the `avoid[]` seam all
exist). The fork is **posture**: Phase 0 is an instrument serving the founder's ear and ships today
with no sign-off. Phase 1 crosses the "automated groundedness gate — human ear instead" line in
CLAUDE.md's Deferred list. Recommendation: **ship Phase 0 now; greenlight Phase 1 the first time the
report flags an ungrounded clip and the founder wishes it had just *fixed* it** — which, on a corpus
too large to fully ear-audit, won't take long.

## The panel (for the record)

| Proposal | Doctrine | Quality | Cost/Risk | Avg |
| --- | --- | --- | --- | --- |
| The Auditor (out-of-band, advisory, no flywheel) | 9 | 5.5 | 8.5 | 7.7 |
| Grounding-gate-on-narrate (inline soft-gate + flywheel) | 7 | 7 | 7 | 7.0 |
| Corpus Grounding Ledger (hybrid + golden/calibrate) | 7.5 | 7 | 6 | 6.8 |
| Sheet-First Gate (gate at enrich + narrate) | 6.5 | 6.5 | 6.5 | 6.5 |

The recommendation grafts The Auditor's frame (the base) with the inline flywheel of the runners-up as
a documented, founder-gated Phase 1, and discards the upstream sheet-faithfulness gate all three
inline proposals leaned on (the no-op above).

## Doctrine ties

- `decisions/` rationale this touches when Phase 1 lands: `docs/decisions/corpus-enrichment.md` (the
  enrich step), `docs/decisions/tour-data-model-zero-reuse.md` (the shared-facts model).
- Reconciles the existing MEMORY note that the eval panel is "deliberately unwired in V2 alpha" — Phase
  0 makes it WIRED, just out-of-band and advisory; the panel stops being dead-looking code.
