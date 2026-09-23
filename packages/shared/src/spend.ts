// Model pricing + the per-process token tally — what a run SPENT on model calls.
//
// ⚠ WHY THIS LIVES IN @skipper/shared AND NOT IN STUDIO (INV-11). It started in
// `packages/studio/src/pipeline/spend.ts`, which was right while every paid call was an OPERATOR
// batch run behind `--apply`. 1.1 breaks that assumption: `POST /drives/plan` spends model tokens on
// EVERY rider request, forever, anonymously, with no `--apply` and no human in the loop — and
// `apps/api` does not depend on `@skipper/studio`. A request path that cannot price what it spends
// cannot record a token tally, which is one of the four guards INV-11 names. `@skipper/shared` is the
// common dependency, so the pricing moved here.
//
// ⚠ TTS pricing deliberately did NOT move — it stays in studio. TTS is synthesis, which only ever
// happens in the operator pipeline; putting it here would hand the request path a cost model for
// something it can never do.
//
// Process-global on purpose: a CLI run is one process and exits, and the API's per-request use reads
// the numbers off ONE call rather than accumulating (see below).

/** $/MTok, keyed by the model id the code SENDS. Claude rows: the Anthropic catalog (cache READS bill
 *  0.1x input, 5-minute cache WRITES 1.25x). Gemini rows: Google Cloud's Agent Platform pricing page
 *  (cached input bills 0.1x input, and there is no write premium — a Gemini call never reports a cache
 *  write, so the 1.25x never applies to it). Re-verify on the vendor page rather than from memory. */
export interface ModelPricing {
  inputPerMTok: number
  outputPerMTok: number
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
  // Sonnet 4.6 — the default corpus `enrich` model (verified 2026-06-15).
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
  // Haiku 4.5 — the delivery-register classifier fallback (verified 2026-06-20).
  'claude-haiku-4-5-20251001': { inputPerMTok: 1, outputPerMTok: 5 },
  // Opus 5 — the live planner 2026-08-01 → 2026-09-17. Still priced because historical `eval_runs` rows
  // and saved planner-eval turns name it. ⚠ Whatever row prices `LLM_MODELS.planner` is the one that
  // prices a RIDER-triggered call: every other model spends when a human ran a CLI; that one spends when
  // a stranger opens the app. An unpriced planner would tally $0 forever with nothing failing — which is
  // exactly what the drift guard exists to prevent, and why that guard iterates every LLM_MODELS value
  // rather than a hand-maintained list.
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25 },
  // Opus 4.6 on Amazon Bedrock — every model key 2026-09-17 → 2026-09-23. Still priced because that
  // week's calibration + planner-eval runs (and their saved raw turns) name both ids. Bedrock is partner-billed and
  // its pricing page is the authority; these rows are derived from the Anthropic list rate ($5/$25/MTok,
  // platform.claude.com pricing table, fetched 2026-09-17) and Bedrock's documented rule that a regional
  // (CRIS) profile bills +10% over the global one. Cache multipliers are the same 0.1x read / 1.25x write.
  // ⚠ Keyed by the id the code SENT (the retired `BEDROCK.opus46`), not the echo in `response.model` — Bedrock
  // echoes `claude-opus-4-6` (probed 2026-09-17), which would never match a lookup and would tally $0
  // silently.
  // The `us.` profile (the one that was live): inference in US regions, +10%.
  'us.anthropic.claude-opus-4-6-v1': { inputPerMTok: 5.5, outputPerMTok: 27.5 },
  // The global profile — same model, routed anywhere with capacity, list price.
  'global.anthropic.claude-opus-4-6-v1': { inputPerMTok: 5, outputPerMTok: 25 },
  // Gemini 3.8 Flash on Vertex AI — EVERY LLM_MODELS key since 2026-09-23, the live planner included,
  // so the rider-triggered warning above applies to this row. The rate is the "non-global" one because
  // the code sends to the `us` multi-region (VERTEX.location): +10% over the global endpoint. Fetched
  // from cloud.google.com/vertex-ai/generative-ai/pricing on 2026-09-23. Thinking tokens bill at the
  // OUTPUT rate — `geminiUsage` folds them into `output_tokens` for exactly that reason.
  // ⚠ INTRODUCTORY RATE — it doubles on a date Google has published; see PRICE_CHANGES below, which is
  // what keeps a run in January from reporting half of what it billed.
  'gemini-3.8-flash': { inputPerMTok: 0.825, outputPerMTok: 4.125 },
}

/** Published future list-price changes, applied by `pricingFor` on and after `from` (UTC).
 *
 *  ⚠ WHY THIS EXISTS INSTEAD OF A CALENDAR REMINDER. Doctrine: "a paid one reports what it BILLED, not
 *  what it planned." A static table that silently stays on an expired introductory rate under-reports
 *  every call by half from the first day of the new price — the `--max-cost` caps and the planner's
 *  `plan_spend` line included — and nothing fails. Encoding the published change makes the number
 *  right on the day without anyone remembering. */
export const PRICE_CHANGES: Record<string, { from: string; pricing: ModelPricing }> = {
  // Google: "Starting January 1, 2027, standard pricing of $1.5 / $7.5 per 1M tokens input / output"
  // (global); the non-global row keeps its +10%.
  'gemini-3.8-flash': { from: '2027-01-01T00:00:00Z', pricing: { inputPerMTok: 1.65, outputPerMTok: 8.25 } },
}

