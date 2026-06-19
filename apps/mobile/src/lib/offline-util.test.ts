import { describe, expect, test } from 'bun:test'
import { INTRO_SEQ, OUTRO_SEQ } from '@skipper/drive-core'
import type { DriveClip, SignedDriveAudio } from '@skipper/shared'
import {
  extForContentType,
  urlMapFromDriveManifest,
  urlMapFromDriveSigned,
} from './offline-util'

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


describe('urlMapFromDriveManifest', () => {
  const driveClip = (seq: number, form: DriveClip['form'], url: string | null): DriveClip => ({
    seq,
    form,
    alongSec: seq * 60,
    url,
    contentType: url ? 'audio/mp4' : null,
    durationMs: 90_000,
  })

  test('keys narration stops by seq (the narration-only v2 manifest)', () => {
    const m = urlMapFromDriveManifest({
      clips: [
        driveClip(0, 'story', 'https://r2/c0'),
        driveClip(1, 'scenic', 'https://r2/c1'),
        driveClip(2, 'wave', 'https://r2/c2'),
      ],
    })
    expect(m.get(0)).toBe('https://r2/c0')
    expect(m.get(2)).toBe('https://r2/c2')
    expect(m.size).toBe(3)
  })

  test('maps intro/outro framing to the player sentinels, skips silent (url-null) beats', () => {
    const m = urlMapFromDriveManifest({
      clips: [
        driveClip(-1, 'intro', 'https://r2/intro'),
        driveClip(0, 'story', 'https://r2/c0'),
        driveClip(1, 'break', null), // a silent rest beat — no audio
        driveClip(-2, 'outro', 'https://r2/outro'),
      ],
    })
    expect(m.get(INTRO_SEQ)).toBe('https://r2/intro')
    expect(m.get(OUTRO_SEQ)).toBe('https://r2/outro')
    expect(m.get(0)).toBe('https://r2/c0')
    expect(m.has(1)).toBe(false)
    expect(m.size).toBe(3)
  })
})

describe('urlMapFromDriveSigned', () => {
  test('maps the flat seq-keyed re-presign response directly', () => {
    const signed: SignedDriveAudio = {
      clips: [
        { seq: 0, url: 'https://r2/c0', contentType: 'audio/mp4', durationMs: 1000 },
        { seq: 3, url: 'https://r2/c3', contentType: 'audio/mp4', durationMs: 1000 },
      ],
    }
    const m = urlMapFromDriveSigned(signed)
    expect(m.get(0)).toBe('https://r2/c0')
    expect(m.get(3)).toBe('https://r2/c3')
    expect(m.size).toBe(2)
  })
})
