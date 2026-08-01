// Offline DRIVE download (Phase 3) — persist a complete drive to disk so it plays with ZERO
// network. Tahoe has dead zones, so offline-first is a hard product requirement.
//
// A drive's manifest (GET /drives/:id) carries its clips' presigned URLs INLINE, so a download
// needs no separate sign call: fetch the manifest, then download every clip's BYTES to the
// PERSISTENT document dir (Paths.document — NOT Paths.cache, which the OS can evict). Presigned R2
// URLs die in ~1h, so we store the BYTES, not the URLs.
//
// Robustness: the manifest stores RELATIVE filenames, not absolute `file://` URIs — the document
// container path can change across app updates, so URIs are reconstructed from `Paths.document` at
// read time. API (SDK-56 expo-file-system): `File`/`Directory`/`Paths`;
// `File.downloadFileAsync(url, destFile)` (static) → a File with `.uri`/`.exists`/`.size`;
// `dir.create({intermediates,idempotent})`; `file.write(str)`/`file.textSync()`/`file.delete()`.

import { Directory, File, Paths } from 'expo-file-system'
import type { DriveClip, DriveManifest, DriveSummary } from '@skipper/shared'
import { getDrive, signDriveAudio } from './api'
import { abortError, assertFreeSpaceFor, downloadFileWithRetry } from './download'
import {
  contentSignature,
  expectedAudioSeqs,
  extForContentType,
  hasDownloadableAudio,
  driveIdsToSweep,
  isPastTtl,
  migrateToVersion,
  missingAudioSeqs,
  type ManifestMigration,
  urlMapFromDriveManifest,
  urlMapFromDriveSigned,
} from './offline-util'

// Manifest schema version. ⚠ Bumping this is NOT a free action — see MANIFEST_MIGRATIONS below. An
// additive change should get a migration, not a bump that silently invalidates every saved download
// on the next app update. Only a genuine shape break, where saved bytes cannot be reinterpreted,
// should invalidate — and even then the bytes stay reclaimable via `downloadDirState`.
// v3: V2 reshape — the embedded `detail` is now a DRIVE manifest (flat clips[] keyed by seq, with
// per-clip `revisedAt`), not a tour detail; a v2 download is a different shape → invalidated.
// v4: + `audioSeqs` (the expected downloadable seqs, so completeness survives the strip below) AND the
// detail's presigned clip `url`s are NULLED on disk — a short-TTL credential never belongs in a
// backed-up manifest (audit #9). Both are shape changes → a v3 download re-downloads.
const MANIFEST_VERSION = 4

/** A downloaded clip — a RELATIVE filename within the drive dir (NOT an absolute uri). */
interface ClipFile {
  name: string
  contentType: string
  durationMs: number | null
}

export interface OfflineManifest {
  driveId: string
  /** Manifest schema version (MANIFEST_VERSION) — a mismatch invalidates the download. */
  version: number
  /** When this download was captured (ISO). */
  savedAt: string
  /** The full drive manifest (route/clips/geometry) — zero-network playback. The clips' presigned
   *  `url`s are STRIPPED (nulled) on disk — a short-TTL credential never belongs in a backed-up file, and
   *  offline playback reads the local file map below, never these. (audit #9) */
  detail: DriveManifest
  /** The player seqs this drive SHOULD have audio for (captured at download time, BEFORE the url strip),
   *  so completeness survives a restart even though `detail`'s urls are gone. `audioSeqs` minus the
   *  `clips` keys = the missing set. (audit #1 / #9) */
  audioSeqs: number[]
  /** Keyed by the player seq (string) — one entry per place narration that LANDED. */
  clips: Record<string, ClipFile>
}

// NOTE: clips live under Paths.document (survives restarts; NOT cache-evicted) but are INCLUDED in
// iCloud/iTunes backups — SDK 56's File API exposes no isExcludedFromBackup setter from JS, so a
// Tahoe drive's tens of MB of re-downloadable audio inflates backups until that lands (then exclude
// via a native config plugin or a backup-excluded subpath). (audit #508)
function driveDir(driveId: string): Directory {
  return new Directory(Paths.document, 'drives', driveId)
}
function manifestFile(driveId: string): File {
  return new File(driveDir(driveId), 'manifest.json')
}
/** Reconstruct a clip's local `file://` uri from the (relative) manifest name. */
function clipUri(driveId: string, clip: ClipFile): string {
  return new File(driveDir(driveId), clip.name).uri
}

