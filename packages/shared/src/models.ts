// The Claude model ids, single-sourced. These literals were hardcoded as bare strings across
// package boundaries that can't share packages/studio/src/models.ts — apps/api (drives.ts),
// apps/admin (server/index.ts), and packages/studio itself (pipeline/job-output.ts) — because the
// apps don't depend on @skipper/studio. @skipper/shared IS the common dependency, so the ids live
// here as the one source of truth. (studio/src/models.ts keeps its own TIER constants — NARRATION_/
// JUDGMENT_/ENRICH_ — with their calibration rationale; those can reference these values.)
//
// Source: Anthropic model catalog (claude-api skill — "Current Models" table). Dep-free, like the
// rest of @skipper/shared.
export const CLAUDE_MODELS = {
  sonnet: 'claude-sonnet-4-6',
  /** ⚠ BUMPED 4.8 → 5 by an explicit founder call, 2026-08-04. The warning below said not to do this
   *  in place, and the founder overrode it knowingly; it is recorded rather than deleted because it is
   *  still the right default for the NEXT bump.
   *
   *  What was checked first, because one of them could have broken everything:
   *   · FORCED `tool_choice` — ✅ accepted. This was the real risk: every studio judge forces a tool,
   *     and Fable 5 REJECTED forced tool use (the reason JUDGMENT_MODEL exists as its own constant).
   *     A rejection here would have broken grounding, charm, veracity, excise and both classifiers at
   *     once, and grounding is fail-closed, so it would have withheld everything.
   *   · `thinking: {type:'adaptive'}` with no tools (narration's shape) — ✅ accepted.
   *   · both together — ✅ accepted.
   *   · pricing — IDENTICAL to 4.8 ($5/$25 per MTok, see MODEL_PRICING), so the bump is cost-neutral.
   *     ⚠ `claude-opus-4-8` STAYS in MODEL_PRICING: historical `eval_runs` rows name it, and an
   *     unpriced model silently under-reports spend.
   *  ✅ CALIBRATED, same day (`eval/calibrate.ts`, 54 Opus calls): **verdict agreement 16/18, violation
   *  recall 8/8, false positives 4 claims across 2 of 10 clean cases.** Recall — the FAIL-CLOSED
   *  direction, where a miss ships a hallucination — is perfect, which is the result that mattered. The
   *  drift is entirely in the COST direction and in the direction calibrate.ts predicted ("precision is
   *  the axis expected to drift… the judge is biased toward flagging BY CONSTRUCTION"). Both
   *  disagreements are false positives on clean cases: `grounding-merged-feature` and
   *  `grounding-inverse-relation`.
   *  ⚠ The second is a RETURNED regression worth knowing about: the grounding prompt spells that exact
   *  carve-out out with that exact example ("hired by his aunt X" grounds "he was X's nephew"), and the
   *  golden case exists because it was a live false positive on 2026-06-09. Opus 5 flags it anyway. Cost
   *  of leaving it: each false positive buys an excision round and trims writing the sheet supported.
   *  ✅ ACCEPTED AS-IS (founder, 2026-08-04): it costs prose, never a shipped hallucination, and is not
   *  worth editing the fail-closed gate on the day the model moved. Re-raise if the number GROWS. */
  opus: 'claude-opus-5',
  haiku: 'claude-haiku-4-5-20251001',
  /** The LIVE PLANNER's model — the only one of these that runs inside a rider request.
   *
   *  ⚠ STILL A SEPARATE KEY even though it now holds the same value as `opus`, and it must stay one.
   *  The whole point is that a future bump of one cannot silently repoint the other: editing `opus`
   *  moves NARRATION_MODEL, JUDGMENT_MODEL, ENRICH_MODELS.opus and two admin job models at once — a
   *  paid-run behaviour change disguised as a constant edit, on prose that is gated by a
   *  fail-closed eval panel calibrated against the CURRENT model. (Same reasoning as JUDGMENT_MODEL
   *  and NARRATION_MODEL coinciding in studio/models.ts and staying separate anyway.)
   *
   *  ⚠ Thinking is ON for this model and must stay on (INV-8): with thinking disabled it can write
   *  a tool call into VISIBLE TEXT instead of a `tool_use` block — the turn succeeds, no error is
   *  raised, and the call never runs. For a planner whose entire contract is emitting a structured
   *  route, that is a silent wrong answer. It can also leak `<thinking>` tags into rider-facing text.
   *  ⚠ There is no thinking BUDGET to size against — `budget_tokens` is rejected with a 400 on this
   *  model. Depth is `output_config.effort`, and `max_tokens` caps thinking PLUS visible output in
   *  one budget (see PLANNER_MAX_TOKENS in apps/api/src/limits.ts). */
  planner: 'claude-opus-5',
} as const
