// Text-to-speech — Google Cloud Text-to-Speech, Gemini-TTS voice, raw fetch.
//
// POST text:synthesize with a Gemini voice + a natural-language style prompt, and
// request LINEAR16 so we can derive an EXACT clip duration from the bytes (Cloud
// TTS has no /with-timestamps-style duration field). Auth is OAuth2/ADC via
// google-auth-library (text:synthesize takes NO API key); usage bills to
// GOOGLE_CLOUD_PROJECT, drawing GCP credits.
//
// JSON field names are camelCase (modelName / languageCode / audioEncoding) — the
// snake_case forms 400. Verified against docs.cloud.google.com/text-to-speech.

import { GoogleAuth } from 'google-auth-library'
import { requireEnv } from '../config'
import { fetchWithRetry } from './http'
import {
  SKIPPER_TTS_STYLE_PROMPT,
  SKIPPER_VOICE_ID,
  TTS_AUDIO_ENCODING,
  TTS_LANGUAGE_CODE,
  TTS_MODEL,
  TTS_SAMPLE_RATE_HZ,
} from '../models'
import { GEMINI_PCM, toWavWithDuration } from './wav'
import { keepFirstTake, measureTailCollapse, TAIL_COLLAPSE_DB, TERMINAL_WINDOW_SEC } from './tail'
import { normalizeAndEncode, verifyMasteredLoudness, type LoudnessOutcome } from './loudnorm'
import { pronunciationClause } from './pronunciation'

const SYNTHESIZE_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize'
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
/** Per-attempt timeout (ms) for one synth. TTS is the most-called external API on a full run
 *  (one clip per stop + frames) and runs in a bounded pool — a single HUNG synth (no timeout)
 *  would hold a worker slot forever and stall the whole synth phase AFTER all narration is paid
 *  for. Generous: a ~2-min clip synthesizes in ~45s (measured ~0.38× audio length), so 90s is
 *  ~2× headroom; a fired timeout is a transient and gets a fresh clock on retry (fetchWithRetry). */
const TTS_REQUEST_TIMEOUT_MS = 90_000

export interface SynthResult {
  /** The clip bytes. `synthesize()` yields the raw lossless WAV take; `synthesizeWithTailRetake()`
   *  yields the encoded AAC `.m4a` (the shipped clip). */
  audio: Uint8Array
  durationMs: number
}

/** Build the Cloud TTS text:synthesize request body (pure — unit-tested). The delivery
 *  `style` is the persona's `ttsStyle` (defaults to the Skipper's). */
export function buildSynthesisRequest(
  text: string,
  voiceName: string,
  style: string = SKIPPER_TTS_STYLE_PROMPT,
) {
  return {
    // input.prompt sets DELIVERY (the persona's words are already in input.text). A per-clip
    // pronunciation guide rides here too — Gemini-TTS has no SSML/<phoneme>, so a name the voice
    // mis-says is fixed via the prompt (pronunciation.ts); '' when the clip says no lexicon name,
    // so the prompt stays byte-identical for the common case.
    input: { text, prompt: style + pronunciationClause(text) },
    voice: { languageCode: TTS_LANGUAGE_CODE, name: voiceName, modelName: TTS_MODEL },
    audioConfig: { audioEncoding: TTS_AUDIO_ENCODING, sampleRateHertz: TTS_SAMPLE_RATE_HZ },
  }
}

// Lazily built so importing this module is side-effect-free (no creds needed until
// synthesis runs); the client caches/refreshes the access token internally.
let auth: GoogleAuth | undefined
function getAuth(): GoogleAuth {
  if (!auth) auth = new GoogleAuth({ scopes: CLOUD_PLATFORM_SCOPE })
  return auth
}

/** Synthesize one narration script to a clip + duration (ms). Throws on API error. The
 *  `voiceId`/`style` come from the persona (default to the Skipper's). */
