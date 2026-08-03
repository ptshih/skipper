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
  isSafeSubjectId,
  migrateToVersion,
  migrateV4ToV5,
  missingAudioSeqs,
  orphanStoreNames,
  parseStoreFileName,
  planV4Rekey,
  revisionToken,
  resolveClipRef,
  storeFileName,
  storeKeepSet,
  storeKeyForClip,
  urlMapFromDriveManifest,
  urlMapFromDriveSigned,
  UNKNOWN_REV,
  type ManifestMigration,
  type StoredClipRef,
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
    // The account-deletion purge relies on exactly this. Any future caller passing a SERVER list
    // must have had a SUCCEEDED fetch, since a failed one is indistinguishable here.
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
        driveClip(2, 'scenic', 'https://r2/c2'),
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
        driveClip(2, 'scenic', 'https://r2/c2'),
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

/* ========================================================================== */
/*  THE SUBJECT-KEYED CLIP STORE                                              */
/* ========================================================================== */

/*
 * This is the module that must never lose a rider's download, and the failure it cannot have is a
 * drive that still LISTS as downloaded but is missing audio — discovered in a dead zone. The stall
 * watchdog SKIPS a clip that will not load, with no note, so a hole is SILENT by construction: the
 * rider simply drives past a stop in silence. There is no filesystem and no renderer here, so these
 * tests are the only place that truth can be asserted. Every one of them stands in for a byte.
 */

const POI_A = '11111111-1111-4111-8111-111111111111'
const POI_B = '22222222-2222-4222-8222-222222222222'
const CLUSTER_A = '33333333-3333-4333-8333-333333333333'
const DRIVE_ID = '44444444-4444-4444-8444-444444444444'

const REV_OLD = '2026-04-01T00:00:00.000Z'
const REV_NEW = '2026-05-02T09:30:00.000Z'
const M4A = 'audio/mp4'

type DetailClip = Record<string, unknown>
type V4Clip = { name: string; contentType: string; durationMs: number | null }

/** A v4 manifest exactly as `offline.ts` persisted it (urls already stripped). */
function v4Manifest(detailClips: DetailClip[], clips: Record<string, V4Clip>): Record<string, unknown> {
  return {
    driveId: DRIVE_ID,
    version: 4,
    savedAt: '2026-05-01T12:00:00.000Z',
    detail: { driveId: DRIVE_ID, label: 'West Shore', polyline: 'abc', clips: detailClips },
    audioSeqs: detailClips.map((c) => c.seq as number),
    clips,
  }
}

const clipFile = (seq: number): V4Clip => ({ name: `${seq}.m4a`, contentType: M4A, durationMs: 90_000 })

/** A v4 saved by a POST-step-4 build: the wire already carried subjectId/subjectKind. */
const postStep4 = () =>
  v4Manifest(
    [
      { seq: 0, form: 'story', alongSec: 0, poiId: POI_A, subjectId: POI_A, subjectKind: 'poi', revisedAt: REV_OLD },
      // ⚠ A FUSED cluster telling: poiId is null BY DESIGN. A store keyed on poiId cannot tell this
      // apart from a broken clip (INV-16).
      { seq: 1, form: 'story', alongSec: 60, poiId: null, subjectId: CLUSTER_A, subjectKind: 'cluster', revisedAt: REV_OLD },
    ],
    { '0': clipFile(0), '1': clipFile(1) },
  )

/** A v4 saved by a PRE-step-4 build: step 4 added subjectId/subjectKind to the wire WITHOUT a
 *  manifest bump, so `version === 4` covers this shape too. The fused clip has NO identity here. */
const preStep4 = () =>
  v4Manifest(
    [
      { seq: 0, form: 'story', alongSec: 0, poiId: POI_A, revisedAt: REV_OLD },
      { seq: 1, form: 'story', alongSec: 60, poiId: null, revisedAt: REV_OLD },
    ],
    { '0': clipFile(0), '1': clipFile(1) },
  )

type V5Manifest = { version: number; clips: Record<string, StoredClipRef> } & Record<string, unknown>
const toV5 = (raw: Record<string, unknown>, placed: Iterable<string> = []) =>
  migrateV4ToV5(raw, new Set(placed)) as V5Manifest

