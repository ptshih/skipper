// Offline tour download (Phase 3) — persist a complete tour to disk so it plays with
// ZERO network. Tahoe has dead zones, so offline-first is a hard product requirement.
//
// We download every clip's BYTES (stops + the intro/outro frames) to the PERSISTENT
// document dir (Paths.document — NOT Paths.cache, which the OS can evict) and write a
// manifest carrying the full drive detail, so a downloaded tour needs no network at all.
// Presigned R2 URLs die in 1h, so we store the BYTES, not the URLs.
//
// Robustness: the manifest stores RELATIVE filenames, not absolute `file://` URIs — the
// document container path can change across app updates, so URIs are reconstructed from
// `Paths.document` at read time. API (SDK-56 expo-file-system, re-verified against the
// live docs): `File`/`Directory`/`Paths`; `File.downloadFileAsync(url, destFile)` (static)
// → a File with `.uri`/`.exists`/`.size`; `dir.create({intermediates,idempotent})`;
// `file.write(str)`/`file.textSync()`/`file.delete()`.

import { Directory, File, Paths } from 'expo-file-system'
import { INTRO_SEQ, OUTRO_SEQ } from '@skipper/drive-core'
import type { TourListItem } from '@skipper/shared'
import { getTour, signTourAudio, type SignedAudio, type TourDetail } from './api'
import { extForContentType, urlMapFromSigned } from './offline-util'

// Manifest schema version — bump on any shape change so a stale-format manifest left by an
// older app build reads as NOT-downloaded (and re-downloads) instead of crashing the player.
// v2: the embedded `detail` now carries per-clip `revisedAt` content tokens (offline staleness);
// a v1 download lacked them, so it's invalidated → re-downloaded with tokens.
const MANIFEST_VERSION = 2

/** A downloaded clip — a RELATIVE filename within the tour dir (NOT an absolute uri). */
interface ClipFile {
  name: string
  contentType: string
  durationMs: number | null
}

export interface OfflineManifest {
  tourId: string
  /** Manifest schema version (MANIFEST_VERSION) — a mismatch invalidates the download. */
  version: number
  /** When this download was captured (ISO). */
  savedAt: string
  /** The full drive detail (route/anchors/region/host/intro/outro/stops) — zero-network playback. */
  detail: TourDetail
  clips: {
    /** Keyed by stop seq (string, for JSON). */
    stops: Record<string, ClipFile>
    intro: ClipFile | null
    outro: ClipFile | null
  }
}

// NOTE: clips live under Paths.document (survives restarts; NOT cache-evicted) but are INCLUDED in
// iCloud/iTunes backups — SDK 56's File API exposes no isExcludedFromBackup setter from JS, so a
// Tahoe tour's tens of MB of re-downloadable audio inflates backups until that lands (then exclude
// via a native config plugin or a backup-excluded subpath). (audit #508)
function tourDir(tourId: string): Directory {
  return new Directory(Paths.document, 'tours', tourId)
}
function manifestFile(tourId: string): File {
  return new File(tourDir(tourId), 'manifest.json')
}
/** Reconstruct a clip's local `file://` uri from the (relative) manifest name. */
function clipUri(tourId: string, clip: ClipFile): string {
  return new File(tourDir(tourId), clip.name).uri
}

export interface DownloadProgress {
  done: number
  total: number
}

/** Build the flat list of clips to download from a sign response (stops + frames). */
function clipsToDownload(signed: SignedAudio): {
  key: string
  url: string
  contentType: string
  durationMs: number | null
  name: string
}[] {
  const out: { key: string; url: string; contentType: string; durationMs: number | null; name: string }[] = []
  for (const s of signed.stops) {
    out.push({
      key: `stop:${s.seq}`,
      url: s.url,
      contentType: s.contentType,
      durationMs: s.durationMs ?? null,
      name: `${s.seq}.${extForContentType(s.contentType)}`,
    })
  }
  if (signed.intro) {
    out.push({
      key: 'intro',
      url: signed.intro.url,
      contentType: signed.intro.contentType,
      durationMs: signed.intro.durationMs ?? null,
      name: `intro.${extForContentType(signed.intro.contentType)}`,
    })
  }
  if (signed.outro) {
    out.push({
      key: 'outro',
      url: signed.outro.url,
      contentType: signed.outro.contentType,
      durationMs: signed.outro.durationMs ?? null,
      name: `outro.${extForContentType(signed.outro.contentType)}`,
    })
  }
  return out
}

