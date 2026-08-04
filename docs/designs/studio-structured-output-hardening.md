# Studio's structured-output layer — hardened in-repo; the AI SDK stays declined

> **Status:** ✅ **BUILT 2026-08-04 (founder go, "go for all of them").** The framework is declined and
> the in-repo fix is landed. ⚠ **The headline number in the first draft of this doc was WRONG and the
> correction is the most useful thing here: the sweep counted EIGHT unvalidated call sites by grepping for
> `input as`, and only TWO were genuinely blind.** Six validate by hand at the point of use, several
> better than a schema could. So the build is a fraction of what was planned, and the reopening condition
> for the framework is narrower than ever. This closes the open half of
> [planner-directions-not-taken.md](../decisions/planner-directions-not-taken.md) §2, which named
> `packages/studio` as the AI SDK's first target if it were ever revisited.

## The question

§2 declined BAML and Vercel's AI SDK for the live planner on three grounds that were not about
capability, and ended: *"If it is ever revisited, start at `packages/studio`: many structured batch
calls, all forced-tool-use JSON extraction, no latency or cache pressure, and it never deploys to Cloud
Run. That is where the leverage is."*

That pointer was written from the SHAPE of the code. Counting what the ten call sites actually do reversed
it — twice, in opposite directions, which is why both corrections are recorded below.

## What is there (measured 2026-08-04)

| site | tool use | recorded spend | validated the reply |
| --- | --- | --- | --- |
| `pipeline/narrate.ts` | none (text + cached system) | ✅ | n/a — text |
| `pipeline/scout.ts` | forced `{type:'any'}`, agentic loop | ✅ | ✅ clamps span ids to the real range |
| `pipeline/classify-register.ts` | forced tool | ✅ | ✅ checks the 4 registers, defaults `story` |
| `pipeline/job-output.ts` | **none — regex-scraped prose** | ❌ | ❌ `JSON.parse` |
| `classify-treatments.ts` | forced tool | ❌ | ❌ **blind cast** |
| `curate-places.ts` | forced tool | ✅ | ✅ per-field filter, throws when empty |
| `eval/grounding.ts` | forced tool | ✅ | ✅ absent `claims` fails closed |
| `eval/charm.ts` | forced tool | ✅ | ❌ **blind cast** |
| `eval/excise.ts` | forced tool | ✅ | ✅ non-empty string or the original script |
| `eval/veracity.ts` | `auto` + web search, on purpose | ✅ | ✅ throws unless `checked` is an array |

## ⚠ Correction 1: the defect was two sites, not eight

The first draft asserted *"not one byte of model output is validated at runtime"* on the strength of a
grep for `input as`. That grep cannot tell a **blind cast** from a **narrow defensive read followed by a
real check**, and six of the eight are the latter. Worse, several encode a domain decision a generic
schema would have destroyed:

- `eval/grounding.ts` distinguishes an **absent** `claims` key (malformed → fails closed) from
  `claims: []` (a legitimate verdict for a clip that speaks no place-claims). A schema accepts both or
  rejects both; the hand-rolled check is strictly more correct.
- `curate-places.ts` filters on `typeof rank === 'number'` *because* rank 0 is valid and a truthiness
  check would silently drop a 0-indexed model's best places — the comment says so.
- `classify-register.ts` checks the four legal registers and defaults to `'story'`, "the safest
  catch-all", rather than failing a run over one classification.
- `eval/excise.ts` returns the **original** script when the repair comes back unusable.
- `eval/veracity.ts` throws rather than let a truncated report read as a vacuous clean pass.
- `pipeline/scout.ts` dedupes and clamps indices to the article's real span range.

**Replacing any of those with a schema check would have deleted judgment and called it hardening.** This
is the repo's own documented trap — *an apparent gap is usually already accepted in a comment at the
definition; read that block before asserting a finding* — and the sweep walked straight into it.

The two genuinely blind sites were `eval/charm.ts` (`call.input as CharmVerdict`, straight into the
scores the panel reports) and `classify-treatments.ts`, where the cast was dangerous for a specific
reason: `treatment` is read as `v.treatment.toLowerCase()` and becomes the group's kind, so any value
other than the three legal ones would have entered the grouping as garbage.

