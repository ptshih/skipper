// Text-to-speech — ElevenLabs, raw fetch (no SDK dep; matches the repo's
// fetch-against-Google style in materialize.ts).
//
// We hit /with-timestamps so a single call returns the MP3 (base64) AND the
// character alignment, giving us audio + exact duration together — the duration
// the ready-gate needs, with no second probe. output_format is a QUERY param.

import { requireEnv } from '../config'
import { ELEVEN_VOICE_SETTINGS, SKIPPER_VOICE_ID, TTS_MODEL, TTS_OUTPUT_FORMAT } from '../models'
import { fetchWithRetry } from './http'

const BASE = 'https://api.elevenlabs.io/v1/text-to-speech'

interface Alignment {
  characters: string[]
  character_start_times_seconds: number[]
  character_end_times_seconds: number[] // SECONDS (not ms)
}

interface WithTimestampsResponse {
  audio_base64: string
  alignment: Alignment | null
  normalized_alignment: Alignment | null
}

export interface SynthResult {
  audio: Uint8Array
  durationMs: number
}

/** Synthesize one narration script to an MP3 buffer + duration (ms). Throws on API error. */
export async function synthesize(text: string, voiceId: string = SKIPPER_VOICE_ID): Promise<SynthResult> {
  const apiKey = requireEnv('ELEVENLABS_API_KEY')
  const url = `${BASE}/${voiceId}/with-timestamps?output_format=${TTS_OUTPUT_FORMAT}`

  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json', // /with-timestamps returns JSON, not a byte stream
    },
    body: JSON.stringify({
      text,
      model_id: TTS_MODEL,
      voice_settings: ELEVEN_VOICE_SETTINGS,
    }),
  })

  if (!res.ok) {
    throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`)
  }

  const data = (await res.json()) as WithTimestampsResponse
  const audio = Buffer.from(data.audio_base64, 'base64')
  const ends = data.alignment?.character_end_times_seconds ?? []
  const lastEnd = ends.length ? ends[ends.length - 1]! : 0
  const durationMs = Math.round(lastEnd * 1000)
  if (!audio.length || durationMs <= 0) {
    throw new Error('ElevenLabs returned empty audio or zero-length alignment.')
  }
  return { audio, durationMs }
}