const DOWNLOAD_CONCURRENCY = 4

// Per-clip byte-transfer budget. The JSON paths (getTour/sign) are time-boxed in api.ts, but the
// DOWNLOAD bytes were not — a half-open / slow-drip dead-zone connection would hang forever. Bound
// each clip with an AbortController so a stuck transfer rejects instead of wedging downloadTour. (audit #2)
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

// In-flight downloads by tourId — dedupes concurrent downloadTour calls for the same tour so two
// taps (a fast double-select before React commits the busy state) can't race on the same files (one
// run's failure-cleanup wiping the other's bytes). Cleared in finally. (audit #825)
const inFlight = new Map<string, Promise<OfflineManifest>>()

/**
 * Download a complete tour (detail + every clip's bytes) to persistent storage and write the
 * manifest. Throws if any clip fails to download/verify (a half-download must never read as "ready");
 * on failure the partial dir is removed. Pass `signal` to cancel (navigation away / a Cancel tap).
 * Concurrent calls for the same tour share one in-flight run. Needs network + (for a non-preview
 * tour) a signed-in account — the /tours + /sign tier check enforces it.
 */
export function downloadTour(
  tourId: string,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<OfflineManifest> {
  const existing = inFlight.get(tourId)
  if (existing) return existing
  const p = runDownload(tourId, onProgress, signal).finally(() => {
    if (inFlight.get(tourId) === p) inFlight.delete(tourId)
  })
  inFlight.set(tourId, p)
  return p
}

async function runDownload(
  tourId: string,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<OfflineManifest> {
  if (signal?.aborted) throw abortError()
  // Fetch + sign FIRST (network). If offline (a dead-zone "Update" tap), this throws here — BEFORE
  // we touch the existing download, so the saved copy survives a failed re-pull attempt.
  const detail = await getTour(tourId)
  const signed = await signTourAudio(tourId)

  // Clean re-pull: drop any prior download now that the network is confirmed, so an "Update" can't
  // fail on DestinationAlreadyExists (downloadFileAsync's exists-check runs AFTER the bytes transfer,
  // burning bandwidth then throwing) and then have the catch wipe the good copy. No back-compat
  // needed (clean destructive) — also drops stale clips from an old cut. (audit #3)
  deleteTourDownload(tourId)

  const dir = tourDir(tourId)
  dir.create({ intermediates: true, idempotent: true })

  const items = clipsToDownload(signed)
  const total = items.length
  if (total === 0) throw new Error('This tour has no audio to download.')

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

  let done = 0
  onProgress?.({ done, total })

  const results = new Map<string, ClipFile>()
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++]!
      const dest = new File(dir, item.name)
      const out = await downloadClip(item.url, dest, signal)
      // Integrity is a PRESENCE/nonzero-size check only — no Content-Length/checksum (the sign DTO
      // carries no size/hash). iOS URLSession enforces a declared Content-Length (R2 object GETs
      // always send one), so a mid-body drop normally rejects in downloadClip; a server
      // short-Content-Length is the only silent-truncation gap. (audit #834)
      if (!out.exists || !out.size || out.size <= 0) {
        throw new Error(`Download verify failed for ${item.name} (exists=${out.exists}, size=${out.size}).`)
      }
      results.set(item.key, { name: item.name, contentType: item.contentType, durationMs: item.durationMs })
      done += 1
      onProgress?.({ done, total })
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, items.length) }, () => worker()),
    )
    // Write the manifest INSIDE the try — a manifest-write failure must also sweep the
    // (verified-but-orphaned) clip files, or they'd leak with no manifest to find them.
    const manifest: OfflineManifest = {
      tourId,
      version: MANIFEST_VERSION,
      savedAt: new Date().toISOString(),
      detail,
      clips: {
        stops: Object.fromEntries(
          signed.stops
            .filter((s) => results.has(`stop:${s.seq}`))
            .map((s) => [String(s.seq), results.get(`stop:${s.seq}`)!]),
        ),
        intro: results.get('intro') ?? null,
        outro: results.get('outro') ?? null,
      },
    }
    manifestFile(tourId).write(JSON.stringify(manifest))
    return manifest
  } catch (e) {
    // Partial download / cancel / manifest-write failure — sweep the dir so it can't read as ready
    // (and no orphaned clips leak), then surface the error.
    try {
      dir.delete()
    } catch {}
    throw e
  }
}

