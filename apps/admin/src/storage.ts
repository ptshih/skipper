// R2 access for the admin console — short-lived presigned GET URLs for the ear-pass.
//
// Same one-door pattern as apps/api/src/storage.ts: the R2 client + presign live in
// @skipper/storage (shared with the generator); this adds the MIME-from-key helper. The
// admin presigns ANY tour's clips with NO tier gate (it's founder-only behind IAP) — unlike
// the public API, where presign sits behind the freemium check.

export { presignGet } from '@skipper/storage'

const AUDIO_CONTENT_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
}

/** MIME for a clip, derived from its R2 key extension (unknown → generic binary). */
export function contentTypeForKey(key: string): string {
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase()
  return AUDIO_CONTENT_TYPES[ext] ?? 'application/octet-stream'
}
