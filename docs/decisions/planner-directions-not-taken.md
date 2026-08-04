# Two directions the live planner did NOT take

> **Status:** ✅ DECIDED 2026-08-03 — both answers are NO, and both were reached by measurement or by
> reading current vendor docs rather than by argument. Recorded here because each is expensive to
> re-derive and each has an obvious-looking champion who will propose it again. Moved out of `TODO.md`
> in the 2026-08-03 backlog re-baseline; the measurements are unchanged.

Neither of these is a backlog item. They are closed questions with a stated reopening condition.

---

## 1. Spatial context for the planner — MEASURED, and the answer is NO (~$1.40)

**Do not build a drive-time matrix, a routing-engine dependency, or any per-place spatial context for
the live planner.**

**The experiment.** A hand-written banded drive-time table for the six fixture anchors, injected as a
volatile system block *after* the cache breakpoint (`extraSystem`, a measurement seam on
`PlannerModelArgs`). Two arms × two pairs, 50 turns each, judge off — the deterministic metrics are the
point. Reproduce with `bun apps/api/eval/run.ts --apply [--spatial] --no-judge`.

| metric | control ×2 | spatial ×2 | verdict |
|---|---|---|---|
| routing failures | 2, 2 | 0, 3 | no effect |
| durations asserted as road fact | 12, 10 | 6, 12 | no effect |
| repeated phrases (6+ words) | 37, 48 | 28, 37 | spatial lower BOTH pairs |

**What it bought: nothing it was for.** Routing is flat. The `contradictory-ask` scenario — added
specifically to fail on the observed `durationDrift` defect (Emerald Bay to Incline is ~50 min; the rider
asks for two hours) — behaved IDENTICALLY in both arms. The skipper agreed to two hours with the table in
front of him. The one axis that moved consistently is repetition, ~23% lower in both pairs, which is real
but is not what the feature was for and does not justify the build.

⚠ **The leak fear did not materialise, and this is the useful negative result.** The research that
preceded this leaned hard on a study measuring 47% secret-leakage on Opus-class models, with suppression
instructions worth only ~25 points — the expectation was that a model holding drive times it is forbidden
to state would tilt or blurt. It did not: durations asserted were 6 vs 12 in the first pair and 12 vs 10
in the second, i.e. noise in both directions. ⚠ **An intermediate write-up of pair one alone claimed the
leak had HALVED. It did not replicate. Do not cite pair one.**

**Cost of building it anyway, for whoever revisits.** Google's Maps terms forbid storing computed
durations outright (§3.2.3(a) names "distance matrix results" in the No-Scraping list; only place IDs are
exempt indefinitely, lat/lng for 30 days), so the only storable source is a non-Google engine —
OSRM/Valhalla/OpenRouteService — which is a real dependency, a new table, a migration, and an operator
step that `curate-places` does not have today. Paying that for a flat routing metric is not a trade.

**If it is ever revisited**, the encoding question is already settled: measured drive-time BANDS,
per-anchor, name-keyed — a measurement, not a projection, so it reads correctly on a ring, a corridor, a
hub-and-spoke and a blob alike. ⚠ **Do NOT revive the projection family** (1-D shore coordinate, MDS): a
ring does not collapse to 1-D under classical MDS — the double-centred matrix is circulant, PC1 is ~50%,
the same score an isotropic blob and a symmetric hub get. There is no shape detector there.

---

## 2. An LLM framework (BAML / Vercel AI SDK) — researched, NOT adopted

Founder asked about **BAML** and then **Vercel's AI SDK**. Both were researched against current docs, not
answered from impressions. **Verdict: not for the live planner. If one is ever adopted,
`packages/studio` is the right first target and the planner is the last.**

**Why the question came up, and it is a good one.** The session's hardest bug was the model serializing
its `plan_route` call into rider-visible prose instead of emitting a tool block (INV-8, observed live for
the first time). BAML's Schema-Aligned Parsing exists for exactly that class — it does not use native
tool-calling at all, it prompts for structured output and parses whatever comes back (broken JSON,
markdown-wrapped, chain-of-thought preceding the payload). Under SAP the failure would be a successful
parse rather than a lost turn.

**BAML — the disqualifier is structural, not capability.** It is a codegen language: `.baml` files
compile to a typed client. This repo deliberately has NO build step ("internal packages export `.ts`
source; bun runs it, `tsc --noEmit` type-checks"), and `apps/api/Dockerfile` copies only `apps/api/src`,
so generated code needs a home and a story in that image. Caching is supported but coarser
(`allowed_role_metadata ["cache_control"]` plus role-level metadata) and **it is unverified whether it can
express TWO breakpoints in one request**, which is exactly what this path needs (system block 1 + the
message tail). ⚠ A broken cached prefix is the single most expensive silent regression here and shows up
only on the invoice.

**Vercel AI SDK — clears every hard requirement, and the founder has already shipped it**
(`ai@6.0.190` + `@ai-sdk/react@3.0.192` in `manoa/archive/mobile`). Verified against the docs:
`providerOptions.anthropic.cacheControl` on system parts AND message parts AND tools;
`usage.inputTokenDetails.cacheReadTokens/cacheWriteTokens` (so the `cache_read: 0` tell survives);
`finishReason: 'length'` distinguishable from `'stop'`/`'tool-calls'` (the truncation case);
`thinking: { type: 'adaptive', effort }`; `disableParallelToolUse`; `abortSignal`. No build step.

**And still no, for `apps/api/planner.ts`, on three grounds that are not about capability:**

1. **No capability gain, and the risk lands on the least testable code.** The value of that module is not
   the HTTP call — it is the six-outcome classifier, telling a rider hanging up from a vendor timeout, and
   the INV-13 guarantee that no vendor error body ever reaches a log (`plannerFailure` reads
   `APIError.type` and nothing else). `finishReason` supplies raw material; every one of those mappings
   still has to exist.
2. **The agent-loop framing is a spend footgun.** `ToolLoopAgent` defaults to `isStepCount(20)`. On a path
   where one anonymous rider request MUST equal one billed call (INV-11), an abstraction whose natural
   mode is multi-step is the wrong thing to sit beside. `streamText` is single-step, but the surrounding
   API invites the other shape.
3. **`display: 'omitted'` is unverified.** The docs list `'summarized'`; this code deliberately uses
   `'omitted'` because rider-facing text must never carry reasoning (INV-8). Prove it first.

⚠ **The client is a bigger commitment than it looks, and would NOT fix the lag.** `apps/mobile` does not
talk to a model — it talks to `POST /drives/plan`, which emits custom SSE frames (`event: say`,
`event: turn`). `useChat` expects the SDK's own data-stream protocol, so adopting it means changing the
WIRE CONTRACT and coupling both halves to the SDK. And manoa's smooth chat was not `useChat` doing the
work: [chat-render-performance.md](../designs/chat-render-performance.md) found skipper's lag is render
architecture (unvirtualized `ScrollView`, unmemoized rows, composer state at the screen root). **Adopt the
SDK as an architecture decision if at all — never as a performance fix.**

**If it is ever revisited, start at `packages/studio`**: many structured batch calls (`enrich`,
`classify-treatments`, `curate-places`, the eval judges), all forced-tool-use JSON extraction, no latency
or cache pressure, and it never deploys to Cloud Run. That is where the leverage is.