/** Read the manifest from disk; null if absent, corrupt, or a stale/foreign schema version. */
export function loadManifest(tourId: string): OfflineManifest | null {
  const f = manifestFile(tourId)
  if (!f.exists) return null
  try {
    const m = JSON.parse(f.textSync()) as OfflineManifest
    // Reject a malformed or stale-format manifest → treat as not-downloaded (re-download)
    // rather than return a half-shape the player would crash on (e.g. a missing `detail`).
    if (!m || m.version !== MANIFEST_VERSION || !m.detail || !m.clips || typeof m.clips.stops !== 'object') {
      return null
    }
    return m
  } catch {
    return null
  }
}

/** Every clip the manifest references is present on disk + nonzero. */
function clipsPresentOnDisk(tourId: string, m: OfflineManifest): boolean {
  const clips = [...Object.values(m.clips.stops), m.clips.intro, m.clips.outro].filter(
    (c): c is ClipFile => c != null,
  )
  if (clips.length === 0) return false
  return clips.every((c) => {
    const f = new File(tourDir(tourId), c.name)
    return f.exists && (f.size ?? 0) > 0
  })
}

/** Build the seq → local `file://` url map (+ frame sentinels) from a downloaded manifest. */
function localUrlMap(tourId: string, m: OfflineManifest): Map<number, string> {
  const urls = new Map<number, string>()
  for (const [seqStr, c] of Object.entries(m.clips.stops)) {
    const seq = Number(seqStr)
    if (Number.isFinite(seq)) urls.set(seq, clipUri(tourId, c)) // skip a tampered non-numeric key
  }
  if (m.clips.intro) urls.set(INTRO_SEQ, clipUri(tourId, m.clips.intro))
  if (m.clips.outro) urls.set(OUTRO_SEQ, clipUri(tourId, m.clips.outro))
  return urls
}

/** True iff a complete, verified download exists (valid manifest + every clip on disk, nonzero). */
export function isTourDownloaded(tourId: string): boolean {
  const m = loadManifest(tourId)
  return m != null && clipsPresentOnDisk(tourId, m)
}

/**
 * Fold a detail's per-clip content tokens (`revisedAt`) + stop set + frame presence into one
 * comparable string. Any drift changes it: a clip re-synth (token bumps), a regen (fresh stop ids
 * → fresh tokens), a stop added/removed (seq set changes), a frame appearing/vanishing.
 */
function contentSignature(d: TourDetail): string {
  const stops = d.stops
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((s) => `${s.seq}:${s.revisedAt ?? ''}`)
    .join(',')
  return `stops[${stops}]|intro:${d.intro?.revisedAt ?? ''}|outro:${d.outro?.revisedAt ?? ''}`
}

/**
 * Is a downloaded tour's audio STALE vs the server's current content? Compares the content
 * tokens embedded in the saved manifest's detail against a freshly-fetched detail. ONLINE-ONLY by
 * nature — the caller already holds fresh detail (the tour screen fetches it to render), so this
 * costs ZERO extra network and is never run in a dead zone. Returns false when nothing is
 * downloaded. NEVER blocks playback: it only powers a "pull the fresh copy" affordance — offline
 * driving always plays the bytes on disk, stale or not.
 */
