// Audio storage — Cloudflare R2 via Bun's native S3 client (no dependency to
// install; R2 is S3-compatible). Audio objects are PRIVATE; we persist the R2
// object KEY on poi_content.audioUrl, and the API issues short-lived presigned
// GET URLs after the freemium tier check (so a shared URL expires and the account
// wall is real). The key mirrors the poi_content cache key, so re-runs overwrite
// the same object and the layout is forward-compatible with the M4 cache.

import { S3Client } from 'bun'
import type { JokeLevel, Persona } from '@skipper/shared'
import { requireEnv } from '../config'
import { TTS_AUDIO_CONTENT_TYPE, TTS_CLIP_EXTENSION } from '../models'

let client: S3Client | undefined

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
      bucket: requireEnv('R2_BUCKET'),
      // R2 by default; set S3_ENDPOINT to point this same S3 code at any other
      // S3-compatible provider (Tigris, B2, AWS S3) with no rewrite. The `||`
      // short-circuits, so R2_ACCOUNT_ID is only required when no override is set.
      endpoint: process.env.S3_ENDPOINT || `https://${requireEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      region: process.env.S3_REGION || 'auto', // R2/Tigris use "auto"; AWS needs a real region
    })
  }
  return client
}

/** Object key mirroring the poi_content cache key (persona, voice, joke level, poi). */
export function clipKey(poiId: string, persona: Persona, voice: string, jokeLevel: JokeLevel): string {
  return `clips/${persona}/${voice}/${jokeLevel}/${poiId}.${TTS_CLIP_EXTENSION}`
}

/** Upload an MP3 (private) and return its R2 object KEY to store on poi_content.audioUrl. */
export async function uploadAudio(key: string, bytes: Uint8Array): Promise<string> {
  // content-type goes in `type` (a BlobPropertyBag field), NOT `contentType`.
  await getClient().file(key).write(bytes, { type: TTS_AUDIO_CONTENT_TYPE })
  return key
}

/** Whether a clip already exists in R2 (lets callers skip re-synthesis). */
export async function audioExists(key: string): Promise<boolean> {
  return getClient().file(key).exists()
}
