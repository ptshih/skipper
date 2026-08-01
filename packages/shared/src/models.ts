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
  opus: 'claude-opus-4-8',
  haiku: 'claude-haiku-4-5-20251001',
  /** The LIVE PLANNER's model — the only one of these that runs inside a rider request.
   *
   *  ⚠ A SEPARATE KEY, never a bump of `opus`. Editing `opus` in place silently repoints
   *  NARRATION_MODEL, JUDGMENT_MODEL, ENRICH_MODELS.opus and two admin job models at once — a
   *  paid-run behaviour change disguised as a constant edit, on prose that is gated by a
   *  fail-closed eval panel calibrated against the CURRENT model.
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
