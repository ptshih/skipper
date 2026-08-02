// THE SUBJECT-KEYED CLIP STORE — the NATIVE half (step 9). Every decision this module could make is
// already made, purely and under test, in `./offline-util` (`planV4Rekey`, `migrateV4ToV5`,
// `storeKeepSet`, `orphanStoreNames`, `parseStoreFileName`). What lives HERE is only what a pure
// function cannot express: the moves, the presence probes, the listing and the deletes. It contains
// no judgement of its own beyond "did the destination actually land", and that one judgement is the
// crash-safety contract (below).
//
// ⚠ THIS IS THE MODULE THAT MUST NEVER LOSE A RIDER'S DOWNLOAD. The failure it cannot have is a drive
// that still LISTS as downloaded but is missing audio, discovered in a dead zone: `useDrive`'s stall
// watchdog skips a clip that won't load after 400 ms with NO note, so a hole is SILENT by
// construction — the rider simply drives past a stop in silence. Every branch below bends toward
// keeping bytes: a collision deletes the SOURCE, an ambiguous outcome leaves BOTH copies, and the
// sweep deletes nothing at all unless it can prove the keep-set is complete.
//
// LAYOUT (⚠ `clips/` is a SIBLING of `drives/`, never a child — `listDownloadedDrives` and
// `downloadedDriveIds` treat every directory under `drives/` as a driveId, so a nested store would
// read as a phantom drive with an unreadable manifest AND become a delete target):
//
//   Paths.document/drives/<driveId>/manifest.json          the drive's own seq→bytes index (INV-6)
//   Paths.document/drives/<driveId>/<seq>.<ext>            legacy bytes: `shared: false` entries only
//   Paths.document/clips/<kind>-<subjectId>.<rev>.<ext>    THE STORE
//
// API (expo-file-system 57): `Directory`/`File`/`Paths`; `dir.create({intermediates,idempotent})`;
// `dir.list()` (THROWS when the dir is absent); `file.moveSync(dest)`; `file.delete()` (THROWS on a
// missing path); `file.size` — which returns **null**, not 0 and not a throw, for a missing file on
// iOS (`ios/FileSystemModule.swift` exposes it as `try? file.size`), so the `.d.ts`'s "0 if the file
// does not exist" is wrong and `(size ?? 0) > 0` is the only correct presence check.
//
// ⚠ It does NOT import `./offline` — that module imports this one. Everything it needs from the
// caller (the drive manifests, whether a download is in flight) arrives as a parameter, which is also
// what keeps the fail-closed rule HERE, next to the delete, rather than at a call site that can
// forget it.
//
// INV-13: nothing in this file logs a path, an id, or anything else derived from rider content.

import { Directory, File, Paths } from 'expo-file-system'
import { migrateV4ToV5, orphanStoreNames, planV4Rekey, storeKeepSet } from './offline-util'

/* -------------------------------------------------------------------------- */
/*  The store directory                                                        */
/* -------------------------------------------------------------------------- */

// Whether this process has already ensured `clips/` exists. `create({idempotent:true})` is cheap but
// not free, and `storedClipUri`/`hasStoredClip` run once per clip on read paths that render — so the
// syscall is paid once per launch instead of once per stop. Reset by `deleteAllStoredClips` (the only
// code that removes the directory) and left false when a create throws, so a disk-full launch retries.
let storeDirEnsured = false

/**
 * The shared clip store, created if absent.
 *
 * ⚠ A move does NOT create intermediate directories (VERIFIED in the installed native source: iOS's
 * `getMoveOrCopyPath` only concatenates a URL; Android throws `DestinationDoesNotExistException`), so
 * the directory must exist before the first `moveSync` — this is where that happens.
 */
export function clipStoreDir(): Directory {
  const dir = new Directory(Paths.document, 'clips')
  if (!storeDirEnsured) {
    try {
      dir.create({ intermediates: true, idempotent: true })
      storeDirEnsured = true
    } catch {
      // Out of space / a transient FS error. Leave the flag false and let the caller's own guard
      // decide: a failed migration step keeps its bytes drive-local and playable, which is the point.
    }
  }
  return dir
}

