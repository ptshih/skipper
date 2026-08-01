// The shared byte-transfer primitive: fetch ONE file to disk, bounded and verified, with the
// retry/backoff/cancel semantics a dead zone demands. Extracted from offline.ts when a second caller
// appeared — a hardened downloader is exactly the thing that must not exist twice and drift.
// ⚠ That second caller (the roam pack) is gone, so offline.ts is the only one today. KEEP THE MODULE
// SPLIT anyway: the extraction is what makes a second downloader impossible to justify, and step 9's
// subject-keyed store is the next caller.
//
// API (SDK-56 expo-file-system): `File.downloadFileAsync(url, destFile, { signal })` (static) → a
// File with `.uri`/`.exists`/`.size`; `file.delete()`.

import { File, Paths } from 'expo-file-system'

// Per-file byte-transfer budget. The JSON paths are time-boxed in api.ts, but the DOWNLOAD bytes
// were not — a half-open / slow-drip dead-zone connection would hang forever. Bound each transfer
// with an AbortController so a stuck one rejects instead of wedging the whole run. (audit #2)
export const CLIP_DOWNLOAD_TIMEOUT_MS = 30_000

// A TRANSIENT failure (a 5xx, a momentary dead-zone drop, a slow-drip timeout, a zero-byte landing)
// is RETRIED with backoff before the file is given up — one network blip must not permanently drop a
// clip from an otherwise-good copy (which, combined with a partial-tolerant manifest, would then read
// as a COMPLETE download after a restart). A real CANCEL (the outer signal) is never retried.
// (audit #1 / #3)
export const CLIP_DOWNLOAD_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 400

// Rough bytes/sec for the 64 kbps AAC (.m4a) clips (64 kbit/s ÷ 8), for pre-flight free-space
// estimates. Deliberately not read from the encoder's AAC_BITRATE — that constant lives in the
// studio pipeline and this is a client-side estimate with a 1.5× safety factor on top.
export const APPROX_BYTES_PER_SEC = 8_000

/** A download can't fit in free space — surfaced with a dedicated, actionable message. (audit #174) */
export class InsufficientStorageError extends Error {
  constructor(message = 'Not enough free space to download this drive.') {
    super(message)
    this.name = 'InsufficientStorageError'
  }
}

/** An AbortError shaped so callers can detect a cancel/timeout uniformly. */
export function abortError(): Error {
  return Object.assign(new Error('Download canceled.'), { name: 'AbortError' })
}

/** Download one file, bounded by a per-file timeout AND the caller's (optional) cancel signal. (audit #2, #816) */
async function downloadOnce(url: string, dest: File, outer?: AbortSignal): Promise<File> {
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

/** Sleep `ms`, rejecting immediately (with an AbortError) if the optional cancel signal fires — so a
 *  retry backoff doesn't keep a canceled download alive for the delay. */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      reject(abortError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener?.('abort', onAbort)
  })
}

/**
 * Download one file with bounded retries + exponential backoff. Each attempt is the timeout-bounded
 * transfer PLUS a nonzero-size verify (no manifest here carries a size/hash, so presence + bytes>0 is
 * the only integrity signal — audit #834); a transient failure (timeout, 5xx, dropped connection,
 * zero-byte landing) is retried up to CLIP_DOWNLOAD_ATTEMPTS, deleting the half-written file between
 * tries (downloadFileAsync rejects on an existing dest). A real CANCEL — the OUTER signal aborting —
 * is terminal and propagates so the caller aborts the whole run (a per-file TIMEOUT, in contrast,
 * aborts only the INNER controller, so it stays retryable). Throws the last error once attempts are
 * exhausted. (audit #1 / #3)
 */
export async function downloadFileWithRetry(
  url: string,
  dest: File,
  name: string,
  signal?: AbortSignal,
): Promise<void> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= CLIP_DOWNLOAD_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw abortError()
    try {
      const out = await downloadOnce(url, dest, signal)
      if (!out.exists || !out.size || out.size <= 0) {
        throw new Error(`Download verify failed for ${name} (exists=${out.exists}, size=${out.size}).`)
      }
      return
    } catch (e) {
      // A user CANCEL (the outer signal) is terminal — never retry it; let the caller abort the run.
      if (signal?.aborted) throw e
      lastErr = e
      // Drop the (possibly half-written / zero-byte) file before the next attempt — a truncated file
      // must not read as a saved clip, and downloadFileAsync rejects on an existing dest.
      try {
        if (dest.exists) dest.delete()
      } catch {}
      if (attempt < CLIP_DOWNLOAD_ATTEMPTS) {
        await abortableDelay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), signal)
      }
    }
  }
  throw lastErr ?? new Error(`Download failed for ${name}.`)
}

/**
 * Pre-flight free-space guard: estimate total bytes from clip durations and require comfortable
 * headroom, so a doomed download fails fast with an actionable message instead of filling the disk
 * and then reporting a misleading "network" error. Skipped entirely when the OS can't report free
 * space (a zero/non-finite reading is "don't know", never "no room"). (audit #174)
 */
export function assertFreeSpaceFor(durationsMs: (number | null | undefined)[], message?: string): void {
  const estBytes = durationsMs.reduce<number>(
    (sum, ms) => sum + Math.max(0, (ms ?? 0) / 1000) * APPROX_BYTES_PER_SEC,
    0,
  )
  if (estBytes <= 0) return
  let free = 0
  try {
    free = Paths.availableDiskSpace
  } catch {
    free = 0
  }
  if (Number.isFinite(free) && free > 0 && free < estBytes * 1.5 + 5_000_000) {
    throw new InsufficientStorageError(message)
  }
}