## ⚠ Correction 2: the parse cannot live inside the call, because `withRetry` bills

The plan assumed one helper wrapping the whole call. `pipeline/http.ts`'s `withRetry` retries **every**
error four times, reasoning that *"a non-transient error just fails ~a few seconds later, harmlessly"* —
true of a free failure, false of a billed model call. `classify-treatments` wraps its call in `withRetry`,
so validating inside that wrapper would re-bill an Opus call **four times per group** over a
deterministic schema failure, on a paid run, silently.

Hence two layers, and the split is a cost decision rather than a style one:

- **`parseToolReply`** — find the forced tool call, validate, throw. Owns no client and bills nothing, so
  it is safe to use OUTSIDE a retry. For sites that own their call because they retry, loop, or return a
  graceful null.
- **`callTool`** — one plain call: record the spend, then delegate to `parseToolReply`. Cannot be wrapped
  wrong because it does not retry, and the tally sits above both throws so a call site cannot forget it.

## ⚠ Correction 3: the "decision for the founder" was already settled in code

The plan flagged one real decision — should an **advisory** judge fail a run when its reply does not
validate? It is moot: `audit-corpus.ts`, the charm judge's only caller, already wraps it in try/catch
(*"advisory; a failure is non-fatal, skipped"*) and prints a warning. So `callTool` throwing is correct
and the degradation already exists at the call site. Nothing was owed.

## Why the AI SDK is still declined

`ai@7.0.51` / `@ai-sdk/anthropic@4.0.29` as of 2026-08-04 — ⚠ note §2 verified against `ai@6.0.190`, a
major version behind, one day earlier. Re-checked against the v7 docs and the 7.0 migration guide:

- ✅ Usage survives the bump and §2's citation was already the v7 shape
  (`usage.inputTokenDetails.{cacheReadTokens,cacheWriteTokens}`; the top-level `cachedInputTokens` was
  removed). `recordModelUsage` stays feedable.
- ✅ `providerOptions.anthropic.cacheControl: {type:'ephemeral'}` on system parts, message parts and
  tools, with `ttl: '1h'` — `narrate.ts`'s cached system block ports cleanly.
- ✅ `thinking: {type:'adaptive'}` plus `effort: 'low'|'medium'|'high'|'max'`; named or `required`
  tool choice; and `generateObject`/`Output.object` throws `NoObjectGeneratedError` instead of handing
  back an unchecked object.

**And the costs land on the paths that matter most:**

1. ⚠ `narrate.ts` reads `stop_reason: 'refusal'` (with `stop_details`) and `'max_tokens'` as distinct
   failures. The SDK's unified `finishReason` union is
   `stop | length | content-filter | tool-calls | error | other` — **no `refusal`** — so that would become
   a dig through `providerMetadata`. Narration is the most expensive call in the pipeline and refusal
   handling is how a run fails loudly instead of writing a bad clip.
2. ⚠ `eval/veracity.ts` uses `auto` tool_choice *because* forcing would prevent web search — a
   server-side tool in a multi-turn exchange. Hardest thing to port, and the judge is advisory anyway.
3. ⚠ `pipeline/scout.ts` is an agentic loop; the SDK's idiom is multi-step with a stop condition, a
   semantic change on a founder-gated corpus-scale paid path. §2 flagged the agent-loop framing as a
   spend footgun for `apps/api`; `enrich` bills per POI across hundreds.
4. Provider portability — the headline benefit — is worth ~nothing: `models.ts` pins Claude ids and warns
   the judge rubrics were calibrated against Opus-tier judging.

**And after Correction 1, the leverage it was supposed to unlock is two call sites.** Ten call-site
rewrites and two dependencies to fix what forty lines fixed is not a close call.

## What landed

