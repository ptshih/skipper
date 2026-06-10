// Audio storage — the generator's R2 keys + uploads. The R2 client + presign live in
// @skipper/storage (shared with the API); this file adds the generator-only concerns:
// TOUR-scoped key minting and writes. Audio objects are PRIVATE; we persist the R2 object
// KEY on tour_stops.audioUrl / tour_brackets.audioUrl, and the API issues short-lived
// presigned GET URLs after the freemium tier check (so a shared URL expires and the account
// wall is real). Keys are TOUR-scoped (narration is tour-owned, never reused across tours):
// clips/<tourId>/<stopId> for stops, clips/<tourId>/<runId>-intro|outro for brackets.

import type { BracketKind } from '@skipper/shared'
import { getR2Client, presignGet } from '@skipper/storage'
import { TTS_AUDIO_CONTENT_TYPE, TTS_CLIP_EXTENSION } from '../models'

// Re-exported so callers (e.g. judge-voice.ts) keep importing presign from './storage'.
export { presignGet }

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
  await getR2Client().file(key).write(bytes, { type: TTS_AUDIO_CONTENT_TYPE })
  return key
}

/** Delete a clip object by key — used to sweep an orphan after a key/extension migration. */
export async function deleteAudio(key: string): Promise<void> {
  await getR2Client().file(key).delete()
}
