# Gemini 3.8 Flash on Vertex AI — every model call

> **Status:** ✅ DECIDED + BUILT + DEPLOYED 2026-09-23 (`00eef324`, canary green — § Prod canary) (founder: "switch it back to gcp gemini flash 3.8", scope
> confirmed as ALL calls). Supersedes [bedrock-opus-4-6.md](bedrock-opus-4-6.md). Narration, every eval
> judge, enrich, curate, the admin helpers and the LIVE PLANNER now call `gemini-3.8-flash` through
> `@google/genai` on Vertex AI's **`us` multi-region**. The grounding gate was re-calibrated and the
> planner eval re-run on the new model the same day (§ Re-measured). The `skipper-api` and
> `skipper-admin` service accounts were granted `roles/aiplatform.user` the same day, BEFORE the push —
> without it every planner turn is a 403 (§ Deploy prerequisites).

"Back" in the founder's words was a misremembering, recorded so nobody goes looking for the old
integration: text models were never on Gemini before this. Pre-Bedrock they ran on Anthropic's own API;
the only Gemini use in the repo was (and still is) TTS and the release-review AUDIO judge
(`RELEASE_ASSESSMENT_MODEL`, `gemini-3.1-pro-preview` — it listens to audio and was left alone).

## What changed

| Before (Bedrock, 2026-09-17 → 23) | After |
| --- | --- |
| `@anthropic-ai/bedrock-sdk` `AnthropicBedrock` + `@anthropic-ai/sdk` | `@google/genai` `GoogleGenAI({ vertexai: true, location: 'us' })` — the SDK derives `aiplatform.us.rep.googleapis.com` itself (verified in the installed 2.24.0). Both Anthropic packages removed from studio, api and admin. |
| `AWS_BEARER_TOKEN_BEDROCK` + `AWS_REGION` | **No key.** Application Default Credentials — the Cloud Run runtime service account, or locally the key file in `GOOGLE_APPLICATION_CREDENTIALS` (resolved against the REPO ROOT, because `bun --filter` runs each app from its own directory). The one env var every readiness guard checks is `VERTEX.projectEnv` = `GOOGLE_CLOUD_PROJECT`, the project Cloud TTS already bills to. |
| `CLAUDE_MODELS` `{ sonnet, opus, haiku, planner }` | `LLM_MODELS` `{ enrich, quality, summary, planner }` — every key `gemini-3.8-flash`. Tier keys kept (renamed to roles) so one tier can be re-split by editing one constant; `planner` still separate from `quality` on purpose. The operator-facing `--model sonnet\|opus` enrich/curate flag kept its old LABELS so admin jobs and runbooks did not change. |
| `MODEL_PRICING` Bedrock rows | `gemini-3.8-flash` at **$0.825 / $4.125** per MTok — Google's NON-global rate (+10% over `global`) because the code sends to the `us` multi-region. It is INTRODUCTORY: `PRICE_CHANGES` applies the published $1.65 / $8.25 from 2027-01-01 automatically, so no run reports half of what it billed on New Year's Day. Old rows kept (history names them). |
| Anthropic `usage` | `geminiUsage()` converts `usageMetadata` into the same tally shape: uncached input = prompt − cached, **output = candidates + thoughts** (thinking bills as output and Gemini reports it apart). |

Call-site translation, one line each (the code comments carry the why):

| Claude shape | Gemini shape | Where |
| --- | --- | --- |
| forced `tool_choice: {type:'tool'}` | `functionCallingConfig: { mode: ANY, allowedFunctionNames: [name] }` — and it ENFORCES the schema | `tool-call.ts` (`callTool` / `forcedToolRequest`), grounding, excise, charm, classifiers, curate, admin, the planner-eval judge |
| `tool_choice: {type:'any'}` agentic loop | `mode: ANY`; the model's turn is echoed back **verbatim** (thought signatures) and each call gets a `functionResponse` with its own id + name | `pipeline/scout.ts` |
| planner `tool_choice: auto` + `disable_parallel_tool_use` | `mode: VALIDATED` (talk OR call, schema + required fields enforced); the FIRST `plan_route` call wins | `apps/api/src/planner.ts` |
| `web_search` server tool loop ending in a `report` tool | ONE call: `googleSearch` + `responseJsonSchema` (Vertex forbids search + custom functions in one request, but Gemini 3 allows search + a response schema) | `eval/veracity.ts` |
| adaptive thinking / `effort` | `thinkingConfig.thinkingLevel` LOW / MEDIUM / HIGH (no "off"; MINIMAL is a 400 on 3.8) | every call picks one explicitly |
| explicit `cache_control` breakpoints | none — Gemini's IMPLICIT cache matches a common request prefix; the stable parts still lead | planner, narration |
| `stop_reason` | `finishReason` — ⚠ a reply carrying a function call finishes `STOP` (there is no `tool_use`); `MAX_TOKENS`, safety finishes, `MALFORMED_FUNCTION_CALL`, and `promptFeedback.blockReason` (no candidate at all) | planner classifier, narration, grounding, curate |
| `Anthropic.APIError` / `APIUserAbortError` | `ApiError` (`.status`; `.message` IS the raw body — never logged) / a reason-less `AbortError` for rider, deadline and per-attempt timeout alike | planner |

