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
 * atom's name — the key is keyed on the SUBJECT, never on whatever mode plays it). A regen mints a
 * fresh clipId, the narration
 * row repoints its audio_url at the new key, and the superseded object orphans for `sweep-orphans` —
 * never overwriting a live narration's bytes in place.
 */
export function narrationClipKey(poiId: string, clipId: string): string {
  return `narration/${poiId}/${clipId}.${TTS_CLIP_EXTENSION}`
}

/** Upload a clip (private AAC .m4a) and return its R2 object KEY to store on narrations.audio_url. */
export async function uploadAudio(key: string, bytes: Uint8Array): Promise<string> {
  // content-type goes in `type` (a BlobPropertyBag field), NOT `contentType`.
  await getR2Client().file(key).write(bytes, { type: TTS_AUDIO_CONTENT_TYPE })
  return key
}

/** Delete a clip object by key — used to sweep an orphan after a key/extension migration. */
export async function deleteAudio(key: string): Promise<void> {
  await getR2Client().file(key).delete()
}

/** One stored object, as the sweep needs to see it. */
export type AudioObject = { key: string; lastModified: string | null }

/** Every object under a prefix, with its age. Paginates (R2/S3 returns ≤1000 per page). */
export async function listAudioObjects(prefix: string): Promise<AudioObject[]> {
  const client = getR2Client()
  const out: AudioObject[] = []
  let startAfter: string | undefined
  for (;;) {
    const res = await client.list({ prefix, maxKeys: 1000, startAfter })
    const page = res.contents ?? []
    for (const o of page) out.push({ key: o.key, lastModified: o.lastModified ?? null })
    if (!res.isTruncated || page.length === 0) break
    startAfter = page[page.length - 1]!.key
  }
  return out
}

/** Every object KEY under a prefix. */
export async function listAudioKeys(prefix: string): Promise<string[]> {
  return (await listAudioObjects(prefix)).map((o) => o.key)
}

/** How long a clip must have existed before the sweep may consider it an orphan. */
export const SWEEP_MIN_AGE_MS = 60 * 60 * 1000

/**
 * The keys the sweep may actually DELETE: unreferenced AND older than `minAgeMs`.
 *
 * ⚠ THE AGE GUARD IS THE WHOLE POINT, and it exists because "unreferenced" is briefly TRUE for a clip
 * that is perfectly healthy. `generate-narrations` uploads the bytes and only then writes the
 * `narrations` row (uploadAudio at :586, the insert at :604), so between those two statements the
 * object is an orphan by this function's definition — once per clip, across a run of hundreds. A sweep
 * landing in that window deletes a clip that is about to be recorded; the row is then written pointing
 * at a key that no longer exists, `audio_url` is NOT NULL so nothing is violated, nothing errors, and
 * the rider simply gets silence at that stop.
 *
 * The in-flight job lock cannot prevent this: it is keyed on (kind, target), and sweep's target is the
 * constant 'narration' while a generate's is a region slug — they never collide. A console-side check
 * would also miss a LOCAL cli generate, which sets no STUDIO_JOB_ID and so creates no row to check.
 * An age guard needs to know about none of that.
 *
 * Nothing is lost by waiting: a genuine orphan is produced by a run that has already finished or died,
 * so it is still there an hour later. `lastModified` missing is treated as TOO YOUNG — unknown age
 * must not authorise a delete. (founder call 2026-08-02)
 *
 * ⚠ This is deliberately the ONLY "which keys are unreferenced" helper here. Its age-guard-less
 * predecessor (`orphanKeys`) was DELETED rather than left exported: a green, fully-tested function
 * one import away is exactly how the window above gets reintroduced by a well-meaning caller.
 */
export function reapableKeys(
  listed: AudioObject[],
  referenced: Set<string>,
  opts: { minAgeMs?: number; now?: number } = {},
): { reap: string[]; heldBack: string[] } {
  const minAgeMs = opts.minAgeMs ?? SWEEP_MIN_AGE_MS
  const now = opts.now ?? Date.now()
  const reap: string[] = []
  const heldBack: string[] = []
  for (const o of listed) {
    if (referenced.has(o.key)) continue
    const ms = o.lastModified ? Date.parse(o.lastModified) : NaN
    if (!Number.isFinite(ms) || now - ms < minAgeMs) heldBack.push(o.key)
    else reap.push(o.key)
  }
  return { reap, heldBack }
}
