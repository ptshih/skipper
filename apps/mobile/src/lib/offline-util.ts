// Pure, native-free offline helpers (no expo-file-system / api / auth imports) so they
// unit-test under `bun test`. offline.ts (which IS native) re-uses these.

import type { DriveClip, SignedDriveAudio } from '@skipper/shared'

/** MIME → on-disk extension. Driven by the sign response's `contentType`, never hardcoded. */
const EXT_BY_TYPE: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
}
export function extForContentType(contentType: string): string {
  return EXT_BY_TYPE[contentType.toLowerCase()] ?? 'mp3'
}

/* -------------------------------------------------------------------------- */
/*  Drive playback url maps (seq-keyed)                                          */
/* -------------------------------------------------------------------------- */

/**
 * The seq → url map for a V2 DRIVE manifest. A driveManifest carries its clips' presigned URLs
 * inline (GET /drives/:id already signs), so online playback maps straight off the manifest —
 * no separate sign call. Every clip is a place narration keyed by its `seq`. (V2 has no placeless
 * framing — asides were deleted; see docs/decisions/geometry-first-regions.md.)
 */
export function urlMapFromDriveManifest(manifest: { clips: DriveClip[] }): Map<number, string> {
  const m = new Map<number, string>()
  for (const c of manifest.clips) {
    if (!c.url) continue // a silent beat (rest) carries no audio
    m.set(c.seq, c.url)
  }
  return m
}

/**
 * The seq → url map for a drive's re-presign response (the offline-refresh / stall-recovery path).
 * `signedDriveAudio` is flat — keyed by the same `seq` the manifest used — so this is a direct map.
 */
export function urlMapFromDriveSigned(signed: SignedDriveAudio): Map<number, string> {
  return new Map<number, string>(signed.clips.map((c) => [c.seq, c.url]))
}

/* -------------------------------------------------------------------------- */
/*  Offline completeness (pure set math; offline.ts wires in the on-disk set)   */
/* -------------------------------------------------------------------------- */

/** A clip has downloadable audio iff it carries BOTH a url and a contentType — a silent beat (rest)
 *  has neither and is never fetched. A TYPE GUARD (narrows url/contentType to non-null), so the download
 *  list AND the completeness check share ONE predicate and "what we should have" can't drift between them.
 *  Intentionally STRICTER than online playback (`urlMapFromDriveManifest` streams on a url ALONE): the
 *  downloader needs the contentType for the on-disk extension, so a clip with no contentType is genuinely
 *  un-downloadable and is correctly NOT "expected" offline (re-pulling could never land it). The two
 *  predicates only diverge on a url-without-contentType clip, which the API never emits (it signs the url
 *  and sets the contentType together) — so completeness never under-counts a downloadable stop. */
export function hasDownloadableAudio<T extends { url?: string | null; contentType?: string | null }>(
  c: T,
): c is T & { url: string; contentType: string } {
  return Boolean(c.url) && Boolean(c.contentType)
}

/** The player seqs a drive SHOULD have downloadable audio for (every clip past `hasDownloadableAudio`). */
export function expectedAudioSeqs(clips: DriveClip[]): number[] {
  return clips.filter(hasDownloadableAudio).map((c) => c.seq)
}

/**
 * The expected audio seqs MISSING from the saved set — the offline-completeness predicate. Empty means a
 * COMPLETE download. Pure set difference: `expectedSeqs` is the list the manifest PERSISTS (the seqs that
 * had audio at download time — OfflineManifest.audioSeqs), `savedSeqs` is the subset that actually landed.
 * Persisting the expected list (rather than re-deriving it from the saved detail) is what lets the detail's
 * presigned clip URLs be stripped on disk (audit #9) without losing the partial-vs-complete signal after a
 * restart. (audit #1)
 */
export function missingAudioSeqs(expectedSeqs: number[], savedSeqs: Iterable<number>): number[] {
  const saved = new Set(savedSeqs)
  return expectedSeqs.filter((seq) => !saved.has(seq))
}

/* -------------------------------------------------------------------------- */
/*  Offline content signature (staleness diff vs the server's current cut)      */
/* -------------------------------------------------------------------------- */

