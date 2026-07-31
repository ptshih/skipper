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
