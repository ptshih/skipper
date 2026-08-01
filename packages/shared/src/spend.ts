// Model pricing + the per-process token tally — what a run SPENT on Anthropic calls.
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

/** $/MTok. Source: the Anthropic model catalog via the `claude-api` skill — re-verify there rather
 *  than from memory, since the table moves. Cache READS bill 0.1x the input rate; 5-minute-TTL cache
 *  WRITES bill 1.25x (the only TTL this repo uses). */
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
  // Opus 5 — the LIVE PLANNER (CLAUDE_MODELS.planner), verified 2026-08-01.
  // ⚠ The ONLY row here that prices a RIDER-triggered call rather than an operator batch. Every other
  // model in this table spends when a human ran a CLI; this one spends when a stranger opens the app.
  // An unpriced planner would tally $0 forever with nothing failing — which is exactly what the drift
  // guard exists to prevent, and why that guard now iterates every CLAUDE_MODELS value rather than a
  // hand-maintained list.
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25 },
}

const CACHE_READ_MULT = 0.1
const CACHE_WRITE_MULT = 1.25

/** The slice of Anthropic's `response.usage` the tally needs — structural, so nothing here imports
 *  the SDK and `@skipper/shared` stays dependency-free (mobile imports this package too). */
export interface UsageLike {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
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
export function usageUsd(model: string, usage: UsageLike): number {
  const p = MODEL_PRICING[model]
  if (!p) return 0 // unknown model: honestly unpriced rather than silently guessed
  return (
    (usage.input_tokens * p.inputPerMTok +
      (usage.cache_read_input_tokens ?? 0) * p.inputPerMTok * CACHE_READ_MULT +
      (usage.cache_creation_input_tokens ?? 0) * p.inputPerMTok * CACHE_WRITE_MULT +
      usage.output_tokens * p.outputPerMTok) /
    1_000_000
  )
}

function tallyUsd(model: string, t: Tally): number {
  const p = MODEL_PRICING[model]
  if (!p) return 0 // unknown model: tokens are tallied, dollars honestly unpriced
  return (
    (t.input * p.inputPerMTok +
      t.cacheRead * p.inputPerMTok * CACHE_READ_MULT +
      t.cacheWrite * p.inputPerMTok * CACHE_WRITE_MULT +
      t.output * p.outputPerMTok) /
    1_000_000
  )
}

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
    const priced = MODEL_PRICING[model] ? `$${tallyUsd(model, t).toFixed(2)}` : 'unpriced'
    return (
      `LLM spend ${model}: ${priced} (${t.calls} calls · in ${fmtTok(t.input)}` +
      ` + cache r${fmtTok(t.cacheRead)}/w${fmtTok(t.cacheWrite)} · out ${fmtTok(t.output)})`
    )
  })
}

/** Model ids that were tallied but have no MODEL_PRICING entry — their dollars read $0,
 *  so a cost CAP must fail safe when this is non-empty (silent under-count otherwise). */
export function unpricedModels(): string[] {
  return [...tallies.keys()].filter((m) => !MODEL_PRICING[m])
}

/** Test seam — the tally is process-global. */
export function resetSpendTally(): void {
  tallies.clear()
}
