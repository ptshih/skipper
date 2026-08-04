# Studio's structured-output layer — harden it in-repo, do NOT adopt the AI SDK

> **Status:** 🔨 **IN PROGRESS (founder go 2026-08-04, "go for all of them")** — recommendation was NO on
> the framework and YES on a ~40-line in-repo helper, and the build is now running the stages below.
> **Stage 0 (the paid CLI's missing receipt) is LANDED.** No stage spends, so none needed a paid-run go.
> ⚠ Stage 3's one real decision — advisory judges DEGRADE rather than throw — was taken as recommended
> under the blanket go; it is flagged here because it is reversible and the founder may want the other
> policy. This answers the open half of
> [planner-directions-not-taken.md](../decisions/planner-directions-not-taken.md) §2, which closed the
> question for the LIVE PLANNER and left `packages/studio` named as "the first target if ever
> revisited" — that pointer was written from the shape of the code, before anyone counted what studio's
> call sites actually do. Counting changed the answer.

## The question, and the short version

§2 declined BAML and Vercel's AI SDK for `apps/api/planner.ts` on three grounds that were not about
capability, and ended: *"If it is ever revisited, start at `packages/studio`: many structured batch
calls, all forced-tool-use JSON extraction, no latency or cache pressure, and it never deploys to Cloud
Run. That is where the leverage is."*

**The leverage is real and the diagnosis was right. The framework is still the wrong instrument for it.**
Studio has four measured defects in how it handles model output. A Zod-backed helper — no new runtime
dependency, because zod 4 is already in the tree — fixes all four. The AI SDK fixes two of them as a side
effect, costs ten call-site rewrites and two new dependencies, and **loses request/response fidelity on
the two most expensive paths in the pipeline.** So: fix the defects, skip the framework, and keep the
reopening condition narrow.

## What is actually there (measured 2026-08-04)

Ten production model call sites in `packages/studio/src`, all Anthropic Messages API, all through
`getAnthropic()` in `models.ts` — **except one, which builds its own client** (below). Three more sites
sit just outside (`apps/admin/server/index.ts`, `apps/admin/server/places.ts`, `apps/api/eval/judge.ts`)
and share the same shape, so any helper should be reachable by them later even if they are out of scope
now.

| site | tool use | records usage | validates output |
| --- | --- | --- | --- |
| `pipeline/narrate.ts` | none (plain text + cached system) | ✅ | n/a — text |
| `pipeline/scout.ts` | forced `{type:'any'}`, agentic loop | ✅ | ❌ cast |
| `pipeline/classify-register.ts` | forced tool | ✅ | ❌ cast |
| `pipeline/job-output.ts` | **none — regex-scrapes JSON from prose** | ❌ | ❌ `JSON.parse` |
| `classify-treatments.ts` | forced tool | ❌ | ❌ cast |
| `curate-places.ts` | forced tool | ✅ | ❌ cast |
| `eval/grounding.ts` | forced tool | ✅ | ❌ cast |
| `eval/charm.ts` | forced tool | ✅ | ❌ cast |
| `eval/excise.ts` | forced tool | ✅ | ❌ cast |
| `eval/veracity.ts` | **`auto` + web search, deliberately** | ✅ | ❌ cast |

**`grep -rn "from 'zod'\|safeParse" packages/studio/src` returns nothing.** Not one byte of model output
in the studio pipeline is validated at runtime. Eight sites hand-write a JSON Schema, then assert the
result into a TypeScript type.

## The four defects

**1. The schema is a promise and the type is a lie (8 sites).** The pattern, verbatim from
`eval/charm.ts`:

```ts
const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
if (!call) throw new Error('Charm judge returned no structured report.')
return call.input as CharmVerdict
```

`input_schema` declares `charm` as `integer, minimum 1, maximum 10`. Anthropic's tool schemas are **not
grammar-enforced** unless `strict: true` is set, and it is not set anywhere in studio — and even under
strict, `minimum`/`maximum`/`maxItems` are documented as unenforced (the same finding that bounded the
`strict: true` item in `TODO.md`). So `charm: 11`, a missing `sag`, or a `recommendation` outside the
enum all flow straight into `charmToStopEvals` → `s.charm >= CHARM_PASS_THRESHOLD` → the panel. The
failure is silent and scores are the output.
⚠ The `find(…tool_use) + cast` block is duplicated **ten times across eight files**. CLAUDE.md names
"two copies of the same set drifting" as this repo's most-repeated bug class; this is ten copies.

**2. A paid CLI that reports nothing about what it billed.** `classify-treatments.ts` never calls
`recordModelUsage`, so `llmSpentUsd()` — the number the CLIs print and `finishJob` writes to
`studio_jobs.cost_usd` — cannot see it. Its own header documents the spend as an *estimate*
(*"measured ~$0.82 for 64 groups"*) and warns *"⚠ PREVIEW SPENDS TOO"*, but nothing reports the actual
bill. This is precisely the defect that was fixed for the charm judge on 2026-08-02, whose comment reads:
*"A judge that bills invisibly is the one thing a spend tally must not permit."* Doctrine is explicit —
**"a paid one reports what it BILLED, not what it planned."**
⚠ It is *not* a false `$0.00` in a job row, because `classify-treatments` has no `runJob` wrapper at all
— which is arguably worse: there is no row, no printed spend line, and no record that a run cost
anything.

**3. `pipeline/job-output.ts` is the worst structured-output path in the repo, and it is inside the job
path.** It asks Haiku for `{ "summary": …, "data": … }` as **free text**, then:

```ts
const jsonMatch = text.match(/\{[\s\S]*\}/)
if (jsonMatch) { const parsed = JSON.parse(jsonMatch[0]) as { … } }
```

wrapped in a `try` whose `catch` returns a minimal object *"so the caller never has to handle null."*
Three compounding problems: a greedy regex takes the first `{` to the last `}` (any prose brace breaks
it), there is no tool call to force the shape, and the catch-all makes a **systematically** broken
extraction indistinguishable from a job that had no metrics. It also does not record usage, so every
job's summarizer tokens are missing from `studio_jobs.cost_usd`.
⚠ It also builds `new Anthropic()` directly, so `models.ts`'s claim — *"ONE lazily-built singleton for
every call site"* — is already false. Two clients, two retry policies (`maxRetries: 5` vs the SDK default
via a per-request `maxRetries: 1`).

