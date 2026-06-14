// Run-spend visibility — the LLM token tally + the pre-TTS cost estimate.
//
// Every Anthropic call site (narrate, scout, closer judge, grounding) records its
// response.usage here; generate.ts prints the tally + a TTS estimate right before the
// TTS/R2 phase and enforces the --max-cost gate (TODO.md cost guardrail). The framing
// is honest: by that point the LLM spend is SUNK — TTS is the one cost still unpaid,
// so the gate's job is to SHOW the sunk spend and cap the remainder.
//
// Process-global on purpose (one generation per process; the CLI exits after a run).

export interface ModelPricing {
  inputPerMTok: number
  outputPerMTok: number
}

/** $/MTok — Anthropic catalog (claude-api skill, verified 2026-06-09). Cache READS bill
 *  0.1× the input rate; 5-minute-TTL cache WRITES 1.25× (the only TTL this repo uses). */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
}
const CACHE_READ_MULT = 0.1
const CACHE_WRITE_MULT = 1.25

/** The slice of Anthropic's response.usage the tally needs (structural — no SDK import). */
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

/** One human line per model — printed by generate.ts ahead of the TTS phase. */
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

/* -------------------------------------------------------------------------- */
/*  TTS estimate — Gemini-TTS is TOKEN-billed, not char-billed                  */
/* -------------------------------------------------------------------------- */

/** Cloud TTS Gemini pricing: ~$1/MTok text-in, ~$20/MTok audio-out, audio ≈ 25 tokens/sec
 *  (pricing page fetched 2026-06-09; ≈ $1.80 per audio-hour). */
export const TTS_TOKEN_PRICING = { textPerMTok: 1, audioPerMTok: 20, audioTokensPerSec: 25 } as const
// Spoken pace mirrors narrate.ts's WORDS_PER_SECOND (the target the model wrote to).
// 3.1-flash reads a touch slower than 2.5 words/sec, so this UNDER-estimates ~5–15% —
// fine for a pre-spend gate; the print says "~".
const TTS_WORDS_PER_SECOND = 2.5
const TTS_CHARS_PER_TEXT_TOKEN = 4

export interface TtsEstimate {
  usd: number
  estSeconds: number
}

/** Estimate the TTS bill for a set of scripts BEFORE synthesis. The style prompt rides
 *  every synthesize call's input, so it is counted once per script. */
export function estimateTtsUsd(scripts: readonly string[], stylePromptChars: number): TtsEstimate {
  let estSeconds = 0
  let textChars = 0
  for (const script of scripts) {
    const words = script.trim().split(/\s+/).filter(Boolean).length
    estSeconds += words / TTS_WORDS_PER_SECOND
    textChars += script.length + stylePromptChars
  }
  const textTok = textChars / TTS_CHARS_PER_TEXT_TOKEN
  const audioTok = estSeconds * TTS_TOKEN_PRICING.audioTokensPerSec
  const usd =
    (textTok * TTS_TOKEN_PRICING.textPerMTok + audioTok * TTS_TOKEN_PRICING.audioPerMTok) / 1_000_000
  return { usd, estSeconds }
}
