// Offline DRIVE download (Phase 3) — persist a complete drive to disk so it plays with ZERO
// network. Tahoe has dead zones, so offline-first is a hard product requirement.
//
// A drive's manifest (GET /drives/:id) carries its clips' presigned URLs INLINE, so a download
// needs no separate sign call: fetch the manifest, then download every clip's BYTES to the
// PERSISTENT document dir (Paths.document — NOT Paths.cache, which the OS can evict). Presigned R2
// URLs die in ~1h, so we store the BYTES, not the URLs.
//
// ⚠ STEP 9 — THE BYTES ARE NOW SHARED, THE INDEX IS STILL PER-DRIVE. One telling is ONE file, keyed
// by its SUBJECT (INV-16) in `Paths.document/clips/` (`./clip-store`), while every drive keeps its own
// `manifest.json` mapping its own seqs to those files (INV-6 — a drive's own manifest is the sole
// authority for that drive). Two drives down the same corridor now share the bytes instead of holding
// two copies; the seq→subject join already lives in `detail.clips` and is deliberately NOT copied to a
// second place that could drift.
//
// ⚠ THAT COLLAPSE CREATES ONE FAILURE THIS MODULE MUST NEVER HAVE: a drive that still LISTS as
// downloaded but is missing audio, discovered in a dead zone. `useDrive`'s stall watchdog SKIPS a clip
// that will not load after 400 ms with NO note, so a hole is SILENT by construction — the rider simply
// drives past a stop in silence. So: nothing but the sweep (`sweepOrphanClips`) may ever remove a
// shared byte; a re-pull is a TOP-UP (fetch → diff → download only what is absent), never a wipe; a
// download's success is judged by the DESTINATION being present and non-zero, never by "it did not
// throw"; and a missing byte costs ONE STOP, never a whole drive.
//
// Robustness: the manifest stores RELATIVE filenames, not absolute `file://` URIs — the document
// container path can change across app updates, so URIs are reconstructed from `Paths.document` at
// read time. API (expo-file-system 57): `File`/`Directory`/`Paths`;
// `File.downloadFileAsync(url, destFile)` (static) → a File with `.uri`/`.exists`/`.size`;
// `dir.create({intermediates,idempotent})`; `file.write(str)`/`file.textSync()`/`file.delete()`;
// `file.moveSync(dest)`; `file.info().modificationTime`.

import { Directory, File, Paths } from 'expo-file-system'
import type { DriveClip, DriveManifest, DriveSummary } from '@skipper/shared'
import { getDrive, signDriveAudio } from './api'
import {
  clipStoreDir,
  deleteAllStoredClips,
  deleteQuietly,
  driveDir,
  hasBytes,
  hasStoredClip,
  isSafeLocalName,
  migrateDriveV4,
  storedClipUri,
  sweepOrphanClips as sweepStore,
} from './clip-store'
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
  resolveClipRef,
  storeFileName,
  storeKeyForClip,
  type ManifestMigration,
  type Saved,
  type StoredClipRef,
  urlMapFromDriveManifest,
  urlMapFromDriveSigned,
} from './offline-util'

// Manifest schema version. ⚠ Bumping this is NOT a free action — see the migration table below. An
// additive change should get a migration, not a bump that silently invalidates every saved download
// on the next app update. Only a genuine shape break, where saved bytes cannot be reinterpreted,
// should invalidate — and even then the bytes stay reclaimable via `downloadDirState`.
// v3: V2 reshape — the embedded `detail` is now a DRIVE manifest (flat clips[] keyed by seq, with
// per-clip `revisedAt`), not a tour detail; a v2 download is a different shape → invalidated.
// v4: + `audioSeqs` (the expected downloadable seqs, so completeness survives the strip below) AND the
// detail's presigned clip `url`s are NULLED on disk — a short-TTL credential never belongs in a
// backed-up manifest (audit #9). Both are shape changes → a v3 download re-downloads.
// v5: the SUBJECT-KEYED STORE (step 9). `clips[seq]` gains `shared`, and its `name` is a store
// filename (`clips/<kind>-<subjectId>.<rev>.<ext>`) rather than `<seq>.<ext>`. MIGRATED, not
// invalidated — `migrateDriveV4` moves the bytes with ZERO network (a v4 manifest still carries
// `poiId`, which IS the subject id for a poi telling) and never drops a clip.
const MANIFEST_VERSION = 5

/**
 * A wire manifest as SAVED. ⚠ `Saved<T>` makes persisting a presigned url a COMPILE error rather than
 * a `map(c => ({...c, url: null}))` anyone can forget — which is what step 3 harvested it for, and it
 * replaces the two hand-rolled strip sites this file used to carry. A short-TTL R2 credential must
 * never sit in a backed-up file, and offline playback reads the local file map, never these. (audit #9)
 *
 * ⚠ A manifest MIGRATED from v4 may still carry a literal `url: null` on disk — the type governs what
 * this build WRITES, and nothing reads that field, so the stale key is inert.
 */
type SavedDriveClip = Saved<DriveClip>
interface SavedDriveManifest extends Omit<DriveManifest, 'clips'> {
  clips: SavedDriveClip[]
}

/** The one home for the url strip. */
function stripUrls(d: DriveManifest): SavedDriveManifest {
  return { ...d, clips: d.clips.map(({ url: _url, ...rest }) => rest) }
}

export interface OfflineManifest {
  driveId: string
  /** Manifest schema version (MANIFEST_VERSION) — a mismatch with no migration invalidates the download. */
  version: number
  /** When this download was captured (ISO). */
  savedAt: string
  /** The full drive manifest (route/clips/geometry) — zero-network playback. Clip `url`s are absent by
   *  TYPE (see `SavedDriveManifest`). */
  detail: SavedDriveManifest
  /** The player seqs this drive SHOULD have audio for (captured at download time, BEFORE the url strip),
   *  so completeness survives a restart even though `detail`'s urls are gone. `audioSeqs` minus the seqs
   *  whose bytes are actually on disk = the missing set. (audit #1 / #9) */
  audioSeqs: number[]
  /** ⚠ Keyed by the player SEQ (string), NOT by subject — the STORE is what's subject-keyed. This is the
   *  drive's own seq→bytes pointer table (INV-6); re-keying it by subject would turn `Object.keys()` into
   *  UUIDs, `Number()` them all to NaN, and report every drive as 100% missing. */
  clips: Record<string, StoredClipRef>
}