**4. Nothing makes any of the above impossible to reintroduce.** Recording usage, forcing the tool, and
checking the result are three things every site is trusted to remember, and two sites already forgot one.

## What the AI SDK would buy, checked against v7 — not the v6 write-up

⚠ **First, a currency correction that matters.** §2 verified against `ai@6.0.190`. As of 2026-08-04 the
published versions are **`ai@7.0.51`** and **`@ai-sdk/anthropic@4.0.29`** — a major bump one day after
that research. Anything adopted now must be re-verified against v7. Re-checked here against
`ai-sdk.dev` (v7 docs + the 7.0 migration guide):

- ✅ **Usage fields survive the bump, and §2's citation was already the v7 shape**:
  `usage.inputTokenDetails.{noCacheTokens,cacheReadTokens,cacheWriteTokens}` and
  `usage.outputTokenDetails.{textTokens,reasoningTokens}`. The 7.0 migration guide confirms the
  top-level `cachedInputTokens`/`reasoningTokens` were **removed** in favour of these. So
  `recordModelUsage` remains feedable.
- ✅ **Prompt caching is expressible** — `providerOptions.anthropic.cacheControl: { type: 'ephemeral' }`
  on system message parts, message parts, *and* tools, with `ttl: '1h'`. `narrate.ts`'s single cached
  system block ports cleanly.
