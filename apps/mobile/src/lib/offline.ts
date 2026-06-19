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
import { extForContentType, urlMapFromDriveManifest, urlMapFromDriveSigned } from './offline-util'

// Manifest schema version — bump on any shape change so a stale-format manifest left by an older
// app build reads as NOT-downloaded (and re-downloads) instead of crashing the player.
// v3: V2 reshape — the embedded `detail` is now a DRIVE manifest (flat clips[] keyed by seq, with
// per-clip `revisedAt`), not a tour detail; a v2 download is a different shape → invalidated.
const MANIFEST_VERSION = 3

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
   *  `url`s are stale on disk (and ignored — offline reads the local file map below). */
  detail: DriveManifest
  /** Keyed by the player seq (string) — one entry per place narration. */
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
    if (!c.url || !c.contentType) continue // a silent beat (rest) carries no audio — nothing to fetch
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

// Per-clip byte-transfer budget. The JSON path (getDrive) is time-boxed in api.ts, but the DOWNLOAD
// bytes were not — a half-open / slow-drip dead-zone connection would hang forever. Bound each clip
// with an AbortController so a stuck transfer rejects instead of wedging downloadDrive. (audit #2)
const CLIP_DOWNLOAD_TIMEOUT_MS = 30_000

// Rough bytes/sec for the 32 kbps MP3 clips (32 kbit/s ÷ 8), for the pre-flight free-space estimate.
const APPROX_BYTES_PER_SEC = 4_000

/** A download can't fit in free space — surfaced with a dedicated, actionable message. (audit #174) */
export class InsufficientStorageError extends Error {
  constructor(message = 'Not enough free space to download this drive.') {
    super(message)
    this.name = 'InsufficientStorageError'
  }
}

/** An AbortError shaped so callers can detect a cancel/timeout uniformly. */
function abortError(): Error {
  return Object.assign(new Error('Download canceled.'), { name: 'AbortError' })
}

/** Download one clip, bounded by a per-clip timeout AND the caller's (optional) cancel signal. (audit #2, #816) */
async function downloadClip(url: string, dest: File, outer?: AbortSignal): Promise<File> {
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  if (outer) {
    if (outer.aborted) ctrl.abort()
    else outer.addEventListener?.('abort', onAbort)
  }
  const timer = setTimeout(() => ctrl.abort(), CLIP_DOWNLOAD_TIMEOUT_MS)
  try {
    return await File.downloadFileAsync(url, dest, { signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener?.('abort', onAbort)
  }
}

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

  // Pre-flight free-space check: estimate total bytes from clip durations and require comfortable
  // headroom, so a doomed download fails fast with an actionable message instead of a misleading
  // "network" error after filling the disk. Skipped if the OS can't report free space. (audit #174)
  const estBytes = items.reduce(
    (sum, it) => sum + Math.max(0, (it.durationMs ?? 0) / 1000) * APPROX_BYTES_PER_SEC,
    0,
  )
  if (estBytes > 0) {
    let free = 0
    try {
      free = Paths.availableDiskSpace
    } catch {
      free = 0
    }
    if (Number.isFinite(free) && free > 0 && free < estBytes * 1.5 + 5_000_000) {
      throw new InsufficientStorageError()
    }
  }

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
        const out = await downloadClip(item.url, dest, signal)
        // Integrity is a PRESENCE/nonzero-size check only — no Content-Length/checksum (the manifest
        // carries no size/hash). iOS URLSession enforces a declared Content-Length (R2 object GETs
        // always send one), so a mid-body drop normally rejects in downloadClip; a server
        // short-Content-Length is the only silent-truncation gap. (audit #834)
        if (!out.exists || !out.size || out.size <= 0) {
          throw new Error(`Download verify failed for ${item.name} (exists=${out.exists}, size=${out.size}).`)
        }
        results.set(item.key, { name: item.name, contentType: item.contentType, durationMs: item.durationMs })
      } catch (e) {
        // A USER CANCEL (or the per-clip timeout firing off the outer signal) aborts the whole run —
        // re-throw so the catch below sweeps the partial dir. Any OTHER single-clip failure is
        // PARTIAL-TOLERANT (H2): drop just this clip's (possibly half-written) file, record the seq,
        // and keep going so one bad clip in a dead zone doesn't cost the rider the whole tour.
        if ((e instanceof Error && e.name === 'AbortError') || signal?.aborted) throw e
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
    // covers ONLY the clips that landed; clipsPresentOnDisk validates against this set, so a partial
    // download still reads as a (smaller) complete one and plays its saved stops.
    const manifest: OfflineManifest = {
      driveId,
      version: MANIFEST_VERSION,
      savedAt: new Date().toISOString(),
      detail,
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

/** Read the manifest from disk; null if absent, corrupt, or a stale/foreign schema version. */
export function loadManifest(driveId: string): OfflineManifest | null {
  const f = manifestFile(driveId)
  if (!f.exists) return null
  try {
    const m = JSON.parse(f.textSync()) as OfflineManifest
    // Reject a malformed or stale-format manifest → treat as not-downloaded (re-download)
    // rather than return a half-shape the player would crash on (e.g. a missing `detail`).
    if (!m || m.version !== MANIFEST_VERSION || !m.detail || !Array.isArray(m.detail.clips) || typeof m.clips !== 'object') {
      return null
    }
    return m
  } catch {
    return null
  }
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

/** True iff a complete, verified download exists (valid manifest + every clip on disk, nonzero). */
export function isDriveDownloaded(driveId: string): boolean {
  const m = loadManifest(driveId)
  return m != null && clipsPresentOnDisk(driveId, m)
}

/**
 * Fold a manifest's per-clip content tokens (`revisedAt`) + clip set into one comparable string.
 * Any drift changes it: a clip re-synth (token bumps), a regen (fresh narration → fresh token), a
 * clip added/removed (seq set changes).
 */
function contentSignature(d: DriveManifest): string {
  const clips = d.clips
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((c) => `${c.seq}:${c.revisedAt ?? ''}`)
    .join(',')
  return `clips[${clips}]`
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
  const m = loadManifest(driveId) // load ONCE (don't isDriveDownloaded() then loadManifest() again)
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