/**
 * Fold a drive's per-clip content tokens (`revisedAt`) + clip set into one comparable string. Any drift
 * changes it: a clip re-synth (token bumps), a regen (fresh narration → fresh token), or a clip
 * added/removed (the seq set changes). SORTED by seq, so a reordered-but-identical clip list compares
 * EQUAL (never a false "stale" nag). Pure — offline.ts diffs the saved manifest's detail against the fresh
 * one with it; it reads only seq + revisedAt, so it is unaffected by the on-disk url strip (audit #9).
 */
export function contentSignature(d: { clips: DriveClip[] }): string {
  const clips = d.clips
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((c) => `${c.seq}:${c.revisedAt ?? ''}`)
    .join(',')
  return `clips[${clips}]`
}

/* -------------------------------------------------------------------------- */
/*  Which downloads to reclaim (pure set math; offline.ts does the deleting)    */
/* -------------------------------------------------------------------------- */

/**
 * The drive ids on disk that the rider's current drive list doesn't account for — i.e. deleted
 * elsewhere, or belonging to another account. `busy` (a download mid-write) is never swept: deleting
 * those files under the downloader as it verifies them would turn a good copy into a broken one.
 *
 * ⚠ This function CANNOT tell a genuinely-empty list from a failed fetch, and an empty `keep`
 * therefore sweeps everything. Today its ONLY caller passes an empty keep deliberately
 * (`deleteAllDriveDownloads`, the account-deletion purge). If a caller ever passes a SERVER list
 * here, that list must come from a fetch that SUCCEEDED — a failed one is indistinguishable at this
 * layer and would wipe every saved drive in a dead zone. Pure + tested because it decides deletions.
 */
export function driveIdsToSweep(
  onDisk: Iterable<string>,
  keep: Iterable<string>,
  busy: Iterable<string> = [],
): string[] {
  const keepSet = new Set(keep)
  const busySet = new Set(busy)
  const out = new Set<string>()
  for (const id of onDisk) {
    if (keepSet.has(id) || busySet.has(id)) continue
    out.add(id)
  }
  return Array.from(out)
}

/* -------------------------------------------------------------------------- */
/*  Saved-manifest migration (pure walk; offline.ts wires in the file + table)  */
/* -------------------------------------------------------------------------- */

/** One step of a saved-manifest upgrade: take the manifest at version N, return it at N+1 (with
 *  `version` bumped), or null if THIS download can't be carried across. */
export type ManifestMigration = (m: Record<string, unknown>) => Record<string, unknown> | null

/** A runaway backstop for a corrupt/lying `version`, not a real bound on the chain. */
const MAX_MIGRATION_STEPS = 16

/**
 * Walk a saved manifest forward to `target`, one registered migration at a time. Returns the
 * migrated object (the SAME object when it was already current), or null when there is no path
 * across — a genuine shape break, a missing migration, or a migration that fails to make progress.
 *
 * Pure so the thing standing between an app update and a rider's saved drives is actually testable.
 * The failure this exists to prevent: a bare `version !== CURRENT → null` gate reads to every caller
 * as "never downloaded", which silently retires every saved download on the next update while its
 * audio stays on disk, unreachable and unswept.
 */
export function migrateToVersion(
  raw: Record<string, unknown>,
  target: number,
  migrations: Record<number, ManifestMigration>,
): Record<string, unknown> | null {
  let m = raw
  for (let step = 0; typeof m.version === 'number' && m.version < target; step++) {
    if (step >= MAX_MIGRATION_STEPS) return null
    const migrate = migrations[m.version]
    if (!migrate) return null
    const next = migrate(m)
    // A migration that returns the same version would spin forever; treat it as no path across.
    if (!next || next.version === m.version) return null
    m = next
  }
  return m
}

/* -------------------------------------------------------------------------- */
/*  Offline freshness TTL (pure date math; offline.ts wires in savedAt + now)   */
/* -------------------------------------------------------------------------- */

const DAY_MS = 24 * 60 * 60 * 1000

/** Days between an ISO timestamp and `now` (ms epoch). Null if the timestamp is unparseable.
 *  Clamped at 0 so a clock skew (a timestamp in the future) never reads as negative age. */
export function daysSinceIso(iso: string, now: number): number | null {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.max(0, (now - t) / DAY_MS)
}

/** Is an ISO timestamp strictly older than `ttlDays` relative to `now`? False when unparseable —
 *  fail-OPEN, since a freshness nudge must never fire on a manifest we can't even date. */
export function isPastTtl(iso: string, now: number, ttlDays: number): boolean {
  const age = daysSinceIso(iso, now)
  return age != null && age > ttlDays
}