describe('isSafeSubjectId (untrusted-from-disk path guard)', () => {
  // A manifest read from disk is JSON.parse'd and shape-checked, NOT re-validated — so any id
  // reaching a path builder is untrusted, and one carrying a separator addresses bytes OUTSIDE the
  // store.
  test('rejects anything that could escape the clips dir', () => {
    expect(isSafeSubjectId('../../etc/passwd')).toBe(false)
    expect(isSafeSubjectId('/')).toBe(false)
    expect(isSafeSubjectId(`../${POI_A}`)).toBe(false)
    expect(isSafeSubjectId(`${POI_A}/../x`)).toBe(false)
    expect(isSafeSubjectId('')).toBe(false)
    expect(isSafeSubjectId(null)).toBe(false)
    expect(isSafeSubjectId(undefined)).toBe(false)
    expect(isSafeSubjectId(42)).toBe(false)
  })

  test('accepts a server-minted uuid, in either case', () => {
    expect(isSafeSubjectId(POI_A)).toBe(true)
    expect(isSafeSubjectId(POI_A.toUpperCase())).toBe(true)
  })
})

describe('revisionToken', () => {
  test('is the ms-epoch of the narration revision', () => {
    expect(revisionToken(REV_OLD)).toBe(String(Date.parse(REV_OLD)))
  })

  test('is UNKNOWN_REV when the clip cannot be dated', () => {
    // The caller then treats the entry as ABSENT whenever an incoming manifest carries a real
    // revisedAt — re-download once, online, rather than serve an undatable telling forever.
    expect(revisionToken(null)).toBe(UNKNOWN_REV)
    expect(revisionToken(undefined)).toBe(UNKNOWN_REV)
    expect(revisionToken('not-a-date')).toBe(UNKNOWN_REV)
    expect(revisionToken(1_700_000_000)).toBe(UNKNOWN_REV)
  })

  test('a pre-1970 timestamp degrades rather than emitting a "-" the filename cannot carry', () => {
    expect(revisionToken('1969-01-01T00:00:00.000Z')).toBe(UNKNOWN_REV)
  })
})

describe('storeFileName / parseStoreFileName', () => {
  test('round-trips both subject kinds and the unknown revision', () => {
    for (const k of [
      { subjectId: POI_A, subjectKind: 'poi' as const, rev: '1750000000000' },
      { subjectId: CLUSTER_A, subjectKind: 'cluster' as const, rev: '1750000000000' },
      { subjectId: POI_B, subjectKind: 'poi' as const, rev: UNKNOWN_REV },
    ]) {
      expect(parseStoreFileName(storeFileName(k, M4A))).toEqual(k)
    }
  })

  test('the extension follows the SERVED contentType', () => {
    const k = { subjectId: POI_A, subjectKind: 'poi' as const, rev: '1' }
    expect(storeFileName(k, M4A).endsWith('.m4a')).toBe(true)
    expect(storeFileName(k, 'audio/mpeg').endsWith('.mp3')).toBe(true)
    expect(storeFileName(k, 'application/octet-stream').endsWith('.mp3')).toBe(true)
  })

  // ⚠ THE STALE-TELLING TEST. Without the revision in the NAME, drive A stores subject S at T0, the
  // operator re-synths, drive B's manifest says T1, the presence check asks "is S present?" → yes →
  // skips, and B plays T0 forever. isDownloadStale cannot see it: it compares MANIFESTS and both
  // manifests are correct — the BYTES are wrong and nothing compares bytes to a manifest.
  test('the SAME subject at two revisions resolves to two DIFFERENT filenames', () => {
    const older = storeKeyForClip({ subjectId: POI_A, subjectKind: 'poi', revisedAt: REV_OLD })
    const newer = storeKeyForClip({ subjectId: POI_A, subjectKind: 'poi', revisedAt: REV_NEW })
    expect(older).not.toBeNull()
    expect(newer).not.toBeNull()
    const a = storeFileName(older!, M4A)
    const b = storeFileName(newer!, M4A)
    expect(a).not.toBe(b)
    // and the new name is NOT satisfied by the old byte being on disk
    expect(new Set([a]).has(b)).toBe(false)
  })

  test('refuses LOUDLY to build a path from a key that could escape the store', () => {
    expect(() => storeFileName({ subjectId: '../evil', subjectKind: 'poi', rev: '1' }, M4A)).toThrow()
    expect(() => storeFileName({ subjectId: POI_A, subjectKind: 'wat' as never, rev: '1' }, M4A)).toThrow()
    expect(() => storeFileName({ subjectId: POI_A, subjectKind: 'poi', rev: '-5' }, M4A)).toThrow()
  })

  test('rejects a name it does not recognise (⇒ the sweep will never delete it)', () => {
    expect(parseStoreFileName('0.m4a')).toBeNull() // a legacy per-drive byte
    expect(parseStoreFileName('manifest.json')).toBeNull()
    expect(parseStoreFileName(`poi-${POI_A}.m4a`)).toBeNull() // no revision segment
    expect(parseStoreFileName(`poi-${POI_A}.v2-1750000000000.m4a`)).toBeNull() // a FUTURE rev format
    expect(parseStoreFileName(`wave-${POI_A}.1.m4a`)).toBeNull() // unknown subject kind
    expect(parseStoreFileName('poi-not-a-uuid.1.m4a')).toBeNull()
    expect(parseStoreFileName('')).toBeNull()
    expect(parseStoreFileName(null)).toBeNull()
  })
})

