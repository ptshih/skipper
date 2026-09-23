// AI model identifiers for @skipper/studio.
//
// Constants only — this file is the single source of truth for model ids so the
// narration (Gemini on Vertex AI) and TTS (Google Cloud TTS) call sites never hard-code a string.
// Each id below cites where it came from; re-verify against the linked source
// before bumping.

import { isAbsolute, resolve } from 'node:path'
import { GoogleGenAI } from '@google/genai'
import { AUDIO_LOUDNESS, LLM_MODELS, VERTEX, type DeliveryRegister } from '@skipper/shared'

// Re-export the shared SUMMARY id so the in-job summarizer (pipeline/job-output.ts) sources it from
// studio/models.ts alongside the other model ids, while @skipper/shared stays the single source.
export const SUMMARY_MODEL = LLM_MODELS.summary

// ---------------------------------------------------------------------------
// Shared Gemini client — ONE lazily-built singleton for every call site.
// ---------------------------------------------------------------------------
// Lazily build the client on first use, so importing this module stays side-effect-free (Google
// credentials are required only when a model call runs) — mirrors the lazy @skipper/db client.
// Every studio/eval module shares this one instance via getGemini(); `label` is a per-call-site
// descriptive parenthetical woven into the missing-config error so the message still names what
// needed it. Provider rationale + auth: VERTEX in @skipper/shared and docs/decisions/gemini-3-8-flash.md.
// ⚠ The guard reads `VERTEX.projectEnv` itself rather than trusting the SDK's env fallback, because a
// Vertex client with no project fails deep inside a paid run — after earlier stops already billed.
let _gemini: GoogleGenAI | null = null
export function getGemini(label = 'a model call needs it'): GoogleGenAI {
  const project = process.env[VERTEX.projectEnv]
  if (!project) {
    throw new Error(`${VERTEX.projectEnv} is not set (${label}).`)
  }
  // 6 attempts = the first call + 5 retries on 408/429/5xx, with the SDK's exponential backoff (it
  // honors no Retry-After, so the backoff is the whole defence). Narration is the most expensive call,
  // so survive a SUSTAINED overload rather than fail a run that already spent on earlier stops.
  // ⚠ Retries are OFF in the SDK unless `retryOptions` is passed — it is not a default to lean on.
  // ⚠ So is the TIMEOUT: the Gen AI SDK sets none, where the Anthropic SDK defaulted to 10 minutes, so a
  // stalled socket in a paid batch would otherwise wait out the whole Cloud Run task. 10 minutes per
  // ATTEMPT restores that bound and clears the slowest measured call (HIGH-thinking narration, ~94 s)
  // many times over. A per-request `httpOptions` still overrides it key by key (job-output's 20 s).
  return (_gemini ??= new GoogleGenAI({
    vertexai: true,
    project,
    location: VERTEX.location,
    googleAuthOptions: { keyFilename: credentialsPath() },
    httpOptions: { timeout: 600_000, retryOptions: { attempts: 6 } },
  }))
}

/** GOOGLE_APPLICATION_CREDENTIALS resolved against the REPO ROOT when relative. `.env.development`
 *  names `./keys/…`, which only resolves when the process runs from the root — and a `bun --filter`
 *  script runs from packages/studio. Unset on Cloud Run (the runtime service account answers
 *  through the metadata server), so this returns undefined there and the SDK takes its default ADC. */
function credentialsPath(): string | undefined {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!path) return undefined
  return isAbsolute(path) ? path : resolve(import.meta.dir, '..', '..', '..', path)
}

