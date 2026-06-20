import { describe, expect, test } from 'bun:test'
import type { DriveClip, SignedDriveAudio } from '@skipper/shared'
import {
  daysSinceIso,
  expectedAudioSeqs,
  extForContentType,
  hasDownloadableAudio,
  isPastTtl,
  missingAudioSeqs,
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

  test('skips silent (url-null) beats', () => {
    const m = urlMapFromDriveManifest({
      clips: [
        driveClip(0, 'story', 'https://r2/c0'),
        driveClip(1, 'break', null), // a silent rest beat — no audio
        driveClip(2, 'wave', 'https://r2/c2'),
      ],
    })
    expect(m.get(0)).toBe('https://r2/c0')
    expect(m.has(1)).toBe(false)
    expect(m.get(2)).toBe('https://r2/c2')
    expect(m.size).toBe(2)
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

describe('daysSinceIso / isPastTtl (offline freshness TTL)', () => {
  const DAY = 24 * 60 * 60 * 1000
  const NOW = Date.parse('2026-06-19T12:00:00.000Z')
  const isoDaysAgo = (n: number) => new Date(NOW - n * DAY).toISOString()

  test('daysSinceIso returns the day-age, clamped at 0', () => {
    expect(daysSinceIso(isoDaysAgo(10), NOW)).toBeCloseTo(10, 6)
    expect(daysSinceIso(isoDaysAgo(0), NOW)).toBe(0)
    expect(daysSinceIso(isoDaysAgo(-5), NOW)).toBe(0) // future timestamp (clock skew) → 0, never negative
  })

  test('daysSinceIso returns null for an unparseable timestamp', () => {
    expect(daysSinceIso('not-a-date', NOW)).toBeNull()
    expect(daysSinceIso('', NOW)).toBeNull()
  })

  test('isPastTtl is strict (> ttl): past expires, the exact boundary does not', () => {
    expect(isPastTtl(isoDaysAgo(31), NOW, 30)).toBe(true)
    expect(isPastTtl(isoDaysAgo(29), NOW, 30)).toBe(false)
    expect(isPastTtl(isoDaysAgo(30), NOW, 30)).toBe(false) // exactly 30 days is not yet past
  })

  test('isPastTtl fails OPEN on an unparseable timestamp (never nudge on a manifest we cannot date)', () => {
    expect(isPastTtl('garbage', NOW, 30)).toBe(false)
  })
})

describe('offline completeness (hasDownloadableAudio / expectedAudioSeqs / missingAudioSeqs)', () => {
  const clip = (seq: number, url: string | null): DriveClip => ({
    seq,
    form: 'story',
    alongSec: seq * 60,
    url,
    contentType: url ? 'audio/mp4' : null,
    durationMs: 90_000,
  })

  test('hasDownloadableAudio needs BOTH a url and a contentType', () => {
    expect(hasDownloadableAudio({ url: 'https://r2/c', contentType: 'audio/mp4' })).toBe(true)
    expect(hasDownloadableAudio({ url: null, contentType: 'audio/mp4' })).toBe(false)
    expect(hasDownloadableAudio({ url: 'https://r2/c', contentType: null })).toBe(false)
    expect(hasDownloadableAudio({ url: null, contentType: null })).toBe(false)
  })

  test('expectedAudioSeqs lists only clips with audio (silent beats excluded)', () => {
    const clips = [clip(0, 'https://r2/c0'), clip(1, null), clip(2, 'https://r2/c2')]
    expect(expectedAudioSeqs(clips)).toEqual([0, 2])
  })

  test('missingAudioSeqs is empty for a COMPLETE download (every expected clip saved)', () => {
    const clips = [clip(0, 'https://r2/c0'), clip(1, 'https://r2/c1')]
    expect(missingAudioSeqs(clips, [0, 1])).toEqual([])
  })

  test('missingAudioSeqs reports the gap for a PARTIAL download (audit #1 — the restart-safe predicate)', () => {
    const clips = [clip(0, 'https://r2/c0'), clip(1, 'https://r2/c1'), clip(2, 'https://r2/c2')]
    // Only seqs 0 and 2 landed — seq 1 never downloaded, so it must surface as missing.
    expect(missingAudioSeqs(clips, [0, 2])).toEqual([1])
  })

  test('a silent beat (no audio) is never counted missing, even when absent from the saved set', () => {
    const clips = [clip(0, 'https://r2/c0'), clip(1, null)]
    // seq 1 is a silent beat — nothing to download, so a saved set of just [0] is COMPLETE.
    expect(missingAudioSeqs(clips, [0])).toEqual([])
  })

  test('an empty saved set marks every audio clip missing; a stray extra saved seq is harmless', () => {
    const clips = [clip(0, 'https://r2/c0'), clip(2, 'https://r2/c2')]
    expect(missingAudioSeqs(clips, [])).toEqual([0, 2])
    expect(missingAudioSeqs(clips, [0, 2, 99])).toEqual([])
  })
})