/* -------------------------------------------------------------------------- */
/*  Saved-shape enforcement (harvested from the deleted roam pack)              */
/* -------------------------------------------------------------------------- */

/**
 * A wire object as SAVED. A served `url` is a presigned R2 credential with a short TTL, so it must
 * never reach disk — it is reconstructed as a `file://` uri at read time.
 *
 * ⚠ The point is that the TYPE does the enforcing, rather than a `map(c => ({...c, url: null}))`
 * anyone can forget: `url` is absent from the saved shape, so persisting one is a COMPILE ERROR.
 * That is a strictly stronger guarantee than the null-it-out convention, which `offline.ts` still
 * uses at two sites and which is only as good as the next person's memory.
 *
 * Carried forward verbatim from the roam pack's `PackPin` when roam was deleted: the pattern was the
 * durable half of that module, and it is what step 9's subject-keyed store wants. Generic here rather
 * than bound to one DTO, since the constraint is about `url`, not about pins.
 */
export type Saved<T extends { url?: unknown }> = Omit<T, 'url'>

/** A clip's on-disk filename, keyed by an opaque subject id. The extension follows the SERVED
 *  contentType, never a hardcoded guess — also harvested from the roam pack, where the id could be
 *  either a poi or a cluster and the filename had to be safe for both. */
/** ⚠ NOT THE STORE PATH BUILDER — use `storeFileName`. This has NO revision segment, so keying the
 *  shared store on it would make two revisions of one telling collide on a single filename, and a
 *  re-synthed clip would be served stale FOREVER with nothing able to detect it (the manifests are
 *  correct; only the bytes are wrong). Kept because it is the harvested roam-pack shape and reads like
 *  the obvious choice — which is exactly why it needs this sign on it. */
export function savedClipFileName(subjectId: string, contentType: string): string {
  return `${subjectId}.${extForContentType(contentType)}`
}

/* -------------------------------------------------------------------------- */
/*  THE SUBJECT-KEYED CLIP STORE — naming, re-key planning, sweep math (step 9) */
/* -------------------------------------------------------------------------- */

/*
 * The store collapses N per-drive copies of one telling into ONE file at
 * `Paths.document/clips/<kind>-<subjectId>.<rev>.<ext>`, while each drive's `manifest.json` stays
 * SEQ-keyed (INV-6: a drive's own manifest is the sole authority for that drive; the seq→subject
 * join already lives in `detail.clips` and must not be copied to a second place that can drift).
 *
 * ⚠ `clips/` is a SIBLING of `drives/`, never a child: `listDownloadedDrives`/`downloadedDriveIds`
 * treat every directory under `drives/` as a driveId, so a nested store would read as a phantom
 * drive with an unreadable manifest — and become a delete target.
 *
 * Everything in this section is PURE on purpose. It decides where a rider's downloaded audio lives
 * and which bytes get deleted, and `bun test` is the only place that truth can be asserted (there
 * is no filesystem and no renderer in this workspace — see the header of this file). The native
 * half executes what these functions decide and adds no branching of its own.
 */

/** The two narration subjects: a `pois` row or a `poi_clusters` row (INV-16). */
export type SubjectKind = 'poi' | 'cluster'

const SUBJECT_KINDS = ['poi', 'cluster'] as const

/** The revision token for a clip whose `revisedAt` we cannot date.
 *  ⚠ POLICY FOR THE CALLER (the top-up owns this, not this module): a `'0'` entry is treated as
 *  ABSENT whenever the incoming manifest carries a REAL `revisedAt` — i.e. re-download once, when
 *  online. Treating it as present would re-open the stale-telling hole below for exactly the clips
 *  whose provenance we can't establish. The server populates `revisedAt` today; this is defence
 *  against a future null, and it is cheap. */
export const UNKNOWN_REV = '0'

