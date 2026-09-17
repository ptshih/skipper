// The Claude model ids, single-sourced. These literals were hardcoded as bare strings across
// package boundaries that can't share packages/studio/src/models.ts — apps/api (drives.ts),
// apps/admin (server/index.ts), and packages/studio itself (pipeline/job-output.ts) — because the
// apps don't depend on @skipper/studio. @skipper/shared IS the common dependency, so the ids live
// here as the one source of truth. (studio/src/models.ts keeps its own TIER constants — NARRATION_/
// JUDGMENT_/ENRICH_ — with their calibration rationale; those can reference these values.)
//
// Dep-free, like the rest of @skipper/shared.

// ---------------------------------------------------------------------------
// PROVIDER: Amazon Bedrock (founder call, 2026-09-17 — "switch my model provider to AWS Bedrock using
// Opus 4.6 for everything"). Every Claude call in this repo goes through `@anthropic-ai/bedrock-sdk`'s
// `AnthropicBedrock` client — NOT the first-party `Anthropic` client and NOT the Mantle client: on
// Bedrock, Opus 4.6 is served by the LEGACY InvokeModel integration (platform.claude.com →
// "Claude on Amazon Bedrock (Opus 4.6 and earlier)"), which is what the default `AnthropicBedrock`
// export speaks. The SDK rewrites `/v1/messages` to `/model/<id>/invoke[-with-response-stream]` and
// injects `anthropic_version` itself; call sites keep the same `messages.create` / `.stream` surface.
//
// ⚠ AUTH IS A BEARER TOKEN, NOT AN AWS KEY PAIR. The credential is a long-term Bedrock API key
// (an `ABSK…` string) carried in `BEDROCK.tokenEnv`; the SDK reads that env var itself and, when it is
// set, sends `Authorization: Bearer` and SKIPS the AWS credential-provider chain entirely — so no
// `~/.aws` probe, no IMDS call, no SigV4 signing in the request path. `ANTHROPIC_API_KEY` is no longer
// read anywhere. ⚠ Bedrock does NOT support the top-level automatic `cache_control`, Batches, Models
// API or token counting on this integration — this repo uses explicit breakpoints only, so nothing
// here needs them; keep it that way.
// ---------------------------------------------------------------------------
export const BEDROCK = {
  /** The env var holding the Bedrock API key (bearer). ONE name, read here and nowhere else by string:
   *  a readiness check that spells it differently is a deploy that boots green and fails on the first
   *  paid call. Set via dotenvx in `.env.development` AND `.env.production` (they are the same
   *  deployment — see CLAUDE.md). */
  tokenEnv: 'AWS_BEARER_TOKEN_BEDROCK',
  /** Read by the SDK for the endpoint host (`bedrock-runtime.<region>.amazonaws.com`); defaults to
   *  us-east-1 inside the SDK when unset. The `us.` inference profile below routes within the US
   *  regions independently of this, so the region only picks the front door. */
  regionEnv: 'AWS_REGION',
  /** Claude Opus 4.6 on Bedrock, via the US cross-region inference profile (founder, 2026-09-17:
   *  "make sure we are using the US profile"). ⚠ The bare model id (`anthropic.claude-opus-4-6-v1`) is
   *  REJECTED for on-demand invocation — Bedrock reports `inferenceTypesSupported: [INFERENCE_PROFILE]`
   *  for it, so a request naming the bare id is a 400. `us.` keeps inference inside US regions and
   *  bills Bedrock's regional (CRIS) rate, +10% over the `global.` profile, which is the same model
   *  routed anywhere with capacity at list price — MODEL_PRICING carries both. Verified 2026-09-17
   *  against the account's `list-inference-profiles` (both ACTIVE) and by a live call on each. */
  opus46: 'us.anthropic.claude-opus-4-6-v1',
} as const