// ---------------------------------------------------------------------------
// Narration — Gemini 3.8 Flash on Vertex AI (since 2026-09-23)
// ---------------------------------------------------------------------------
// The spec wants the MOST CAPABLE model for narration quality; the founder chose Gemini 3.8 Flash for
// every tier on 2026-09-23 (`LLM_MODELS.quality` in @skipper/shared). History, kept because it is WHY
// this constant exists as a single switch: Claude Fable 5 (2026-06-09) → Opus 4.8 after Fable began
// 404ing account-wide (2026-06-14) → Opus 5 (2026-08-04) → Opus 4.6 on Bedrock (2026-09-17) → here.
//
// Request surface, VERIFIED on the live model before the switch rather than assumed — the Fable-era
// failure was exactly a model refusing a request shape (docs/decisions/gemini-3-8-flash.md has the
// per-shape probe results):
//   · forced function call (`mode: ANY` + `allowedFunctionNames: [name]`) — ✅ (every judge depends on
//     it), and it ENFORCES the JSON schema, which Claude's non-strict tool use never did
//   · `mode: ANY` over several functions — ✅ (pipeline/scout.ts's agentic fetch-or-finalize loop), but
//     only when the model's turn is sent back VERBATIM: a stripped thought signature is a 400
//   · plain text generation at `thinkingLevel: HIGH` — ✅ (this call, narrate.ts)
//   · Google Search grounding together with a JSON response schema — ✅ (eval/veracity.ts)
// `temperature`/`top_p`/`top_k` are ignored on Gemini 3 and nothing here sends them.
//
// COST: $0.825/$4.125 per MTok on the `us` multi-region (MODEL_PRICING in @skipper/shared, introductory
// through 2026 — PRICE_CHANGES doubles it on the published date). Thinking bills as output, and Gemini
// 3.8 always thinks.
// ⚠ THE LAST CALIBRATION DESCRIBES CLAUDE, NOT THIS MODEL. Opus 4.6, 2026-09-17: verdict agreement
// 17/18, violation recall 8/8, 1 false positive across 1/10 clean cases (Opus 5 before it: 16/18, 8/8,
// 4 FPs across 2/10, accepted as-is by the founder 2026-08-04). Recall is the FAIL-CLOSED axis. Re-run
// `eval/calibrate.ts` on Gemini before trusting a grounding/charm score, and re-raise only if its
// numbers MOVE — that drift is what the runner exists to watch.
//
// Source: the id literal is single-sourced in @skipper/shared (LLM_MODELS / VERTEX).
export const NARRATION_MODEL = LLM_MODELS.quality

// JUDGMENT tier — the structured-report / spot-check judges (eval/charm.ts, eval/grounding.ts,
// eval/veracity.ts): the NON-narration calls that need the calibration tier. (The enrichment
// scout is a SEPARATE ENRICH tier — see ENRICH_MODELS below.) It COINCIDES with NARRATION_MODEL — but it
// stays a SEPARATE constant on purpose, for two reasons that outlive the coincidence:
//   (a) Most of them FORCE a function call; Gemini 3.8 Flash accepts it (probed 2026-09-23), but it's a
//       hard requirement the narration model must also meet if the two ever diverge again (Fable, e.g.,
//       rejected Claude's equivalent).
//   (b) The judge rubrics/score thresholds are calibrated against THIS tier's judging — moving it would
//       silently shift every score (re-run eval/calibrate.ts after any bump).
//
// ⚠ AND THE COINCIDENCE ITSELF IS A KNOWN RISK, not just an accident of availability: a judge running
// the same model that wrote the text is the documented setting for SELF-PREFERENCE BIAS, whose
// load-bearing detail is that it does NOT go away with a more capable judge — only with a DIFFERENT
// one. Exposure is uneven: eval/charm.ts is a pure taste judgment and is the exposed one;
// eval/grounding.ts checks claims against a sheet printed in the same context window, which is a
// verifiable check rather than a preference, so it is far less exposed. Sources + the cheap probe that
// would settle it: docs/research/llm-judge-bias-and-prompt-optimization.md. Pointing THIS constant at
// another family is the one-line mitigation if that probe ever shows the bias is real here.
export const JUDGMENT_MODEL = LLM_MODELS.quality