// NOTE: clips live under Paths.document (survives restarts; NOT cache-evicted) but are INCLUDED in
// iCloud/iTunes backups — SDK 57's File API exposes no isExcludedFromBackup setter from JS, so a
// Tahoe drive's tens of MB of re-downloadable audio inflates backups until that lands (then exclude
// via a native config plugin or a backup-excluded subpath). (audit #508)
// ⚠ WHEN THAT LANDS, `drives/` AND `clips/` MUST SHARE ONE BACKUP FATE. Excluding the store alone
// restores a device with every manifest and zero bytes — every drive listing as downloaded and playing
// as silence, on a brand-new phone, with nothing to explain it. That is a data-shape bug, not a
// storage optimization.
// ⚠ `driveDir`, `isSafeLocalName`, `hasBytes` and `deleteQuietly` come from `./clip-store` — it is the
// LEAF of this pair (it never imports back), and all four were duplicated character-for-character here
// until the 1.1 sweep. In THIS module `deleteQuietly` is only ever pointed at a file the module OWNS
// (a drive-local byte, or its own `.part` temp) — NEVER at a shared store byte, which only the sweep
// may reclaim.
function manifestFile(driveId: string): File {
  return new File(driveDir(driveId), 'manifest.json')
}

/** Are a manifest entry's bytes actually on disk? Resolves shared-vs-drive-local off `shared`. */
function clipPresent(driveId: string, c: StoredClipRef): boolean {
  if (!isSafeLocalName(c.name)) return false
  return c.shared ? hasStoredClip(c.name) : hasBytes(new File(driveDir(driveId), c.name))
}

/** A clip's local `file://` uri, or null when its bytes are not on disk. Presence-checked on purpose:
 *  the whole partial-tolerance story is "resolve what is there, report what is not". */
