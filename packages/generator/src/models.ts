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
// Anthropic model catalog, Claude Fable 5 is the most capable model — a new tier
// ABOVE Opus — and its API id is the bare string "claude-fable-5".
//
// IMPORTANT: use the bare id exactly as written — do NOT append a date suffix.
// Fable 5 shares Opus 4.8's request surface — adaptive thinking only, NO
// `budget_tokens` / `temperature` / `top_p` / `top_k` (all 400) — with TWO extra
// Fable-only constraints: an explicit `thinking: {type:"disabled"}` ALSO 400s
// (it's accepted on Opus 4.8), and a FORCED tool_choice ({type:"tool"}) 400s with
// "tool_choice forces tool use is not compatible with this model" (observed live
// 2026-06-09, req_011CbtU9f7zsE1V8HegixKaw). narrate.ts ({type:"adaptive"}, no
// tools) rides the switch; the forced-tool judges (charm.ts)
// can NOT — they pin JUDGMENT_MODEL below instead of NARRATION_MODEL.
//
// COST (a founder-relevant axis, per CLAUDE.md): Fable 5 is ~2× Opus 4.8 —
// $10/$50 vs $5/$25 per MTok — so a live regen bills more. Switched 2026-06-09
// at founder request.
//
// Source: Anthropic model catalog (claude-api skill — "Current Models" table,
// cross-checked against platform.claude.com models overview).
export const NARRATION_MODEL = 'claude-fable-5' as const

// JUDGMENT tier — every NON-narration model call: the enrichment scout (pipeline/scout.ts)
// and the structured-report / spot-check judges (eval/charm.ts,
// pipeline/judge.ts, eval/grounding.ts, eval/veracity.ts). Opus 4.8, deliberately NOT
// NARRATION_MODEL. Two reasons it can't ride the narration model:
//   (a) Four of the five FORCE tool use (tool_choice {type:'tool'} or {type:'any'}), which
//       Claude Fable 5 rejects outright (400 "tool_choice forces tool use is not compatible
//       with this model" — observed live 2026-06-09, req_011CbtU9f7zsE1V8HegixKaw); only
//       veracity (auto tool_choice + web_search) is exempt.
//   (b) The judge rubrics/score thresholds were calibrated against Opus-tier judging — a
//       model swap would silently shift every score (re-run eval/calibrate.ts after a bump).
// Upgraded Sonnet→Opus 2026-06-09 at founder request (these were the judgment-tier
// "Sonnet is plenty" calls; the old NARRATION_MODEL_ALTERNATES catalog is gone with them).
export const JUDGMENT_MODEL = 'claude-opus-4-8' as const

// ---------------------------------------------------------------------------
// Text-to-speech — Google Cloud Text-to-Speech (Gemini-TTS voices)
// ---------------------------------------------------------------------------
// We synthesize narration OFFLINE in a batch job (latency irrelevant, quality
// paramount). We hit the Cloud TTS REST endpoint (texttospeech.googleapis.com)
// with a GEMINI-TTS voice so the work bills to the GCP project — GCP Welcome/trial
// credits are NOT usable on the Gemini Developer API key; only Cloud TTS / Vertex
// draw GCP credits. Cloud TTS uniquely gives the persona three things: a natural,
// steerable Gemini voice (the active pick is "Algenib" — see below), a first-class natural-language STYLE prompt
// (input.prompt) to steer delivery, and flexible output encodings (we now use MP3 —
// see the AUDIO FORMAT note below; duration, which the API never returns, is summed
// from the frames in pipeline/mp3.ts). Auth is OAuth/ADC
// (text:synthesize takes no API key) — handled in pipeline/tts.ts. No ElevenLabs
// quota or 2026-12-31 voice sunset to worry about on this provider.
//
// Sources: https://docs.cloud.google.com/text-to-speech/docs/gemini-tts
//          https://docs.cloud.google.com/text-to-speech/docs/basics

// The Gemini-TTS model backing the voice (goes in voice.modelName). Picked 2026-06-08
// BY EAR over 2.5-pro and 2.5-flash on the real canonical "1960 Winter Olympics" story:
// 3.1-flash (the newest tier) reads the deadpan a touch more unhurried, which suits the
// low-and-slow skipper. ⚠ PREVIEW MODEL — it may change or sunset; re-verify by ear if
// Google revises it, and keep GA 'gemini-2.5-pro-tts' as the fallback. All Gemini-TTS
// models share the same voices + encoding set, so this does NOT affect the 32k-MP3 output.
export const TTS_MODEL = 'gemini-3.1-flash-tts-preview' as const