/**
 * A filename safe to address inside the store.
 *
 * ⚠ A manifest read from disk is `JSON.parse`'d and shape-checked, NOT re-validated, so every name
 * that reaches a path builder here is untrusted input: a `/` or a `..` would address bytes OUTSIDE
 * the store — including a drive's `manifest.json`. This is deliberately a PATH-SAFETY guard and not a
 * full `parseStoreFileName`: a name written by a FUTURE build (a rev format this one has never seen)
 * must still resolve and play, and only the sweep — where the cost of being wrong is a deletion —
 * demands a name it can fully parse.
 */
function isSafeStoreName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('\0')
  )
}

/** `exists && size > 0`, never throwing. Both properties can throw on a path torn down mid-scan (a
 *  concurrent delete), and a throw there must read as "not present", never abort the caller's pass. */
function hasBytes(f: File): boolean {
  try {
    return f.exists && (f.size ?? 0) > 0
  } catch {
    return false
  }
}

/**
 * Is this store filename present AND non-empty?
 *
 * ⚠ THE ONLY DEFINITION OF SUCCESS IN THIS MODULE. A move's outcome is judged by the DESTINATION —
 * never by "the move did not throw" (a `Directory` destination silently keeps the SOURCE filename and
 * throws nothing) and never by the source's absence ("source gone, destination present" is the normal
 * RESUME state after a crash mid-migration, not a failure). Nonzero because no manifest carries a
 * size or a hash, so presence + bytes>0 is the only integrity signal we have — the same rule
 * `downloadFileWithRetry`'s verify already uses.
 *
 * Returns false (never throws) for a name that isn't safe to address, so a resolver written as
 * `hasStoredClip(name) ? storedClipUri(name) : …` can never reach `storedClipUri`'s throw.
 */
export function hasStoredClip(name: string): boolean {
  if (!isSafeStoreName(name)) return false
  return hasBytes(new File(clipStoreDir(), name))
}

/**
 * A stored clip's local `file://` uri.
 *
 * ⚠ THROWS on a name that could escape the store. The manifest stores RELATIVE names precisely
 * because the document container path changes across app updates, so the uri is rebuilt here at read
 * time — and a tampered/corrupt name must be loud rather than silently addressing bytes outside
 * `clips/`. Pair it with `hasStoredClip` (which is total) and the throw is unreachable. The message
 * carries no rider content (INV-13).
 */
export function storedClipUri(name: string): string {
  if (!isSafeStoreName(name)) {
    throw new Error('offline store: refusing to address an unsafe clip name')
  }
  return new File(clipStoreDir(), name).uri
}

/* -------------------------------------------------------------------------- */
/*  The v4 → v5 re-key                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A drive's own directory. Duplicated from `offline.ts` (one line) rather than imported: `offline.ts`
 * imports THIS module, so importing back would be a cycle. The shape is fixed by the layout comment
 * at the top of the file and by `listDownloadedDrives`, not by either copy.
 */
function driveDir(driveId: string): Directory {
  return new Directory(Paths.document, 'drives', driveId)
}

/** Delete a file if it is there. `delete()` throws on a missing path, and every caller here is
 *  reclaiming a KNOWN-duplicate source, so a failure is never worth propagating. */
function deleteQuietly(f: File): void {
  try {
    if (f.exists) f.delete()
  } catch {}
}