/** The rate a call made at `at` bills at: the scheduled change once it is in effect, else the table. */
export function pricingFor(model: string, at: Date = new Date()): ModelPricing | undefined {
  const change = PRICE_CHANGES[model]
  if (change && at.getTime() >= Date.parse(change.from)) return change.pricing
  return MODEL_PRICING[model]
}

const CACHE_READ_MULT = 0.1
const CACHE_WRITE_MULT = 1.25

/** The tally's usage shape. It is Anthropic's `response.usage` spelling because that is what every
 *  recorded row and saved eval turn already carries; Gemini's `usageMetadata` is converted INTO it by
 *  `geminiUsage` below rather than the other way round. Structural, so nothing here imports an SDK and
 *  `@skipper/shared` stays dependency-free (mobile imports this package too). */
export interface UsageLike {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

/** The slice of Gemini's `GenerateContentResponse.usageMetadata` the conversion reads. Structural for
 *  the same reason as `UsageLike`; every field is optional because Gemini omits a zero count rather
 *  than sending 0 (probed: `thoughtsTokenCount` is simply absent on a call that did not think). */
export interface GeminiUsageMetadata {
  promptTokenCount?: number | null
  cachedContentTokenCount?: number | null
  candidatesTokenCount?: number | null
  thoughtsTokenCount?: number | null
}

/**
 * Gemini usage → the tally's shape, billed the way Google bills it.
 *
 * ⚠ TWO FOLDS, AND EACH ONE IS A SILENT UNDER- OR OVER-COUNT IF DROPPED:
 *   · `promptTokenCount` INCLUDES the cached tokens, so uncached input is the difference — pricing
 *     both at the full rate would bill the cached share twice.
 *   · thinking is billed at the OUTPUT rate but reported apart from `candidatesTokenCount`, so output
 *     is the sum. On Gemini 3 every call thinks; leaving it out would under-count every call.
 * A missing metadata object (a stream that died before its final chunk) converts to zeros, which is
 * the honest reading of "nothing was reported" — the callers that can salvage more say so themselves.
 */
export function geminiUsage(meta: GeminiUsageMetadata | null | undefined): UsageLike {
  const prompt = meta?.promptTokenCount ?? 0
  const cached = Math.min(meta?.cachedContentTokenCount ?? 0, prompt)
  return {
    input_tokens: prompt - cached,
    output_tokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
  }
}

interface Tally {
  calls: number
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

const tallies = new Map<string, Tally>()

export function recordModelUsage(model: string, usage: UsageLike): void {
  const t = tallies.get(model) ?? { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  t.calls += 1
  t.input += usage.input_tokens
  t.output += usage.output_tokens
  t.cacheRead += usage.cache_read_input_tokens ?? 0
  t.cacheWrite += usage.cache_creation_input_tokens ?? 0
  tallies.set(model, t)
}

/** What ONE call cost, without touching the process tally.
 *
 *  Exists for the request path: a long-lived API process accumulating a global tally would grow
 *  without bound and mean nothing (whose spend is it?). A rider-triggered call wants the cost of THAT
 *  call, to log or attribute; the CLI wants the running total. Same pricing, two shapes. */
export function usageUsd(model: string, usage: UsageLike, at: Date = new Date()): number {
  const p = pricingFor(model, at)
  if (!p) return 0 // unknown model: honestly unpriced rather than silently guessed
  return (
    (usage.input_tokens * p.inputPerMTok +
      (usage.cache_read_input_tokens ?? 0) * p.inputPerMTok * CACHE_READ_MULT +
      (usage.cache_creation_input_tokens ?? 0) * p.inputPerMTok * CACHE_WRITE_MULT +
      usage.output_tokens * p.outputPerMTok) /
    1_000_000
  )
}

/** A running tally priced by the SAME arithmetic as a single call.
 *
 *  ⚠ This was a second copy of `usageUsd`'s formula differing only in field spelling, in the module
 *  INV-11 names as a spend guard — so a pricing change (a new cache multiplier, a rounding rule)
 *  applied to one and not the other made the per-call `plan_spend` log and the CLI's running total
 *  silently disagree about the same dollars. A tally IS a summed usage; the only real difference is
 *  the names, so that is all this does. */
const tallyUsd = (model: string, t: Tally): number =>
  usageUsd(model, {
    input_tokens: t.input,
    output_tokens: t.output,
    cache_read_input_tokens: t.cacheRead,
    cache_creation_input_tokens: t.cacheWrite,
  })

/** Total recorded LLM spend (USD) across all models this process. */
export function llmSpentUsd(): number {
  let sum = 0
  for (const [model, t] of tallies) sum += tallyUsd(model, t)
  return sum
}

const fmtTok = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n)

/** One human line per model — printed by generate-narrations.ts ahead of the TTS phase. */
export function llmSpendLines(): string[] {
  return [...tallies.entries()].map(([model, t]) => {
    const priced = pricingFor(model) ? `$${tallyUsd(model, t).toFixed(2)}` : 'unpriced'
    return (
      `LLM spend ${model}: ${priced} (${t.calls} calls · in ${fmtTok(t.input)}` +
      ` + cache r${fmtTok(t.cacheRead)}/w${fmtTok(t.cacheWrite)} · out ${fmtTok(t.output)})`
    )
  })
}

/** Model ids that were tallied but have no MODEL_PRICING entry — their dollars read $0,
 *  so a cost CAP must fail safe when this is non-empty (silent under-count otherwise). */
export function unpricedModels(): string[] {
  return [...tallies.keys()].filter((m) => !pricingFor(m))
}

/** Test seam — the tally is process-global. */
export function resetSpendTally(): void {
  tallies.clear()
}
