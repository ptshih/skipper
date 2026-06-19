// Audio storage — the studio pipeline's R2 keys + uploads. The R2 client + presign live in
// @skipper/storage (shared with the API); this file adds the studio-only concerns: narration
// clip key minting + writes. Audio objects are PRIVATE; we persist the R2 object KEY on
// narrations.audio_url, and the API issues short-lived presigned GET URLs after the tier check
// (so a shared URL expires and the account wall is real). Keys are narration/<poiId>/<clipId>.

import { getR2Client, presignGet } from '@skipper/storage'
import { TTS_AUDIO_CONTENT_TYPE, TTS_CLIP_EXTENSION } from '../models'

// Re-exported so callers (e.g. judge-voice.ts) keep importing presign from './storage'.
export { presignGet }

/**
 * Narration clip key — per-CLIP unique: narration/<poiId>/<clipId>.<ext> (the atom's bytes under the
 * atom's name; the roam MODE no longer owns the prefix). A regen mints a fresh clipId, the narration
 * row repoints its audio_url at the new key, and the superseded object orphans for `sweep-orphans` —
 * never overwriting a live narration's bytes in place.
 */
export function narrationClipKey(poiId: string, clipId: string): string {
  return `narration/${poiId}/${clipId}.${TTS_CLIP_EXTENSION}`
}

/** Upload an MP3 (private) and return its R2 object KEY to store on the track/frame row. */
export async function uploadAudio(key: string, bytes: Uint8Array): Promise<string> {
  // content-type goes in `type` (a BlobPropertyBag field), NOT `contentType`.
  await getR2Client().file(key).write(bytes, { type: TTS_AUDIO_CONTENT_TYPE })
  return key
}

/** Delete a clip object by key — used to sweep an orphan after a key/extension migration. */
export async function deleteAudio(key: string): Promise<void> {
  await getR2Client().file(key).delete()
}

/** Every object KEY under a prefix. Paginates (R2/S3 returns ≤1000 per page). */
export async function listAudioKeys(prefix: string): Promise<string[]> {
  const client = getR2Client()
  const keys: string[] = []
  let startAfter: string | undefined
  for (;;) {
    const res = await client.list({ prefix, maxKeys: 1000, startAfter })
    const page = res.contents ?? []
    for (const o of page) keys.push(o.key)
    if (!res.isTruncated || page.length === 0) break
    startAfter = page[page.length - 1]!.key
  }
  return keys
}

/** Keys present in R2 (`listed`) that NO current DB row references (`referenced`) — i.e. the
 *  orphans safe to delete. Pure (the decision the sweep tool acts on); a referenced key can
 *  never be returned. */
export function orphanKeys(listed: string[], referenced: Set<string>): string[] {
  return listed.filter((k) => !referenced.has(k))
}