function clipUri(driveId: string, c: StoredClipRef): string | null {
  if (!clipPresent(driveId, c)) return null
  try {
    return c.shared ? storedClipUri(c.name) : new File(driveDir(driveId), c.name).uri
  } catch {
    return null
  }
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

/* -------------------------------------------------------------------------- */
/*  Planning — one clip of a drive, and where its bytes belong                  */
/* -------------------------------------------------------------------------- */

/** One clip of a drive as the downloader sees it: where its bytes belong, and where to get them. */
interface PlannedClip {
  seq: number
  /** Relative filename — inside `clips/` when `shared`, else inside `drives/<driveId>/`. */
  name: string
  shared: boolean
  contentType: string
  durationMs: number | null
  url: string
}

/**
 * Every clip of a drive that has audio, mapped to its destination filename.
 *
 * ⚠ The store name carries the narration's REVISION (`storeFileName`), which is what makes the
 * presence check safe: "is subject S present?" alone would answer YES with a byte from a cut the
 * operator has since re-synthed, and NOTHING would catch it — `isDownloadStale` compares MANIFESTS
 * (`seq:revisedAt`) and both manifests would be correct while the BYTES were wrong. Planning off the
 * FRESH manifest is therefore also what implements `UNKNOWN_REV`'s policy for free: an entry stored
 * under rev `'0'` simply does not match a name built from a real `revisedAt`, so it reads as ABSENT and
 * is re-fetched once, when online.
 *
 * A clip with audio but NO resolvable subject keeps its bytes drive-local under the legacy
 * `<seq>.<ext>` name (`shared: false`) rather than being skipped. The server sets `subjectId` and `url`
 * from the same row, so this is a server bug, not a normal state — but losing the stop is a worse
 * answer than duplicating a few KB, and it keeps a pre-step-4 fused telling playing untouched.
 */
function planDriveClips(detail: DriveManifest): PlannedClip[] {
  const out: PlannedClip[] = []
  for (const c of detail.clips) {
    if (!hasDownloadableAudio(c)) continue // a silent beat (rest) carries no audio — nothing to fetch
    // Every place narration downloads under its OWN seq (V2 has no placeless framing; see
    // docs/decisions/geometry-first-regions.md), which is what makes these on-disk keys line up with
    // offline-util's `urlMapFromDriveManifest`.
    const seq = c.seq
    const key = storeKeyForClip(c)
    let storeName: string | null = null
    if (key) {
      try {
        storeName = storeFileName(key, c.contentType)
      } catch {
        storeName = null // an unsafe key is loud in offline-util; here it degrades to drive-local
      }
    }
    out.push({
      seq,
      name: storeName ?? `${seq}.${extForContentType(c.contentType)}`,
      shared: storeName != null,
      contentType: c.contentType,
      durationMs: c.durationMs ?? null,
      url: c.url,
    })
  }
  return out
}

function plannedPresent(driveId: string, p: PlannedClip): boolean {
  return p.shared ? hasStoredClip(p.name) : hasBytes(new File(driveDir(driveId), p.name))
}

/**
 * The manifest entries for a plan, judged ENTIRELY by what is on disk right now.
 *
 * ⚠ This is the crash-safety contract, and it is why a re-run always finishes the job rather than
 * starting over: a clip counts as saved iff its DESTINATION holds bytes — never because a transfer
 * "did not throw", and never because a source is gone. Two seqs resolving to one subject share one
 * file and both get an entry.
 */
function buildClipRefs(
  driveId: string,
  planned: PlannedClip[],
  /** The entries this drive is ALREADY committed to, when there are any. See the ⚠ below — omitting
   *  this is a silent hole, not a smaller manifest. */
  saved?: Record<string, StoredClipRef>,
): { clips: Record<string, StoredClipRef>; missingSeqs: number[] } {
  const clips: Record<string, StoredClipRef> = {}
  const missingSeqs: number[] = []
  for (const p of planned) {
    const plannedRef: StoredClipRef = {
      name: p.name,
      contentType: p.contentType,
      durationMs: p.durationMs,
      shared: p.shared,
    }
    const prior = saved?.[String(p.seq)]
    const { ref, missing } = resolveClipRef(
      plannedRef,
      plannedPresent(driveId, p),
      prior,
      prior ? clipPresent(driveId, prior) : false,
    )
    if (ref) clips[String(p.seq)] = ref
    if (missing) missingSeqs.push(p.seq)
  }
  return { clips, missingSeqs }
}

/** The distinct destinations a plan still needs — one entry per FILE, not per seq. In the collapse
 *  case this is usually EMPTY, which is the whole point: a second drive down the same corridor costs
 *  N `exists` calls and no network. */
function missingDestinations(driveId: string, planned: PlannedClip[]): PlannedClip[] {
  const seen = new Set<string>()
  const out: PlannedClip[] = []
  for (const p of planned) {
    if (seen.has(p.name)) continue
    seen.add(p.name)
    if (plannedPresent(driveId, p)) continue
    out.push(p)
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

// In-flight top-ups, same dedupe, separate map because the shapes differ. Both feed the sweep's
// "is anything writing?" guard.
const topUps = new Map<string, Promise<OfflineStatus | null>>()

/** Store filenames a transfer is currently working toward. ⚠ A subject mid-write is referenced by NO
 *  manifest yet — the manifest is written LAST, deliberately — so without this the sweep would call it
 *  an orphan and delete it out from under the downloader as it verifies it. */
const writingStoreNames = new Set<string>()

/**
 * In-flight SHARED transfers, keyed by STORE FILENAME — i.e. by (subject, revision), NOT by driveId.
 *
 * ⚠ EVERY OTHER DEDUPE IN THIS MODULE IS PER-DRIVE, AND THAT IS THE WRONG AXIS FOR THE STORE. `inFlight`
 * and `topUps` key on driveId, and `topUpDrive` only declines when THIS drive is already downloading —
 * so two runs for DIFFERENT drives could reach `fetchClip` for the same subject at once. Both compute
 * the same `.part` path (it is keyed on subject+revision and lives in the shared store), and each opens
 * by deleting it, so each was destroying the other's in-flight partial; `downloadFileAsync` also
 * rejects on an existing dest and `downloadFileWithRetry` deletes between attempts, so two runs could
 * mutually starve across all three and BOTH drives would record the stop as missing.
 *
 * ⚠ It needed no unusual behaviour to hit: `downloadDrive` runs as a background promise, and opening
 * ANOTHER drive fires its `topUpDrive` automatically on the online load. Two drives sharing a subject
 * is not an edge case — it is the entire premise of the shared store.
 *
 * Serializing here rather than giving each transfer a unique temp is deliberate: it also collapses the
 * DUPLICATE FETCH, which is what makes "a second drive down the same corridor costs N `exists` calls
 * and no network" true while a download is in flight rather than only after it finishes. A unique temp
 * would have fixed the collision and left both drives pulling the same bytes — and left an abandoned
 * temp after a hard kill that nothing reclaims (today's fixed name self-cleans on the next attempt).
 */
const transfers = new Map<string, Promise<void>>()

/**
 * Download a drive (manifest + clip bytes) to persistent storage and write the manifest.
 *
 * ⚠ IT IS A TOP-UP, NOT A WIPE-AND-REFETCH (step 9). It used to open with `deleteDriveDownload` for a
 * "clean re-pull"; under a shared store that is the single most likely way to destroy another drive's
 * audio — it is the EVERYDAY path (the "Update" tap), far commoner than the rare drive delete, and it
 * can fail halfway leaving a drive the rider never touched missing its stops. So now: fetch the
 * manifest, diff it against what is already on disk, and download ONLY what is absent. Reclaiming
 * superseded bytes is the exclusive job of `sweepOrphanClips`.
 *
 * PARTIAL-TOLERANT (H2): a single clip's download/verify failure no longer aborts the run — the failed
 * clip is skipped, the rest stay saved, and the result carries `downloaded`/`total`/`failedSeqs` so the
 * rider keeps the clips that landed (worst case a dead zone) and can re-pull the stragglers. The
 * manifest covers only the clips whose bytes are actually on disk, so a partial download plays its
 * saved stops and reports the gap after a restart.
 *
 * Throws ONLY when the run can't start (manifest fetch failed / no audio / no free space) or NOTHING is
 * on disk afterwards (a true network-down) or it was canceled. ⚠ On any of those it leaves an EXISTING
 * saved manifest alone — a failed "Update" must never cost the rider the copy they already had. Pass
 * `signal` to cancel. Concurrent calls for the same drive share one in-flight run. Needs network + a
 * signed-in account (the /drives tier check enforces it — a drive is owned).
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

/**
 * Fetch ONE clip's bytes to its destination.
 *
 * Drive-local bytes go straight to the drive's own dir. A SHARED clip is serialized per store name
 * first (see `transfers`) and then transferred by `transferSharedClip`, which owns the temp-and-move
 * mechanics. The split is the point: the per-name lock has to sit OUTSIDE the transfer, or the second
 * caller has already computed the contended temp path before it can be told to wait.
 */
async function fetchClip(driveId: string, p: PlannedClip, signal?: AbortSignal): Promise<void> {
  if (!p.shared) {
    // Drive-local: the old per-drive path, still correct for a clip with no resolvable subject.
    const dest = new File(driveDir(driveId), p.name)
    try {
      await downloadFileWithRetry(p.url, dest, p.name, signal)
    } catch (e) {
      deleteQuietly(dest) // a truncated/zero-byte file must not read as a saved clip
      throw e
    }
    return
  }
  // ⚠ WAIT FOR ANY RUN ALREADY FETCHING THIS EXACT SUBJECT+REVISION, rather than racing it on a temp
  // both sides delete (see `transfers`). The loop consumes a SETTLED promise per iteration and the slot
  // is always cleared in the `finally` below, so it terminates: either a leader lands the bytes and
  // every waiter returns, or the leader fails and exactly one waiter becomes the next leader.
  for (;;) {
    const running = transfers.get(p.name)
    if (!running) break
    // Its failure is not ours to inherit — a dead-zone exhaustion for one drive must not poison
    // another drive's attempt at the same subject.
    await running.catch(() => {})
    // A cancel that arrived while we waited is terminal, exactly as it is inside the transfer.
    if (signal?.aborted) throw abortError()
    if (hasStoredClip(p.name)) return // the other run landed it — this is the free, no-network case
  }
  const task = transferSharedClip(p, signal)
  transfers.set(p.name, task)
  try {
    await task
  } finally {
    // Identity-checked: only clear the slot if it is still OURS, never a successor's.
    if (transfers.get(p.name) === task) transfers.delete(p.name)
  }
}

/**
 * The shared-store transfer itself — ONE caller at a time per store name, enforced by `fetchClip`.
 *
 * ⚠ A SHARED DESTINATION IS NEVER THE DOWNLOAD TARGET. `downloadFileWithRetry` deletes `dest` between
 * attempts (a truncated file must not read as a saved clip) and `downloadFileAsync`'s own idempotent
 * path does remove-then-move — either would destroy an incumbent good copy that another drive is
 * relying on, and on final exhaustion leave the subject missing for BOTH. So a shared clip lands in a
 * `.part` temp inside the store and is placed with a `moveSync` that carries NO `overwrite` option
 * (default false → a collision throws while touching neither file; `overwrite: true` is
 * remove-then-move, a real window with zero copies). Safe because the revision is in the filename: a
 * collision means the same subject at the same `revisedAt`, i.e. provably identical bytes, so the
 * temp — never the incumbent — is what gets dropped.
 *
 * The `.part` suffix is deliberate: `parseStoreFileName` rejects a four-segment name, so the sweep
 * will never mistake a temp for an orphan (or for a live clip).
 *
 * ⚠ THE TEMP IS KEYED ON SUBJECT+REVISION, SO IT IS SHARED ACROSS DRIVES — which is exactly why the
 * caller must hold the per-name slot before entering here. The opening `deleteQuietly(tmp)` is only
 * safe as "our own abandoned temp" while this function has no concurrent twin; unguarded, it deleted
 * another drive's in-flight partial. Do not call this directly.
 */
async function transferSharedClip(p: PlannedClip, signal?: AbortSignal): Promise<void> {
  const store = clipStoreDir()
  const tmp = new File(store, `${p.name}.part`)
  writingStoreNames.add(p.name)
  try {
    deleteQuietly(tmp) // our own abandoned temp from a hard kill — never a live store byte
    await downloadFileWithRetry(p.url, tmp, p.name, signal)
    if (!hasStoredClip(p.name)) {
      try {
        tmp.moveSync(new File(store, p.name))
      } catch {
        // A concurrent pass landed it first, or the disk is full. The destination check below is the
        // only thing allowed to declare success; nothing is deleted here.
      }
    }
    if (!hasStoredClip(p.name)) throw new Error('Clip did not land in the offline store.')
  } finally {
    deleteQuietly(tmp) // a no-op after a clean move; after a collision it reclaims a verified duplicate
    writingStoreNames.delete(p.name)
  }
}

/** Run the missing transfers with bounded concurrency. Partial-tolerant: only the OUTER cancel is
 *  terminal (a persistent per-clip failure is absorbed and resurfaces as a missing seq). */
async function fetchMissing(
  driveId: string,
  needed: PlannedClip[],
  signal: AbortSignal | undefined,
  onSettled: (p: PlannedClip) => void,
): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < needed.length) {
      if (signal?.aborted) throw abortError() // a cancel tap aborts the whole run, not just a clip
      const p = needed[next++]!
      try {
        await fetchClip(driveId, p, signal)
      } catch {
        // The OUTER signal is the ONLY terminal failure. Anything else means the retries were
        // exhausted (a persistent timeout/5xx), which is PARTIAL-TOLERANT (H2): drop this clip and
        // keep going so one bad clip in a dead zone doesn't cost the rider the whole drive. The gap is
        // NOT silent — the manifest's `audioSeqs` still expects it, so `offlineStatus` re-derives it
        // after a restart (audit #1).
        if (signal?.aborted) throw abortError()
      }
      onSettled(p)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, needed.length) }, () => worker()),
  )
}

