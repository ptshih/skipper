// R2 access for the API — issues short-lived PRESIGNED GET URLs for gated audio.
//
// Audio objects are PRIVATE in R2; narrations.audioUrl (and detours.audioUrl) store the
// object KEY. The API presigns on demand AFTER the tier check, so a leaked/shared URL expires
// and the account wall is real. The R2 client, presign, and key→MIME helper all live in
// @skipper/storage (the single R2 door, shared with admin + the studio pipeline) — re-exported here
// so route handlers keep importing from './storage'.
import type { Context } from 'hono'

export { presignGet, contentTypeForKey } from '@skipper/storage'

/**
 * The ONE answer to "presigning failed" — a 503, never a 200.
 *
 * Six route handlers presign audio (roam, roam/sample, drive create, its idempotent replay, drive
 * read, and the offline re-sign) and each was carrying its own byte-identical copy of this log line
 * and body. That is six places to keep a rider-facing sentence in step, and the status is
 * load-bearing: a 200 with a `warning` field was tried once and navigated the rider into a silently
 * EMPTY paid drive, because `driveManifest` is a plain z.object and strips unknown keys, so the
 * client never saw a retry signal. Keep this a 503.
 */
export function audioUnavailable(c: Context, label: string, e: unknown) {
  console.error(`[api] ${label} presign failed`, e)
  return c.json(
    { error: 'audio_unavailable', message: 'Audio is warming up. Give it a moment and try again.' },
    503,
  )
}