/**
 * Move ONE clip's bytes from a drive dir into the store. Returns whether the store now holds them.
 *
 * ⚠ THE MOVE, EXACTLY — every clause is load-bearing and was verified against the installed native
 * source (expo-file-system 57.0.1):
 *
 *   - **A `File` destination, never a `Directory`.** A `Directory` destination keeps the SOURCE
 *     filename (iOS `FileSystemPath.getMoveOrCopyPath` appends `url.lastPathComponent`), which would
 *     silently produce a store keyed on the old SEQ — a store that looks populated while being keyed
 *     on a position in one drive, exactly what INV-16 forbids. It throws nothing and passes any "no
 *     exception" test. This is the silent byte-dropper of the three possible behaviours.
 *   - **No `overwrite` option, anywhere.** The default is `false`, which makes a collision THROW
 *     while touching neither file. `overwrite: true` is `removeItem(dest)` THEN `moveItem` — a real
 *     window in which NEITHER copy exists — so it can destroy a byte that was already good. There is
 *     never a reason to reach for it here.
 *   - **A collision is resolved by deleting the SOURCE. Never the destination, on any path, ever.**
 *     Safe because the revision is in the filename: two drives can only collide on a name when they
 *     carry the same `revisedAt`, i.e. the bytes are provably identical.
 *   - **If the move throws, RE-CHECK the destination.** A concurrent pass may have just landed it; if
 *     it is now present the source is a verified duplicate and is droppable. Otherwise leave BOTH and
 *     let the next launch retry — the rider is never left with neither.
 *
 * ⚠ A zero-byte destination (a torn write) is NOT deleted, deliberately: "never the destination"
 * admits no exception a future reader could widen. The move then throws, this clip stays drive-local
 * and playable, and the empty file is left for the sweep to reclaim once no manifest names it.
 */
function placeOne(dir: Directory, fromName: string, toName: string): boolean {
  const src = new File(dir, fromName)
  if (!hasStoredClip(toName)) {
    try {
      // Nothing to move (the resume state, or a byte lost before this build ran) — fall through to
      // the destination check, which is the only thing allowed to declare success.
      if (hasBytes(src)) src.moveSync(new File(clipStoreDir(), toName))
    } catch {
      // A collision with a concurrent pass, a full disk, a permissions fault. The destination check
      // below decides; nothing is deleted on this path.
    }
  }
  const landed = hasStoredClip(toName)
  // Only once the store is PROVEN to hold the bytes is the drive-local copy droppable. After a clean
  // move the source is already gone and this is a no-op; after a collision it reclaims a duplicate.
  if (landed) deleteQuietly(src)
  return landed
}

/**
 * Carry one drive's saved download from manifest v4 to v5, moving its bytes into the shared store on
 * the way. Registered by `offline.ts` as the v4 step of the migration ladder, closed over the driveId
 * (`MANIFEST_MIGRATIONS[4] = (raw) => migrateDriveV4(driveId, raw)`).
 *
 * ⚠ ORDER: the bytes move FIRST; the caller's manifest write is the COMMIT POINT. The reverse order
 * would leave a v5 manifest pointing at `clips/` paths that do not exist yet, with the real bytes
 * still in `drives/<id>/` referenced by nothing — and therefore eligible for a sweep that consults
 * only manifests. Silent, permanent loss. In this order a crash leaves a still-valid v4 manifest plus
 * some bytes already in the store, and the next launch re-runs the migration, finds those
 * destinations present, and finishes the job.
 *
 * ⚠ WHY THIS RUNS LAZILY INSIDE `loadManifest` rather than in a launch effect: every reader funnels
 * through `loadManifest`, and it is SYNCHRONOUS — so no reader can ever observe a half-migrated v4,
 * and a network fetch is not even expressible here. Which is precisely why the re-key has to be a
 * MOVE: the subject identity must be derivable from what is already on disk. It is (`storeKeyForClip`
 * maps a pre-step-4 `poiId` to its subject BY IDENTITY, not by inference), so the whole migration is
 * zero-network — and a same-volume move is a `rename(2)`, needing ~0 additional bytes, which a
 * copy-based migration would not.
 *
 * Never returns null for a v4 input: `migrateV4ToV5`'s contract is total, because null reads to every
 * caller as "never downloaded" and would retire a whole download while its audio sits on disk. The
 * `| null` exists only to satisfy `ManifestMigration`. A clip whose bytes did not land in the store —
 * an unidentifiable pre-step-4 FUSED telling, a move that failed, a crash between two moves — keeps
 * its original drive-local name with `shared: false` and plays exactly as it does today.
 *
 * `savedAt` is carried through verbatim by the pure half; restamping it would silently reset every
 * rider's offline freshness TTL on a copy that could be months old.
 */
