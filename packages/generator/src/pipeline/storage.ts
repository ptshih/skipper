// Audio storage — Cloudflare R2 via Bun's native S3 client (no dependency to
// install; R2 is S3-compatible). We persist a stable PUBLIC URL on
// poi_content.audioUrl, built from R2_PUBLIC_BASE_URL — NOT a presigned URL
// (those expire). The object key mirrors the poi_content cache key so re-runs
// overwrite the same object and the layout is forward-compatible with the M4
// cache.

import { S3Client } from 'bun'
import type { JokeLevel, Persona } from '@skipper/shared'
import { requireEnv } from '../config'
import { TTS_AUDIO_CONTENT_TYPE } from '../models'

let client: S3Client | undefined
let publicBase: string | undefined

function getClient(): { s3: S3Client; base: string } {
  if (!client || !publicBase) {
    const accountId = requireEnv('R2_ACCOUNT_ID')
    publicBase = requireEnv('R2_PUBLIC_BASE_URL').replace(/\/+$/, '')
    client = new S3Client({
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
      bucket: requireEnv('R2_BUCKET'),
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      region: 'auto', // R2 canonical region
    })
  }
  return { s3: client, base: publicBase }
}

/** Object key mirroring the poi_content cache key (persona, voice, joke level, poi). */
export function clipKey(poiId: string, persona: Persona, voice: string, jokeLevel: JokeLevel): string {
  return `clips/${persona}/${voice}/${jokeLevel}/${poiId}.mp3`
}

/** Upload an MP3 and return the public URL to store on poi_content.audioUrl. */
export async function uploadAudio(key: string, bytes: Uint8Array): Promise<string> {
  const { s3, base } = getClient()
  // content-type goes in `type` (a BlobPropertyBag field), NOT `contentType`.
  await s3.file(key).write(bytes, { type: TTS_AUDIO_CONTENT_TYPE })
  return `${base}/${key}`
}

/** Whether a clip already exists in R2 (lets callers skip re-synthesis). */
export async function audioExists(key: string): Promise<boolean> {
  const { s3 } = getClient()
  return s3.file(key).exists()
}
