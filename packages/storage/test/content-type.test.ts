import { describe, expect, test } from 'bun:test'
import { contentTypeForKey } from '../src/index'

// The audio MIME map. This is not a hypothetical: the comment on AUDIO_CONTENT_TYPES records that a
// per-app copy DRIFTED once — admin was missing `m4a` and served the canonical clip as
// application/octet-stream — which is what motivated pulling it into one place. It had no test.
//
// Why it matters more than a MIME lookup usually does: the type rides a PRESIGNED url for a private
// object, and the mobile player treats audio format as DATA (the offline download writes the file
// extension from it). A wrong type here does not throw; it produces a clip the player will not open,
// in the dead-zone case the download exists for.
describe('contentTypeForKey', () => {
  test('m4a — the current canonical format — is audio/mp4', () => {
    // The exact case that drifted. Everything the pipeline ships today is AAC-LC .m4a.
    expect(contentTypeForKey('narrations/emerald-bay.m4a')).toBe('audio/mp4')
  })

  test('the legacy formats still resolve, so surviving old clips stay playable', () => {
    expect(contentTypeForKey('narrations/old.mp3')).toBe('audio/mpeg')
    expect(contentTypeForKey('narrations/older.wav')).toBe('audio/wav')
  })

  test('an unknown extension falls back to octet-stream rather than guessing', () => {
    // Deliberate: a future codec change should degrade to "generic binary", not silently claim to be
    // an audio type the player would then fail to decode.
    expect(contentTypeForKey('narrations/future.opus')).toBe('application/octet-stream')
  })

  test('extension matching is case-insensitive', () => {
    // R2 keys are written by the pipeline, but nothing enforces case, and a capitalised extension
    // silently falling back to octet-stream is exactly the original bug in a new hat.
    expect(contentTypeForKey('narrations/LOUD.M4A')).toBe('audio/mp4')
    expect(contentTypeForKey('narrations/Mixed.M4a')).toBe('audio/mp4')
  })

  test('uses the LAST dot, so dots earlier in the key do not confuse it', () => {
    // Real keys are pathlike and can carry a version or a hash segment.
    expect(contentTypeForKey('narrations/v2.1/lake.tahoe.m4a')).toBe('audio/mp4')
  })

  test('a key with no extension is octet-stream, not a crash', () => {
    expect(contentTypeForKey('narrations/no-extension')).toBe('application/octet-stream')
    expect(contentTypeForKey('')).toBe('application/octet-stream')
  })

  test('a key ending in a dot is octet-stream', () => {
    expect(contentTypeForKey('narrations/trailing.')).toBe('application/octet-stream')
  })
})