- ✅ **Adaptive thinking + effort** — `providerOptions.anthropic.thinking: { type: 'adaptive' }` plus
  `effort: 'low' | 'medium' | 'high' | 'max'`.
- ✅ **Forced tool choice** — `toolChoice: 'required'` or a named tool.
- ✅ **Real validation** — `generateObject` / `Output.object` with a Zod schema throws
  `NoObjectGeneratedError` rather than handing back an unchecked object. This is the genuine win, and it
  is the *only* one of studio's four defects the framework fixes that a helper does not fix equally.

**And the costs, which land on the paths that matter most:**

1. ⚠ **`narrate.ts` reads two Anthropic-specific fields the unified API does not carry.** It throws
   distinct errors on `stop_reason === 'refusal'` (with `stop_details`) and `stop_reason === 'max_tokens'`.
   The SDK's unified `finishReason` union is `stop | length | content-filter | tool-calls | error | other`
   — **there is no `refusal`**, and `stop_details` would have to be dug out of `providerMetadata` /
   `rawFinishReason`. Narration is the most expensive call in the pipeline and refusal handling is how a
   run fails loudly instead of writing a bad clip. Trading a first-class field for a raw-metadata dig on
   that path is a downgrade.
2. ⚠ **`eval/veracity.ts` uses `auto` tool_choice *because* forcing the tool would prevent web search** —
   a server-side Anthropic tool inside a multi-turn exchange. That is the single hardest thing to port and
   the one judge whose output is advisory anyway, so the migration's risk and its value are inversely
   matched.
3. ⚠ **`pipeline/scout.ts` is an agentic loop** (`tool_choice: {type:'any'}`, every turn either fetches or
   finalizes). The SDK's idiom is multi-step with a stop condition — a semantic change on a
   founder-gated, corpus-scale paid path. §2 already flagged the agent-loop framing as a spend footgun for
   `apps/api`; the same instinct applies here, where `enrich` bills per POI across hundreds.
4. **Provider portability, the SDK's headline benefit, is worth approximately nothing here.** `models.ts`
   pins Claude ids, and `JUDGMENT_MODEL` carries an explicit warning that the judge rubrics were
   calibrated against Opus-tier judging — *"moving this would silently shift every score."* Studio is
   deliberately single-provider.

## Recommendation: the in-repo helper

**Zod 4 already generates the JSON Schema, so this needs no new dependency** (`zod@^4.4.3` is in
`@skipper/shared`; studio needs it added as a direct dep, which is a one-line change to an existing
transitive). Verified in the installed version on 2026-08-04:

```
z.toJSONSchema(z.object({ charm: z.int().min(1).max(10), rec: z.enum(['ship','tune','rework']) }))
→ { type: 'object', properties: {…}, required: [...], additionalProperties: false, $schema: … }
```

That is byte-for-byte the shape the eight sites hand-write today, including `additionalProperties: false`,
`required`, `description` from `.describe()`, enums, and numeric bounds.

One function — call it `callTool()` in `pipeline/tool-call.ts` — takes a model, system, messages, a tool
name/description and a Zod schema, and:

1. derives `input_schema` from the schema (`z.toJSONSchema`, `$schema` stripped),
2. forces the tool,
3. calls `recordModelUsage` **before** anything can throw (the ordering `eval/charm.ts` learned the hard
   way and documents at the call),
4. finds the `tool_use` block and `safeParse`s it,
5. throws one labelled error naming the site and the validation failure.

That deletes ten duplicated find-and-cast blocks, makes forgetting the spend tally impossible by
construction, and turns eight silent-corruption paths into loud ones — the exact three properties the
framework was wanted for, minus the dependency and minus the fidelity loss on `narrate`/`scout`/`veracity`,
which keep using `getAnthropic()` directly because they are not forced-single-tool calls.

## The traps this must not walk into