describe('storeKeyForClip (INV-16 — subjectId is the identity, poiId is not)', () => {
  test('a FUSED cluster telling keys on its cluster subject even though poiId is null', () => {
    expect(storeKeyForClip({ poiId: null, subjectId: CLUSTER_A, subjectKind: 'cluster', revisedAt: REV_OLD })).toEqual({
      subjectId: CLUSTER_A,
      subjectKind: 'cluster',
      rev: String(Date.parse(REV_OLD)),
    })
  })

  test('subjectId WINS over poiId when both are present', () => {
    const k = storeKeyForClip({ poiId: POI_B, subjectId: POI_A, subjectKind: 'poi', revisedAt: REV_OLD })
    expect(k?.subjectId).toBe(POI_A)
  })

  test('a pre-step-4 poi clip keys on poiId BY IDENTITY — the zero-network half of the migration', () => {
    expect(storeKeyForClip({ poiId: POI_A, revisedAt: REV_OLD })).toEqual({
      subjectId: POI_A,
      subjectKind: 'poi',
      rev: String(Date.parse(REV_OLD)),
    })
  })

  test('a subjectId with no kind is a poi (the server sets cluster kind alongside the id)', () => {
    expect(storeKeyForClip({ subjectId: POI_A })?.subjectKind).toBe('poi')
  })

  test('unidentifiable clips return null rather than a synthesized key', () => {
    // A pre-step-4 FUSED telling: no subjectId, poiId null BY DESIGN. Its bytes stay drive-local.
    expect(storeKeyForClip({ poiId: null, revisedAt: REV_OLD })).toBeNull()
    expect(storeKeyForClip({})).toBeNull()
    // A cluster clip whose id is missing must NEVER fall back to poiId — that would file a fused
    // telling under a poi.
    expect(storeKeyForClip({ poiId: POI_A, subjectKind: 'cluster' })).toBeNull()
    // Corruption from disk: present-but-unsafe, or a kind we have never heard of.
    expect(storeKeyForClip({ subjectId: '../../x', subjectKind: 'poi' })).toBeNull()
    expect(storeKeyForClip({ subjectId: POI_A, subjectKind: 'wave' })).toBeNull()
  })
})