export function migrateDriveV4(
  driveId: string,
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  const placed = new Set<string>()
  if (isSafeStoreName(driveId)) {
    const dir = driveDir(driveId)
    for (const step of planV4Rekey(raw)) {
      // `toName: null` = the subject is not recoverable offline (a pre-step-4 fused cluster telling
      // has `poiId: null` BY DESIGN and no `subjectId`). Those are Emerald Bay and downtown Reno:
      // their bytes are perfectly good audio and only the NAME is unrecoverable. Nothing to move.
      if (step.toName == null) continue
      // A source name off disk is untrusted the same way a store name is.
      if (!isSafeStoreName(step.fromName)) continue
      try {
        if (placeOne(dir, step.fromName, step.toName)) placed.add(step.toName)
      } catch {
        // Belt and braces: one clip's failure must never abort the drive's migration, and a throw out
        // of here would propagate through `loadManifest` into every reader.
      }
    }
  }
  // ⚠ `placed` holds only the names VERIFIED PRESENT in the store — not "the moves that did not
  // throw". That set IS the crash-safety contract; see `migrateV4ToV5`.
  return migrateV4ToV5(raw, placed)
}

/* -------------------------------------------------------------------------- */
/*  Reclamation                                                                */
/* -------------------------------------------------------------------------- */

/** What the sweep needs from `offline.ts`, passed in rather than imported (this module cannot import
 *  `./offline` — that is a cycle). */
export interface StoreSweepInput {
  /** Every drive directory on disk (each dir name IS the driveId) — `downloadedDriveIds()`. */
  driveIds: Iterable<string>
  /** `loadManifest`. ⚠ MUST return null for a manifest it cannot read; the sweep's whole safety rests
   *  on being able to tell "this drive references nothing" from "I could not read this drive". */
  readManifest: (driveId: string) => { clips?: unknown } | null
  /** True while ANY download is running — `inFlight.size > 0`. */
  downloadsInFlight: boolean
  /** Store filenames currently being written. A subject mid-transfer is referenced by NO manifest yet
   *  (the manifest is written last, deliberately), so without this a sweep would call it an orphan
   *  and delete it out from under the downloader as it verifies it. */
  busy?: Iterable<string>
  /** Does this drive have a `manifest.json` AT ALL? ⚠ This is what keeps the fail-closed rule from
   *  being permanently disabled by a single hard kill. A SIGKILL between creating a drive dir and
   *  writing its manifest leaves a directory with no index — `readManifest` returns null for it
   *  forever, and without this predicate the sweep would abort on EVERY run from then on, so
   *  re-synth orphans and deleted drives' bytes would accumulate with nothing able to reclaim them.
   *  A dir with no manifest references nothing, so skipping it is safe: any shared byte it did land
   *  is either named by some OTHER drive's manifest (and kept) or genuinely unreferenced (and is
   *  exactly what the sweep is for). Absent ⇒ skip; present-but-unreadable ⇒ still abort. */
  hasManifest?: (driveId: string) => boolean
}