/** ⚠ THE HIGHEST-VALUE DECISION IN THE STORE: the narration's revision is IN THE FILENAME.
 *
 * Without it a re-synthed telling is served STALE and INVISIBLY. Drive A stores subject S at
 * revision T0; the operator re-synths; drive B's manifest says T1; the top-up asks "is S present?"
 * → yes → skips; B plays T0 forever. `isDownloadStale` cannot see it — `contentSignature` compares
 * MANIFESTS (`seq:revisedAt`) and BOTH manifests are correct; the BYTES are wrong and nothing
 * compares bytes to a manifest. Under the old per-drive storage this was structurally impossible;
 * collapsing to one copy is what creates it. Keying the file on (subject, revision) makes it
 * impossible again — and makes every remaining collision provably byte-identical, which is why the
 * collision resolution ("delete the SOURCE") is lossless.
 *
 * Digits only: the token sits between two dots, and a '-' would collide with the
 * `<kind>-<subjectId>` separator. A negative (pre-1970) narration timestamp is nonsense, so it
 * degrades to UNKNOWN_REV rather than producing an unparseable name.
 */
export function revisionToken(revisedAt: unknown): string {
  if (typeof revisedAt !== 'string') return UNKNOWN_REV
  const t = Date.parse(revisedAt)
  return Number.isFinite(t) && t >= 0 ? String(t) : UNKNOWN_REV
}

/** Everything needed to address one telling's bytes in the shared store. */
export interface StoreKey {
  subjectId: string
  subjectKind: SubjectKind
  /** ms-epoch of the narration's `revisedAt`, or UNKNOWN_REV. See `revisionToken`. */
  rev: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A subject id safe to use as a filename. The wire type is `z.uuid()`, but a manifest read from
 * disk is `JSON.parse`'d and shape-checked — NOT re-validated — so any id reaching a path builder
 * is untrusted input, and one containing `/` or `..` would address bytes OUTSIDE the store.
 * The uuid shape is the guard because it is what the server actually mints.
 */
export function isSafeSubjectId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id)
}

/**
 * The store filename for a telling. `<kind>-<subjectId>.<rev>.<ext>`: the kind costs nothing, makes
 * an on-disk listing debuggable, and gives the sweep a shape to validate before it deletes.
 *
 * ⚠ THROWS on a key that could escape the store. Unreachable from the real paths — the only two
 * constructors of a `StoreKey` (`storeKeyForClip`, `parseStoreFileName`) both refuse an unsafe id —
 * so a throw here means someone hand-built a key from untrusted data, which is exactly the bug that
 * must be loud rather than a silent write to a path outside `clips/`. The message carries no rider
 * content (INV-13).
 */
export function storeFileName(k: StoreKey, contentType: string): string {
  const kindOk = (SUBJECT_KINDS as readonly string[]).includes(k.subjectKind)
  if (!isSafeSubjectId(k.subjectId) || !kindOk || !/^\d+$/.test(k.rev)) {
    throw new Error('offline store: refusing to build a filename from an unsafe subject key')
  }
  return `${k.subjectKind}-${k.subjectId}.${k.rev}.${extForContentType(contentType)}`
}

/**
 * The inverse of `storeFileName`, for the sweep.
 *
 * ⚠ `null` means NEVER DELETE THIS FILE. The sweep is listing-driven (enumerate `clips/`, subtract
 * the names taken VERBATIM from manifests), so an unrecognised name is exactly the case where "we
 * don't know" must mean "don't touch" — including a name written by a FUTURE build whose rev format
 * this one has never seen. A leak is recoverable; a deleted download in a dead zone is not.
 */
export function parseStoreFileName(name: unknown): StoreKey | null {
  if (typeof name !== 'string') return null
  const parts = name.split('.')
  if (parts.length !== 3) return null
  const [head, rev, ext] = parts
  if (!head || !rev || !ext) return null
  if (!/^\d+$/.test(rev)) return null
  if (!/^[a-z0-9]+$/i.test(ext)) return null
  const dash = head.indexOf('-') // 'poi' / 'cluster' contain none; the uuid's start at the id
  if (dash <= 0) return null
  const subjectKind = head.slice(0, dash)
  const subjectId = head.slice(dash + 1)
  if (!(SUBJECT_KINDS as readonly string[]).includes(subjectKind)) return null
  if (!isSafeSubjectId(subjectId)) return null
  return { subjectId, subjectKind: subjectKind as SubjectKind, rev }
}