/** Drop a drive dir we created but never committed a manifest to. ⚠ Guarded on the manifest's ABSENCE:
 *  a failed run must never delete the manifest of the download the rider already had. */
function dropUncommittedDriveDir(driveId: string): void {
  try {
    if (manifestFile(driveId).exists) return
    const dir = driveDir(driveId)
    if (dir.exists) dir.delete()
  } catch {}
}

// ⚠ THERE IS DELIBERATELY NO "PRUNE THE DRIVE DIR AFTER A COMMIT" PASS, and the reason is worth
// keeping: it looks like free hygiene (a legacy byte promoted into the shared store leaves its
// per-drive copy behind) and it is actually a byte-loss path. A pre-step-4 FUSED telling lives at
// `drives/<id>/<seq>.m4a` with no resolvable subject; the next ONLINE manifest DOES carry its
// subjectId, so it re-plans as shared — and if that one fetch then fails on thin signal, a prune
// keyed on "the new manifest doesn't name this file" deletes the only copy of Emerald Bay the rider
// had. The residue is bounded (one duplicate per unmigratable clip per drive, and it goes with the
// drive), and it costs a rider nothing. Bytes over tidiness, every time.

async function runDownload(
  driveId: string,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  if (signal?.aborted) throw abortError()
  // Fetch the manifest FIRST (network; clips come pre-signed). If offline (a dead-zone "Update"
  // tap), this throws here — BEFORE we touch anything on disk, so the saved copy survives a failed
  // re-pull attempt.
  const detail = await getDrive(driveId)

  const planned = planDriveClips(detail)
  const total = planned.length
  if (total === 0) throw new Error('This drive has no audio to download.')

  driveDir(driveId).create({ intermediates: true, idempotent: true })

  const needed = missingDestinations(driveId, planned)

  // Pre-flight free-space check, so a doomed download fails fast with an actionable message instead
  // of a misleading "network" error after filling the disk. (audit #174) ⚠ Sized over the MISSING set
  // only — a rider whose store already holds 90% of this drive would otherwise be told they can't
  // save a drive that needs 2 MB, which is exactly the phone they're most likely to be holding.
  assertFreeSpaceFor(needed.map((p) => p.durationMs))

  // Progress is counted in SEQS (what the UI shows), not in transfers — two seqs sharing one subject
  // are one fetch and two stops.
  const seqsPerName = new Map<string, number>()
  for (const p of planned) seqsPerName.set(p.name, (seqsPerName.get(p.name) ?? 0) + 1)
  let done = total - needed.reduce((n, p) => n + (seqsPerName.get(p.name) ?? 1), 0)
  onProgress?.({ done, total })

  try {
    await fetchMissing(driveId, needed, signal, (p) => {
      done += seqsPerName.get(p.name) ?? 1
      onProgress?.({ done, total })
    })
  } catch (e) {
    // A cancel. ⚠ Do NOT delete the drive dir: it may hold the manifest of the download the rider
    // already had, and any bytes this run did land are either named by that manifest or reclaimable
    // by the sweep. Only a dir we created and never committed to is dropped.
    dropUncommittedDriveDir(driveId)
    throw e
  }

  // A re-pull carries forward whatever the previous download already had: one clip failing on this
  // run must not retire a stop the rider could still hear (see buildClipRefs). Null on a first
  // download, which is the no-op case.
  const { clips, missingSeqs } = buildClipRefs(driveId, planned, loadManifest(driveId)?.clips)
  if (Object.keys(clips).length === 0) {
    // A true network-down — nothing on disk to save. Throw so the caller shows the generic download
    // error rather than a hollow "downloaded 0 of N".
    dropUncommittedDriveDir(driveId)
    throw new Error('Download failed — no clips could be saved.')
  }

  // ⚠ THE MANIFEST WRITE IS THE COMMIT POINT, and it comes LAST. The reverse order would leave a
  // manifest naming bytes that do not exist yet while the real bytes sat referenced by nothing — and
  // therefore eligible for a sweep that consults only manifests. Silent, permanent loss.
  //
  // `audioSeqs` is captured from the FRESH detail (urls intact) BEFORE the strip, so the
  // partial-vs-complete signal survives a restart. (audit #1 / #9)
  const manifest: OfflineManifest = {
    driveId,
    version: MANIFEST_VERSION,
    savedAt: new Date().toISOString(),
    detail: stripUrls(detail),
    audioSeqs: expectedAudioSeqs(detail.clips),
    clips,
  }
  try {
    manifestFile(driveId).write(JSON.stringify(manifest))
  } catch (e) {
    dropUncommittedDriveDir(driveId)
    throw e
  }
  return {
    manifest,
    downloaded: Object.keys(clips).length,
    total,
    failedSeqs: missingSeqs,
  }
}

