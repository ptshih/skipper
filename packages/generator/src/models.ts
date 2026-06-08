// AI model identifiers for @skipper/generator.
//
// Constants only — this file is the single source of truth for model ids so the
// narration (Anthropic) and TTS (Google Cloud TTS) call sites never hard-code a string.
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
// Text-to-speech — Google Cloud Text-to-Speech (Gemini-TTS voices)
// ---------------------------------------------------------------------------
// We synthesize narration OFFLINE in a batch job (latency irrelevant, quality
// paramount). We hit the Cloud TTS REST endpoint (texttospeech.googleapis.com)
// with a GEMINI-TTS voice so the work bills to the GCP project — GCP Welcome/trial
// credits are NOT usable on the Gemini Developer API key; only Cloud TTS / Vertex
// draw GCP credits. Cloud TTS uniquely gives the persona three things: the warm
// Gemini "Sulafat" voice, a first-class natural-language STYLE prompt
// (input.prompt) to steer delivery, and LINEAR16 output so we get an EXACT duration
// from the byte length (there is no /with-timestamps equivalent). Auth is OAuth/ADC
// (text:synthesize takes no API key) — handled in pipeline/tts.ts. No ElevenLabs
// quota or 2026-12-31 voice sunset to worry about on this provider.
//
// Sources: https://docs.cloud.google.com/text-to-speech/docs/gemini-tts
//          https://docs.cloud.google.com/text-to-speech/docs/basics

// The Gemini-TTS model backing the voice (goes in voice.model_name). `pro` is the
// most natural/steerable; swap to 'gemini-2.5-flash-tts' for cheaper/faster.
export const TTS_MODEL = 'gemini-2.5-pro-tts' as const

// LINEAR16 (16-bit PCM) so duration is EXACT from byte length; stored in R2 as a
// playable WAV (pipeline/wav.ts wraps headerless PCM if the API returns it). MP3 /
// OGG_OPUS would be ~10x smaller but their duration is not byte-linear — a later
// size optimization, not an M1 concern.
export const TTS_AUDIO_ENCODING = 'LINEAR16' as const
export const TTS_SAMPLE_RATE_HZ = 24_000 as const
export const TTS_AUDIO_CONTENT_TYPE = 'audio/wav' as const
export const TTS_CLIP_EXTENSION = 'wav' as const
export const TTS_LANGUAGE_CODE = 'en-US' as const

// Gemini-TTS prebuilt voices (each carries a one-word timbre descriptor). The
// ACTIVE pick is `algenib` ("Gravelly") — a deep, weathered MALE voice that fits
// the written "a man" persona, chosen by ear (2026-06-08) from a full-catalog
// audition reading the canonical Jungle-Cruise jokes deadpan. `sulafat` ("Warm")
// was the prior pick but reads female; it and the rest stay as A/B references.
export const GEMINI_VOICES = {
  algenib: 'Algenib', // Gravelly — THE SKIPPER PICK (deep/weathered, male; matches the persona). Picked 2026-06-08.
  sulafat: 'Sulafat', // Warm — former pick (female; retired because the persona is a man)
  achird: 'Achird', // Friendly
  gacrux: 'Gacrux', // Mature
  vindemiatrix: 'Vindemiatrix', // Gentle
  charon: 'Charon', // Informative (tour-guide register)
} as const

export type GeminiVoice = (typeof GEMINI_VOICES)[keyof typeof GEMINI_VOICES]

// The Skipper's voice. Stored VERBATIM as the poi_content cache-key `voice` (and in
// the R2 clip key), so changing it after tours exist forces re-synthesis. No
// ElevenLabs sunset/quota constraint on this provider.
export const SKIPPER_VOICE_ID: GeminiVoice = GEMINI_VOICES.algenib

// Natural-language DELIVERY directive (Cloud TTS input.prompt). The persona's words
// already live in the script; this only sets HOW it is read, never WHAT is said —
// so it can't loosen grounding. (Persona-in-delivery, not in facts.)
export const SKIPPER_TTS_STYLE_PROMPT =
  'Read this as a warm, dry, low-and-slow river-boat tour captain talking to friends riding along in the car: unhurried, genuinely glad they came, a man who has told these corny jokes a thousand times and still quietly delights in every one. Deliver the jokes completely deadpan and fully committed to the bit — never laugh at your own setup, never sing-song the punchline, never signal "get it?"; land each one flat and matter-of-fact, a little pleased with yourself even when it is terrible. You are the straight man to your own jokes. Put a small pause right before the pun and a slightly longer beat right after it, so there is room for the groan. Let the quiet, sincere lines breathe. Conversational and human, the sound of a man noticing things out the window — never a newscaster, never a stand-up comedian working a crowd.'

/**
 * Voice is a fixed function of persona in v1 — centralized here so it can't drift
 * from the poi_content cache-key `voice` dimension. The stored value is the Cloud
 * TTS Gemini voice name. (A user-selectable voice knob is deferred to M3.)
 */
export const PERSONA_VOICE = {
  skipper: SKIPPER_VOICE_ID,
} as const