/**
 * The store key for one clip, or null when its subject is not recoverable from what's on hand.
 *
 * ⚠ `poiId` is NOT the identity (INV-16). It is null BY DESIGN for a fused cluster telling, so a
 * store keyed on it cannot tell a fused clip from a broken one. Precedence, and every branch is
 * exact rather than inferred:
 *   - `subjectId` + `subjectKind` → that pair, verbatim (the post-step-4 wire).
 *   - `subjectId` with no kind → 'poi'. The server sets `subjectKind: 'cluster'` on every fused
 *     clip in the same object literal that sets `subjectId`, so a kindless id is a poi.
 *   - no `subjectId`, a `poiId` → `{poiId, 'poi'}` BY IDENTITY: the server sets
 *     `subjectId: r.poiId` for a poi telling. This is what re-keys a pre-step-4 manifest with ZERO
 *     network — it is not a guess.
 *   - anything else → null: a pre-step-4 FUSED telling (`poiId: null`, no `subjectId`), a garbage
 *     kind, or a tampered id. Its bytes stay drive-local and PLAYABLE; see `migrateV4ToV5`.
 * Takes `unknown` fields because the caller's data may have come off disk unvalidated.
 */
export function storeKeyForClip(c: {
  poiId?: unknown
  subjectId?: unknown
  subjectKind?: unknown
  revisedAt?: unknown
}): StoreKey | null {
  const rev = revisionToken(c.revisedAt)
  const kind = c.subjectKind
  if (c.subjectId != null) {
    // Present-but-unsafe is corruption, not a reason to fall back to poiId — for a fused clip that
    // would key a cluster telling on a poi, the exact mis-key INV-16 exists to prevent.
    if (!isSafeSubjectId(c.subjectId)) return null
    if (kind == null) return { subjectId: c.subjectId, subjectKind: 'poi', rev }
    if (kind === 'poi' || kind === 'cluster') return { subjectId: c.subjectId, subjectKind: kind, rev }
    return null // an unknown kind names a file we could never match — don't guess
  }
  if (kind === 'cluster') return null // a fused telling with no subjectId has no identity at all
  if (isSafeSubjectId(c.poiId)) return { subjectId: c.poiId, subjectKind: 'poi', rev }
  return null
}

/* --------------------------- the v4 → v5 migration ------------------------- */

/** One clip in a v5 manifest. The manifest stays SEQ-keyed; `name` is where the bytes actually are:
 *  inside `clips/` when `shared`, else inside `drives/<driveId>/` (a legacy byte with no resolvable
 *  subject). Stored, never re-derived — a contentType change between download and read must never
 *  mis-address bytes that are already on disk. */
export interface StoredClipRef {
  name: string
  contentType: string
  durationMs: number | null
  shared: boolean
}

/** One planned re-key. `toName: null` = this clip's subject is unrecoverable offline; there is
 *  nothing to move and its bytes stay where they are. */
export interface V4RekeyStep {
  seq: number
  /** Relative to `drives/<driveId>/`. */
  fromName: string
  /** Relative to `clips/`, or null. */
  toName: string | null
  contentType: string
  durationMs: number | null
}

interface V4Row extends Omit<V4RekeyStep, 'toName'> {
  key: StoreKey | null
}

/**
 * Normalize a v4 manifest's `clips` map against its `detail.clips` seq→subject join. ONE reader for
 * both `planV4Rekey` and `migrateV4ToV5`, so the name the migration writes into the manifest and
 * the name the mover targets cannot drift — a drift there is a manifest pointing at bytes that are
 * somewhere else, i.e. a silent hole.
 *
 * ⚠ Guarded on `version === 4`. Without it, running this over a v5 manifest would read its SHARED
 * names as drive-local sources and plan moves out of `clips/` into itself.
 */
function v4Rows(raw: Record<string, unknown>): V4Row[] {
  if ((raw as { version?: unknown }).version !== 4) return []
  const clips = raw.clips
  if (!clips || typeof clips !== 'object') return []
  const detail = raw.detail as { clips?: unknown } | null | undefined
  const detailClips = Array.isArray(detail?.clips) ? (detail.clips as Record<string, unknown>[]) : []
  const bySeq = new Map<number, Record<string, unknown>>()
  for (const d of detailClips) {
    const s = typeof d?.seq === 'number' ? d.seq : Number.NaN
    if (Number.isFinite(s) && !bySeq.has(s)) bySeq.set(s, d)
  }
  const rows: V4Row[] = []
  for (const [seqStr, value] of Object.entries(clips as Record<string, unknown>)) {
    const seq = Number(seqStr)
    if (!Number.isFinite(seq)) continue
    const e = value as { name?: unknown; contentType?: unknown; durationMs?: unknown } | null
    // A nameless entry addresses NO bytes, and carrying it forward would make the resolver build a
    // uri for the drive DIRECTORY. It is the one entry that cannot be kept — everything else is.
    if (typeof e?.name !== 'string' || e.name.length === 0) continue
    const d = bySeq.get(seq)
    rows.push({
      seq,
      fromName: e.name,
      contentType: typeof e.contentType === 'string' ? e.contentType : '',
      durationMs: typeof e.durationMs === 'number' ? e.durationMs : null,
      key: d ? storeKeyForClip(d) : null, // no matching detail row → unidentifiable, kept drive-local
    })
  }
  rows.sort((a, b) => a.seq - b.seq)
  return rows
}

