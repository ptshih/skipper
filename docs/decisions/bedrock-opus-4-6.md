# Claude via Amazon Bedrock — Opus 4.6 for everything

> **Status:** ✅ DECIDED + BUILT + DEPLOYED 2026-09-17 (founder: "switch my model provider to use AWS
> Bedrock using model Opus 4.6 for everything", then "make sure we are using the US profile"). Every
> Claude call in the repo — narration, the eval judges, enrich, curate, the admin helpers and the LIVE
> PLANNER — runs through Amazon Bedrock on Opus 4.6 via the **`us.` inference profile**. First commit
> (`global.`) pushed and canaried green the same day — prod served a real planner turn over Bedrock;
> the `us.` switch followed as a second commit. **Calibration and the planner eval were re-run on the
> new model the same day (§ Re-measured below) — both hold; the eval gate is calibrated on 4.6 now.**

## What changed

| Before (2026-08-04 → 2026-09-17) | After |
| --- | --- |
| `@anthropic-ai/sdk` `new Anthropic()` (first-party API) | `@anthropic-ai/bedrock-sdk` `new AnthropicBedrock()` — the SDK's **legacy InvokeModel** integration, which is what serves Opus 4.6 on Bedrock (the newer Mantle endpoint serves 4.7+ only) |
| `ANTHROPIC_API_KEY` | `AWS_BEARER_TOKEN_BEDROCK` — a long-term Bedrock API key (`ABSK…`), sent as `Authorization: Bearer`; **not** an AWS access-key pair, no SigV4, no credential chain. Plus `AWS_REGION` for the front door. Both set in `.env.development` **and** `.env.production` (same deployment). The name is single-sourced as `BEDROCK.tokenEnv` in `packages/shared/src/models.ts`. |
| `CLAUDE_MODELS` = `{ sonnet: claude-sonnet-4-6, opus: claude-opus-5, haiku: claude-haiku-4-5-…, planner: claude-opus-5 }` | every key = `BEDROCK.opus46` = **`us.anthropic.claude-opus-4-6-v1`** (the US cross-region inference profile — inference stays in US regions. The bare `anthropic.claude-opus-4-6-v1` reports `inferenceTypesSupported: [INFERENCE_PROFILE]` and 400s on-demand; `global.` is the same model routed anywhere at list price, and was the id for the first ~2 hours) |
| `MODEL_PRICING` had no Bedrock row | `us.anthropic.claude-opus-4-6-v1` at **$5.50/$27.50** per MTok (Anthropic list $5/$25 × Bedrock's documented +10% regional premium; Bedrock's invoice is the authority) and `global.…` at $5/$25 (the day's calibration + eval runs name it). Old rows kept — historical `eval_runs` name them. |
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
re-split one tier by editing one constant. Per-token price for the Opus tiers is list +10% for the `us.`
profile ($5.50/$27.50 vs $5/$25), while Opus 4.6's older tokenizer bills ~30% FEWER tokens for the same
text than Opus 5 — net, a regen costs about what it did or less.

⚠ **Flagged once at the time and proceeded on the founder's call:** Opus 5 → 4.6 is a step *down* on the
model the fail-closed eval gate was calibrated against, and Opus 5 is also available on Bedrock in the same
account. If the calibration re-run shows recall moving, `BEDROCK.opus46` is the one-line switch back.

## What was probed before it landed (~$0.22 total, founder go)

Every request shape this repo sends, on Bedrock / Opus 4.6 (probed on the `global.` profile; the `us.`
profile was then verified by a live call — same echo, same usage shape — and re-measured for throttling)
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
  `us-east-1`). The `us.` profile routes within US regions regardless of which one is the front door.
- **Bedrock THROTTLES PER ACCOUNT, PER PROFILE, and the ceilings are low enough to matter** (measured
  2026-09-17 with tiny requests, `maxRetries: 0`): the `global.` profile took 8 concurrent cleanly and
  returned 11 × 429 at 16; the **`us.` profile took 24 concurrent cleanly and returned 11 × 429 at 36.**
  Forty SEQUENTIAL calls in a minute never throttled, so it is a burst/concurrency budget, not a plain
  RPM. Consequences: `eval/calibrate.ts` used to fire 54 at once and died on 429 through the SDK's five
  retries — it now runs through `mapLimit` at `CALIBRATE_CONCURRENCY` (default 2 cases × 3 votes = 6 in
  flight). The narration pipeline's `NARRATION_CONCURRENCY` (12) plus 3-vote grounding gates can reach
  ~36 in flight — over the `us.` ceiling; the SDK's `maxRetries: 5` backoff should absorb the burst, but
  a full-region regen is the run to watch (`SKIPPER_NARRATION_CONCURRENCY` is the env dial; an AWS
  Service Quotas increase is the other lever). The live planner is one call per rider turn with
  `maxRetries: 1`: ~25 simultaneous rider turns would start hearing the outage line.

## Re-measured on the new model (2026-09-17, founder go "run any paid runs you need")

**Eval-gate calibration** (`eval/calibrate.ts`, 18 golden cases × 3 votes = 54 judge calls, $0.73):
**verdict agreement 17/18, violation recall 8/8, false positives 1 claim across 1/10 clean cases.**
Against Opus 5 (2026-08-04: 16/18, 8/8, 4 across 2/10) that is the same perfect recall — the fail-closed
axis — and BETTER precision. The one disagreement is `grounding-merged-feature` (a false positive on
Opus 5 too); `grounding-inverse-relation`, the returned regression on Opus 5, passes on 4.6. The runner
still exits non-zero on any disagreement, as designed. The gate is calibrated on the model it runs.

**Planner eval** (`apps/api/eval/run.ts --apply`, 15 scenarios / 59 turns + judge, $0.57):
**routing 1.00 (0/59), voice 1.00, discipline 1.00, persona advisory 0.72 with 1/59 flagged; judge
8/10 — ship; GATE PASS.** Against run 2 on Opus 5 (2026-08-04: routing 0.96 with 2/57 flagged, persona
0/57 flagged, repeats 12, durations 2): routing is cleaner, one persona turn reads as canned (the
`wrap-up-long-conversation` "actually two" turn), `durations asserted as road fact` is 1 (the same
"Two hours" detector-noise shape run 2 documented — do not tighten the detector), and `distinct
repeated phrases` rose 12 → 28, almost all of them place-name read-backs ("emerald bay state park out
to incline village") that the prompt REQUIRES the model to say. Raw turns: `apps/api/eval/.runs/2026-09-17T17-54-30-749Z-mem.json`.
⚠ Both runs used the `global.` id; the `us.` profile is the same weights behind a different router, so
they were not repeated for it.

**Prod canary after the first push** (`95ab5fd6`): API/admin/studio builds SUCCESS (site correctly not
triggered); `skipper-api-00167-npj → 00168-6tg`, traffic 100%; `/health` 200 in 210 ms; `/version`
unchanged; no ERROR-severity log lines in the 20-minute window. One deliberate real `POST /drives/plan`
against prod (authorized): 200 in 4.5 s, in-persona read-back, and prod's own `plan_spend` line named
`model: global.anthropic.claude-opus-4-6-v1`, `served_by: claude-opus-4-6`, cache write 11,024,
$0.070 — Cloud Run reaches Bedrock with the decrypted token.

## Knowingly left as history

Dated records that name `claude-opus-5` / `ANTHROPIC_API_KEY` as they were at the time and are NOT
rewritten: `docs/designs/1-1-adversarial-review.md`, `docs/designs/drives-first-1-1-build-notes.md`,
`docs/guides/1-1-submission-sweep.md`, `docs/guides/app-store-submission.md`,
`docs/research/rider-spend-exposure.md`, `docs/research/llm-judge-bias-and-prompt-optimization.md`.
`docs/designs/ask-the-skipper-spec.md` (DEFERRED) still plans on `ANTHROPIC_API_KEY` in its build steps —
when it is picked up, those steps mean the Bedrock token. `ANTHROPIC_API_KEY` itself was left in the
encrypted env files (unread by anything; the founder may `dotenvx set --unset` it).
