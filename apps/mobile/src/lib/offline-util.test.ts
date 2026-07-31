import { describe, expect, test } from 'bun:test'
import type { DriveClip, SignedDriveAudio } from '@skipper/shared'
import {
  contentSignature,
  daysSinceIso,
  driveIdsToSweep,
  expectedAudioSeqs,
  extForContentType,
  hasDownloadableAudio,
  isPastTtl,
  migrateToVersion,
  missingAudioSeqs,
  urlMapFromDriveManifest,
  urlMapFromDriveSigned,
  type ManifestMigration,
} from './offline-util'

// Decides DELETIONS of rider-owned audio, so it gets tests rather than a careful read.
describe('driveIdsToSweep', () => {
  test('keeps what the list accounts for and sweeps what it does not', () => {
    expect(driveIdsToSweep(['a', 'b', 'c'], ['a', 'c'])).toEqual(['b'])
  })

  test('never sweeps a download that is mid-write', () => {
    // Deleting these files under the downloader as it verifies them turns a good copy into a broken
    // one — worse than the leak the sweep exists to fix.
    expect(driveIdsToSweep(['a', 'b'], [], ['b'])).toEqual(['a'])
  })

  test('an empty keep-list sweeps everything — authority over it is the CALLER’s guarantee', () => {
    // The account-switch path relies on exactly this; the list path must therefore only ever pass a
    // list from a SUCCEEDED fetch (app/index.tsx), since a failed one is indistinguishable here.
    expect(driveIdsToSweep(['a', 'b'], []).sort()).toEqual(['a', 'b'])
  })

  test('a list naming drives that are not on disk sweeps nothing', () => {
    expect(driveIdsToSweep([], ['a', 'b'])).toEqual([])
    expect(driveIdsToSweep(['a'], ['a', 'b', 'c'])).toEqual([])
  })

  test('a duplicated dir name is only reported once', () => {
    expect(driveIdsToSweep(['a', 'a'], [])).toEqual(['a'])
  })
})

// The walk that stands between an app update and a rider's saved drives. A bare
// `version !== CURRENT → null` gate reads to every caller as "never downloaded", which retires every
// saved download on the next update while its audio stays on disk, unreachable and unswept.
describe('migrateToVersion', () => {
  const bumpTo = (v: number): ManifestMigration => (m) => ({ ...m, version: v, [`did${v}`]: true })

  test('an already-current manifest passes through untouched', () => {
    const m = { version: 4, keep: 'me' }
    expect(migrateToVersion(m, 4, {})).toBe(m) // same object — no needless rewrite
  })

  test('walks a multi-step chain and preserves the payload', () => {
    const out = migrateToVersion({ version: 2, clips: { '0': 'a' } }, 4, {
      2: bumpTo(3),
      3: bumpTo(4),
    })
    expect(out?.version).toBe(4)
    expect(out?.did3).toBe(true)
    expect(out?.did4).toBe(true)
    expect(out?.clips).toEqual({ '0': 'a' })
  })

  test('a missing migration is no path across, not a crash', () => {
    expect(migrateToVersion({ version: 2 }, 4, { 3: bumpTo(4) })).toBeNull()
  })

  test('a migration that declines this download returns null', () => {
    expect(migrateToVersion({ version: 3 }, 4, { 3: () => null })).toBeNull()
  })

  // A migration that forgets to bump `version` would otherwise spin forever inside a file read.
  test('a non-progressing migration stops rather than looping', () => {
    expect(migrateToVersion({ version: 3 }, 4, { 3: (m) => ({ ...m }) })).toBeNull()
  })

  test('a NEWER manifest than this build knows is left alone for the shape check to reject', () => {
    // Downgrade (an older build reading a newer download) — the loop never runs; the caller's
    // isCurrentManifest is what refuses it, so this never silently plays a shape we can't read.
    const m = { version: 9 }
    expect(migrateToVersion(m, 4, {})).toBe(m)
  })

  test('a lying version cannot spin forever', () => {
    // Every step bumps by a fraction, so `version < target` stays true indefinitely without the guard.
    const creep: ManifestMigration = (m) => ({ ...m, version: (m.version as number) + 0.01 })
    expect(
      migrateToVersion({ version: 1 }, 4, Object.fromEntries(
        Array.from({ length: 40 }, (_, i) => [1 + i * 0.01, creep]),
      )),
    ).toBeNull()
  })
})

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

  test('missingAudioSeqs is empty for a COMPLETE download (every expected seq saved)', () => {
    expect(missingAudioSeqs([0, 1], [0, 1])).toEqual([])
  })

  test('missingAudioSeqs reports the gap for a PARTIAL download (audit #1 — the restart-safe predicate)', () => {
    // Expected 0,1,2 but only 0 and 2 landed — seq 1 must surface as missing.
    expect(missingAudioSeqs([0, 1, 2], [0, 2])).toEqual([1])
  })

  test('missingAudioSeqs: an empty saved set marks every expected seq missing; a stray extra saved seq is harmless', () => {
    expect(missingAudioSeqs([0, 2], [])).toEqual([0, 2])
    expect(missingAudioSeqs([0, 2], [0, 2, 99])).toEqual([])
  })

  test('composed: a silent beat is never EXPECTED, so a partial with only silent gaps reads COMPLETE', () => {
    const clips = [clip(0, 'https://r2/c0'), clip(1, null), clip(2, 'https://r2/c2')]
    const expected = expectedAudioSeqs(clips) // [0, 2] — seq 1 (silent beat) excluded
    expect(missingAudioSeqs(expected, [0, 2])).toEqual([]) // both audio clips saved → complete
    expect(missingAudioSeqs(expected, [0])).toEqual([2]) // an AUDIO clip missing → partial
  })
})

describe('contentSignature (offline staleness diff — audit #8)', () => {
  const clip = (seq: number, revisedAt: string | null): DriveClip => ({
    seq,
    form: 'story',
    alongSec: seq * 60,
    url: `https://r2/c${seq}`,
    contentType: 'audio/mp4',
    durationMs: 90_000,
    revisedAt,
  })

  test('is STABLE regardless of clip order (sorted by seq — a reorder is not a false "stale" nag)', () => {
    const a = contentSignature({ clips: [clip(0, 't0'), clip(1, 't1'), clip(2, 't2')] })
    const b = contentSignature({ clips: [clip(2, 't2'), clip(0, 't0'), clip(1, 't1')] })
    expect(a).toBe(b)
  })

  test('CHANGES when a clip is re-cut (its revisedAt token bumps)', () => {
    const before = contentSignature({ clips: [clip(0, 't0'), clip(1, 't1')] })
    const after = contentSignature({ clips: [clip(0, 't0'), clip(1, 't1-NEW')] })
    expect(after).not.toBe(before)
  })

  test('CHANGES when a clip is added or removed (the seq set changes)', () => {
    const two = contentSignature({ clips: [clip(0, 't0'), clip(1, 't1')] })
    const three = contentSignature({ clips: [clip(0, 't0'), clip(1, 't1'), clip(2, 't2')] })
    expect(three).not.toBe(two)
  })

  test('null/absent revisedAt is stable, but ADDING a token still registers as changed', () => {
    const a = contentSignature({ clips: [clip(0, null), clip(1, null)] })
    expect(contentSignature({ clips: [clip(0, null), clip(1, null)] })).toBe(a)
    expect(contentSignature({ clips: [clip(0, 't0'), clip(1, null)] })).not.toBe(a)
  })
})