export function isDownloadStale(tourId: string, fresh: TourDetail): boolean {
  const m = loadManifest(tourId)
  if (!m) return false
  return contentSignature(m.detail) !== contentSignature(fresh)
}

/** A downloaded manifest's drive detail projected to a catalog list-item (the home card's shape).
 *  Detail carries no `teaser`, so the card degrades to its `summary`. */
function listItemFromDetail(d: TourDetail): TourListItem {
  return {
    id: d.tour.id,
    slug: d.tour.slug,
    headline: d.tour.headline,
    regionSlug: d.region.slug,
    regionName: d.region.displayName,
    startAnchorName: d.tour.startAnchor.name,
    endAnchorName: d.tour.endAnchor.name,
    summary: d.tour.summary,
    distanceMeters: d.tour.distanceMeters,
    durationSeconds: d.tour.durationSeconds,
    teaser: null,
  }
}

/**
 * Every fully-downloaded tour as a catalog list-item, read from disk with ZERO network.
 * Powers the home screen's offline-first fallback: when the catalog fetch fails in a dead
 * zone, the saved drives stay browsable (and reachable) instead of a blank error wall.
 */
export function listDownloadedTours(): TourListItem[] {
  const root = new Directory(Paths.document, 'tours')
  if (!root.exists) return []
  const out: TourListItem[] = []
  for (const entry of root.list()) {
    // tour dirs only; each dir name IS the tourId. A complete download = valid manifest + clips on disk.
    if (!(entry instanceof Directory)) continue
    try {
      const m = loadManifest(entry.name)
      if (m && clipsPresentOnDisk(entry.name, m)) out.push(listItemFromDetail(m.detail))
    } catch {
      // A tour dir torn down mid-scan (deleteTourDownload / a failed re-pull's cleanup) can make a
      // File.exists/size throw — skip that entry rather than aborting the whole offline catalog,
      // which would error-wall the home screen out of its dead-zone fallback. (audit #843)
    }
  }
  return out
}

/** Remove a tour's offline download (manifest + clips). Idempotent. */
export function deleteTourDownload(tourId: string): void {
  const dir = tourDir(tourId)
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
  detail: TourDetail
  /** seq → uri (local `file://` when downloaded, presigned https when streaming). */
  urls: Map<number, string>
  /** true when served entirely from disk (no network used to load). */
  offline: boolean
}

/**
 * Load a tour for playback, OFFLINE-FIRST: if a complete download exists, return the manifest's
 * detail + local `file://` uris with ZERO network. Otherwise fetch + sign and stream online.
 */
export async function loadPlayback(
  tourId: string,
  opts?: { preview?: boolean },
): Promise<Playback> {
  const m = loadManifest(tourId) // load ONCE (don't isTourDownloaded() then loadManifest() again)
  if (m && clipsPresentOnDisk(tourId, m)) {
    return { detail: m.detail, urls: localUrlMap(tourId, m), offline: true }
  }
  // `preview` streams any ready tour (the open funnel); omit it for the gated live drive.
  const detail = await getTour(tourId, opts)
  const signed = await signTourAudio(tourId, opts)
  return { detail, urls: urlMapFromSigned(signed), offline: false }
}

/**
 * A fresh url map for the stall-recovery path. When the tour is downloaded it returns the LOCAL
 * file:// map (which never expires — and re-points a player that loaded ONLINE at the
 * now-downloaded files); otherwise it re-signs the presigned URLs (~1h TTL). Always returns a map.
 */
export async function resignPlayback(
  tourId: string,
  opts?: { preview?: boolean },
): Promise<Map<number, string>> {
  const m = loadManifest(tourId)
  if (m && clipsPresentOnDisk(tourId, m)) return localUrlMap(tourId, m)
  const signed = await signTourAudio(tourId, opts)
  return urlMapFromSigned(signed)
}
