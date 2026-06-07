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
// Text-to-speech — ElevenLabs (POST /v1/text-to-speech/{voice_id}/with-timestamps)
// ---------------------------------------------------------------------------
// We synthesize narration OFFLINE in a batch job (latency irrelevant, quality
// paramount), so we use ElevenLabs' most lifelike narration model. The
// /with-timestamps endpoint returns the MP3 (base64) AND character alignment in
// one call, so we get audio + exact duration together
// (durationMs = last(alignment.character_end_times_seconds) * 1000) — which
// satisfies the ready-gate's non-null-audio + known-duration requirement without
// a second probe.
//
// Sources: https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
//          https://elevenlabs.io/docs/overview/models
export const TTS_MODEL = 'eleven_multilingual_v2' as const

// MP3 at 44.1 kHz / 128 kbps — good quality/size for narration; uploaded to R2
// with this Content-Type. (mp3_44100_192 needs a higher ElevenLabs tier.)
// NOTE: output_format is a QUERY param on the REST endpoint, not a body field.
export const TTS_OUTPUT_FORMAT = 'mp3_44100_128' as const
export const TTS_AUDIO_CONTENT_TYPE = 'audio/mpeg' as const

// ElevenLabs voice options for the Skipper. The ACTIVE pick (`adam`) is a
// PROFESSIONAL voice → permanent (NOT subject to the 2026-12-31 Default-voice
// sunset). The george/brian/bill entries are legacy "Default" voices that
// ElevenLabs RETIRES on 2026-12-31 — kept only as A/B references, do not ship them.
// Source: https://help.elevenlabs.io/hc/en-us/articles/25844757988753
export const ELEVEN_VOICES = {
  adam: 'IRHApOXLvnW57QJPQH2P', // "Adam — American, Dark and Tough" — PROFESSIONAL (permanent)
  george: 'JBFqnCBsd6RMkjVDRZzb', // "Warm, Captivating Storyteller" — DEPRECATED Default (gone 2026-12-31)
  brian: 'nPczCjzI2devNBz1zQrb', // "Deep, Resonant and Comforting" — DEPRECATED Default
  bill: 'pqHfZKP75CvOlQylNhV4', // older, trustworthy, warm narrator — DEPRECATED Default
} as const

export type ElevenVoiceId = (typeof ELEVEN_VOICES)[keyof typeof ELEVEN_VOICES]

// The Skipper's voice. Stored VERBATIM as the poi_content cache-key `voice`.
// `adam` is a professional (permanent) voice — not affected by the Default-voice sunset.
export const SKIPPER_VOICE_ID: ElevenVoiceId = ELEVEN_VOICES.adam

// voice_settings tuned for a warm/corny/characterful storyteller on
// eleven_multilingual_v2 (continuous controls). style is moderate — high style
// destabilizes long passages. (eleven_v3 would change these semantics.)
export const ELEVEN_VOICE_SETTINGS = {
  stability: 0.4,
  similarity_boost: 0.8,
  style: 0.35,
  use_speaker_boost: true,
  speed: 1.0,
} as const

/**
 * Voice is a fixed function of persona in v1 — centralized here so it can't drift
 * from the poi_content cache-key `voice` dimension. The stored value is the
 * ElevenLabs voice_id. (A user-selectable voice knob is deferred to M3.)
 */
export const PERSONA_VOICE = {
  skipper: SKIPPER_VOICE_ID,
} as const
