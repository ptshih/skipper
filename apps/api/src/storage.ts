// R2 access for the API — issues short-lived PRESIGNED GET URLs for gated audio.
//
// Audio objects are PRIVATE in R2; narrations.audioUrl (and detours.audioUrl) store the
// object KEY. The API presigns on demand AFTER the tier check, so a leaked/shared URL expires
// and the account wall is real. The R2 client, presign, and key→MIME helper all live in
// @skipper/storage (the single R2 door, shared with admin + the studio pipeline) — re-exported here
// so route handlers keep importing from './storage'.
import type { Context } from 'hono'
import type { AttributionList } from '@skipper/shared'
import { contentTypeForKey, presignGet } from '@skipper/storage'

export { presignGet, contentTypeForKey }

/**
 * The fields that travel with a presigned clip, on EVERY surface that hands one to a rider.
 *
 * ⚠ `attribution` IS A LEGAL OBLIGATION, NOT A FIELD. Wikipedia is CC BY-SA, so any surface that
 * presents the adapted work owes credit — and until this existed, the three surfaces that emit clips
 * (the drive manifest, the anonymous route preview, and `GET /sample`) each carried their own copy of
 * the same three lines, in two different idioms. That made a legal requirement a CONVENTION enforced
 * by whoever wrote the next surface, and nothing fails when a convention is forgotten. Emitting the
 * URL and the credit from one expression means a clip cannot reach a rider without it.
 *
 * ⚠ The stubbed break-audio path (`detours`) is the fourth surface, and it is the reason this is worth
 * a function rather than a code review habit: it does not exist yet, so it cannot be reminded.
 *
 * ⚠ THROWS, exactly as `presignGet` does — an R2-config fault is not per-key, so the caller decides
 * whether that degrades (the preview drops the taste) or 503s (`audioUnavailable`, where a credit has
 * already been spent). Do not swallow it here; the two answers are genuinely different.
 *
 * Spread into the response object, so the caller keeps ownership of every other field.
 */
export function presignedClipFields(
  key: string,
  attribution: AttributionList | null | undefined,
): { url: string; contentType: string; attribution?: AttributionList } {
  return {
    url: presignGet(key),
    contentType: contentTypeForKey(key),
    // Omitted rather than null when absent: the wire schemas mark it optional, and an explicitly-null
    // credit reads as "we checked and there is none" on a clip that may simply predate attribution.
    ...(attribution ? { attribution } : {}),
  }
}

/**
 * The ONE answer to "presigning failed" — a 503, never a 200.
 *
 * Every route that presigns audio (drive create, its idempotent replay, drive replay, the offline
 * re-sign, and `GET /sample`) was carrying its own byte-identical copy of this log line and body.
 * That is one rider-facing sentence to keep in step across a handful of files, and the status is
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