/* -------------------------------------------------------------------------- */
/*  INV-6's top-up — fill the shared store with what THIS drive still needs     */
/* -------------------------------------------------------------------------- */

/** Do two clip tables name the same files? Cheap enough to run per focus, and it is what keeps the
 *  top-up from rewriting a manifest (a non-atomic write) every time the rider opens a drive. */
function clipRefsEqual(a: Record<string, StoredClipRef>, b: Record<string, StoredClipRef>): boolean {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => a[k]!.name === b[k]?.name && a[k]!.shared === b[k]?.shared)
}

/**
 * Fill the shared store with any subject THIS drive's own manifest names and the store lacks, then
 * re-commit the drive's index (INV-6 — its own manifest is the sole authority for it). Returns the
 * refreshed status, or null when the drive is not a saved download.
 *
 * WHAT IT IS ACTUALLY FOR, stated honestly: with a fail-closed sweep, deleting drive A can never
 * remove a byte B's manifest names — so this is not repairing that. Its job is (a) closing a PARTIAL
 * download automatically (a thin-signal stop that never landed) and (b) picking up a RE-SYNTHED
 * subject, whose bytes live under a different filename because the revision is in the name. It is the
 * automatic, byte-minimal version of the manual "Finish the download" action, made nearly free by the
 * shared store.
 *
 * ⚠ FOUR BOUNDS — "never a surprise download on a metered connection":
 *  1. It runs ONLY for a drive that is ALREADY a saved download (first line). Read loosely, "fill the
 *     store with what it lacks" would start pulling tens of MB on cellular the moment a rider merely
 *     OPENED a drive they never saved. It never converts a non-download into a download.
 *  2. It fetches only what the SHARED STORE lacks. In the collapse case that is usually ZERO bytes.
 *  3. It reuses the download guards verbatim — the free-space pre-flight, `downloadFileWithRetry`,
 *     DOWNLOAD_CONCURRENCY, the caller's AbortSignal, and a per-drive in-flight dedupe. Its hard
 *     ceiling is the drive's own clip count: it can never legitimately need more.
 *  4. ⚠ IT NEVER RUNS ON THE PLAY PATH. Mid-drive it would compete with clip streaming AND with the
 *     stall watchdog's own re-sign. Call it from the drive-detail screen's ONLINE load, never from
 *     `loadPlayback`/`resignPlayback`. In a dead zone the caller's `getDrive` has already thrown, so
 *     it simply never runs.
 */
export function topUpDrive(
  driveId: string,
  fresh: DriveManifest,
  signal?: AbortSignal,
): Promise<OfflineStatus | null> {
  // A download for this drive is doing the same job, better — don't race it.
  if (inFlight.has(driveId)) return Promise.resolve(null)
  const existing = topUps.get(driveId)
  if (existing) return existing
  const p = runTopUp(driveId, fresh, signal).finally(() => {
    if (topUps.get(driveId) === p) topUps.delete(driveId)
  })
  topUps.set(driveId, p)
  return p
}

async function runTopUp(
  driveId: string,
  fresh: DriveManifest,
  signal?: AbortSignal,
): Promise<OfflineStatus | null> {
  const saved = loadManifest(driveId)
  if (!saved) return null // BOUND 1 — never convert a non-download into a download

  const planned = planDriveClips(fresh)
  if (planned.length === 0) return offlineStatus(driveId)

  const needed = missingDestinations(driveId, planned) // BOUND 2 + the ceiling (⊆ planned, by name)
  let landed = 0
  if (needed.length > 0) {
    assertFreeSpaceFor(needed.map((p) => p.durationMs)) // BOUND 3
    await fetchMissing(driveId, needed, signal, () => {})
    landed = needed.filter((p) => plannedPresent(driveId, p)).length
  }

  // ⚠ `saved.clips` is passed so a planned byte that did not land falls back to the one already on
  // disk rather than being dropped. See the ⚠ in buildClipRefs — this argument is the difference
  // between "stale but playing" and a silent gap the sweep then makes permanent.
  const { clips } = buildClipRefs(driveId, planned, saved.clips)
  if (Object.keys(clips).length === 0) return offlineStatus(driveId) // nothing on disk to commit

  // Rewrite only on a real change: a manifest write is not atomic on iOS, and this runs on every
  // online open of the drive screen.
  const detail = stripUrls(fresh)
  const unchanged =
    landed === 0 &&
    contentSignature(saved.detail) === contentSignature(fresh) &&
    clipRefsEqual(saved.clips, clips)
  if (unchanged) return offlineStatus(driveId)

  const next: OfflineManifest = {
    driveId,
    version: MANIFEST_VERSION,
    // ⚠ `savedAt` moves ONLY when bytes actually landed. A top-up that fetched nothing must not reset
    // the rider's freshness TTL on a copy that could be months old.
    savedAt: landed > 0 ? new Date().toISOString() : saved.savedAt,
    detail,
    audioSeqs: expectedAudioSeqs(fresh.clips),
    clips,
  }
  try {
    manifestFile(driveId).write(JSON.stringify(next))
  } catch {
    // Best-effort: a failed commit costs a repeat next open, never the download.
    return offlineStatus(driveId)
  }
  return offlineStatus(driveId)
}

/* -------------------------------------------------------------------------- */
/*  Reading the saved index                                                     */
/* -------------------------------------------------------------------------- */

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
      // ⚠ `!== null` is load-bearing: `typeof null === 'object'`, so without it a manifest carrying
      // `clips: null` passes the shape check and every reader then does `Object.entries(null)` and
      // throws. `listDownloadedDrives` happens to catch that; the drive-detail refresh does not.
      typeof x.clips === 'object' &&
      x.clips !== null,
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
 * ⚠ IT IS A PER-DRIVE FACTORY, NOT A MODULE-LEVEL TABLE, and that is load-bearing: the v4 step MOVES
 * BYTES, so it must be closed over the driveId whose dir it is moving them out of. Registering
 * `migrateV4ToV5` bare (with no `placed` set) would mark every clip `shared: false` forever —
 * correct-looking, and the store would never fill.
 */
function manifestMigrations(driveId: string): Record<number, ManifestMigration> {
  return { 4: (raw) => migrateDriveV4(driveId, raw) }
}