export async function synthesize(
  text: string,
  voiceId: string = SKIPPER_VOICE_ID,
  style: string = SKIPPER_TTS_STYLE_PROMPT,
): Promise<SynthResult> {
  const project = requireEnv('GOOGLE_CLOUD_PROJECT')
  const token = await getAuth().getAccessToken()
  if (!token) {
    throw new Error(
      'Could not obtain a Google access token. Set GOOGLE_APPLICATION_CREDENTIALS to a service-account ' +
        'JSON, or run `gcloud auth application-default login`.',
    )
  }

  const res = await fetchWithRetry(
    SYNTHESIZE_URL,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-goog-user-project': project,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildSynthesisRequest(text, voiceId, style)),
    },
    { timeoutMs: TTS_REQUEST_TIMEOUT_MS },
  )

  if (!res.ok) {
    throw new Error(`Cloud TTS ${res.status}: ${await res.text()}`)
  }

  const data = (await res.json()) as { audioContent?: string }
  if (!data.audioContent) throw new Error('Cloud TTS returned no audioContent.')

  const raw = new Uint8Array(Buffer.from(data.audioContent, 'base64'))
  // Cloud TTS returns no duration field. LINEAR16 is byte-linear, so wrap the headerless PCM
  // as a playable WAV and derive the EXACT duration from the byte length (wav.ts). This is the
  // raw lossless take; synthesizeWithTailRetake encodes it to AAC after the QA passes.
  const { wav: audio, durationMs } = toWavWithDuration(raw, GEMINI_PCM)
  if (!audio.length || durationMs <= 0) {
    throw new Error('Cloud TTS returned empty audio or a zero-length duration.')
  }
  return { audio, durationMs }
}

/** What the tail probe + retake decided for one clip (null = probe skipped: clip too
 *  short or ffmpeg absent — see pipeline/tail.ts). */
export interface TailOutcome {
  /** Tail-vs-body drop (dB) of the FIRST take. */
  firstDropDb: number
  /** Drop of the take that actually shipped (null = the retake couldn't be measured). */
  keptDropDb: number | null
  retook: boolean
  /** True when the SHIPPED take still measures collapsed — flag it for the human pass. */
  shippedCollapsed: boolean
}

export type SynthWithTailResult = SynthResult & {
  tail: TailOutcome | null
  /** The post-encode loudness/true-peak verdict for the shipped .m4a (null = meter skipped, ffmpeg miss). */
  loudness: LoudnessOutcome | null
}

/** Best-of-N tail retakes: on a collapsed first take, synthesize up to this many MORE takes and keep the
 *  least-collapsed one, stopping early as soon as one comes back clean. At the ~1-in-4 collapse rate a
 *  single retake still ships ~1/16 collapsed; a second retake drops that to ~1/64, and the extra synth
 *  only fires on the ~6% that already failed twice. The running TTS cost cap bounds the overrun. */
const RETAKE_LIMIT = 2

/**
 * Synthesize with the tail-collapse retake (TODO.md audio-QA #1): Gemini-TTS takes are
 * non-deterministic in level and ~1 in 4 collapses over the closing sentence(s) — the
 * "mumble". Measure tail-vs-body after the synth (12 s tail AND a 4 s last-words window);
 * on a drop ≥ TAIL_COLLAPSE_DB re-synth up to RETAKE_LIMIT more times (best of RETAKE_LIMIT+1)
 * and keep the least-collapsed take, so a Dam-class take can never ship silently again.
 * Then master the WINNER (TODO.md audio-QA #2): the limiter→single-pass-loudnorm chain fused
 * with the single AAC encode (loudnorm.ts), killing the clip-to-clip level spread + the
 * quiet-vs-Spotify gap. ffmpeg is REQUIRED here (it's the encoder, not just a QA tool) —
 * normalizeAndEncode throws if it's absent. Finally an ADVISORY post-encode meter
 * (verifyMasteredLoudness) re-reads the shipped .m4a so a clip that lands off-target or over
 * the true-peak ceiling is flagged (never withheld). Every SHIP path (generate-narrations,
 * resynth-narration) goes through this.
 */