describe('planV4Rekey (both v4 shapes)', () => {
  test('a POST-step-4 v4 re-keys every clip, the fused one on its CLUSTER subject', () => {
    const steps = planV4Rekey(postStep4())
    expect(steps.map((s) => s.seq)).toEqual([0, 1])
    expect(steps[0]).toEqual({
      seq: 0,
      fromName: '0.m4a',
      toName: `poi-${POI_A}.${Date.parse(REV_OLD)}.m4a`,
      contentType: M4A,
      durationMs: 90_000,
    })
    expect(steps[1].toName).toBe(`cluster-${CLUSTER_A}.${Date.parse(REV_OLD)}.m4a`)
    expect(steps[1].toName).not.toContain('poi-')
  })

  test('a PRE-step-4 v4 re-keys the poi half with ZERO network and leaves the fused clip alone', () => {
    const steps = planV4Rekey(preStep4())
    expect(steps[0].toName).toBe(`poi-${POI_A}.${Date.parse(REV_OLD)}.m4a`)
    // ⚠ Emerald Bay / downtown Reno. There is no identity for it offline — and "no identity" must
    // mean "leave the bytes exactly where they are", never "delete" and never "invent an id".
    expect(steps[1].toName).toBeNull()
    expect(steps[1].fromName).toBe('1.m4a')
  })

  test('refuses to plan anything for a manifest that is not v4', () => {
    // Without this guard a re-run over a v5 manifest would read its SHARED names as drive-local
    // sources and plan moves out of the store into itself.
    expect(planV4Rekey(toV5(postStep4(), planV4Rekey(postStep4()).map((s) => s.toName!)))).toEqual([])
    expect(planV4Rekey({ version: 3, clips: { '0': clipFile(0) } })).toEqual([])
  })

  test('two seqs on one subject+revision plan the SAME destination (one file, two stops)', () => {
    const raw = v4Manifest(
      [
        { seq: 0, form: 'story', alongSec: 0, subjectId: POI_A, subjectKind: 'poi', revisedAt: REV_OLD },
        { seq: 1, form: 'story', alongSec: 60, subjectId: POI_A, subjectKind: 'poi', revisedAt: REV_OLD },
      ],
      { '0': clipFile(0), '1': clipFile(1) },
    )
    const steps = planV4Rekey(raw)
    expect(steps[0].toName).toBe(steps[1].toName)
  })
})

