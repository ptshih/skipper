// Pure, native-free offline helpers (no expo-file-system / api / auth imports) so they
// unit-test under `bun test`. offline.ts (which IS native) re-uses these.

import { INTRO_SEQ, OUTRO_SEQ } from '@skipper/drive-core'
import type { DriveClip, SignedAudio, SignedDriveAudio } from '@skipper/shared'

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

/**
 * The url map the players key on: stop seq → uri, plus the intro/outro frame clips under
 * the INTRO_SEQ/OUTRO_SEQ sentinels. ONLINE (presigned https) form; the offline form is built
 * the same way from local file:// uris in offline.ts.
 */
export function urlMapFromSigned(signed: SignedAudio): Map<number, string> {
  const m = new Map<number, string>(signed.stops.map((u) => [u.seq, u.url]))
  if (signed.intro) m.set(INTRO_SEQ, signed.intro.url)
  if (signed.outro) m.set(OUTRO_SEQ, signed.outro.url)
  return m
}

/* -------------------------------------------------------------------------- */
/*  V2 — drive playback url maps (the same seq-keyed contract, drive shapes)     */
/* -------------------------------------------------------------------------- */

/**
 * The seq → url map for a V2 DRIVE manifest. A driveManifest carries its clips' presigned URLs
 * inline (GET /drives/:id already signs), so online playback maps straight off the manifest —
 * no separate sign call. Place narrations key by their `seq`; the placeless intro/outro framing
 * (by `form`) keys under the INTRO_SEQ/OUTRO_SEQ sentinels the player already understands.
 * (Interludes are EMPTY in v2 core — the framing library isn't synthesized yet — so today this
 * yields a flat stop map; the form mapping is here so frames slot in without a player change.)
 */
export function urlMapFromDriveManifest(manifest: { clips: DriveClip[] }): Map<number, string> {
  const m = new Map<number, string>()
  for (const c of manifest.clips) {
    if (!c.url) continue // a silent beat (rest) carries no audio
    const seq = c.form === 'intro' ? INTRO_SEQ : c.form === 'outro' ? OUTRO_SEQ : c.seq
    m.set(seq, c.url)
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