function plannedName(r: V4Row): string | null {
  return r.key ? storeFileName(r.key, r.contentType) : null
}

/**
 * The PURE plan for re-keying one v4 download into the shared store. The native half executes it
 * and contains no branching of its own:
 *   - a `File` destination, never a `Directory` (a Directory destination keeps the SOURCE filename
 *     and silently produces a store keyed on the old seq — it throws nothing and passes any "no
 *     exception" test),
 *   - never an `overwrite` option (it is remove-then-move, a real window with zero copies),
 *   - a collision is resolved by deleting the SOURCE, never the destination, on any path, ever,
 *   - and SUCCESS IS JUDGED BY THE DESTINATION being present and non-zero — never by "the move did
 *     not throw", and never by the source's absence. "Source gone, destination present" is the
 *     normal RESUME state after a crash mid-migration, not a failure.
 *
 * Handles BOTH v4 shapes: step 4 put `subjectId`/`subjectKind` on the wire WITHOUT a manifest bump,
 * so `version === 4` covers a pre-step-4 manifest carrying only `poiId` and a post-step-4 one
 * carrying both. See `storeKeyForClip` for why the pre-step-4 poi half re-keys with zero network.
 */
export function planV4Rekey(raw: Record<string, unknown>): V4RekeyStep[] {
  return v4Rows(raw).map((r) => ({
    seq: r.seq,
    fromName: r.fromName,
    toName: plannedName(r),
    contentType: r.contentType,
    durationMs: r.durationMs,
  }))
}

/**
 * The PURE shape rewrite, registered as the v4 step of the manifest ladder. Bytes move FIRST; this
 * write is the COMMIT POINT (the reverse order would leave a v5 manifest pointing at `clips/` paths
 * that don't exist yet, with the real bytes in `drives/<id>/` referenced by nothing and eligible for
 * a sweep that consults only manifests — silent, permanent loss).
 *
 * ⚠ `placed` is the set of store filenames VERIFIED PRESENT after the moves — NOT "the moves that
 * did not throw". That parameter IS the crash-safety contract: a clip whose byte is not in `placed`
 * stays `shared: false` at its ORIGINAL drive-local name. It is never dropped, and the resolver
 * still plays it.
 *
 * ⚠ It never returns null for a v4 input. Null reads to every caller as "never downloaded", which
 * retires a whole download while its audio sits on disk — the exact failure the migration ladder
 * exists to prevent. A clip that cannot be re-keyed (a pre-step-4 FUSED telling: `poiId: null` BY
 * DESIGN and no `subjectId`) is NOT deleted, NOT dropped from the manifest, NOT treated as
 * corruption and NOT given a synthesized id — it keeps its bytes drive-local with `shared: false`.
 * Those are Emerald Bay and downtown Reno; promotion to the shared store is deferred, the FIELD
 * lands now. The `| null` in the signature exists only to satisfy `ManifestMigration`.
 *
 * `savedAt` is carried through VERBATIM — restamping it would silently reset every rider's offline
 * freshness TTL on a copy that could be months old.
 */
export function migrateV4ToV5(
  raw: Record<string, unknown>,
  placed: ReadonlySet<string>,
): Record<string, unknown> | null {
  if ((raw as { version?: unknown }).version !== 4) return raw // already v5 / not ours — no-op
  const clips: Record<string, StoredClipRef> = {}
  for (const r of v4Rows(raw)) {
    const toName = plannedName(r)
    // The byte is in the store ONLY if it was verified there. Anything else — an unidentifiable
    // clip, a move that did not land, a crash between two moves — keeps its drive-local name.
    const name = toName != null && placed.has(toName) ? toName : r.fromName
    clips[String(r.seq)] = {
      name,
      contentType: r.contentType,
      durationMs: r.durationMs,
      shared: name === toName,
    }
  }
  return { ...raw, version: 5, clips }
}