/** The player seq a clip maps to — every place narration under its own seq (V2 has no placeless
 *  framing; see docs/decisions/geometry-first-regions.md). Mirrors offline-util's
 *  urlMapFromDriveManifest so the on-disk keys line up with the online url map. */
function clipSeq(c: DriveClip): number {
  return c.seq
}

export interface DownloadProgress {
  done: number
  total: number
}

/** The outcome of a download run — partial-tolerant: a single clip failing leaves the rest saved.
 *  `failedSeqs` is empty on a complete download. The drive is PLAYABLE (manifest written) as long as
 *  at least one clip landed; the UI uses these to show "downloaded N of M" + offer a re-pull. */
export interface DownloadResult {
  manifest: OfflineManifest
  downloaded: number
  total: number
  /** Player seqs whose clip failed to download/verify. */
  failedSeqs: number[]
}

/** Build the flat list of clips to download from a drive manifest (every clip that has audio). */
function clipsToDownload(detail: DriveManifest): {
  key: string
  url: string
  contentType: string
  durationMs: number | null
  name: string
}[] {
  const out: { key: string; url: string; contentType: string; durationMs: number | null; name: string }[] = []
  for (const c of detail.clips) {
    if (!hasDownloadableAudio(c)) continue // a silent beat (rest) carries no audio — nothing to fetch
    const seq = clipSeq(c)
    out.push({
      key: String(seq),
      url: c.url,
      contentType: c.contentType,
      durationMs: c.durationMs ?? null,
      name: `${seq}.${extForContentType(c.contentType)}`,
    })
  }
  return out
}

const DOWNLOAD_CONCURRENCY = 4

// The per-clip transfer (timeout, retry/backoff, nonzero-size verify, cancel semantics) and the
// free-space guard live in ./download — extracted so a second downloader can never drift from this
// one. `InsufficientStorageError` is re-exported because the drive-detail screen catches it
// by name and this module is its established import site.
export { InsufficientStorageError } from './download'

// In-flight downloads by driveId — dedupes concurrent downloadDrive calls for the same drive so two
// taps (a fast double-select before React commits the busy state) can't race on the same files (one
// run's failure-cleanup wiping the other's bytes). Cleared in finally. (audit #825)
const inFlight = new Map<string, Promise<DownloadResult>>()

/**
 * Download a drive (manifest + clip bytes) to persistent storage and write the manifest. PARTIAL-
 * TOLERANT (H2): a single clip's download/verify failure no longer aborts the run or wipes the whole
 * dir — the failed clip is skipped, the rest stay saved, and the result carries `downloaded`/`total`/
 * `failedSeqs` so the rider keeps the clips that landed (worst case a dead zone) and can re-pull the
 * stragglers. The manifest is written covering only the clips that succeeded, so a partial download
 * plays its saved stops and silently skips the missing ones (the player already no-ops a clip with no
 * url). Throws ONLY when the run can't start (manifest fetch failed / no audio / no free space) or
 * EVERY clip failed (a true network-down — nothing to save) or it was canceled. Pass `signal` to
 * cancel (navigation away / a Cancel tap). Concurrent calls for the same drive share one in-flight
 * run. Needs network + a signed-in account (the /drives tier check enforces it — a drive is owned).
 */
export function downloadDrive(
  driveId: string,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  const existing = inFlight.get(driveId)
  if (existing) return existing
  const p = runDownload(driveId, onProgress, signal).finally(() => {
    if (inFlight.get(driveId) === p) inFlight.delete(driveId)
  })
  inFlight.set(driveId, p)
  return p
}

