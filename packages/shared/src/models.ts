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
} as const

export type ClaudeModelId = (typeof CLAUDE_MODELS)[keyof typeof CLAUDE_MODELS]