// ENRICH tier — the corpus `enrich` step's fact-sheet builder (pipeline/scout.ts buildCorpusFactSheet).
// The fact-sheet builder SELECTS verbatim spans + grounded bundles; that is an easier call than narration
// judgment AND it runs corpus-scale (~hundreds of POIs, once per region), which is why it once had a
// cheaper default tier. ⚠ Since 2026-09-23 BOTH choices resolve to Gemini 3.8 Flash. The `--model
// sonnet|opus` operator switch keeps its old tier LABELS so admin jobs and runbooks keep working: `sonnet`
// = `LLM_MODELS.enrich`, `opus` = the judgment tier. Editing either shared key re-splits them.
export const ENRICH_MODELS = {
  sonnet: LLM_MODELS.enrich,
  opus: JUDGMENT_MODEL,
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

// AUDIO FORMAT — LINEAR16 → AAC@64k .m4a (spike option B; chosen 2026-06-14, bumped 48k→64k for clean peaks, see
// docs/decisions/audio-compression-spike.md). We request LOSSLESS LINEAR16 from Gemini-TTS,
// then the loudnorm step (pipeline/loudnorm.ts) does the ONLY lossy encode: a single
// ffmpeg pass that true-peak-limits THEN single-pass dynamic loudnorm-normalizes AND encodes to AAC-LC 64 kbps in an .m4a. This beats
// requesting Cloud TTS's fixed 32k MP3 directly because that path then RE-ENCODES (32k MP3 →
// loudnorm → 32k MP3) — two lossy generations; LINEAR16-first collapses it to one and lets
// us pick the codec/bitrate. AAC@64k is ~6× smaller than the LINEAR16 WAV, clearly better
// than MP3@32k at ~the same size, and iOS AVPlayer (expo-audio) plays it (OGG_OPUS is smaller
// but iOS can't decode Ogg/Opus — disqualified). Duration is EXACT from the PCM byte length
// (pipeline/wav.ts), measured before the encode and preserved through it — no MP3 frame parse.
//
// ⚠ ffmpeg is now REQUIRED on every SHIP path (it IS the encoder, not just QA) — Cloud Run
// carries it (packages/studio/Dockerfile); a bare box without it fails loudly. The
// player/API are codec-agnostic (they take a presigned URL + a duration; MIME derives from
// the .m4a key extension), so this was a studio-only flip.
export const TTS_AUDIO_ENCODING = 'LINEAR16' as const
export const TTS_SAMPLE_RATE_HZ = 24_000 as const // Gemini-TTS LINEAR16 native rate
export const TTS_AUDIO_CONTENT_TYPE = 'audio/mp4' as const
export const TTS_CLIP_EXTENSION = 'm4a' as const
export const TTS_LANGUAGE_CODE = 'en-US' as const

// LOUDNESS NORMALIZATION (TODO.md "TTS audio QA" #2 — clip-to-clip level spread + overall level vs
// Spotify). Gemini-TTS takes are non-deterministic in LEVEL (measured body means −26.7 → −19.5 dB
// across 30 live clips) and PEAK-BOUND (crest at ~0 dBFS), so a plain loudnorm undershoots
// inconsistently. Fix = the voice-MASTERING CHAIN in pipeline/loudnorm.ts: corrective EQ → light
// denoise → gate → gentle compression → single-pass loudnorm, whose own look-ahead true-peak limiter is
// the final peak guard (it REPLACED the standalone alimiter). That file owns every number on the path —
// the asked-for target, the chain's measured LANDING (ACTIVE_MASTER_TARGET_LUFS, what QA judges
// against), the pre-encode TP ceiling and the AAC bitrate. Only the LRA is shared from here; history in
// docs/decisions/audio-loudness-spec.md.
// ⚠ This block used to describe a separate limiter stage plus two switchable presets (`normal14` /
// `loud13`). Both were retired with the PROD-natural chain, so an agent reading models.ts — the file
// CLAUDE.md names as the audio-format truth — went looking for a preset switch that does not exist.
// LRA (loudness range) is held at the loudnorm default — speech is low-dynamic, so it rarely binds.
export const LOUDNORM_RANGE_LU = AUDIO_LOUDNESS.rangeLu

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

// The Skipper's voice. Baked into the narration audio, so changing it after a
// narration exists forces re-synthesis (resynth-narration.ts). No ElevenLabs
// sunset/quota constraint on this provider.
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
// ⚠ This only affects NEW synthesis. Existing narrations take it on the next regen, or by
// re-synthesizing a clip in place (resynth-narration.ts) and the founder re-validating by
// ear. Do NOT re-tune the wording without a fresh ear test.
export const SKIPPER_TTS_STYLE_PROMPT =
  'Read this as a warm road-trip tour guide letting friends in on jokes you all secretly enjoy — genuinely glad they came, a man who has told these corny jokes a thousand times and quietly loves every one. Keep the narration moving at a natural, easy talking pace, like a man telling you about the view out the window — relaxed but never sleepy, never dragging. Save the slow-down for the jokes: deliver them deadpan and fully committed, but with warmth — close and friendly, never dropping to a murmur — as if you and the riders both know it is corny and that is exactly why it is good. Never laugh at your own setup, never sing-song the punchline; land each one flat and matter-of-fact. Put a small pause right before the pun, and after it lands hold one short beat — not waiting for anything, just letting it sit — then roll on. Let the sincere lines breathe without fading — keep the voice clear, present, and at full conversational volume from the first sentence to the very last; never trail off, drop low, or swallow the closing words. Talking WITH friends, not at a crowd.'

// (The voice↔persona binding now lives in the persona registry — each PersonaDef carries
// its own `voice`; see packages/studio/src/persona/. `SKIPPER_VOICE_ID` above is the
// source constant the Skipper def references + the synthesize() default.)

// DELIVERY REGISTER → style SUFFIX. The base above (SKIPPER_TTS_STYLE_PROMPT) is the `story` read —
// the ear-tuned default that carries the persona, the joke delivery, and the load-bearing ANTI-FADE
// rule. A place's register (classified once from its Wikidata P31 type; see classify-registers) only
// MODULATES that base — pace, space, energy — so it stays ONE host adjusting his read, never a
// different voice. anti-fade lives in the base, so every register keeps "full volume to the last
// word" (each suffix re-asserts it where it could be misread). `story` = no suffix (byte-identical to
// today, so the tuned read is preserved). ⚠ These are DELIVERY wording — re-tune only behind a fresh
// founder ear-test (same rule as the base), never blind.
const REGISTER_STYLE_SUFFIX: Record<DeliveryRegister, string> = {
  story: '',
  landscape:
    ' This stop is a piece of landscape, not a tale — so give it a little more air. Ease the pace a touch, let the spaces between thoughts breathe, and let real, quiet wonder into your voice, like a man who has gone still to let the folks take in the view. Unhurried, never sleepy; and still hold the level clear to the very last word.',
  town:
    ' This stop is a town — keep it light and neighborly, a shade brighter and more conversational, the easy warmth of pointing out a place you are fond of to a friend riding shotgun. A touch quicker and chattier than a story, but never rushed, and never trailing off at the end.',
  civic:
    ' This stop is a built thing — a piece of engineering, not a story. Read it plain and grounded, with a little quiet pride in how it was made; less wonder, more matter-of-fact respect for the work. Steady and clear the whole way through, full volume to the last word.',
}

/**
 * The TTS delivery directive for a place, given its persona BASE style and its delivery REGISTER:
 * the base (the `story` read) plus a register suffix that modulates pace/space/energy. `story` returns
 * the base unchanged. Persona-agnostic in the base (any PersonaDef's `ttsStyle` can be passed), since
 * the register suffixes describe HOW to read a landscape/town/civic place, not a specific host.
 */
export function ttsStyleFor(baseStyle: string, register: DeliveryRegister): string {
  return `${baseStyle}${REGISTER_STYLE_SUFFIX[register]}`
}

// DELIVERY REGISTER → LENGTH band. The register also biases HOW LONG a telling runs, not just how
// it's read — a landscape glance and a rich historic story should not aim for the same duration (the
// single fixed ~150s band fought this AND the "let the facts set the length" doctrine; folded in
// 2026-06-19). `target` = the typical AIM (the number that actually drives length); `max` = an
// anti-sprawl CEILING. Length stays FACT-DRIVEN underneath — a thin sheet lands short regardless
// ("never pad to reach the aim"); the register only sets the per-type aim/ceiling.
//
// Values are RESEARCH-GROUNDED (2026-06-19 external research, cited in the length TODO): museum/heritage
// audio guides run 60–90s/stop ("not a lecture"), GuideAlong (GPS auto-play, our closest analog) keeps
// tracks "under 3 min", Autio's 3–5 min is the market's long end, and NPS pegs wayside dwell ~45s. A
// drive has long silent gaps between stops (each trigger is a welcome event), so we sit ABOVE the museum
// floor, BELOW the Autio ceiling. The old 150s blanket default was too long → dropped to a 90s story aim.
// STORY keeps a 180s MAX (founder, "just in case" a genuinely rich telling earns it) while its TARGET
// stays 90s, so a typical story is tight and only a fact-rich one stretches. A clip that HITS the cap is
// a prompt problem, not a length one. ⚠ Ear-gated — these are starting points; A/B by ear while driving.
const REGISTER_LENGTH: Record<DeliveryRegister, { targetSeconds: number; maxSeconds: number }> = {
  landscape: { targetSeconds: 60, maxSeconds: 100 }, // natural feature: wonder over inventory, not a factless glance
  story: { targetSeconds: 90, maxSeconds: 180 }, // human history: tight by default, headroom for a rich arc
  town: { targetSeconds: 60, maxSeconds: 90 }, // orient + one hook, not a full story
  civic: { targetSeconds: 70, maxSeconds: 110 }, // one "how/why it exists" beat; fact-dense → capped tighter
}

/** The target/max length band for a place, by its delivery register. */
export function lengthForRegister(register: DeliveryRegister): { targetSeconds: number; maxSeconds: number } {
  return REGISTER_LENGTH[register]
}