**Thinking: HIGH on every call, output cap: the model's ceiling — both founder rules, 2026-09-23**
("always run gemini on high", after listening to HIGH-vs-MEDIUM narration samples on three Tahoe places;
then "you can significantly bump caps, because i have a lot of GCP credits"). Each is ONE constant in
`@skipper/shared` — `LLM_THINKING_LEVEL = 'HIGH'`, `LLM_MAX_OUTPUT_TOKENS = 65_536` — read by every call
site (narration, every judge, excise, enrich, curate, the admin helpers, the planner, the planner-eval
judge and the release AUDIO judge). `forcedToolRequest` accepts no level and no cap, and
`packages/shared/test/thinking-level.test.ts` fails on any hard-coded level, so the rule cannot drift one
call site at a time. (The first cut of this migration had mixed LOW/MEDIUM/HIGH; that is superseded.)
On Gemini the cap bounds thinking + output together (probed: a 150-token cap on HIGH spent 143 on
thought), so the full ceiling is what makes HIGH safe everywhere. What bounds a call now is its CLOCK:

- **the live planner** — `PLANNER_MAX_TOKENS` 4,096 → **65,536** (founder call; limits.ts keeps its own
  literal and a test pins it equal to the shared one). Measured at HIGH on the real roster: 485–3,237
  thinking tokens, **6–21 s to the first word** (MEDIUM: ~5–7 s) — the round-the-lake ask used 3,268 of
  the old 4,096. The 45 s `PLANNER_TIMEOUT_MS` ends a runaway turn near ~11k tokens (~$0.05); typical
  turns cost $0.011–0.02. The silent thinking before the first token is the accepted trade.
- **the admin curated-places draft** — measured at HIGH for 120 places: 80.7 s, and one run's first 90 s
  attempt timed out (billed anyway) before the retry finished at 155.8 s. It now gets ONE 220 s attempt
  (`ADMIN_DRAFT_HTTP`), inside the server's 240 s idleTimeout; the quick bbox proposal keeps 90 s × 2.
- **the job summarizer** — its per-request timeout went 20 s → 120 s.
- **the release audio judge** moved MEDIUM → HIGH WITHOUT a `RELEASE_ASSESSMENT_POLICY` bump: the rubric
  is unchanged, and a bump would hide every existing assessment from the publication gate and force a
  paid re-judge. Assessments before 2026-09-23 ran at MEDIUM.

## What was probed before it landed (founder: "spend as much as you want without further approval")

Every request shape, live, on `gemini-3.8-flash` / `us` (`packages/studio/.scratch/gemini-*.ts`,
gitignored):

| Shape | Result |
| --- | --- |
| forced call with `parametersJsonSchema` using `additionalProperties`, `enum`, integer bounds, `maxItems`, nested objects, `type: [x,'null']` | ✅ accepted as written; args schema-exact |
| `MINIMAL` thinking | ❌ 400 `Thinking level is unsupported` (documented) |
| streamed chat turn with a function available (`VALIDATED`) | ✅ text streams in 3 chunks; usage arrives ONLY on the final chunk |
| streamed draw turn | ✅ the call arrives whole in one chunk, `finish: STOP`, NO text part — the Claude-era wordless draw, which the required `say` field already covers |
| two-turn function loop, turn echoed verbatim | ✅ |
| same loop with the thought signature stripped | ❌ 400 "Function call is missing a thought_signature" |
| Google Search grounding | ✅; with `responseJsonSchema` together | ✅ |
| cap on thinking | a 150-token cap at HIGH: 143 thought, `MAX_TOKENS` after three words |
| implicit cache, synthetic 14–17k-token prefixes, 16 calls on `us` and `global` | never hit |

Then the SHIPPED code, live (`packages/studio/.scratch/gemini-e2e.ts`, `apps/api/.scratch/planner-live.ts`,
`apps/admin/.scratch/draft-smoke.ts`):

