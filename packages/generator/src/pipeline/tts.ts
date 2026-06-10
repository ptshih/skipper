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
import { mp3DurationMs } from './mp3'

const SYNTHESIZE_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize'
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
/** Per-attempt timeout (ms) for one synth. TTS is the most-called external API on a full run
 *  (one clip per stop + brackets) and runs in a bounded pool — a single HUNG synth (no timeout)
 *  would hold a worker slot forever and stall the whole synth phase AFTER all narration is paid
 *  for. Generous: a ~2-min clip synthesizes in ~45s (measured ~0.38× audio length), so 90s is
 *  ~2× headroom; a fired timeout is a transient and gets a fresh clock on retry (fetchWithRetry). */
const TTS_REQUEST_TIMEOUT_MS = 90_000

export interface SynthResult {
  /** The playable clip bytes — an MP3 by default; a WAV when TTS_AUDIO_ENCODING is LINEAR16. */
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
    // input.prompt sets DELIVERY (the persona's words are already in input.text).
    input: { text, prompt: style },
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
  // Cloud TTS returns no duration field, so each encoding derives it from the bytes:
  //  - MP3: the bytes ARE the .mp3 clip; duration = sum of MPEG frame times (mp3.ts).
  //  - LINEAR16: wrap headerless PCM as a playable WAV; duration is byte-linear (wav.ts).
  let audio: Uint8Array
  let durationMs: number
  if (TTS_AUDIO_ENCODING === 'MP3') {
    audio = raw
    durationMs = mp3DurationMs(raw)
  } else {
    const wrapped = toWavWithDuration(raw, GEMINI_PCM)
    audio = wrapped.wav
    durationMs = wrapped.durationMs
  }
  if (!audio.length || durationMs <= 0) {
    throw new Error('Cloud TTS returned empty audio or a zero-length duration.')
  }
  return { audio, durationMs }
}