export async function synthesizeWithTailRetake(
  text: string,
  voiceId: string = SKIPPER_VOICE_ID,
  style: string = SKIPPER_TTS_STYLE_PROMPT,
  label = 'clip',
): Promise<SynthWithTailResult> {
  const first = await synthesize(text, voiceId, style)
  const m1 = await measureTailCollapse(first.audio, first.durationMs)

  // ── Pick the take (the tail-collapse retake) ──
  let shipped: SynthResult = first
  let tail: TailOutcome | null
  if (m1 === null) {
    tail = null // probe skipped (clip too short or ffmpeg absent) — ship unmeasured
  } else if (m1.dropDb < TAIL_COLLAPSE_DB) {
    tail = { firstDropDb: m1.dropDb, keptDropDb: m1.dropDb, retook: false, shippedCollapsed: false }
  } else {
    // Collapsed — retake up to RETAKE_LIMIT more times (best of RETAKE_LIMIT+1) and keep the
    // least-collapsed MEASURED take, stopping early as soon as one comes back clean. The first take is
    // measured + collapsed, so there's always a measured baseline; an UNMEASURED fresh retake (probe
    // failed) is held only as a last-resort unknown — a fresh take of a collapsed script usually comes
    // out clean, so an unknown still beats a KNOWN mumble.
    console.warn(
      `  ⚠ tail collapse on ${label}: tail ${m1.tailDb.toFixed(1)} dB / last-${TERMINAL_WINDOW_SEC}s ${m1.terminalDb.toFixed(1)} dB ` +
        `vs body ${m1.bodyDb.toFixed(1)} dB (drop ${m1.dropDb.toFixed(1)} dB ≥ ${TAIL_COLLAPSE_DB}) — re-synthesizing (best of ${RETAKE_LIMIT + 1})...`,
    )
    let bestTake = first
    let bestMeasure = m1
    let unknownFallback: SynthResult | null = null
    let retakes = 0
    while (retakes < RETAKE_LIMIT && bestMeasure.dropDb >= TAIL_COLLAPSE_DB) {
      retakes++
      const next = await synthesize(text, voiceId, style)
      const mNext = await measureTailCollapse(next.audio, next.durationMs)
      if (mNext === null) {
        unknownFallback = next // probe failed on this take — keep it as an unmeasured last resort
        continue
      }
      if (!keepFirstTake(bestMeasure, mNext)) {
        bestTake = next // mNext's drop is smaller → it becomes the take to beat
        bestMeasure = mNext
      }
    }
    // Ship the least-collapsed measured take; if it STILL collapses but a fresh unmeasured take exists,
    // ship the unknown over the known mumble.
    let keptDropDb: number | null
    if (bestMeasure.dropDb >= TAIL_COLLAPSE_DB && unknownFallback) {
      shipped = unknownFallback
      keptDropDb = null
    } else {
      shipped = bestTake
      keptDropDb = bestMeasure.dropDb
    }
    const shippedCollapsed = keptDropDb !== null && keptDropDb >= TAIL_COLLAPSE_DB
    console.warn(
      shippedCollapsed
        ? `  ⚠ ${label}: all ${retakes + 1} takes collapsed — shipping the best (drop ${keptDropDb!.toFixed(1)} dB), flagged for the human pass.`
        : `  ✓ ${label}: ${keptDropDb === null ? 'shipped a fresh unmeasured retake on the odds' : `clean after ${retakes} retake(s) (drop ${keptDropDb.toFixed(1)} dB)`}.`,
    )
    tail = { firstDropDb: m1.dropDb, keptDropDb, retook: true, shippedCollapsed }
  }

  // ── Master the shipped take: the limiter→single-pass-loudnorm chain fused with the single AAC encode
  //    (loudnorm.ts). This is the ONLY lossy pass (the take above is lossless WAV), and ffmpeg is REQUIRED
  //    here — it IS the encoder, so it throws loudly if absent rather than ship a mislabeled clip. The PCM
  //    duration is exact and content-preserving, so it carries through the encode. ──
  const audio = await normalizeAndEncode(shipped.audio)

  // ── Post-encode QA meter (loudnorm.ts): re-decode the shipped .m4a and check it actually landed at the
  //    master target + under the −1 dBTP delivery ceiling. ADVISORY (mark-and-flag) — null on an ffmpeg
  //    miss, never fails synthesis; the caller records the verdict for the human-review pass. ──
  const loudness = await verifyMasteredLoudness(audio)

  return { audio, durationMs: shipped.durationMs, tail, loudness }
}