async function runDownload(
  driveId: string,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  if (signal?.aborted) throw abortError()
  // Fetch the manifest FIRST (network; clips come pre-signed). If offline (a dead-zone "Update"
  // tap), this throws here — BEFORE we touch the existing download, so the saved copy survives a
  // failed re-pull attempt.
  const detail = await getDrive(driveId)

  // Clean re-pull: drop any prior download now that the network is confirmed, so an "Update" can't
  // fail on DestinationAlreadyExists (downloadFileAsync's exists-check runs AFTER the bytes transfer,
  // burning bandwidth then throwing) and then have the catch wipe the good copy. No back-compat
  // needed (clean destructive) — also drops stale clips from an old cut. (audit #3)
  deleteDriveDownload(driveId)

  const dir = driveDir(driveId)
  dir.create({ intermediates: true, idempotent: true })

  const items = clipsToDownload(detail)
  const total = items.length
  if (total === 0) throw new Error('This drive has no audio to download.')

  // Pre-flight free-space check, so a doomed download fails fast with an actionable message instead
  // of a misleading "network" error after filling the disk. (audit #174)
  assertFreeSpaceFor(items.map((it) => it.durationMs))

  let attempted = 0
  onProgress?.({ done: attempted, total })

  const results = new Map<string, ClipFile>()
  const failed = new Map<string, number>() // item.key → player seq, for the partial result
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      if (signal?.aborted) throw abortError() // a cancel tap aborts the whole run, not just a clip
      const item = items[next++]!
      const dest = new File(dir, item.name)
      try {
        // Retries a transient blip (timeout/5xx/dropped/zero-byte) with backoff + a nonzero-size verify
        // before giving up — so one flaky moment doesn't permanently drop a clip. (audit #1 / #3)
        await downloadFileWithRetry(item.url, dest, item.name, signal)
        results.set(item.key, { name: item.name, contentType: item.contentType, durationMs: item.durationMs })
      } catch {
        // The OUTER signal is the ONLY terminal failure: a USER CANCEL aborts the whole run — re-throw
        // so the catch below sweeps the partial dir. Any OTHER failure means the retries were exhausted
        // (a persistent timeout/5xx), which is PARTIAL-TOLERANT (H2): drop just this clip's file, record
        // the seq, and keep going so one bad clip in a dead zone doesn't cost the rider the whole tour.
        // The gap is NOT silent — the saved manifest's `detail` still lists the failed clip, so
        // offlineStatus() re-derives it after a restart (audit #1).
        if (signal?.aborted) throw abortError()
        try {
          if (dest.exists) dest.delete() // a truncated/zero-byte file must not read as a saved clip
        } catch {}
        failed.set(item.key, Number(item.key))
      }
      attempted += 1
      onProgress?.({ done: attempted, total })
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, items.length) }, () => worker()),
    )
    // EVERY clip failed → a true network-down, nothing worth saving. Sweep the (empty) dir and throw
    // so the caller shows the generic download error rather than a hollow "downloaded 0 of N".
    if (results.size === 0) {
      try {
        dir.delete()
      } catch {}
      throw new Error('Download failed — no clips could be saved.')
    }
    // Write the manifest INSIDE the try — a manifest-write failure must also sweep the
    // (verified-but-orphaned) clip files, or they'd leak with no manifest to find them. The manifest
    // covers ONLY the clips that landed; `clipsPresentOnDisk` confirms those SAVED clips still play,
    // while `offlineStatus`/`missingAudioSeqs` diff `audioSeqs` (the expected set) against them — so a
    // partial download stays playable AND surfaces as partial after a restart.
    //
    // Capture `audioSeqs` from the FRESH detail (urls intact) BEFORE stripping, then NULL the detail's
    // presigned clip URLs for disk — a short-TTL credential must not sit in a backed-up manifest, and
    // offline playback uses the local file map, never these. (audit #1 / #9)
    const audioSeqs = expectedAudioSeqs(detail.clips)
    const manifest: OfflineManifest = {
      driveId,
      version: MANIFEST_VERSION,
      savedAt: new Date().toISOString(),
      detail: { ...detail, clips: detail.clips.map((c) => ({ ...c, url: null })) },
      audioSeqs,
      clips: Object.fromEntries(results),
    }
    manifestFile(driveId).write(JSON.stringify(manifest))
    return {
      manifest,
      downloaded: results.size,
      total,
      failedSeqs: Array.from(failed.values()),
    }
  } catch (e) {
    // A cancel / manifest-write failure / total network-down — sweep the dir so it can't read as
    // ready (and no orphaned clips leak), then surface the error. (A PARTIAL download never reaches
    // here: single-clip failures are absorbed in the worker above.)
    try {
      dir.delete()
    } catch {}
    throw e
  }
}

/** Is this object a manifest THIS build can hand to the player? Shape, not just version — a
 *  half-written file must not reach the player as a crash (a missing `detail`/`audioSeqs`). */
function isCurrentManifest(m: unknown): m is OfflineManifest {
  const x = m as OfflineManifest | null
  return Boolean(
    x &&
      x.version === MANIFEST_VERSION &&
      x.detail &&
      Array.isArray(x.detail.clips) &&
      Array.isArray(x.audioSeqs) &&
      typeof x.clips === 'object',
  )
}

