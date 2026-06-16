import { describe, expect, test } from 'bun:test'
import { INTRO_SEQ, OUTRO_SEQ } from '@skipper/drive-core'
import type { SignedAudio } from '@skipper/shared'
import { extForContentType, urlMapFromSigned } from './offline-util'

describe('extForContentType', () => {
  test('maps known audio MIME types to on-disk extensions', () => {
    expect(extForContentType('audio/mpeg')).toBe('mp3')
    expect(extForContentType('audio/wav')).toBe('wav')
    expect(extForContentType('audio/mp4')).toBe('m4a')
  })

  test('is case-insensitive', () => {
    expect(extForContentType('AUDIO/MPEG')).toBe('mp3')
  })

  test('falls back to mp3 for an unknown type (never hardcodes the wrong format silently)', () => {
    expect(extForContentType('application/octet-stream')).toBe('mp3')
  })
})

describe('urlMapFromSigned', () => {
  const clip = (url: string) => ({ url, contentType: 'audio/mpeg', durationMs: 1000 })

  test('keys stops by seq and frames under the INTRO_SEQ/OUTRO_SEQ sentinels', () => {
    const signed: SignedAudio = {
      stops: [
        { seq: 0, ...clip('https://r2/stop0') },
        { seq: 1, ...clip('https://r2/stop1') },
      ],
      intro: clip('https://r2/intro'),
      outro: clip('https://r2/outro'),
    }
    const m = urlMapFromSigned(signed)
    expect(m.get(0)).toBe('https://r2/stop0')
    expect(m.get(1)).toBe('https://r2/stop1')
    expect(m.get(INTRO_SEQ)).toBe('https://r2/intro')
    expect(m.get(OUTRO_SEQ)).toBe('https://r2/outro')
    expect(m.size).toBe(4)
  })

  test('omits absent frames (a tour with no intro/outro)', () => {
    const signed: SignedAudio = {
      stops: [{ seq: 0, ...clip('https://r2/stop0') }],
      intro: null,
      outro: null,
    }
    const m = urlMapFromSigned(signed)
    expect(m.has(INTRO_SEQ)).toBe(false)
    expect(m.has(OUTRO_SEQ)).toBe(false)
    expect(m.size).toBe(1)
  })
})
