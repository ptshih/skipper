// R2 access for the API — issues short-lived PRESIGNED GET URLs for gated audio.
//
// Audio objects are PRIVATE in R2; tour_stops.audioUrl (and tour_brackets.audioUrl) store the
// object KEY. The API presigns on demand AFTER the tier check, so a leaked/shared URL expires
// and the account wall is real. The R2 client + presign live in @skipper/storage (shared with
// the generator); this file adds the API-only concern: deriving a clip's MIME from its key.

// Re-exported so route handlers keep importing presign from './storage' (one storage door).
export { presignGet } from '@skipper/storage'

const AUDIO_CONTENT_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg', // current canonical (gemini-tts 32k MP3)
  wav: 'audio/wav', // legacy LINEAR16 clips, if any survive
}

/** MIME for a clip, derived from its R2 key extension. Lets the client treat the audio
 *  format as DATA (offline download writes the right extension; the player stays
 *  format-agnostic) instead of hardcoding it. Unknown extensions fall back to a generic
 *  binary type so a future codec change can't silently break the contract. */
export function contentTypeForKey(key: string): string {
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase()
  return AUDIO_CONTENT_TYPES[ext] ?? 'application/octet-stream'
}
