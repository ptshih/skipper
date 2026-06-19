// AI model identifiers for @skipper/studio.
//
// Constants only — this file is the single source of truth for model ids so the
// narration (Anthropic) and TTS (Google Cloud TTS) call sites never hard-code a string.
// Each id below cites where it came from; re-verify against the linked source
// before bumping.

import Anthropic from '@anthropic-ai/sdk'

// ---------------------------------------------------------------------------
// Shared Anthropic client — ONE lazily-built singleton for every call site.
// ---------------------------------------------------------------------------
// Lazily build the Anthropic client on first use, so importing this module stays
// side-effect-free (ANTHROPIC_API_KEY is required only when a model call runs) —
// mirrors the lazy @skipper/db client. Every generator/eval module shares this one
// instance via getAnthropic(); `label` is a per-call-site descriptive parenthetical
// woven into the missing-key error so the message still names what needed the key.
let _anthropic: Anthropic | null = null
export function getAnthropic(label = 'a model call needs it'): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(`ANTHROPIC_API_KEY is not set (${label}).`)
  }
  // maxRetries 5 (SDK default is 2): narration is the most expensive call, so survive a
  // SUSTAINED Anthropic overload (429/529) rather than fail a run that already spent on earlier
  // stops. The SDK backs off exponentially + honors Retry-After.
  return (_anthropic ??= new Anthropic({ maxRetries: 5 }))
}

// ---------------------------------------------------------------------------
// Narration — Anthropic Messages API
// ---------------------------------------------------------------------------
// The spec wants the MOST CAPABLE model for narration quality. Claude Fable 5 was
// the pick (a tier above Opus; switched 2026-06-09 at founder request), but on
// 2026-06-14 it began returning 404 "Claude Fable 5 is not available. Please use
// Opus 4.8." account-wide (req_011Cc2MhTY66A8XhQ1A29VBd) — so narration is back on
// Opus 4.8, the most capable model available to this account. (Re-point here if
// Fable access returns; this constant is the single switch.)
//
// Opus 4.8 request surface: adaptive thinking only, NO `budget_tokens` /
// `temperature` / `top_p` / `top_k` (all 400). narrate.ts passes
// thinking:{type:"adaptive"} with no tools, so it rides Opus cleanly. (Unlike Fable,
// Opus 4.8 ACCEPTS a forced tool_choice, so the Fable-era reason the judges needed a
// separate model no longer bites — but JUDGMENT_MODEL stays Opus for calibration; see below.)
//
// COST (a founder-relevant axis, per CLAUDE.md): Opus 4.8 is $5/$25 per MTok — HALF
// of Fable's $10/$50, so a regen now bills less than the Fable interim did.
//
// Source: Anthropic model catalog (claude-api skill — "Current Models" table).
export const NARRATION_MODEL = 'claude-opus-4-8' as const

// JUDGMENT tier — every NON-narration model call: the enrichment scout (pipeline/scout.ts)
// and the structured-report / spot-check judges (eval/charm.ts, pipeline/judge.ts,
// eval/grounding.ts, eval/veracity.ts). Opus 4.8. With narration ALSO on Opus 4.8 now
// (Fable 5 unavailable, above), this tier currently COINCIDES with NARRATION_MODEL — but it
// stays a SEPARATE constant on purpose, for two reasons that outlive the coincidence:
//   (a) Four of the five FORCE tool use (tool_choice {type:'tool'} or {type:'any'}); Opus 4.8
//       accepts that, but it's a hard requirement the narration model must also meet if the
//       two ever diverge again (Fable, e.g., rejected it).
//   (b) The judge rubrics/score thresholds were calibrated against Opus-tier judging — moving
//       this would silently shift every score (re-run eval/calibrate.ts after any bump).
// Upgraded Sonnet→Opus 2026-06-09 at founder request (the old NARRATION_MODEL_ALTERNATES
// catalog is gone with them).
export const JUDGMENT_MODEL = 'claude-opus-4-8' as const