/**
 * Read the manifest from disk, migrating an older format forward when we know how. Null if absent,
 * corrupt, or a format this build genuinely can't carry across.
 *
 * ⚠ THE v4→v5 BYTE MOVE HAPPENS HERE, LAZILY, and that placement is deliberate: every reader funnels
 * through `loadManifest`, and it is SYNCHRONOUS — so no reader can ever observe a half-migrated drive,
 * and a launch effect would leave a window in which a drive reads as never-downloaded (its v4 clip
 * names pointing at bytes already moved) and is one "Remove" tap from losing the only map to them. It
 * is also why the re-key must be a MOVE and not a re-download: a network fetch is not expressible in a
 * synchronous reader.
 */
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
  const m = migrateToVersion(raw as Record<string, unknown>, MANIFEST_VERSION, manifestMigrations(driveId))
  if (!m || !isCurrentManifest(m)) return null
  // Persist the upgrade so the walk is a one-time cost per download, never per read. ⚠ For the v4 step
  // this write is the COMMIT POINT of a migration whose bytes have ALREADY moved — a crash before it
  // leaves a still-valid v4 manifest plus some bytes in the store, and the next read finishes the job.
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
 * across, or a file lost to a hard kill mid-run (a SIGKILL runs no cleanup). Deleting there would throw
 * away the EXPENSIVE half (hundreds of MB, minutes of transfer) to fix the CHEAP half (a few KB of
 * re-fetchable JSON).
 *
 * ⚠ STEP 9 MADE IT STRICTLY MORE CAPABLE, and this is the best consequence of the shared store: it
 * scans the STORE, so a drive whose index is unreadable now repairs from bytes a DIFFERENT drive
 * downloaded. Note the asymmetry — the v4 MIGRATION is zero-network (a v4 manifest still carries
 * `poiId`), a repair never can be: with no manifest at all, only the server holds the seq→subject map.
 *
 * NON-DESTRUCTIVE: it only ever writes a manifest. Nothing is deleted, so a repair that turns out to
 * be wrong costs nothing — unlike a sweep, which forecloses shipping the missing migration later. That
 * matters MORE under sharing, not less: the rider's fallback when a repair lies is "Remove download",
 * which would destroy a perfectly good store copy.
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

  const planned = planDriveClips(detail)
  // A repair runs when the index is unreadable, so there is usually nothing to carry forward — but if
  // a manifest IS readable, a drive-local legacy byte it names must survive the repair rather than be
  // silently orphaned by a plan built only from the fresh manifest.
  const { clips } = buildClipRefs(driveId, planned, loadManifest(driveId)?.clips)
  if (Object.keys(clips).length === 0) return null // nothing salvageable — not a repair, a download

  // Date the copy from the bytes, not from now — a repaired download must not read as freshly pulled,
  // or the freshness TTL is silently reset on a copy that could be months old.
  //
  // ⚠ From the OLDEST matched clip, not the drive dir: the dir now holds only `manifest.json`, so its
  // mtime is meaningless. And oldest, not newest, because the nudge must reflect the STALEST byte the
  // rider will actually hear — a store copy adopted from another drive can predate this one by months.
  let oldest: number | null = null
  for (const c of Object.values(clips)) {
    const t = clipModifiedAt(driveId, c)
    if (t != null && (oldest == null || t < oldest)) oldest = t
  }
  if (oldest == null) {
    try {
      const mtime = dir.info().modificationTime
      if (typeof mtime === 'number' && Number.isFinite(mtime) && mtime > 0) oldest = mtime
    } catch {}
  }
  const savedAt = oldest != null ? new Date(oldest).toISOString() : new Date().toISOString()

  const manifest: OfflineManifest = {
    driveId,
    version: MANIFEST_VERSION,
    savedAt,
    detail: stripUrls(detail),
    audioSeqs: expectedAudioSeqs(detail.clips),
    clips,
  }
  manifestFile(driveId).write(JSON.stringify(manifest))
  return offlineStatus(driveId)
}