/**
 * Delete the store files no drive manifest accounts for. Returns how many were reclaimed.
 *
 * MARK-AND-SWEEP, NOT A REFCOUNT — and that is a decision, not an accident. A persisted count is a
 * second source of truth whose drift is silent IN THE DELETING DIRECTION: an under-count deletes live
 * bytes and the rider only finds out in a dead zone. The manifests ARE the refcount, re-derived from
 * disk on every run, self-healing, and impossible to desynchronize.
 *
 * ⚠ FAIL-CLOSED. It deletes NOTHING AT ALL when:
 *   - any directory under `drives/` yields a null (unreadable, truncated, future-version) manifest —
 *     an unreadable manifest contributes zero names, and that must mean "keep everything", never
 *     "references nothing". `repairDownload` exists to recover exactly that drive NON-destructively;
 *     sweeping first would turn a recoverable state into permanent loss;
 *   - a download is in flight, for the reason on `busy` above;
 *   - the computed keep-set is empty, because this function cannot tell a genuinely-empty keep-set
 *     from one that failed to build.
 * This is the same hazard `driveIdsToSweep` already documents one layer up ("an empty `keep`
 * therefore sweeps everything"), one level down and worse: these are the rider's audio bytes, not a
 * re-fetchable index. A leak is recoverable; a deleted download at a trailhead is not.
 *
 * ⚠ CONSEQUENCE, ACCEPTED: a rider who removes their LAST download leaks its bytes — the keep-set is
 * then legitimately empty and the abort cannot distinguish it. The erasure path
 * (`deleteAllStoredClips`) is what clears the store outright; a leak is the safe side of this trade.
 *
 * ⚠ NO OTHER PATH MAY REMOVE A SHARED BYTE. In particular `runDownload`'s opening "clean re-pull"
 * delete must only clear the per-drive index: it is the EVERYDAY path and a far more likely
 * shared-byte deleter than the rare drive delete.
 *
 * Listing-driven, never name-prediction-driven (a subject re-encoded between download and read would
 * predict a name that doesn't match the bytes on disk), and a name `parseStoreFileName` rejects is
 * never deleted — forward-compat, so a future build's rev format can't be eaten by today's sweep.
 */
export function sweepOrphanClips(input: StoreSweepInput): number {
  if (input.downloadsInFlight) return 0

  const manifests: { clips?: unknown }[] = []
  for (const driveId of input.driveIds) {
    let m: { clips?: unknown } | null = null
    try {
      m = input.readManifest(driveId)
    } catch {
      return 0 // could not read ⇒ the keep-set is incomplete ⇒ delete nothing
    }
    if (!m) {
      // No index AT ALL ⇒ this drive references nothing and cannot be made incomplete by us. Skip it.
      // An index that EXISTS but will not parse is the dangerous case — it may name shared bytes we
      // cannot see — so that still aborts the whole sweep. See `hasManifest`.
      if (input.hasManifest && !input.hasManifest(driveId)) continue
      return 0
    }
    manifests.push(m)
  }

  const keep = storeKeepSet(manifests)
  if (keep.size === 0) return 0

  const dir = clipStoreDir()
  let onDisk: string[]
  try {
    if (!dir.exists) return 0
    onDisk = dir.list().flatMap((e) => (e instanceof File ? [e.name] : []))
  } catch {
    return 0
  }

  let reclaimed = 0
  for (const name of orphanStoreNames(onDisk, keep, input.busy ?? [])) {
    try {
      const f = new File(dir, name)
      if (f.exists) {
        f.delete()
        reclaimed += 1
      }
    } catch {
      // Best-effort: a file that won't delete is a leak, and a leak is never worth aborting the rest.
    }
  }
  return reclaimed
}

/**
 * Delete the ENTIRE store. Returns how many clip files it held.
 *
 * ⚠ ACCOUNT DELETION ONLY — App Store 5.1.1(v) / CLAUDE.md: erasure is immediate and total. Under the
 * shared store, deleting the drive directories reclaims only the manifests; every megabyte of audio
 * would survive an account purge, unreferenced, invisible to every other code path, and chargeable to
 * the rider's storage. That is `reclaimLegacyRoamPack`'s lesson repeated — DELETING A FEATURE (or an
 * account) DOES NOT DELETE ITS BYTES.
 *
 * ⚠ Deliberately NOT routed through `sweepOrphanClips`: that sweep is fail-toward-KEEPING (it aborts
 * on an unreadable manifest, an in-flight download and an empty keep-set), and for a purge keeping
 * bytes is the WRONG direction. This one is unconditional.
 */
export function deleteAllStoredClips(): number {
  const dir = clipStoreDir()
  let count = 0
  try {
    if (!dir.exists) return 0
    count = dir.list().filter((e) => e instanceof File).length
  } catch {
    count = 0 // couldn't count; the delete below still has to happen
  }
  try {
    if (dir.exists) dir.delete()
  } catch {}
  // The directory is gone, so the memo must not claim it exists — the next store access re-creates it.
  storeDirEnsured = false
  return count
}