/**
 * Forward migrations, keyed by the version being migrated FROM. Each returns the manifest one
 * version newer (with `version` bumped) or null if this particular download can't be carried across.
 *
 * ⚠ THE POINT OF THIS TABLE is that bumping MANIFEST_VERSION used to be a silent data-loss event:
 * the old gate was `version !== MANIFEST_VERSION → null`, and all seven callers read null as "never
 * downloaded". So an app update turned every saved drive into a drive that vanishes from the offline
 * list, error-walls its detail screen in a dead zone, and silently downgrades the live player to
 * streaming — while tens of MB of perfectly good audio stayed on disk with nothing able to find it.
 * The rider updates in town and finds nothing in Tahoe. It has already happened twice (v2→v3, v3→v4).
 *
 * So: an ADDITIVE change gets a migration here, not a bump-and-wipe. Only a genuine shape break —
 * where the saved bytes truly cannot be reinterpreted — is allowed to invalidate, and even then the
 * bytes stay reclaimable through `downloadDirState` rather than becoming invisible.
 *
 * Empty today: v2 and v3 were real reshapes (see the MANIFEST_VERSION note above) and no v4 successor
 * exists yet. The seam is here so the next one has somewhere obvious to go.
 */
const MANIFEST_MIGRATIONS: Record<number, ManifestMigration> = {}

/** Read the manifest from disk, migrating an older format forward when we know how. Null if absent,
 *  corrupt, or a format this build genuinely can't carry across. */