describe('migrateV4ToV5', () => {
  const allPlaced = (raw: Record<string, unknown>) =>
    planV4Rekey(raw)
      .map((s) => s.toName)
      .filter((n): n is string => n !== null)

  test('a fully-placed drive lands entirely in the shared store, seq-keyed', () => {
    const raw = postStep4()
    const m = toV5(raw, allPlaced(raw))
    expect(m.version).toBe(5)
    expect(Object.keys(m.clips).sort()).toEqual(['0', '1'])
    expect(m.clips['0']).toEqual({
      name: `poi-${POI_A}.${Date.parse(REV_OLD)}.m4a`,
      contentType: M4A,
      durationMs: 90_000,
      shared: true,
    })
    expect(m.clips['1'].shared).toBe(true)
  })

  // ⚠ THE CRASH-SAFETY CONTRACT. `placed` is what was VERIFIED PRESENT in the store, not "the moves
  // that did not throw". A byte that is not provably there must keep its drive-local name — the
  // manifest must never name a file that is not where it says it is.
  test('a byte missing from `placed` stays drive-local and is NEVER dropped', () => {
    const raw = postStep4()
    const m = toV5(raw, [allPlaced(raw)[0]]) // seq 1's move did not land
    expect(m.clips['0'].shared).toBe(true)
    expect(m.clips['1']).toEqual({ name: '1.m4a', contentType: M4A, durationMs: 90_000, shared: false })
    expect(Object.keys(m.clips)).toHaveLength(2) // the drive still knows about every stop
  })

  test('a PRE-step-4 fused clip survives as a playable drive-local entry', () => {
    const raw = preStep4()
    const m = toV5(raw, allPlaced(raw))
    expect(m.clips['0'].shared).toBe(true)
    expect(m.clips['1']).toEqual({ name: '1.m4a', contentType: M4A, durationMs: 90_000, shared: false })
  })

  // "Source gone, destination present" is the normal RESUME state after a crash mid-migration, not
  // a failure. Judging by the source would drop every already-moved clip from the manifest and
  // leave its bytes in the store referenced by nothing — which the sweep would then reclaim.
  test('resuming a half-migrated drive lists every clip exactly once', () => {
    const raw = postStep4()
    const placed = allPlaced(raw) // both bytes already moved by the interrupted run
    const m = toV5(raw, placed)
    expect(Object.keys(m.clips).sort()).toEqual(['0', '1'])
    expect(Object.values(m.clips).every((c) => c.shared)).toBe(true)
    expect(new Set(Object.values(m.clips).map((c) => c.name)).size).toBe(2)
  })

  test('carries driveId / savedAt / detail / audioSeqs through VERBATIM', () => {
    const raw = postStep4()
    const m = toV5(raw, allPlaced(raw))
    expect(m.driveId).toBe(raw.driveId)
    // ⚠ savedAt is NOT restamped — that would silently reset every rider's offline freshness TTL on
    // a copy that could be months old.
    expect(m.savedAt).toBe(raw.savedAt)
    expect(m.detail).toEqual(raw.detail)
    expect(m.audioSeqs).toEqual(raw.audioSeqs as number[])
  })

  test('NEVER returns null for a v4 — null reads to every caller as "never downloaded"', () => {
    expect(migrateV4ToV5({ version: 4 }, new Set())).not.toBeNull()
    expect(migrateV4ToV5({ version: 4, clips: {}, detail: null }, new Set())).not.toBeNull()
    expect(migrateV4ToV5(v4Manifest([], {}), new Set())).not.toBeNull()
    // a clips entry with no matching detail row (a hand-repaired manifest) is kept, drive-local
    const orphanSeq = toV5(v4Manifest([], { '7': clipFile(7) }))
    expect(orphanSeq.clips['7']).toEqual({ name: '7.m4a', contentType: M4A, durationMs: 90_000, shared: false })
  })

  test('is a no-op on a manifest that is already v5 (idempotent)', () => {
    const raw = postStep4()
    const once = toV5(raw, allPlaced(raw))
    expect(migrateV4ToV5(once, new Set(allPlaced(raw)))).toBe(once) // same object, untouched
  })

  test('drives the existing ladder: migrateToVersion walks 4 → 5 in exactly one step', () => {
    const raw = postStep4()
    const placed = new Set(allPlaced(raw))
    const walked = migrateToVersion(raw, 5, { 4: (m) => migrateV4ToV5(m, placed) })
    expect(walked?.version).toBe(5)
    expect(Object.keys(walked?.clips as Record<string, unknown>).sort()).toEqual(['0', '1'])
  })

  test('two seqs on one subject share ONE store file (the whole point of the collapse)', () => {
    const raw = v4Manifest(
      [
        { seq: 0, form: 'story', alongSec: 0, subjectId: POI_A, subjectKind: 'poi', revisedAt: REV_OLD },
        { seq: 1, form: 'story', alongSec: 60, subjectId: POI_A, subjectKind: 'poi', revisedAt: REV_OLD },
      ],
      { '0': clipFile(0), '1': clipFile(1) },
    )
    const m = toV5(raw, allPlaced(raw))
    expect(m.clips['0'].name).toBe(m.clips['1'].name)
    expect(m.clips['1'].shared).toBe(true)
  })
})

describe('storeKeepSet', () => {
  const ref = (name: string, shared: boolean): StoredClipRef => ({
    name,
    contentType: M4A,
    durationMs: null,
    shared,
  })

  test('unions the SHARED names of every manifest, verbatim', () => {
    const a = { clips: { '0': ref('poi-a.1.m4a', true), '1': ref('poi-b.1.m4a', true) } }
    const b = { clips: { '0': ref('poi-b.1.m4a', true), '5': ref('cluster-c.2.m4a', true) } }
    expect([...storeKeepSet([a, b])].sort()).toEqual(['cluster-c.2.m4a', 'poi-a.1.m4a', 'poi-b.1.m4a'])
  })

  test('EXCLUDES drive-local names — they live elsewhere, and admitting one could mark a real orphan live', () => {
    const a = { clips: { '0': ref('poi-a.1.m4a', true), '1': ref('1.m4a', false) } }
    expect([...storeKeepSet([a])]).toEqual(['poi-a.1.m4a'])
  })

  test('an empty set of manifests keeps nothing — the caller must not read that as "sweep it all"', () => {
    expect(storeKeepSet([]).size).toBe(0)
  })
})

