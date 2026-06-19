// Pure, native-free offline helpers (no expo-file-system / api / auth imports) so they
// unit-test under `bun test`. offline.ts (which IS native) re-uses these.

import type { DriveClip, SignedDriveAudio } from '@skipper/shared'

/** MIME → on-disk extension. Driven by the sign response's `contentType`, never hardcoded. */
const EXT_BY_TYPE: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
}
export function extForContentType(contentType: string): string {
  return EXT_BY_TYPE[contentType.toLowerCase()] ?? 'mp3'
}

/* -------------------------------------------------------------------------- */
/*  Drive playback url maps (seq-keyed)                                          */
/* -------------------------------------------------------------------------- */

/**
 * The seq → url map for a V2 DRIVE manifest. A driveManifest carries its clips' presigned URLs
 * inline (GET /drives/:id already signs), so online playback maps straight off the manifest —
 * no separate sign call. Every clip is a place narration keyed by its `seq`. (V2 has no placeless
 * framing — asides were deleted; see docs/decisions/geometry-first-regions.md.)
 */
export function urlMapFromDriveManifest(manifest: { clips: DriveClip[] }): Map<number, string> {
  const m = new Map<number, string>()
  for (const c of manifest.clips) {
    if (!c.url) continue // a silent beat (rest) carries no audio
    m.set(c.seq, c.url)
  }
  return m
}

/**
 * The seq → url map for a drive's re-presign response (the offline-refresh / stall-recovery path).
 * `signedDriveAudio` is flat — keyed by the same `seq` the manifest used — so this is a direct map.
 */
export function urlMapFromDriveSigned(signed: SignedDriveAudio): Map<number, string> {
  return new Map<number, string>(signed.clips.map((c) => [c.seq, c.url]))
}

/* -------------------------------------------------------------------------- */
/*  Offline freshness TTL (pure date math; offline.ts wires in savedAt + now)   */
/* -------------------------------------------------------------------------- */

const DAY_MS = 24 * 60 * 60 * 1000

/** Days between an ISO timestamp and `now` (ms epoch). Null if the timestamp is unparseable.
 *  Clamped at 0 so a clock skew (a timestamp in the future) never reads as negative age. */
export function daysSinceIso(iso: string, now: number): number | null {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.max(0, (now - t) / DAY_MS)
}

/** Is an ISO timestamp strictly older than `ttlDays` relative to `now`? False when unparseable —
 *  fail-OPEN, since a freshness nudge must never fire on a manifest we can't even date. */
export function isPastTtl(iso: string, now: number, ttlDays: number): boolean {
  const age = daysSinceIso(iso, now)
  return age != null && age > ttlDays
}
