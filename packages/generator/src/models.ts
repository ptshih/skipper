// AI model identifiers for @skipper/generator.
//
// Constants only — this file is the single source of truth for model ids so the
// narration (Anthropic) and TTS (OpenAI) call sites never hard-code a string.
// Each id below cites where it came from; re-verify against the linked source
// before bumping.

// ---------------------------------------------------------------------------
// Narration — Anthropic Messages API
// ---------------------------------------------------------------------------
// The spec wants the MOST CAPABLE model for narration quality. Per the current
// Anthropic model catalog, Claude Opus 4.8 is the most capable model and its
// API id is the bare string "claude-opus-4-8".
//
// IMPORTANT: use the bare id exactly as written — do NOT append a date suffix
// (date-suffixed Opus ids 404). Opus 4.8 also only supports adaptive thinking
// (no `budget_tokens` / `temperature` / `top_p` / `top_k`) if/when the actual
// narration request is wired up later.
//
// Source: Anthropic model catalog (claude-api skill — "Current Models" table,
// cross-checked against platform.claude.com models overview).
export const NARRATION_MODEL = 'claude-opus-4-8' as const

// Cheaper / faster Anthropic fallbacks from the same catalog, if narration ever
// needs to trade capability for cost or latency.
export const NARRATION_MODEL_ALTERNATES = {
  /** best speed / intelligence balance */
  sonnet: 'claude-sonnet-4-6',
  /** fastest & cheapest */
  haiku: 'claude-haiku-4-5-20251001',
} as const

// ---------------------------------------------------------------------------
// Text-to-speech — OpenAI Audio API (audio.speech.create)
// ---------------------------------------------------------------------------
// "gpt-4o-mini-tts" is OpenAI's current, most reliable TTS model and the ONLY
// one that supports the steerable `instructions` parameter (control tone,
// emotion, accent, pacing — ideal for giving the skipper a consistent
// character). Legacy "tts-1" (low latency) and "tts-1-hd" (higher quality)
// still exist but support only 9 voices and ignore `instructions`.
//
// Source: OpenAI Text-to-Speech guide
// https://developers.openai.com/api/docs/guides/text-to-speech
export const TTS_MODEL = 'gpt-4o-mini-tts' as const

// Legacy TTS models, kept for reference (do not use unless you need tts-1's
// lower latency and can live without `instructions`).
export const TTS_MODEL_LEGACY = {
  fast: 'tts-1',
  hd: 'tts-1-hd',
} as const

// Characterful voice candidates for the skipper.
// gpt-4o-mini-tts exposes 13 voices: alloy, ash, ballad, coral, echo, fable,
// nova, onyx, sage, shimmer, verse, marin, cedar.
// OpenAI recommends `marin` and `cedar` for best overall quality. `ballad`,
// `ash`, `verse`, `fable`, and `onyx` read as the most expressive/characterful
// of the set — good fits for a "skipper" persona.
// NOTE: `marin`, `cedar`, `ballad`, and `verse` are gpt-4o-mini-tts ONLY —
// they are not available on tts-1 / tts-1-hd.
//
// Source: OpenAI Text-to-Speech guide (link above).
export const TTS_VOICE_CANDIDATES = [
  'marin', // OpenAI-recommended, best quality
  'cedar', // OpenAI-recommended, best quality
  'ballad', // warm, expressive — strong characterful-skipper pick
  'ash', // dynamic, characterful
  'verse', // expressive, narration-friendly
  'fable', // storytelling timbre
  'onyx', // deep, authoritative
] as const

export type TtsVoice = (typeof TTS_VOICE_CANDIDATES)[number]

// Default voice for the skipper. Swap to any entry in TTS_VOICE_CANDIDATES.
export const TTS_VOICE: TtsVoice = 'ballad'

/**
 * Voice is a fixed function of persona in v1 — centralized here so it can't drift
 * from the poi_content cache-key `voice` dimension. (A user-selectable voice knob
 * on the tour request is deferred to M3.)
 */
export const PERSONA_VOICE = {
  skipper: TTS_VOICE,
} as const
