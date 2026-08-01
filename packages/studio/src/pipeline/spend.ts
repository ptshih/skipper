// TTS spend estimation — the one cost the --max-cost gate can still PREVENT.
//
// ⚠ The LLM half of this module MOVED to `@skipper/shared` (INV-11): `POST /drives/plan` spends
// model tokens on every rider request and `apps/api` cannot import `@skipper/studio`, so the pricing
// table and the token tally had to live where both can reach them. Import `recordModelUsage`,
// `MODEL_PRICING`, `llmSpentUsd`, `llmSpendLines`, `unpricedModels` and `resetSpendTally` from
// `@skipper/shared` — they are deliberately NOT re-exported here, so there is exactly one import
// path and no second home to drift from.
//
// TTS pricing stayed. Synthesis only ever happens in the operator pipeline, so handing the request
// path a cost model for something it can never do would be worse than useless.
//
// The framing the gate rests on is unchanged and worth restating: by the time this prints, the LLM
// spend is SUNK. TTS is the one cost still unpaid, so the gate's job is to SHOW the sunk spend and
// CAP the remainder.

import { WORDS_PER_SECOND } from '../config'

/* -------------------------------------------------------------------------- */
/*  TTS estimate — Gemini-TTS is TOKEN-billed, not char-billed                  */
/* -------------------------------------------------------------------------- */

/** Cloud TTS Gemini pricing: ~$1/MTok text-in, ~$20/MTok audio-out, audio ≈ 25 tokens/sec
 *  (pricing page fetched 2026-06-09; ≈ $1.80 per audio-hour). */
export const TTS_TOKEN_PRICING = { textPerMTok: 1, audioPerMTok: 20, audioTokensPerSec: 25 } as const
// Spoken pace = the shared WORDS_PER_SECOND base (the target the model wrote to).
// 3.1-flash reads a touch slower than 2.5 words/sec, so this UNDER-estimates ~5–15% —
// fine for a pre-spend gate; the print says "~". The separate TTS_ESTIMATE_SAFETY margin
// below corrects for it, so the shared base stays the single pace and the margin stays local.
const TTS_CHARS_PER_TEXT_TOKEN = 4

/** The estimate above UNDER-counts ~5–15% (WORDS_PER_SECOND runs a touch fast vs
 *  3.1-flash's real pace, so actual audio seconds — and the audio-token bill — come in
 *  higher). The --max-cost gate multiplies the estimate by this margin before comparing to
 *  the cap, so a tight cap is honored against the upper bound, not the optimistic point
 *  estimate (a $4.80 estimate on a $5 cap would otherwise sail through and bill ~$5.20). */
export const TTS_ESTIMATE_SAFETY = 1.2

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
    estSeconds += words / WORDS_PER_SECOND
    textChars += script.length + stylePromptChars
  }
  const textTok = textChars / TTS_CHARS_PER_TEXT_TOKEN
  const audioTok = estSeconds * TTS_TOKEN_PRICING.audioTokensPerSec
  const usd =
    (textTok * TTS_TOKEN_PRICING.textPerMTok + audioTok * TTS_TOKEN_PRICING.audioPerMTok) / 1_000_000
  return { usd, estSeconds }
}