// ENRICH tier — the corpus `enrich` step's fact-sheet builder (pipeline/scout.ts buildCorpusFactSheet).
// The fact-sheet builder SELECTS verbatim spans + grounded bundles; that is an easier call than narration
// judgment AND it runs corpus-scale (~hundreds of POIs, once per region), so the DEFAULT is Sonnet 4.6 ($3/$15
// per MTok — half Opus's input, ~⅗ its output) to keep the one-time bill modest. Opus stays available
// (`enrich-pois --model opus`) for an A/B against the calibration tier on a sample. Both ACCEPT a
// forced tool_choice {type:'any'} (the fact-sheet builder forces it every turn) — only Fable rejected that,
// so either is safe. Sources: claude-api skill "Current Models" table (verified 2026-06-15).
export const ENRICH_MODELS = {
  sonnet: 'claude-sonnet-4-6',
  opus: JUDGMENT_MODEL, // 'claude-opus-4-8'
} as const
export type EnrichModelChoice = keyof typeof ENRICH_MODELS

// ---------------------------------------------------------------------------
// Text-to-speech — Google Cloud Text-to-Speech (Gemini-TTS voices)
// ---------------------------------------------------------------------------
// We synthesize narration OFFLINE in a batch job (latency irrelevant, quality
// paramount). We hit the Cloud TTS REST endpoint (texttospeech.googleapis.com)
// with a GEMINI-TTS voice so the work bills to the GCP project — GCP Welcome/trial
// credits are NOT usable on the Gemini Developer API key; only Cloud TTS / Vertex
// draw GCP credits. Cloud TTS uniquely gives the persona three things: a natural,
// steerable Gemini voice (the active pick is "Charon" — see below), a first-class natural-language STYLE prompt
// (input.prompt) to steer delivery, and flexible output encodings (we request LINEAR16 and
// encode to AAC — see the AUDIO FORMAT note below; duration, which the API never returns, is
// exact from the PCM byte length in pipeline/wav.ts). Auth is OAuth/ADC
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
// models share the same voices + encoding set, so this does NOT affect the AAC output.
export const TTS_MODEL = 'gemini-3.1-flash-tts-preview' as const

// AUDIO FORMAT — LINEAR16 → AAC@48k .m4a (spike option B; chosen 2026-06-14, see
// docs/decisions/audio-compression-spike.md). We request LOSSLESS LINEAR16 from Gemini-TTS,
// then the loudnorm step (pipeline/loudnorm.ts) does the ONLY lossy encode: a single
// ffmpeg pass that linear-normalizes AND encodes to AAC-LC 48 kbps in an .m4a. This beats
// requesting Cloud TTS's fixed 32k MP3 directly because that path then RE-ENCODES (32k MP3 →
// loudnorm → 32k MP3) — two lossy generations; LINEAR16-first collapses it to one and lets
// us pick the codec/bitrate. AAC@48k is ~8× smaller than the LINEAR16 WAV, clearly better
// than MP3@32k at ~the same size, and iOS AVPlayer (expo-audio) plays it (OGG_OPUS is smaller
// but iOS can't decode Ogg/Opus — disqualified). Duration is EXACT from the PCM byte length
// (pipeline/wav.ts), measured before the encode and preserved through it — no MP3 frame parse.
//
// ⚠ ffmpeg is now REQUIRED on every SHIP path (it IS the encoder, not just QA) — Cloud Run
// carries it (packages/studio/Dockerfile); a bare box without it fails loudly. The
// player/API are codec-agnostic (they take a presigned URL + a duration; MIME derives from
// the .m4a key extension), so this was a generator-only flip.
export const TTS_AUDIO_ENCODING = 'LINEAR16' as const
export const TTS_SAMPLE_RATE_HZ = 24_000 as const // Gemini-TTS LINEAR16 native rate
export const TTS_AUDIO_CONTENT_TYPE = 'audio/mp4' as const
export const TTS_CLIP_EXTENSION = 'm4a' as const
export const TTS_LANGUAGE_CODE = 'en-US' as const