⚠ **1. A naive Zod swap CHANGES THE BYTES the calibrated judges see, and that shifts scores.**
`z.int()` emits `minimum: -9007199254740991, maximum: 9007199254740991` where the hand-written schema has
a bare `{ type: 'integer' }`. The tool schema is part of the prompt. `models.ts` is explicit that judge
thresholds were calibrated against Opus-tier judging and that moving the ground *"would silently shift
every score (re-run `eval/calibrate.ts` after any bump)."* So for the four judge sites, either keep the
hand-written schema and add validation only, or accept a re-calibration — **decide per site, do not
assume the schemas are interchangeable.** The cheapest honest path is to migrate the non-calibrated sites
first (`classify-register`, `classify-treatments`, `curate-places`, `job-output`) and treat the judges as
a second, measured step.

⚠ **2. Validation is a BEHAVIOUR change on paid runs, and strict-everywhere is the wrong default.**
Today a malformed report proceeds silently; after, it throws. On the load-bearing paths that is correct
and doctrine agrees — *"absence of failure is not success."* But `charm` and `veracity` are **advisory**
(they never withhold a clip), so a schema hiccup throwing there would kill a run that already spent, over
a number that does not gate anything. Validate strictly where the output is load-bearing; on the advisory
judges, degrade to "advisory unavailable" with a loud log and let the run finish. **This is the one real
design decision in the whole plan.**

⚠ **3. Do not let this become a repo-wide codemod.** Ten call sites across eight files, several of them
in the paid pipeline, in a tree shared with other agents. CLAUDE.md's rule is explicit: by explicit path,
atomic commits, never a codemod.

⚠ **4. `job-output.ts`'s catch-all fallback is load-bearing and must survive.** Its contract is *"the
caller never has to handle null"*, and it runs while a job is settling — a throw there could take down the
reporting of an otherwise successful run. Convert it to forced tool use **and keep the fallback**, but
make the fallback say that extraction failed rather than returning something indistinguishable from a
quiet job.

## The plan, cheapest first, each stage independently shippable

**Stage 0 — the two spend gaps (free, no dep, no schema work).** Add `recordModelUsage` to
`classify-treatments.ts` and `job-output.ts`; point `job-output.ts` at `getAnthropic()` so `models.ts`'s
one-client claim becomes true again. Give `classify-treatments` a printed spend line like
`curate-places` has. ⚠ Whether it should also get a `runJob` wrapper is a separate question — it is a
region-scoped operator CLI, not an admin-launched job, so probably not; the printed line is the fix.

**Stage 1 — `callTool()` plus the four non-calibrated sites.** Add `zod` to studio's `package.json`, write
the helper with its own test (a stub client, a schema, one valid and one invalid payload, and an assertion
that usage is recorded even when validation fails). Migrate `classify-register`, `classify-treatments`,
`curate-places` one commit each.

**Stage 2 — `job-output.ts` from regex to forced tool use.** The highest-value single fix in the list, and
it is independent of everything else.

**Stage 3 — the four judges, as a measured step, not a refactor.** Add validation without touching the
schemas first. Only consider deriving their schemas from Zod if someone is willing to re-run
`eval/calibrate.ts` and compare.

**Stage 4 — decline the AI SDK, and record the reopening condition.** Revisit only if studio ever needs a
second provider, or if `NoObjectGeneratedError`-style repair proves necessary after stages 1–3 are in
place and still leaking. Neither is true today.

## What this does NOT claim

- No measurement here shows that any of the eight unvalidated casts has *actually* produced a bad score.
  The claim is that nothing would catch it if one did, and that the corpus has already been regenerated
  into worse states for less reason.
- Stage 0's `classify-treatments` gap is a reporting defect, not a spend defect. The money was always
  really spent; the operator just never learns how much.
- BAML is not re-litigated. Its disqualifier (codegen into a repo with no build step) is structural and
  unchanged, and its one real advantage — Schema-Aligned Parsing — targets the planner's tool-call-as-text
  leak, which is not a studio failure mode.