describe('orphanStoreNames (decides DELETIONS of rider-owned audio)', () => {
  const A = `poi-${POI_A}.1750000000000.m4a`
  const B = `poi-${POI_B}.1750000000000.m4a`
  const C = `cluster-${CLUSTER_A}.1750000000000.m4a`

  test('keeps what a manifest names and returns what none does', () => {
    expect(orphanStoreNames([A, B, C], [A, C])).toEqual([B])
  })

  test('never returns a subject that is mid-write', () => {
    // A subject being fetched is referenced by NO manifest yet — the manifest is the commit point —
    // so a naive keep-set calls it an orphan and deletes it under the downloader.
    expect(orphanStoreNames([A, B], [], [B])).toEqual([A])
  })

  // ⚠ FORWARD-COMPAT. A name this build cannot parse is exactly the case where "we don't know" must
  // mean "don't touch": a leak is recoverable, a deleted download in a dead zone is not.
  test('never returns a name it cannot parse', () => {
    const unknowns = ['refcounts.json', '0.m4a', `poi-${POI_A}.v2-1750000000000.m4a`, 'poi-nope.1.m4a', '.DS_Store']
    expect(orphanStoreNames([...unknowns, B], [])).toEqual([B])
  })

  // The same hazard driveIdsToSweep documents, one level down and with worse stakes. An unreadable
  // manifest contributes ZERO names, so an empty keep-set must never be read as "nothing is
  // referenced" — the CALLER is fail-closed and deletes nothing at all when any manifest fails to
  // load, when a download is in flight, or when the keep-set comes out empty.
  test('an EMPTY keep-set sweeps EVERYTHING — the abort is the caller’s guarantee', () => {
    expect(orphanStoreNames([A, B, C], []).sort()).toEqual([A, C, B].sort())
  })

  test('a duplicated listing entry is only reported once', () => {
    expect(orphanStoreNames([A, A], [])).toEqual([A])
  })

  test('composed with storeKeepSet: a byte two drives share is never swept when one is removed', () => {
    const remaining = { clips: { '0': { name: A, contentType: M4A, durationMs: null, shared: true } } }
    expect(orphanStoreNames([A, B], storeKeepSet([remaining]))).toEqual([B])
  })
})

describe('resolveClipRef — a failed top-up must not retire a playable stop', () => {
  const planned: StoredClipRef = { name: 'poi-a.2000.m4a', contentType: 'audio/mp4', durationMs: 9, shared: true }
  const saved: StoredClipRef = { name: 'poi-a.1000.m4a', contentType: 'audio/mp4', durationMs: 9, shared: true }

  test('the planned byte landed — use it, nothing missing', () => {
    expect(resolveClipRef(planned, true, saved, true)).toEqual({ ref: planned, missing: false })
  })

  // ⚠ THE ONE THAT MATTERS. A re-synth changes the planned FILENAME (the revision is part of it), so a
  // background top-up on thin signal fetches the new name, fails, and finds it absent — while the OLD
  // bytes sit on disk playing fine. Dropping the seq here would rewrite the manifest without it,
  // orphan those bytes, and hand them to the sweep, which deletes the rider's only copy. The rider
  // then hears 400ms of nothing at that stop, in a dead zone, with no note.
  test('the planned byte is ABSENT but the saved one is present — KEEP the saved one, still report missing', () => {
    expect(resolveClipRef(planned, false, saved, true)).toEqual({ ref: saved, missing: true })
  })

  test('neither is present — no ref, missing', () => {
    expect(resolveClipRef(planned, false, saved, false)).toEqual({ ref: null, missing: true })
  })

  test('a first download (nothing saved yet) is unaffected', () => {
    expect(resolveClipRef(planned, true, undefined, false)).toEqual({ ref: planned, missing: false })
    expect(resolveClipRef(planned, false, undefined, false)).toEqual({ ref: null, missing: true })
  })

  // `missing` stays true on the carry-forward so the "N left to save" chip fires: the rider is told
  // their copy is behind, they are just not silently robbed of it in the meantime.
  test('a carried-forward clip is STILL counted missing, so the rider is told', () => {
    expect(resolveClipRef(planned, false, saved, true).missing).toBe(true)
  })
})
