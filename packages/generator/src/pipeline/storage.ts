// Audio storage — Cloudflare R2 via Bun's native S3 client (no dependency to
// install; R2 is S3-compatible). Audio objects are PRIVATE; we persist the R2
// object KEY on tour_stops.audioUrl / tour_brackets.audioUrl, and the API issues
// short-lived presigned GET URLs after the freemium tier check (so a shared URL
// expires and the account wall is real). Keys are TOUR-scoped (narration is
// tour-owned, never reused across tours): clips/<tourId>/<stopId> for stops,
// clips/<tourId>/intro|outro for brackets.

import { S3Client } from 'bun'
import type { BracketKind } from '@skipper/shared'
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
      endpoint:
        process.env.S3_ENDPOINT ||
        `https://${requireEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      region: process.env.S3_REGION || 'auto', // R2/Tigris use "auto"; AWS needs a real region
    })
  }
  return client
}

/** Tour-scoped object key for a stop's clip: clips/<tourId>/<stopId>.<ext>. */
export function clipKey(tourId: string, stopId: string): string {
  return `clips/${tourId}/${stopId}.${TTS_CLIP_EXTENSION}`
}

/**
 * Bracket clip key — PER-RUN unique: clips/<tourId>/<runId>-intro|outro.<ext>.
 *
 * The runId component is deliberate (audit-caught): with a fixed per-tour key, a regen (or
 * a stray concurrent run) overwrites the LIVE telling's bracket bytes in place before its
 * own ready-gate commits — leaving rows that describe someone else's audio. Stop clips are
 * immune via fresh per-run stop ids; this gives brackets the same property. The row's
 * audioUrl is the only pointer to the key, and superseded keys orphan in R2 on regen —
 * the same accepted trade as stop clips. Tools that PATCH an existing bracket in place
 * write to the row's stored audioUrl, never to a freshly minted key.
 */
export function bracketKey(tourId: string, kind: BracketKind, runId: string): string {
  return `clips/${tourId}/${runId}-${kind}.${TTS_CLIP_EXTENSION}`
}

/** Upload an MP3 (private) and return its R2 object KEY to store on the stop/bracket row. */
export async function uploadAudio(key: string, bytes: Uint8Array): Promise<string> {
  // content-type goes in `type` (a BlobPropertyBag field), NOT `contentType`.
  await getClient().file(key).write(bytes, { type: TTS_AUDIO_CONTENT_TYPE })
  return key
}

/** Whether a clip already exists in R2 (lets callers skip re-synthesis). */
export async function audioExists(key: string): Promise<boolean> {
  return getClient().file(key).exists()
}

/** Delete a clip object by key — used to sweep an orphan after a key/extension migration. */
export async function deleteAudio(key: string): Promise<void> {
  await getClient().file(key).delete()
}

/** A short-lived presigned GET URL for a private clip KEY (for local listening/auditing). */
export function presignGet(key: string, expiresInSeconds: number = 60 * 60): string {
  return getClient().file(key).presign({ method: 'GET', expiresIn: expiresInSeconds })
}