- **`pipeline/tool-call.ts`** — `parseToolReply`, `callTool`, `toolInputSchema`. No new runtime dependency
  beyond `zod` (already in the tree via `@skipper/shared`; added to studio as a direct dep because bun's
  isolated linker correctly refuses an undeclared import). 12 tests in `test/tool-call.test.ts`, including
  the ordering property (**spend recorded even when validation fails**) and a mutation check pinning the
  byte-drift below.
- **`classify-treatments.ts`** — a paid CLI that billed real money and reported nothing: no
  `recordModelUsage`, no `runJob`, so `llmSpentUsd()` could not see it. Its header's "~$0.82 for 64
  groups" is a planning estimate, not a receipt, and doctrine is *"a paid one reports what it BILLED"*.
  Now records usage and prints a receipt from `main().finally(...)` — one place rather than one per exit,
  and a run that throws mid-classification still reports what it spent. Verdict is validated, returning
  null on a bad reply so one unusable verdict costs one group instead of aborting a run (`mapLimit` fails
  fast).
- **`eval/charm.ts`** — the blind cast is gone; the verdict shape is one Zod definition with the TS types
  inferred from it, replacing an interface that sat beside a JSON Schema beside a cast.
- **`pipeline/job-output.ts`** — the greedy-regex scrape (`/\{[\s\S]*\}/`, first brace to last) is
  replaced by a forced tool call; it records its Haiku spend for the first time; it goes through the
  shared client, so `models.ts`'s "ONE lazily-built singleton for every call site" is true again; and its
  fallback now names the failure instead of reading identically to a job with nothing to report.

## The trap that survives

⚠ **A derived schema is NOT byte-identical to a hand-written one, and the calibrated judges care.** The
tool schema is part of the prompt. Measured: `z.toJSONSchema` renders an integer as
`{type:'integer', minimum:-9007199254740991, maximum:9007199254740991}` where the hand-written schemas
carry a bare `{type:'integer'}` — and **no zod spelling avoids it** (`z.int()` and `z.number().int()` both
emit the bounds). `models.ts` warns that moving the judges' ground *"would silently shift every score
(re-run eval/calibrate.ts after any bump)"*. So `eval/charm.ts` keeps its hand-written schema on the wire
and validates the reply only, via `callTool`'s `inputSchema` escape hatch. Deriving a calibrated site's
schema is a re-calibration, not a refactor. A test pins the drift so that if zod ever starts emitting a
bare integer, someone finds out.

## Reopening condition for the framework

A second model provider in studio, or `parseToolReply` proving insufficient in a way repair-style parsing
would fix. Neither is true. BAML is not re-litigated: its disqualifier (codegen into a repo with no build
step) is structural, and its one real advantage — Schema-Aligned Parsing — targets the planner's
tool-call-as-text leak, which is not a studio failure mode.

## What this does NOT claim

- No measurement shows either blind cast ever actually produced a bad score. The claim is that nothing
  would have caught it.
- `classify-treatments`'s gap was a **reporting** defect, not a spend defect. The money was always really
  spent; the operator just never learned how much.
- **Two of the three changed paths ARE proven against live models** (founder go, 2026-08-04, billed
  **$0.0305** total — Haiku $0.00 / Opus $0.03, one call each, no database touched):
  - `synthesizeJobOutput` returned a valid report through the forced tool, and its `data` came back
    materially richer than the regex path could carry — nested `groundingScores`, a typed `warnings`
    array, correct number/bool types. The free-form `z.record` renders as a schema the model fills happily.
  - `judgeCharm` returned a verdict that passed `CHARM_VERDICT` on the first try: all six required fields,
    two stops scored, integers inside 1–10, `recommendation` inside the enum. That is the real proof — the
    schema matches what the model actually emits, with its hand-written schema on the wire.
- ⚠ **`classify-treatments` is still unproven live, and it cannot be made cheap.** It takes `--region` and
  nothing narrower, so its smallest possible run is a full-region preview at ~$0.82 (and a preview spends).
  Deliberately left for a separate decision rather than folded into a smoke test. Its validation is the
  lenient kind — `highlights`/`drop`/`confidence` optional because every consumer already defaults them —
  so the expected failure mode on a first run is one skipped group with a warning, not a dead run.
