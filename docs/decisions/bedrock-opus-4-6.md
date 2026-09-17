# Claude via Amazon Bedrock — Opus 4.6 for everything

> **Status:** ✅ DECIDED + BUILT 2026-09-17 (founder: "switch my model provider to use AWS Bedrock using
> model Opus 4.6 for everything"). Every Claude call in the repo — narration, the eval judges, enrich,
> curate, the admin helpers and the LIVE PLANNER — now runs through Amazon Bedrock on Opus 4.6. Landed
> in one commit; **not yet pushed** (a push deploys the API at 100% with no canary — separate go).
> ⚠ **Open follow-ups, both paid and both the founder's call:** re-run `eval/calibrate.ts` on the new
> model before trusting a grounding/charm score, and re-run the planner eval (`apps/api/eval`) before
> trusting the persona numbers in TODO.md — both were last measured on Opus 5.

## What changed

| Before (2026-08-04 → 2026-09-17) | After |
| --- | --- |
| `@anthropic-ai/sdk` `new Anthropic()` (first-party API) | `@anthropic-ai/bedrock-sdk` `new AnthropicBedrock()` — the SDK's **legacy InvokeModel** integration, which is what serves Opus 4.6 on Bedrock (the newer Mantle endpoint serves 4.7+ only) |
| `ANTHROPIC_API_KEY` | `AWS_BEARER_TOKEN_BEDROCK` — a long-term Bedrock API key (`ABSK…`), sent as `Authorization: Bearer`; **not** an AWS access-key pair, no SigV4, no credential chain. Plus `AWS_REGION` for the front door. Both set in `.env.development` **and** `.env.production` (same deployment). The name is single-sourced as `BEDROCK.tokenEnv` in `packages/shared/src/models.ts`. |
| `CLAUDE_MODELS` = `{ sonnet: claude-sonnet-4-6, opus: claude-opus-5, haiku: claude-haiku-4-5-…, planner: claude-opus-5 }` | every key = `BEDROCK.opus46` = **`global.anthropic.claude-opus-4-6-v1`** (the GLOBAL cross-region inference profile — the bare `anthropic.claude-opus-4-6-v1` reports `inferenceTypesSupported: [INFERENCE_PROFILE]` and 400s on-demand; `us.` is the same model at +10%) |
| `MODEL_PRICING` had no Bedrock row | `global.anthropic.claude-opus-4-6-v1` at $5/$25 per MTok (Anthropic list; Bedrock's invoice is the authority). Old rows kept — historical `eval_runs` name them. |
| core SDK `^0.112.1` | `^0.126.0` in the three workspaces that call Claude — `bedrock-sdk@0.33.6` requires `>=0.115.1`, and ONE core copy is what keeps every `instanceof Anthropic.APIError` true. No breaking changes in that range touch the Messages surface (the breaking bits were beta Files/Skills). |

The four client construction sites moved and nothing else about the calls did: `packages/studio/src/models.ts`
(`getAnthropic`, the shared lazy singleton), `apps/api/src/planner.ts` (`plannerClient`),
`apps/admin/server/index.ts` + `places.ts`, `apps/api/eval/judge.ts`. Readiness checks (`studio/config.ts`
`ANTHROPIC_READY`, the admin 503 guard, the planner's `not_configured`, every `--apply` guard) read
`BEDROCK.tokenEnv`. Names like `getAnthropic` / `ANTHROPIC_READY` / `anthropic_unconfigured` were kept —
~20 call sites and their tests spell them, and the Messages surface behind them is unchanged.

## Why "everything", and what it costs

The founder's words. Read literally: the in-job summarizer (was Haiku 4.5, $1/$5) and the corpus `enrich`
default (was Sonnet 4.6, $3/$15) now bill at Opus rates. The tier KEYS were kept so a future call can
re-split one tier by editing one constant. Per-token price for the Opus tiers is unchanged ($5/$25), and
Opus 4.6's older tokenizer bills ~30% FEWER tokens for the same text than Opus 5 — a regen costs what it
did or less.

⚠ **Flagged once at the time and proceeded on the founder's call:** Opus 5 → 4.6 is a step *down* on the
model the fail-closed eval gate was calibrated against, and Opus 5 is also available on Bedrock in the same
account. If the calibration re-run shows recall moving, `BEDROCK.opus46` is the one-line switch back.

## What was probed before it landed (~$0.22 total, founder go)

Every request shape this repo sends, on Bedrock / Opus 4.6 / the `global.` profile
(`packages/studio/.scratch/probe-bedrock-opus46-*.ts`, gitignored; evidence retained in the FSD goal dir):

| Shape | Where it's used | Result |
| --- | --- | --- |
| forced `tool_choice: {type:'tool'}` | every studio judge (`tool-call.ts`) | ✅ |
| `tool_choice: {type:'any'}` | `scout.ts`, admin bbox-lookup | ✅ |
| adaptive thinking, no tools | `narrate.ts` | ✅ (engages: 530 thinking tokens on a reasoning prompt) |
| adaptive + `display:'omitted'` + `effort:'medium'` + `tool_choice auto/disable_parallel` + explicit `cache_control` + **streaming** | the live planner | ✅ tool_use returned; `omitted` ⇒ thinking block present with empty text |
| forced tool + adaptive thinking | recorded as available | ✅ |
| `messages.stream` with `max_tokens: 32000` | `curate-places` | ✅ |
| explicit `cache_control` breakpoint | planner + `narrate.ts` | ✅ **only above 4096 tokens** — a ~700-token prefix silently did not cache (`cache_creation_input_tokens: 0`); a 12k prefix wrote then read |
| `budget_tokens` (never sent) | — | accepted (deprecated, not rejected) |

Then **one real planner turn** through the shipped `runPlannerTurn` against the live Lake Tahoe roster
(132 anchors): `plan_spend` logged `model: global.anthropic.claude-opus-4-6-v1`, `served_by: claude-opus-4-6`,
cache write 11,030 tokens, 44 thinking tokens, $0.0707, 3.7 s; the turn read the two ends back in persona
exactly as the prompt's read-back rule specifies.

## Gotchas that are now load-bearing

- **`response.model` echoes `claude-opus-4-6`, not the id we send.** `MODEL_PRICING` is keyed by the SENT
  id; pricing by the echo would tally $0. `logPlanSpend` prints both (`model` / `served_by`).
- **Thinking must be requested on 4.6.** Opus 5 ran adaptive thinking by default; 4.6 runs WITHOUT it when
  `thinking` is omitted. Every call that needs it already says `{type:'adaptive'}` (INV-8 for the planner).
- **Cache minimum is 4096 tokens on 4.6** (512 on Opus 5 — not monotonic across generations). A region whose
  roster + prompt fall under it never caches and bills full price every anonymous turn, silently. Tahoe is
  ~11k; watch `cache_read` in `plan_spend` for any new region.
- **No top-level automatic `cache_control` on this Bedrock integration** (400) — explicit breakpoints only,
  which is all the repo ever used. Also unsupported: Batches, Models API, token counting, server tools,
  server-side `fallbacks`. Nothing here needs them.
- **Effort levels on 4.6 are `low`/`medium`/`high`/`max`** — no `xhigh`. Nothing sends it.
- **The Bedrock SDK does not read `~/.aws/config` for the region** — only `AWS_REGION` (default
  `us-east-1`). The `global.` profile makes the region choice cosmetic for inference.

## Knowingly left as history

Dated records that name `claude-opus-5` / `ANTHROPIC_API_KEY` as they were at the time and are NOT
rewritten: `docs/designs/1-1-adversarial-review.md`, `docs/designs/drives-first-1-1-build-notes.md`,
`docs/guides/1-1-submission-sweep.md`, `docs/guides/app-store-submission.md`,
`docs/research/rider-spend-exposure.md`, `docs/research/llm-judge-bias-and-prompt-optimization.md`.
`docs/designs/ask-the-skipper-spec.md` (DEFERRED) still plans on `ANTHROPIC_API_KEY` in its build steps —
when it is picked up, those steps mean the Bedrock token. `ANTHROPIC_API_KEY` itself was left in the
encrypted env files (unread by anything; the founder may `dotenvx set --unset` it).