export const CLAUDE_MODELS = {
  /** ⚠ EVERY KEY BELOW NOW RESOLVES TO THE SAME BEDROCK ID (founder, 2026-09-17: "Opus 4.6 for
   *  everything"). The keys are kept as TIER names, not model names, because ~20 call sites and their
   *  tests select by role (`sonnet` = the corpus-scale enrich default, `haiku` = the in-job summarizer,
   *  `opus` = narration + the calibration-tier judges, `planner` = the one rider-triggered call) and
   *  the separation is still the point: a future founder call can re-split a tier by editing ONE key
   *  without touching a call site. ⚠ Cost note for the tiers that were cheaper: enrich (was Sonnet 4.6,
   *  $3/$15) and the summarizer (was Haiku 4.5, $1/$5) now bill at Opus rates. Known and accepted.
   *
   *  What moving OFF Opus 5 means, recorded so nobody reads the calibration notes below as current:
   *   · the fail-closed eval gate was CALIBRATED on Opus 5 (2026-08-04, `eval/calibrate.ts`) — those
   *     numbers describe a model this repo no longer runs. Re-run calibrate.ts before trusting a
   *     grounding/charm score on 4.6 (a separate paid go; not run with this switch).
   *   · Opus 4.6 uses the OLDER tokenizer (~30% fewer tokens for the same text than 4.7+), so every
   *     `max_tokens` cap sized for Opus 5 now has MORE headroom, never less.
   *   · Opus 4.6 has no `xhigh` effort (low/medium/high/max) — nothing here sends it.
   *   · `budget_tokens` is DEPRECATED (not rejected) on 4.6 — still never send it; adaptive thinking
   *     must be requested EXPLICITLY (`{type:'adaptive'}`), since omitting `thinking` on 4.6 means no
   *     thinking at all (unlike Opus 5, where it was on by default).
   *  The request surface this repo sends was PROBED on Bedrock/Opus 4.6 on 2026-09-17 before the
   *  switch — forced `tool_choice` (`tool` + `any`), adaptive thinking with `display:'omitted'`,
   *  `output_config.effort`, explicit `cache_control`, streaming, and forced-tool + thinking together.
   *  See docs/decisions/bedrock-opus-4-6.md for the probe record. */
  sonnet: BEDROCK.opus46,
  /** History that still earns its keep: this key was BUMPED 4.8 → 5 by an explicit founder call on
   *  2026-08-04, and the checks run then (forced `tool_choice` accepted — every studio judge depends on
   *  it, and Fable 5 had REJECTED it; adaptive thinking with no tools accepted; both together accepted)
   *  are the same checks that were re-run for the Bedrock move. ⚠ `claude-opus-5` and `claude-opus-4-8`
   *  STAY in MODEL_PRICING: historical `eval_runs` rows name them, and an unpriced model silently
   *  under-reports spend. The Opus 5 calibration result (verdict agreement 16/18, violation recall 8/8,
   *  4 false positives across 2/10 clean cases; accepted as-is by the founder) lives in git history and
   *  studio/models.ts's NARRATION_MODEL note. */
  opus: BEDROCK.opus46,
  haiku: BEDROCK.opus46,
  /** The LIVE PLANNER's model — the only one of these that runs inside a rider request.
   *
   *  ⚠ STILL A SEPARATE KEY even though it holds the same value as `opus`, and it must stay one.
   *  The whole point is that a future bump of one cannot silently repoint the other: editing `opus`
   *  moves NARRATION_MODEL, JUDGMENT_MODEL, ENRICH_MODELS.opus and two admin job models at once — a
   *  paid-run behaviour change disguised as a constant edit, on prose that is gated by a
   *  fail-closed eval panel calibrated against the CURRENT model. (Same reasoning as JUDGMENT_MODEL
   *  and NARRATION_MODEL coinciding in studio/models.ts and staying separate anyway.)
   *
   *  ⚠ Thinking is ON for this model and must stay on (INV-8) — and on 4.6 that means REQUESTED
   *  EXPLICITLY, because omitting `thinking` on this generation runs without it. With thinking off the
   *  model can write a tool call into VISIBLE TEXT instead of a `tool_use` block — the turn succeeds,
   *  no error is raised, and the call never runs. For a planner whose entire contract is emitting a
   *  structured route, that is a silent wrong answer. It can also leak `<thinking>` tags into
   *  rider-facing text.
   *  ⚠ There is no thinking BUDGET to size against — `budget_tokens` is deprecated on this model and
   *  never sent. Depth is `output_config.effort`, and `max_tokens` caps thinking PLUS visible output in
   *  one budget (see PLANNER_MAX_TOKENS in apps/api/src/limits.ts). */
  planner: BEDROCK.opus46,
} as const