- `narrateStop` on a four-fact Vikingsholm sheet: a grounded, in-voice script. ⚠ **HIGH thinking spent
  13.7k–15.5k thinking tokens for ~120 words — 82–94 s and ~$0.07 a clip.** The same input at MEDIUM:
  2.1k thinking, 16 s, a comparably grounded script (one sample, not an ear test). HIGH is kept for parity
  until the founder A/Bs the two by ear — it makes a full-region regen roughly 5× slower than on Claude
  (well inside the studio job's 6 h timeout). `NARRATION_MAX_TOKENS` went to 60k so HIGH cannot truncate.
- the 3-vote grounding gate flagged both planted inventions ("tallest house in California", "rowed out
  every afternoon"); `exciseUngrounded` cut exactly those sentences.
- veracity (Google Search + JSON) caught a planted "Leonard Palme" and returned the correction with a
  source; charm, the scout loop (it fetched geology, then finalized), the register classifier and the
  job summarizer (whose `z.record` schema Gemini accepted) all returned valid, validated output.
- **the live planner against the real Lake Tahoe roster (132 anchors, ~11.4k-token prompt):** a chat turn
  in 5.2 s for **$0.011**; a draw turn in 7.2 s, $0.011, a valid route with real anchor uuids and the ends
  read back in persona. The draw turn **read 4,038 cached tokens** — the implicit cache does work on the
  real prompt, best-effort. Opus 4.6 was ~$0.07 a turn.
- the admin curated-places draft: 12 ranked, resolvable places in 16.5 s.

## Re-measured on the new model (2026-09-23)

**Grounding-gate calibration** (`eval/calibrate.ts`, 18 golden cases × 3 votes = 54 judge calls,
**$0.16** — Opus 4.6 was $0.73): **verdict agreement 17/18, violation recall 8/8, false positives 3
claims across 1/10 clean cases.** Recall — the fail-closed axis — is perfect, as on Opus 4.6 (17/18, 8/8,
1 across 1/10) and Opus 5 (16/18, 8/8, 4 across 2/10). The disagreement is `grounding-ambient-ok`, a
clean case over-flagged three times; that costs excision rounds, never a shipped hallucination. The runner
exits non-zero on any disagreement, as designed.

**Planner eval** (`apps/api/eval/run.ts --apply`, 15 scenarios / 59 turns + judge, **$0.34** — Opus 4.6
was $0.57): **routing 1.00 (0/59), voice 1.00, discipline 0.98 (1/59) → the run reports GATE: FAIL;
persona advisory 0.76 with 0/59 flagged; judge 8/10 — ship.** The one discipline flag is worth reading
before reacting to the FAIL: asked *"how far is that?"* the skipper said *"That's the map's business, not
mine — I don't keep the mileage in my head…"* — a correct deflection that invented no distance, caught
because the turn's banned phrase `mile` is a substring match and `mileage` contains it. Two re-runs of
that scenario (`--only route-metrics --no-judge`, $0.03) both passed 4/4. So: a detector false positive on
one sample of a non-deterministic turn, NOT a regression; the check was left exactly as it is (loosening
a gate to turn a run green is the thing this repo refuses to do). The judge noted one "welcome aboard"
slip (nautical — off-persona) in the last conversation. `durations` 1 (the known "Two hours …" detector
shape — do not tighten it); `repeats` 23 (Opus 4.6: 28, Opus 5: 12), again mostly the place-name
read-backs the prompt requires; echoes 9/59. Raw turns: `apps/api/eval/.runs/2026-09-23T22-09-12-253Z-mem.json`.

## Prod canary (2026-09-23, after pushing `00eef324`)

All three triggered builds SUCCESS (api, admin, studio; site correctly not triggered). `skipper-api-00169-x6b
→ 00170-rt9` at 100% traffic; admin `→ 00105-4wz`. `/health` 200 in 0.25 s (baseline 0.31 s), `/version`
200. One deliberate real `POST /drives/plan` on prod (founder go): 200 in 6.3 s, an in-persona read-back
of Tahoe City → Emerald Bay State Park asking for the yes. Prod's own `plan_spend` line: revision
`00170-rt9`, `model`/`served_by` `gemini-3.8-flash`, `stop_reason: STOP`, `usage_reported: true`, 132
anchors, 11,394 in / 546 out (520 thinking), **$0.011652** — which proves the runtime service account
reaches Vertex (the one thing that could not be proven from a laptop). Zero ERROR-severity lines on
skipper-api or skipper-admin in the 20 minutes after the deploy (baseline: none in the prior 2 h). Not
exercised on prod: the admin helpers (behind IAP; same forced-call shape as the drafts proven locally) and
a studio job run (paid, and nothing to run).

## Hardened after an independent review (same day)

- `LEAKED_TOOL_CALL` (apps/api/src/tool-call-leak.ts) only knew CLAUDE's leak shape (`<invoke …>`); it now
  also matches Gemini's (`default_api.<fn>(` and a `tool_code` fence). None was seen in 67 Gemini eval
  turns — the blind spot was closed before it could bite.
- A MAX_TOKENS reply is now a failure even when it still carries a call whose args validate
  (`parseToolReply` throws; excision returns the original script) — a cut-short list reads as a smaller,
  cleaner verdict, and only the finish reason tells them apart.
- The studio client gained a 10-minute per-attempt timeout (the Gen AI SDK sets none; Anthropic's did).
- `apps/api/eval/run.ts --effort` rejects anything but low/medium/high instead of silently running at the
  default depth under the wrong label.

**Re-measured at HIGH (2026-09-23, after the always-HIGH rule).** Grounding calibration ($0.45 — 2.8×
the MEDIUM run): **agreement 16/18, recall 8/8, false positives 3 claims across 2/10 clean cases**
(`grounding-ambient-ok` 2, `grounding-callback-ambient` 1). Recall — the fail-closed axis — stays perfect;
precision dipped by one clean case, which costs excision rounds, never a shipped hallucination. Planner
eval ($0.44): **routing 1.00, voice 1.00, persona 0/59 flagged (0.77), judge 8/10 — ship; discipline 1/59
→ GATE FAIL on the SAME "I don't keep the mileage in my head" deflection** (the `mile` substring ban —
now 2 of 4 full-suite runs of that turn; the two isolated re-runs passed). Whether to narrow that ban to
a word match is the founder's call; the check was left as it is. `repeats` 17 (MEDIUM: 23), `durations` 1
("Two hours noted!" — the known noise shape). Thinking p50 646 / max 1,735 tokens, every turn `STOP`,
mean $0.0068 / max $0.0125 a turn. Raw: `apps/api/eval/.runs/2026-09-23T23-04-49-010Z-mem.json`.

## Deploy prerequisites

1. ✅ DONE 2026-09-23 (founder go "do next"): `gcloud projects add-iam-policy-binding
   lithe-window-491818-k8 --member=serviceAccount:skipper-api@lithe-window-491818-k8.iam.gserviceaccount.com
   --role=roles/aiplatform.user` — WITHOUT it every `POST /drives/plan` is a 403 (`plan_spend`
   `err: permission_denied`) and every rider hears the outage line. Granted BEFORE the push. (It could not
   be proven from a laptop — impersonating the SA needs a token-creator role nobody here holds — so the
   post-push canary is the proof.)
2. ✅ DONE 2026-09-23: the same for `skipper-admin@…` (bbox proposal + curated-places draft).
   `skipper-studio@…` already had it (TTS and the release audio judge use Vertex).
3. ✅ DECIDED 2026-09-23 (founder, after the green canary: "keep the keys"): `AWS_BEARER_TOKEN_BEDROCK`,
   `AWS_REGION` and `ANTHROPIC_API_KEY` STAY in both encrypted env files. Nothing reads them; they are kept
   on purpose so `git revert` of `00eef324` stays a one-step rollback to Bedrock. Do not "clean them up"
   as dead config.

## Known trade-offs, recorded rather than re-litigated

- **Judge and writer are one model family now** (they were on Claude too). Self-preference bias bites the
  taste judges (charm, the planner-eval persona judge) most; grounding is a verifiable check against a
  printed sheet. The one-line mitigation is pointing `JUDGMENT_MODEL` at a different family.
- **Veracity's Google Search queries bill per QUERY past the monthly free allowance** (Vertex pricing
  page, 2026-09-23), outside the token tally — as the Anthropic web_search fee did. Google's terms let a
  customer omit Search Suggestions below 1M grounding prompts/day, so the CLI's plain-text report is fine.
- **Gemini reports usage only on a stream's final chunk**, so a planner turn cut off mid-stream has no
  counts to salvage; `plan_spend` now says `usage_reported: false` instead of letting zeros read as free.
- **A rider hanging up no longer stops the spend already started.** The Gen AI SDK documents abort as
  client-only: "will not cancel the request in the service. You will still be charged." On Claude, closing
  the stream stopped generation. What survives: a rider already gone when the turn starts opens NO call,
  and a mid-turn exit is still logged as a cancellation, not an outage. At ~$0.01 a turn it was accepted.
- **No per-request search cap** (Claude's `max_uses`): the prompt's "1-4 claims" is the bound.
- **Temperature is ignored on Gemini 3** — the grounding gate's union voting stays the only reliability lever.