// AUDIO FORMAT. We request MP3 directly from Gemini-TTS (unary text:synthesize supports
// LINEAR16/MP3/OGG_OPUS/ALAW/MULAW/PCM; MP3 is fixed "32kbps"). MP3 is ~12× smaller than
// the LINEAR16 WAV used through M1 — fixing the slow-buffer clip skips on weak signal and
// shrinking the future offline tour download (see docs/decisions/audio-compression-spike.md).
// OGG_OPUS is smaller still but iOS AVPlayer (expo-audio) CANNOT decode Ogg/Opus, so it's
// disqualified for the phone player. Cloud TTS returns no duration field and MP3 isn't
// byte-linear, so duration is summed from the MPEG frames (pipeline/mp3.ts) — validated
// exact against ffprobe.
//
// Typed as the union (NOT `as const`) so flipping back to 'LINEAR16' stays a ONE-LINE
// change — the spike's option B (request PCM, transcode to AAC@48k if 32kbps MP3 dulls
// the voice by ear) — and the LINEAR16 branch in tts.ts keeps type-checking.
//
// ⚠ Re-synth + EAR-TEST gate before relying on this: existing R2 clips are still WAV;
// flipping only affects NEW generation. Run ONE live synth (needs GCP creds) to confirm
// Gemini's MP3 parses, ear-test 32kbps MP3 vs AAC@48k on the founder-blessed Algenib
// read, then re-synth the CURRENT canonical preview (its id is destroyed/regenerated on
// each migration — look it up): resynth-tour.ts <canonical> + sweep orphaned .wav.
export const TTS_AUDIO_ENCODING: 'LINEAR16' | 'MP3' = 'MP3'
export const TTS_SAMPLE_RATE_HZ = 24_000 as const // honored for LINEAR16; MP3 is fixed 32kbps (rate may be ignored)
export const TTS_AUDIO_CONTENT_TYPE = 'audio/mpeg' as const
export const TTS_CLIP_EXTENSION = 'mp3' as const
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

// The Skipper's voice. Baked into the tour-OWNED narration audio, so changing it
// after tours exist forces re-synthesis (resynth-tour.ts). No ElevenLabs
// sunset/quota constraint on this provider.
export const SKIPPER_VOICE_ID: GeminiVoice = GEMINI_VOICES.algenib

// Natural-language DELIVERY directive (Cloud TTS input.prompt). The persona's words
// already live in the script; this only sets HOW it is read, never WHAT is said —
// so it can't loosen grounding. (Persona-in-delivery, not in facts.)
//
// WARMER delivery (Phase 1, 2026-06-08): replaces the prior low-and-slow / dry read —
// founder-picked over "tightened" / "drier" / "bigger-beat" (the tour-structure handoff's
// Appendix A — doc since deleted; see git history). Keeps the deadpan, committed-to-the-bit jokes but at a natural, easy talking
// pace (relaxed, never dragging), saving the slow-down for the puns with a confiding warmth.
// PAUSE re-anchored (2026-06-10, founder A/B ear test on the Chambers clip): the post-pun
// beat now serves deadpan RHYTHM, not a groan — the skipper-craft research found a beat held
// FOR an audience reaction is a live-boat artifact (docs/research/jungle-cruise-skipper-craft.md
// §5); in solo audio the pause just lets the pun sit.
// ANTI-FADE (2026-06-10, founder direction — fix the mumble at the prompt): measured tail
// collapse on 8/30 live clips (worst: emerald seq 13's final sentence at near-silence; see
// TODO.md "TTS audio QA"). The volume-lowering cues ("confiding", "quiet beat", bare
// "breathe") are gone and an explicit hold-the-level-to-the-last-word rule is in. Founder
// ear-tested this wording vs the prior one on the Dam clip + outro (no regression). NOTE:
// takes are stochastic — judge the fix across the next regen's full clip set, not one take.
// ⚠ NOT yet on the live canonical preview: this only affects NEW synthesis. Taking effect
// means re-synthesizing the canonical clips at Phase 6 (resynth-tour.ts --preview) and the
// founder re-validating by ear. Do NOT re-tune the wording without a fresh ear test.
export const SKIPPER_TTS_STYLE_PROMPT =
  'Read this as a warm road-trip tour guide letting friends in on jokes you all secretly enjoy — genuinely glad they came, a man who has told these corny jokes a thousand times and quietly loves every one. Keep the narration moving at a natural, easy talking pace, like a man telling you about the view out the window — relaxed but never sleepy, never dragging. Save the slow-down for the jokes: deliver them deadpan and fully committed, but with warmth — close and friendly, never dropping to a murmur — as if you and the riders both know it is corny and that is exactly why it is good. Never laugh at your own setup, never sing-song the punchline; land each one flat and matter-of-fact. Put a small pause right before the pun, and after it lands hold one short beat — not waiting for anything, just letting it sit — then roll on. Let the sincere lines breathe without fading — keep the voice clear, present, and at full conversational volume from the first sentence to the very last; never trail off, drop low, or swallow the closing words. Talking WITH friends, not at a crowd.'

// (The voice↔persona binding now lives in the persona registry — each PersonaDef carries
// its own `voice`; see packages/generator/src/persona/. `SKIPPER_VOICE_ID` above is the
// source constant the Skipper def references + the synthesize() default.)
