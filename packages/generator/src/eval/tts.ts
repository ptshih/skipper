// TTS-CLEANLINESS evaluator — a deterministic GATE (no LLM, no spend).
//
// The script is synthesized VERBATIM by Gemini-TTS, so any markup, emoji, URL, or SSML/HTML
// in it is read aloud as garbage (or, for emoji, rendered as tofu upstream). The persona
// prompt already orders "spoken, no markdown"; this CHECKS the output, catching regressions
// (a model slip, or a future prompt edit that leaks formatting). Because it's a GATE, every
// rule is HIGH-PRECISION: it fires only on characters/shapes that never occur in normal
// spoken English prose — em-dashes, ellipses, quotes, parentheses, and apostrophes are all
// fine and deliberately NOT flagged. (Bare digits are intentionally NOT gated: "1960" reads
// fine and gating it would false-positive; a spell-out-numbers check, if wanted, is a
// separate advisory signal.)

import type { StopEval } from './types'

export interface TtsInput {
  seq: number
  script: string
}

interface Rule {
  label: string
  test: RegExp
}

// Each rule matches an unambiguous TTS-breaker. Order = report order.
const RULES: Rule[] = [
  { label: 'markdown emphasis/code (* _ `)', test: /[*_`]/ },
  { label: 'markdown heading (#)', test: /(^|\n)\s{0,3}#{1,6}\s/ },
  { label: 'markdown link/image "](" ', test: /\]\(/ },
  { label: 'list marker at line start', test: /(^|\n)\s*([-+•]|\d+[.)])\s+\S/ },
  { label: 'URL', test: /(https?:\/\/|www\.)/i },
  { label: 'HTML/SSML tag (<...>)', test: /<\/?[a-z!][^>]*>/i },
  { label: 'emoji (renders as tofu; TTS chokes)', test: /\p{Extended_Pictographic}/u },
]

/**
 * Score one stop's TTS-cleanliness. PASS = no TTS-breaking markup present (binary: a script
 * is either speakable as-is or it is not). Returns the SAME StopEval shape as every other
 * evaluator, so it drops straight into the scorecard panel + the regen `avoid[]` hook.
 */
export function evaluateTts(input: TtsInput): StopEval {
  const findings = RULES.filter((r) => r.test.test(input.script)).map((r) => `TTS-unsafe: ${r.label}`)
  return {
    seq: input.seq,
    dimension: 'tts',
    pass: findings.length === 0,
    score: findings.length === 0 ? 1 : 0,
    findings,
  }
}