export function loadManifest(driveId: string): OfflineManifest | null {
  const f = manifestFile(driveId)
  if (!f.exists) return null
  let raw: unknown
  try {
    raw = JSON.parse(f.textSync())
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null

  const startedAt = (raw as Record<string, unknown>).version
  // The walk itself is pure + unit-tested in offline-util (it is what stands between an app update
  // and a rider's saved drives); this file only supplies the file, the table and the shape check.
  const m = migrateToVersion(raw as Record<string, unknown>, MANIFEST_VERSION, MANIFEST_MIGRATIONS)
  if (!m || !isCurrentManifest(m)) return null
  // Persist the upgrade so the walk is a one-time cost per download, never per read.
  if (m.version !== startedAt) {
    try {
      manifestFile(driveId).write(JSON.stringify(m))
    } catch {
      // Best-effort: failing to persist costs a re-migration next read, never the download.
    }
  }
  return m
}

/**
 * Rebuild a readable manifest around audio that is ALREADY on disk, without re-downloading it.
 *
 * The case this exists for: a download whose manifest is unreadable — a version with no migration
 * across, or a file lost to a hard kill mid-run (runDownload's catch sweeps, but a SIGKILL doesn't
 * run it). Deleting there would throw away the EXPENSIVE half (hundreds of MB, minutes of transfer)
 * to fix the CHEAP half (a few KB of re-fetchable JSON). The clip files are named deterministically
 * from the seq, so a fresh manifest is all that's needed to adopt them again.
 *
 * NON-DESTRUCTIVE: it only ever writes a manifest. Nothing is deleted, so a repair that turns out to
 * be wrong costs nothing — unlike a sweep, which forecloses shipping the missing migration later.
 *
 * Safe even when the saved bytes are an OLDER cut: `savedAt` is taken from the download's own mtime
 * where the OS reports it (a repaired copy must not read as freshly downloaded, or the freshness TTL
 * is quietly reset), and the content diff still flags a superseded cut afterwards and offers the
 * re-pull. Worst case is playable-but-flagged audio, which in a dead zone beats nothing.
 *
 * Partial-tolerant: whatever is present is adopted, and `audioSeqs` records what SHOULD be there, so
 * the gap resurfaces as the usual "N left to save". Needs network (the manifest fetch) and returns
 * null when nothing on disk could be matched — the caller then offers a real download or a remove.
 */
export async function repairDownload(driveId: string): Promise<OfflineStatus | null> {
  const dir = driveDir(driveId)
  let exists = false
  try {
    exists = dir.exists
  } catch {
    exists = false
  }
  if (!exists) return null

  // Fetch BEFORE touching disk (the ordering rule the whole file follows): a repair attempted in a
  // dead zone must leave the download exactly as it found it.
  const detail = await getDrive(driveId)

  const clips: Record<string, ClipFile> = {}
  for (const item of clipsToDownload(detail)) {
    try {
      const f = new File(dir, item.name)
      if (f.exists && (f.size ?? 0) > 0) {
        clips[item.key] = { name: item.name, contentType: item.contentType, durationMs: item.durationMs }
      }
    } catch {}
  }
  if (Object.keys(clips).length === 0) return null // nothing salvageable — not a repair, a download

  // Date the copy from the bytes, not from now — a repaired download must not read as freshly
  // pulled, or the freshness TTL is silently reset on a copy that could be months old. The dir's
  // mtime is roughly when the last clip landed. `modificationTime` is optional on DirectoryInfo, so
  // fall back to now rather than invent a timestamp.
  let savedAt = new Date().toISOString()
  try {
    const mtime = dir.info().modificationTime
    if (typeof mtime === 'number' && Number.isFinite(mtime) && mtime > 0) {
      savedAt = new Date(mtime).toISOString()
    }
  } catch {}

  const manifest: OfflineManifest = {
    driveId,
    version: MANIFEST_VERSION,
    savedAt,
    // Same url strip as a real download — a short-TTL credential never belongs in a backed-up file.
    detail: { ...detail, clips: detail.clips.map((c) => ({ ...c, url: null })) },
    audioSeqs: expectedAudioSeqs(detail.clips),
    clips,
  }
  manifestFile(driveId).write(JSON.stringify(manifest))
  return offlineStatus(driveId)
}

/** Whether a drive has bytes on disk, INDEPENDENT of whether this build can read their manifest.
 *  `unreadable` is the state the version gate used to hide: a real download, occupying real space,
 *  that `loadManifest` reports as nothing. Surfacing it is what keeps the reclaim affordance
 *  reachable — see the drive-detail ⋯ menu. */
export type DownloadDirState = 'none' | 'unreadable' | 'ok'

export function downloadDirState(driveId: string): DownloadDirState {
  let exists = false
  try {
    exists = driveDir(driveId).exists
  } catch {
    exists = false
  }
  if (!exists) return 'none'
  return loadManifest(driveId) ? 'ok' : 'unreadable'
}

/** Every clip the manifest references is present on disk + nonzero. */
function clipsPresentOnDisk(driveId: string, m: OfflineManifest): boolean {
  const clips = Object.values(m.clips)
  if (clips.length === 0) return false
  return clips.every((c) => {
    const f = new File(driveDir(driveId), c.name)
    return f.exists && (f.size ?? 0) > 0
  })
}

/** Build the seq → local `file://` url map from a downloaded manifest. Keys (incl. the frame
 *  sentinels) were baked in at download time, so this is a direct projection. */
function localUrlMap(driveId: string, m: OfflineManifest): Map<number, string> {
  const urls = new Map<number, string>()
  for (const [seqStr, c] of Object.entries(m.clips)) {
    const seq = Number(seqStr)
    if (Number.isFinite(seq)) urls.set(seq, clipUri(driveId, c)) // skip a tampered non-numeric key
  }
  return urls
}

/** Whether a drive has a usable offline copy AND, for a PARTIAL download, which clips never landed. */
export interface OfflineStatus {
  /** A playable copy exists: a valid manifest with its SAVED clips present on disk. True even for a
   *  PARTIAL download (it plays the stops it has) — read `missingSeqs` to tell partial from complete. */
  downloaded: boolean
  /** Expected-but-missing clip seqs — EMPTY means a COMPLETE download. Derived from the SAVED manifest
   *  (`audioSeqs` lists every expected clip; `clips` holds only those that landed), so it survives an app
   *  restart, unlike the in-memory DownloadResult.failedSeqs. (audit #1) */
  missingSeqs: number[]
  /** Total clips this drive should have audio for. */
  expectedCount: number
}

/**
 * The on-disk offline status for a drive (ZERO network): whether a playable copy exists and, for a
 * partial download, the gap. null when nothing playable is on disk. This is the restart-safe successor
 * to a bare downloaded? boolean — a half-downloaded drive used to read as a clean "Saved offline" once
 * the in-memory download result was gone (audit #1); now the gap is re-derived from the manifest itself.
 */
export function offlineStatus(driveId: string): OfflineStatus | null {
  const m = loadManifest(driveId)
  if (!m || !clipsPresentOnDisk(driveId, m)) return null
  const savedSeqs = Object.keys(m.clips).map(Number).filter(Number.isFinite)
  return {
    downloaded: true,
    missingSeqs: missingAudioSeqs(m.audioSeqs, savedSeqs),
    expectedCount: m.audioSeqs.length,
  }
}

/**
 * Is a downloaded drive's audio STALE vs the server's current content? Compares the content tokens
 * embedded in the saved manifest against a freshly-fetched manifest. ONLINE-ONLY by nature — the
 * caller already holds the fresh manifest (the drive screen fetches it to render), so this costs
 * ZERO extra network and is never run in a dead zone. Returns false when nothing is downloaded.
 * NEVER blocks playback: it only powers a "pull the fresh copy" affordance.
 */
export function isDownloadStale(driveId: string, fresh: DriveManifest): boolean {
  const m = loadManifest(driveId)
  if (!m) return false
  return contentSignature(m.detail) !== contentSignature(fresh)
}

// Offline downloads never auto-refresh: the device keeps its saved bytes indefinitely, so a
// facts_hash move / patch-clip / resynth never reaches an already-downloaded drive UNLESS the rider
// re-opens the detail screen while online (that's isDownloadStale's content-diff). OFFLINE_TTL_DAYS
// is the time-based safety net that fires INDEPENDENT of that diff — even on a drive saved once and
// never re-opened, or held in a dead zone where no fresh fetch is possible. SOFT by design: the copy
// stays playable past expiry (never strand a rider mid-Tahoe — see CLAUDE.md), it just nudges a
// re-download. A starting value, ear/usage-tunable like the facts TTL. Secondary benefit: it bounds
// how long a baked Places break-name persists offline. Decision: docs/decisions/offline-freshness-ttl.md.
export const OFFLINE_TTL_DAYS = 30

/**
 * Is a downloaded drive past its freshness TTL (OFFLINE_TTL_DAYS)? Reads ONLY the saved manifest's
 * `savedAt` (zero network), so unlike isDownloadStale it fires even in a dead zone. SOFT — never
 * blocks playback; it only powers an "expired — re-download" nudge. False when nothing's downloaded
 * or the timestamp is unparseable (the date math is offline-util's `isPastTtl`, unit-tested).
 */
export function isDownloadExpired(driveId: string): boolean {
  const m = loadManifest(driveId)
  return m != null && isPastTtl(m.savedAt, Date.now(), OFFLINE_TTL_DAYS)
}

/** A downloaded manifest projected to a drive list-card (the home "My Drives" shape). */
function summaryFromManifest(m: OfflineManifest): DriveSummary {
  const d = m.detail
  return {
    driveId: d.driveId ?? m.driveId,
    label: d.label,
    startName: null,
    endName: null,
    distanceMeters: d.distanceMeters ?? null,
    durationSeconds: d.durationSeconds ?? null,
    clipCount: d.clips.length,
    createdAt: m.savedAt,
  }
}

/**
 * Every fully-downloaded drive as a list-card, read from disk with ZERO network. Powers the home
 * screen's offline-first fallback: when the /drives fetch fails in a dead zone, the saved drives
 * stay browsable (and reachable) instead of a blank error wall.
 */
export function listDownloadedDrives(): DriveSummary[] {
  const root = new Directory(Paths.document, 'drives')
  if (!root.exists) return []
  const out: DriveSummary[] = []
  for (const entry of root.list()) {
    // drive dirs only; each dir name IS the driveId. A complete download = valid manifest + clips on disk.
    if (!(entry instanceof Directory)) continue
    try {
      const m = loadManifest(entry.name)
      if (m && clipsPresentOnDisk(entry.name, m)) out.push(summaryFromManifest(m))
    } catch {
      // A drive dir torn down mid-scan (deleteDriveDownload / a failed re-pull's cleanup) can make a
      // File.exists/size throw — skip that entry rather than aborting the whole offline catalog,
      // which would error-wall the home screen out of its dead-zone fallback. (audit #843)
    }
  }
  return out
}

/* -------------------------------------------------------------------------- */
/*  Reclaiming downloads that are no longer the rider's (founder OK 2026-07-31) */
/* -------------------------------------------------------------------------- */

/** Every drive dir currently on disk, by driveId (each dir name IS the driveId). Version-blind on
 *  purpose — this is about what OCCUPIES SPACE, not about what this build happens to be able to read. */
function downloadedDriveIds(): string[] {
  const root = new Directory(Paths.document, 'drives')
  try {
    if (!root.exists) return []
    return root.list().flatMap((e) => (e instanceof Directory ? [e.name] : []))
  } catch {
    return []
  }
}

/**
 * Delete EVERY drive download on this device. Returns how many were reclaimed.
 *
 * For account deletion, and only that. `purgeUserData` erases the server side, but the copies on the
 * phone are the same rider's data and CLAUDE.md is unambiguous that erasure is immediate and total —
 * and after `deleteUser` the rider is anonymous, so home takes its signed-out branch and
 * `listDownloadedDrives` would hand the deleted account's drives to whoever picks the phone up next.
 * Those copies are also permanently unreclaimable by any other path: the server rows are gone, so no
 * future drive list can ever mention them for `sweepUnknownDownloads` to act on.
 *
 * ⚠ Deliberately does NOT touch the legacy roam pack — that is `reclaimLegacyRoamPack`'s job, and it
 * runs for EVERY rider at launch, not only one deleting an account.
 */
export function deleteAllDriveDownloads(): number {
  // Keep NOTHING. Still excludes an in-flight download, which would otherwise have its files pulled
  // out from under the downloader mid-verify.
  const doomed = driveIdsToSweep(downloadedDriveIds(), [], inFlight.keys())
  for (const driveId of doomed) deleteDriveDownload(driveId)
  return doomed.length
}

/** Remove a drive's offline download (manifest + clips). Idempotent. */
export function deleteDriveDownload(driveId: string): void {
  const dir = driveDir(driveId)
  if (dir.exists) {
    try {
      dir.delete()
    } catch {}
  }
}

/* -------------------------------------------------------------------------- */
/*  Playback resolution — offline-first, with the online stream as fallback     */
/* -------------------------------------------------------------------------- */

export interface Playback {
  detail: DriveManifest
  /** seq → uri (local `file://` when downloaded, presigned https when streaming). */
  urls: Map<number, string>
  /** true when served entirely from disk (no network used to load). */
  offline: boolean
}

/**
 * Load a drive for playback, OFFLINE-FIRST: if a complete download exists, return the manifest +
 * local `file://` uris with ZERO network. Otherwise fetch the manifest (clips pre-signed inline) and
 * stream online.
 */
export async function loadPlayback(driveId: string): Promise<Playback> {
  const m = loadManifest(driveId) // load ONCE (don't check-then-reload the manifest)
  if (m && clipsPresentOnDisk(driveId, m)) {
    return { detail: m.detail, urls: localUrlMap(driveId, m), offline: true }
  }
  const detail = await getDrive(driveId)
  return { detail, urls: urlMapFromDriveManifest(detail), offline: false }
}

/**
 * A fresh url map for the stall-recovery path. When the drive is downloaded it returns the LOCAL
 * file:// map (which never expires — and re-points a player that loaded ONLINE at the now-downloaded
 * files); otherwise it re-signs the presigned URLs (~1h TTL). Always returns a map.
 */
export async function resignPlayback(driveId: string): Promise<Map<number, string>> {
  const m = loadManifest(driveId)
  if (m && clipsPresentOnDisk(driveId, m)) return localUrlMap(driveId, m)
  const signed = await signDriveAudio(driveId)
  return urlMapFromDriveSigned(signed)
}

/** One-shot reclaim of the deleted roam mode's offline pack (`Paths.document/roam-pack/`).
 *
 *  ⚠ THIS EXISTS BECAUSE DELETING A FEATURE DOES NOT DELETE ITS BYTES. Roam let a rider save the
 *  region's pins + audio — up to ~138 MB — and `deleteRoamPack()` in the (now removed) roam-pack
 *  module was the ONLY code that could ever reclaim it. `deleteAllDriveDownloads` deliberately never
 *  touched it, and the Settings row that offered "Remove saved stories" went with roam. So on every
 *  device that ever tapped Save, that directory would have become permanently unreachable garbage —
 *  invisible to the app, chargeable to the rider's storage, removable only by deleting the app.
 *
 *  Idempotent and best-effort: a missing directory is the normal case (a rider who never saved), and
 *  a failure here must never block launch. Safe to delete this function once no install predating the
 *  roam removal plausibly survives — until then it is the only thing holding the promise that
 *  uninstalling a feature gives the space back. */
export function reclaimLegacyRoamPack(): void {
  try {
    const dir = new Directory(Paths.document, 'roam-pack')
    if (dir.exists) dir.delete()
  } catch {
    // Nothing to do and nothing to report — the rider cannot act on it, and retrying next launch is free.
  }
}
