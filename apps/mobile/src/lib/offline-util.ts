// Pure, native-free offline helpers (no expo-file-system / api / auth imports) so they
// unit-test under `bun test`. offline.ts (which IS native) re-uses these.

import { INTRO_SEQ, OUTRO_SEQ } from '@skipper/drive-core'
import type { SignedAudio } from '@skipper/shared'

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