/** A stored clip's mtime (ms epoch), or null when the OS won't report one. */
function clipModifiedAt(driveId: string, c: StoredClipRef): number | null {
  if (!isSafeLocalName(c.name)) return null
  try {
    const f = c.shared ? new File(clipStoreDir(), c.name) : new File(driveDir(driveId), c.name)
    const t = f.info().modificationTime
    return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : null
  } catch {
    return null
  }
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

/**
 * The seqs whose bytes are actually on disk right now.
 *
 * ⚠ THIS REPLACES AN ALL-OR-NOTHING PREDICATE, and it is the cheapest safety in step 9. The old
 * `clipsPresentOnDisk` was `clips.every(...)` and gated `offlineStatus`, `loadPlayback`,
 * `resignPlayback` and `listDownloadedDrives` — so ONE missing byte made a 40-stop drive vanish from
 * the dead-zone home list, read as "not downloaded" on its own screen, and error-wall the player, with
 * 39 perfectly good clips sitting on disk and "Download" (which needs network) as the only offered
 * recovery. A missing byte must cost ONE STOP. It was already a latent bug; the shared store is what
 * makes partial presence reachable, and it multiplies every other failure by the drive's length.
 */
function presentSeqs(driveId: string, m: OfflineManifest): number[] {
  const out: number[] = []
  for (const [seqStr, c] of Object.entries(m.clips)) {
    const seq = Number(seqStr)
    if (!Number.isFinite(seq)) continue // skip a tampered non-numeric key
    if (clipPresent(driveId, c)) out.push(seq)
  }
  return out
}

/** Does this drive have ANY playable byte on disk? (The "is there something to show/play" question —
 *  completeness is `offlineStatus().missingSeqs`.) */
function hasAnyClipOnDisk(driveId: string, m: OfflineManifest): boolean {
  for (const [, c] of Object.entries(m.clips)) if (clipPresent(driveId, c)) return true
  return false
}

/** Build the seq → local `file://` url map from a downloaded manifest. Only seqs whose bytes are
 *  actually present appear — a missing one is simply absent, exactly as it is for a partial download. */
function localUrlMap(driveId: string, m: OfflineManifest): Map<number, string> {
  const urls = new Map<number, string>()
  for (const [seqStr, c] of Object.entries(m.clips)) {
    const seq = Number(seqStr)
    if (!Number.isFinite(seq)) continue
    const uri = clipUri(driveId, c)
    if (uri) urls.set(seq, uri)
  }
  return urls
}

/** Does the local map cover every seq this drive expects audio for? */
function isLocallyComplete(m: OfflineManifest, urls: Map<number, string>): boolean {
  return urls.size > 0 && m.audioSeqs.every((seq) => urls.has(seq))
}

/** Whether a drive has a usable offline copy AND, for a PARTIAL download, which clips never landed. */
export interface OfflineStatus {
  /** A playable copy exists: a valid manifest with at least one of its clips present on disk. True for a
   *  PARTIAL download (it plays the stops it has) — read `missingSeqs` to tell partial from complete. */
  downloaded: boolean
  /** Expected-but-missing clip seqs — EMPTY means a COMPLETE download. Derived from the SAVED manifest
   *  (`audioSeqs` lists every expected clip) diffed against the bytes ACTUALLY on disk, so it survives an
   *  app restart — unlike the in-memory DownloadResult.failedSeqs — and now also catches a byte that
   *  went missing after the download. (audit #1) */
  missingSeqs: number[]
  /** Total clips this drive should have audio for. */
  expectedCount: number
}

/**
 * The on-disk offline status for a drive (ZERO network): whether a playable copy exists and, for a
 * partial download, the gap. null when nothing playable is on disk. This is the restart-safe successor
 * to a bare downloaded? boolean — a half-downloaded drive used to read as a clean "Saved offline" once
 * the in-memory download result was gone (audit #1); now the gap is re-derived from the disk itself.
 */
export function offlineStatus(driveId: string): OfflineStatus | null {
  const m = loadManifest(driveId)
  if (!m) return null
  const saved = presentSeqs(driveId, m)
  if (saved.length === 0) return null
  return {
    downloaded: true,
    missingSeqs: missingAudioSeqs(m.audioSeqs, saved),
    expectedCount: m.audioSeqs.length,
  }
}

/**
 * Is a downloaded drive's audio STALE vs the server's current content? Compares the content tokens
 * embedded in the saved manifest against a freshly-fetched manifest. ONLINE-ONLY by nature — the
 * caller already holds the fresh manifest (the drive screen fetches it to render), so this costs
 * ZERO extra network and is never run in a dead zone. Returns false when nothing is downloaded.
 * NEVER blocks playback: it only powers a "pull the fresh copy" affordance.
 *
 * ⚠ IT COMPARES MANIFESTS, NOT BYTES, and cannot ever be the guard against serving a superseded cut —
 * both manifests can be correct while the bytes are old. That is why the narration's revision is baked
 * into the store FILENAME (`planDriveClips`); this stays a UX affordance, not a safety property.
 */
export function isDownloadStale(driveId: string, fresh: DriveManifest): boolean {
  const m = loadManifest(driveId)
  if (!m) return false
  return contentSignature(m.detail) !== contentSignature(fresh)
}

// Offline downloads never auto-refresh: the device keeps its saved bytes indefinitely, so a
// facts_hash move / patch-clip / resynth never reaches an already-downloaded drive UNLESS the rider
// re-opens the detail screen while online (that's isDownloadStale's content-diff, plus topUpDrive).
// OFFLINE_TTL_DAYS is the time-based safety net that fires INDEPENDENT of that diff — even on a drive
// saved once and never re-opened, or held in a dead zone where no fresh fetch is possible. SOFT by
// design: the copy stays playable past expiry (never strand a rider mid-Tahoe — see CLAUDE.md), it just
// nudges a re-download. A starting value, ear/usage-tunable like the facts TTL. Secondary benefit: it
// bounds how long a baked Places break-name persists offline.
// Decision: docs/decisions/offline-freshness-ttl.md.
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

/** Everything the detail screen needs to describe a drive's offline state, from ONE manifest read.
 *
 *  ⚠ WHY THIS EXISTS RATHER THAN THREE CALLS. `offlineStatus`, `isDownloadExpired` and
 *  `downloadDirState` each independently `loadManifest`, and `loadManifest` is a SYNCHRONOUS
 *  `textSync()` + `JSON.parse` + migration walk with no memo — so asking all three (which is what a
 *  refresh does) paid three file reads and three parses on the JS thread, on focus, after every
 *  download and after every top-up. The three answers are three readings of ONE file; taking it once
 *  is both cheaper and the only way they cannot disagree about a manifest rewritten between reads.
 *
 *  Deliberately identical in outcome to calling the three: the directory check gates the read exactly
 *  the way `downloadDirState` does, and an absent/unreadable manifest yields the same null status and
 *  the same `false` expiry those functions return. */
export function offlineSnapshot(driveId: string): {
  status: OfflineStatus | null
  expired: boolean
  dirState: DownloadDirState
} {
  let dirExists = false
  try {
    dirExists = driveDir(driveId).exists
  } catch {
    dirExists = false
  }
  const m = dirExists ? loadManifest(driveId) : null
  const dirState: DownloadDirState = !dirExists ? 'none' : m ? 'ok' : 'unreadable'
  if (!m) return { status: null, expired: false, dirState }

  const saved = presentSeqs(driveId, m)
  const status: OfflineStatus | null =
    saved.length === 0
      ? null
      : { downloaded: true, missingSeqs: missingAudioSeqs(m.audioSeqs, saved), expectedCount: m.audioSeqs.length }
  return { status, expired: isPastTtl(m.savedAt, Date.now(), OFFLINE_TTL_DAYS), dirState }
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
 * Every drive with a playable offline copy, as a list-card, read from disk with ZERO network. Powers
 * the home screen's offline-first fallback: when the /drives fetch fails in a dead zone, the saved
 * drives stay browsable (and reachable) instead of a blank error wall.
 *
 * ⚠ "Playable", not "complete": a drive missing one byte still belongs here. Dropping it would hide a
 * 39-of-40 drive from a rider standing at a trailhead.
 */
export function listDownloadedDrives(): DriveSummary[] {
  const root = new Directory(Paths.document, 'drives')
  if (!root.exists) return []
  const out: DriveSummary[] = []
  for (const entry of root.list()) {
    // drive dirs only; each dir name IS the driveId.
    if (!(entry instanceof Directory)) continue
    try {
      const m = loadManifest(entry.name)
      if (m && hasAnyClipOnDisk(entry.name, m)) out.push(summaryFromManifest(m))
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
 * Reclaim shared clip bytes no saved drive still needs. Returns how many files were freed.
 *
 * ⚠ THE ONLY PATH ALLOWED TO REMOVE A SHARED BYTE. Everything else — a drive delete, a re-pull, a
 * top-up, a 404 cleanup — touches only `drives/<driveId>/`. It is a MARK-AND-SWEEP re-derived from
 * disk, never a persisted refcount: a count is a second source of truth whose drift is silent IN THE
 * DELETING DIRECTION, and the rider only finds out in a dead zone.
 *
 * The abort rules live in `./clip-store` next to the delete; this function only supplies the inputs.
 * ⚠ `readManifest` is `loadManifest`, which MIGRATES as a side effect — that is fine and deliberate:
 * it completes each drive's v4 re-key (bytes first, manifest last) BEFORE its names enter the keep-set,
 * so the sweep never sees a drive mid-migration. A drive it cannot read yields null and the whole sweep
 * aborts, which is the point.
 *
 * Run it at launch (a drive deleted server-side leaks its exclusive subjects otherwise) and after any
 * drive delete. Cost is one directory listing plus N manifest reads, N = saved drives.
 */
export function sweepOrphanClips(): number {
  return sweepStore({
    driveIds: downloadedDriveIds(),
    readManifest: (id) => loadManifest(id),
    // ⚠ Lets the sweep tell "this drive has no index" from "I cannot read this drive's index". Without
    // it, ONE hard kill between creating a drive dir and committing its manifest disables the sweep
    // FOREVER — every later run aborts on that dir, and orphans accumulate with nothing able to
    // reclaim them. The fail-closed rule is still fail-closed; it just stops being a hair trigger.
    hasManifest: (id) => {
      try {
        return manifestFile(id).exists
      } catch {
        return true // cannot tell ⇒ assume it has one ⇒ abort, which is the safe direction
      }
    },
    downloadsInFlight: inFlight.size > 0 || topUps.size > 0,
    busy: writingStoreNames,
  })
}

/**
 * Delete EVERY drive download on this device. Returns how many drives were reclaimed.
 *
 * For account deletion, and only that. `purgeUserData` erases the server side, but the copies on the
 * phone are the same rider's data and CLAUDE.md is unambiguous that erasure is immediate and total —
 * and after `deleteUser` the rider is anonymous, so home takes its signed-out branch and
 * `listDownloadedDrives` would hand the deleted account's drives to whoever picks the phone up next.
 * Those copies are also permanently unreclaimable by any other path: the server rows are gone, so no
 * future drive list can ever mention them.
 *
 * ⚠ IT MUST CLEAR THE SHARED STORE TOO (App Store 5.1.1(v)). The drive dirs now hold little more than
 * manifests; every megabyte of AUDIO is in `clips/`, and deleting only the dirs would leave all of it
 * on the phone — unreferenced, invisible to every code path, and chargeable to the rider's storage.
 * Bytes outlive the code that knew how to find them — the lesson stated in full above. And it must NOT be routed
 * through `sweepOrphanClips`: that sweep is deliberately fail-toward-KEEPING, and for a purge, keeping
 * bytes is the wrong direction.
 *
 */
export function deleteAllDriveDownloads(): number {
  // Keep NOTHING. Still excludes an in-flight download's DIR, which would otherwise have its files
  // pulled out from under the downloader mid-verify.
  // ⚠ topUps as well as inFlight. A top-up is a real transfer into the shared store, so excluding it
  // here while `sweepOrphanClips` already checks both would let an erasure race land more of the
  // deleted rider's audio after the purge ran — a 5.1.1(v) residue.
  const doomed = driveIdsToSweep(downloadedDriveIds(), [], [...inFlight.keys(), ...topUps.keys()])
  for (const driveId of doomed) removeDriveDir(driveId)
  deleteAllStoredClips()
  return doomed.length
}

/** Remove a drive's own directory (its manifest + any drive-local legacy bytes). Idempotent. Shared
 *  bytes are untouched by construction — they are not in here. */
function removeDriveDir(driveId: string): void {
  const dir = driveDir(driveId)
  if (dir.exists) {
    try {
      dir.delete()
    } catch {}
  }
}

/**
 * Remove a drive's offline download. Idempotent.
 *
 * ⚠ IT DELETES THE PER-DRIVE INDEX, THEN SWEEPS — it never reaches into the store itself. Deleting a
 * shared byte here would break every OTHER drive that names it, silently, discovered in a dead zone.
 * The sweep is what actually frees the space, and it is fail-closed: if any other drive's manifest is
 * unreadable, or a download is running, nothing is freed this pass. A rider may therefore see less
 * space returned than they expect; the honest alternative is explaining refcounts to someone in a car.
 */
export function deleteDriveDownload(driveId: string): void {
  removeDriveDir(driveId)
  sweepOrphanClips()
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
 * Load a drive for playback, OFFLINE-FIRST: a COMPLETE download returns the saved manifest + local
 * `file://` uris with ZERO network.
 *
 * ⚠ A PARTIAL copy tries the network first and falls back to what is on disk. Two halves, both
 * deliberate: online, streaming plays every stop including the ones that never landed; offline, the
 * `getDrive` throw is CAUGHT and the partial local map is served rather than error-walling the player.
 * That catch is the whole point — the old code fell straight through to `await getDrive(driveId)` the
 * moment one byte was missing, so a rider at a trailhead with 39 of 40 stops on disk got an error
 * screen whose only offered recovery was "Download".
 */
export async function loadPlayback(driveId: string): Promise<Playback> {
  const m = loadManifest(driveId) // load ONCE (don't check-then-reload the manifest)
  const local = m ? localUrlMap(driveId, m) : null
  if (m && local && isLocallyComplete(m, local)) {
    return { detail: m.detail, urls: local, offline: true }
  }
  try {
    const detail = await getDrive(driveId)
    return { detail, urls: urlMapFromDriveManifest(detail), offline: false }
  } catch (e) {
    if (m && local && local.size > 0) return { detail: m.detail, urls: local, offline: true }
    throw e
  }
}

/**
 * A fresh url map for the stall-recovery path. When the drive is fully downloaded it returns the LOCAL
 * file:// map (which never expires — and re-points a player that loaded ONLINE at the now-downloaded
 * files); otherwise it re-signs the presigned URLs (~1h TTL), falling back to whatever IS on disk when
 * that fails. Always returns a map when anything at all is playable.
 */
export async function resignPlayback(driveId: string): Promise<Map<number, string>> {
  const m = loadManifest(driveId)
  const local = m ? localUrlMap(driveId, m) : null
  if (m && local && isLocallyComplete(m, local)) return local
  try {
    const signed = await signDriveAudio(driveId)
    return urlMapFromDriveSigned(signed)
  } catch (e) {
    if (local && local.size > 0) return local
    throw e
  }
}

// ⚠ `reclaimLegacyRoamPack()` LIVED HERE until 2026-08-02. It deleted `Paths.document/roam-pack/` at
// launch — up to ~138 MB that roam's Save let a rider write and that nothing else could ever free
// once roam's own `deleteRoamPack()` and the "Remove saved stories" Settings row went with the mode.
// REMOVED on a founder call: no build that shipped roam's Save path ever reached a device, so no
// install can hold that directory and the reclaim could never fire. It was insurance against a
// population that turned out not to exist.
//
// ⚠ THE LESSON IT CARRIED IS NOT DELETED WITH IT, because it is load-bearing elsewhere in this file
// and in `clip-store.ts`: DELETING A FEATURE — OR AN ACCOUNT — DOES NOT DELETE ITS BYTES. Bytes
// outlive the only code that knew how to find them, and what is left is unreachable garbage:
// invisible to the app, chargeable to the rider's storage, removable only by deleting the app. That
// is why `deleteAllDriveDownloads` clears the shared clip store rather than only the drive dirs
// (App Store 5.1.1(v)), and why the launch sweep runs for drives dropped on a 404.
