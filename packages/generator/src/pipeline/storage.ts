// Audio storage — the generator's R2 keys + uploads. The R2 client + presign live in
// @skipper/storage (shared with the API); this file adds the generator-only concerns:
// TOUR-scoped key minting and writes. Audio objects are PRIVATE; we persist the R2 object
// KEY on tracks.audioUrl / tour_frames.audioUrl, and the API issues short-lived presigned
// GET URLs after the freemium tier check (so a shared URL expires and the account wall is
// real). Keys are TOUR-scoped (narration is tour-owned, never reused across tours):
// clips/<tourId>/<trackId> for stops, clips/<tourId>/<runId>-intro|outro for frames.

import type { FrameKind } from '@skipper/shared'
import { getR2Client, presignGet } from '@skipper/storage'
import { TTS_AUDIO_CONTENT_TYPE, TTS_CLIP_EXTENSION } from '../models'

// Re-exported so callers (e.g. judge-voice.ts) keep importing presign from './storage'.
export { presignGet }

/** Tour-scoped object key for a stop track's clip: clips/<tourId>/<trackId>.<ext>. */
export function clipKey(tourId: string, trackId: string): string {
  return `clips/${tourId}/${trackId}.${TTS_CLIP_EXTENSION}`
}

/**
 * Frame clip key — PER-RUN unique: clips/<tourId>/<runId>-intro|outro.<ext>.
 *
 * The runId component is deliberate (audit-caught): with a fixed per-tour key, a regen (or
 * a stray concurrent run) overwrites the LIVE telling's frame bytes in place before its
 * own ready-gate commits — leaving rows that describe someone else's audio. Stop clips are
 * immune via fresh per-run track ids; this gives frames the same property. The row's
 * audioUrl is the only pointer to the key, and superseded keys orphan in R2 on regen —
 * the same accepted trade as stop clips. Tools that PATCH an existing frame in place
 * write to the row's stored audioUrl, never to a freshly minted key.
 */
export function frameKey(tourId: string, kind: FrameKind, runId: string): string {
  return `clips/${tourId}/${runId}-${kind}.${TTS_CLIP_EXTENSION}`
}

/**
 * Free-roam clip key — per-TRACK unique: roam/<poiId>/<trackId>.<ext>. Same
 * never-overwrite-live-bytes property as frame keys: a roam regen mints a fresh
 * trackId, the row points at the new key, and the superseded object orphans for
 * `sweep-orphans --roam`. (Roam narration is ROAM-owned — a segment(tourId null) + its track.)
 */
export function roamClipKey(poiId: string, trackId: string): string {
  return `roam/${poiId}/${trackId}.${TTS_CLIP_EXTENSION}`
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