/* ------------------------------- the sweep --------------------------------- */

/**
 * The store names every readable manifest still needs. THE MANIFESTS ARE THE REFCOUNT, re-derived
 * from disk on every run — deliberately, instead of a persisted count, because a count is a second
 * source of truth whose drift is silent IN THE DELETING DIRECTION and a rider only discovers it in
 * a dead zone. Names are taken VERBATIM, never re-derived from a contentType: a subject re-encoded
 * between download and read would otherwise predict a name that doesn't match the bytes on disk.
 *
 * `shared: false` entries are excluded on purpose — those bytes live in the drive's own dir, and
 * admitting a drive-local name here could mark a genuinely orphaned store file as live.
 *
 * ⚠ Keep-set COMPLETENESS is the caller's precondition, not this function's job. See
 * `orphanStoreNames`.
 */
export function storeKeepSet(manifests: Iterable<{ clips?: unknown }>): Set<string> {
  const keep = new Set<string>()
  for (const m of manifests) {
    const clips = m?.clips
    if (!clips || typeof clips !== 'object') continue
    for (const value of Object.values(clips as Record<string, unknown>)) {
      const e = value as { name?: unknown; shared?: unknown } | null
      if (e?.shared === true && typeof e.name === 'string' && e.name.length > 0) keep.add(e.name)
    }
  }
  return keep
}

/**
 * The store files no manifest accounts for. `busy` (a subject mid-write, whose manifest is not
 * written until the transfer finishes) is never swept — deleting those bytes under the downloader
 * as it verifies them turns a good copy into a broken one.
 *
 * ⚠ A name `parseStoreFileName` rejects is NEVER returned. Forward-compat: a future build's rev
 * format must not be eaten by today's sweep.
 *
 * ⚠ THE SAME HAZARD `driveIdsToSweep` CARRIES, ONE LEVEL DOWN — and it is worse here, because these
 * are the rider's audio bytes rather than a re-fetchable index. This function CANNOT tell a
 * genuinely-empty keep-set from a keep-set that failed to build, and an empty `keep` therefore
 * sweeps EVERYTHING. An unreadable manifest contributes zero names, which must mean "keep
 * everything", never "references nothing". So the CALLER is fail-closed and deletes nothing at all
 * when ANY directory under `drives/` yields a null manifest, when any download is in flight, or
 * when the computed keep-set is empty. That abort lives in the caller because only the caller can
 * tell "no manifests" from "no manifests I could read".
 */
export function orphanStoreNames(
  onDisk: Iterable<string>,
  keep: Iterable<string>,
  busy: Iterable<string> = [],
): string[] {
  const keepSet = new Set(keep)
  const busySet = new Set(busy)
  const out = new Set<string>()
  for (const name of onDisk) {
    if (keepSet.has(name) || busySet.has(name)) continue
    if (!parseStoreFileName(name)) continue
    out.add(name)
  }
  return Array.from(out)
}

/**
 * Which entry a seq commits to, given what the fresh plan wants and what the drive already has.
 *
 * ⚠ THE MIDDLE CASE IS THE WHOLE REASON THIS IS A FUNCTION. Omitting it is a silent hole that needs no
 * rider action: a re-synth (or a legacy clip whose subject the fresh manifest can finally name) changes
 * the planned FILENAME, so a background top-up on thin signal fetches the new name, fails, finds the new
 * name absent — and would rewrite the manifest without a seq whose OLD bytes are on disk and playing
 * fine. Orphaning them then hands them to the sweep, which deletes the rider's only copy. The rider
 * hears silence at that stop, in a dead zone, with no note (the drive watchdog skips an unresolvable
 * seq after 400ms and says nothing).
 *
 * So: stale-but-playable beats a gap, and the rider is still told — `missing` stays true either way, so
 * the "N left to save" chip fires and the next good connection replaces it. Bytes over tidiness.
 */
export function resolveClipRef(
  planned: StoredClipRef,
  plannedPresent: boolean,
  saved: StoredClipRef | undefined,
  savedPresent: boolean,
): { ref: StoredClipRef | null; missing: boolean } {
  if (plannedPresent) return { ref: planned, missing: false }
  if (saved && savedPresent) return { ref: saved, missing: true }
  return { ref: null, missing: true }
}
