// Offline tour download (Phase 3) — persist a complete tour to disk so it plays with
// ZERO network. Tahoe has dead zones, so offline-first is a hard product requirement.
//
// We download every clip's BYTES (stops + the intro/outro brackets) to the PERSISTENT
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
import { getTour, signTourAudio, type SignedAudio, type TourDetail } from './api'
import { extForContentType, urlMapFromSigned } from './offline-util'

export { extForContentType, urlMapFromSigned }

// Manifest schema version — bump on any shape change so a stale-format manifest left by an
// older app build reads as NOT-downloaded (and re-downloads) instead of crashing the player.
const MANIFEST_VERSION = 1

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

/** Build the flat list of clips to download from a sign response (stops + brackets). */
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

/**
 * Download a complete tour (detail + every clip's bytes) to persistent storage and write
 * the manifest. Throws if any clip fails to download/verify (a half-download must never
 * read as "ready"); on failure the partial dir is removed. Needs network + (for a
 * non-preview tour) a signed-in account — the /tours + /sign tier check enforces it.
 */
export async function downloadTour(
  tourId: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<OfflineManifest> {
  const detail = await getTour(tourId)
  const signed = await signTourAudio(tourId)

  const dir = tourDir(tourId)
  dir.create({ intermediates: true, idempotent: true })

  const items = clipsToDownload(signed)
  const total = items.length
  if (total === 0) throw new Error('This tour has no audio to download.')
  let done = 0
  onProgress?.({ done, total })

  const results = new Map<string, ClipFile>()
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++]!
      const dest = new File(dir, item.name)
      const out = await File.downloadFileAsync(item.url, dest)
      // Verify on disk: a 0-byte or missing file is a failed download, not a clip.
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
    // Partial download / manifest-write failure — sweep the dir so it can't read as ready
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

/** Build the seq → local `file://` url map (+ bracket sentinels) from a downloaded manifest. */
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