// LOUDNESS NORMALIZATION (TODO.md "TTS audio QA" #2 — clip-to-clip level spread + overall
// level vs Spotify). Gemini-TTS takes are non-deterministic in LEVEL: measured body means
// ranged −26.7 → −19.5 dB across 30 live clips (a 7.2 dB stop-to-stop jump), and the whole
// mix read ~20–25% quiet vs a Spotify reference. Fix = an ffmpeg two-pass LINEAR loudnorm
// on every shipped take (pipeline/loudnorm.ts), targeting these EBU R128 values:
//   I  (integrated loudness) = −14 LUFS — Spotify's normalization target; brings the quiet
//      clips up and lands every clip at the SAME integrated level, collapsing the spread.
//   TP (true-peak ceiling)   = −1.5 dBTP — headroom so the gain-up can't clip (why we use
//      loudnorm, not a flat `volume=+NdB`).
// TUNABLE: these are the single knobs. The −14 start is verified by a founder on-device A/B
// vs Spotify before the first paid full run — if the real playback level still reads low,
// nudge TARGET up (−13/−12) here; no other code changes. (The 17 bundled drive-music tracks
// are NOT in this pipeline — matching them is a separate one-time re-encode once −14 locks.)
export const LOUDNORM_TARGET_LUFS = -14 as const
export const LOUDNORM_TRUE_PEAK_DB = -1.5 as const
// LRA (loudness range) is held at the loudnorm default — speech is already low-dynamic, so
// this rarely binds; it stays a constant rather than a knob.
export const LOUDNORM_RANGE_LU = 11 as const

// Gemini-TTS prebuilt voices (each carries a one-word timbre descriptor). The
// ACTIVE pick is `charon` ("Informative" — the tour-guide register), chosen by ear
// 2026-06-10 over Algenib in a six-voice audition on the Chambers passage under the
// anti-fade style prompt. `algenib` ("Gravelly") was the pick 2026-06-08→06-10 and
// stays as the A/B reference. This catalog is the AUDITIONED shortlist, not the full
// table: Cloud TTS lists 16 MALE Gemini voices (docs, fetched 2026-06-10) — still
// unauditioned: Algieba, Alnilam, Enceladus, Fenrir, Iapetus, Orus, Puck, Rasalgethi,
// Sadachbia, Sadaltager, Schedar, Umbriel, Zubenelgenubi.
export const GEMINI_VOICES = {
  charon: 'Charon', // Informative (tour-guide register) — THE SKIPPER PICK. Picked 2026-06-10.
  algenib: 'Algenib', // Gravelly — former pick (2026-06-08→06-10; deep/weathered, male)
  sulafat: 'Sulafat', // Warm — former pick (female; retired because the persona is a man)
  achird: 'Achird', // Friendly
  gacrux: 'Gacrux', // Mature (NOTE: the Cloud TTS table lists Gacrux as FEMALE)
  vindemiatrix: 'Vindemiatrix', // Gentle (female per the Cloud TTS table)
} as const

export type GeminiVoice = (typeof GEMINI_VOICES)[keyof typeof GEMINI_VOICES]

// The Skipper's voice. Baked into the tour-OWNED narration audio, so changing it
// after tours exist forces re-synthesis (resynth-tour.ts). No ElevenLabs
// sunset/quota constraint on this provider. ⚠ The live canonical tours still carry
// Algenib audio until the next regen/resynth — Charon ships with that run.
export const SKIPPER_VOICE_ID: GeminiVoice = GEMINI_VOICES.charon

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
// means re-synthesizing the canonical clips at Phase 6 (resynth-tour.ts <canonical> --apply)
// and the founder re-validating by ear. Do NOT re-tune the wording without a fresh ear test.
export const SKIPPER_TTS_STYLE_PROMPT =
  'Read this as a warm road-trip tour guide letting friends in on jokes you all secretly enjoy — genuinely glad they came, a man who has told these corny jokes a thousand times and quietly loves every one. Keep the narration moving at a natural, easy talking pace, like a man telling you about the view out the window — relaxed but never sleepy, never dragging. Save the slow-down for the jokes: deliver them deadpan and fully committed, but with warmth — close and friendly, never dropping to a murmur — as if you and the riders both know it is corny and that is exactly why it is good. Never laugh at your own setup, never sing-song the punchline; land each one flat and matter-of-fact. Put a small pause right before the pun, and after it lands hold one short beat — not waiting for anything, just letting it sit — then roll on. Let the sincere lines breathe without fading — keep the voice clear, present, and at full conversational volume from the first sentence to the very last; never trail off, drop low, or swallow the closing words. Talking WITH friends, not at a crowd.'

// (The voice↔persona binding now lives in the persona registry — each PersonaDef carries
// its own `voice`; see packages/studio/src/persona/. `SKIPPER_VOICE_ID` above is the
// source constant the Skipper def references + the synthesize() default.)
