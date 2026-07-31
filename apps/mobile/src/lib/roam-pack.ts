// THE ROAM OFFLINE PACK — roam's answer to "Tahoe has dead zones".
//
// Roam was 100% online-only: `getRoamManifest` was an unguarded await whose rejection dead-ended the
// session, nothing cached the pin set (it lived in a ref and died with the screen), and every clip
// was streamed from a presigned URL and never saved. That is the anonymous front door and the
// founder's daily mode, on exactly the roads with no bars.
//
// The pack is ONE artifact holding pins AND audio, because either alone is worse than nothing:
// cached pins with no bytes would fire a trigger, buffer for CLIP_STALL_MS and skip in silence — a
// rider watching a sheet spin. `playablePins` enforces that pairing (roam-pack-util.ts).
//
// Shape mirrors the drive download (offline.ts), which is the proven precedent: a manifest plus
// bytes under `Paths.document`, RELATIVE filenames only (the document container path changes across
// app updates, so uris are rebuilt at read time), and no presigned credential ever written to disk —
// here enforced by the `PackPin` type rather than by remembering to null a field.
//
// Sizing is why this is a checkbox and not an architecture project: measured, the ENTIRE
// rider-reachable corpus is ~238 clips / ~293 min / ~138 MB at the shipped bitrate. A few podcast
// episodes. There is no per-region keying because `GET /roam` offers none — it is point+radius only
// (no bbox, no region param, radiusKm capped at 100 server-side), and one corpus exists today.

import { Directory, File, Paths } from 'expo-file-system'
import type { RoamPin } from '@skipper/shared'
import { getRoamManifest } from './api'
import { abortError, assertFreeSpaceFor, downloadFileWithRetry } from './download'
import { isPastTtl } from './offline-util'
import {
  clipFileName,
  estimateBytes,
  packCoversPoint,
  playablePins,
  stripUrl,
  type PackPin,
} from './roam-pack-util'

// Pack schema version. ⚠ Bumping this must NOT silently orphan a rider's pack the way the drive
// manifest's version gate does (a mismatch there returns null, the drive vanishes from the offline
// list, and tens of MB stay on disk with nothing able to sweep them). `readPack` therefore reports a
// stale format as a DISTINCT state rather than as "nothing saved", so the UI can say so and offer to
// reclaim it. Migration path from day one — see the TODO note on MANIFEST_VERSION.
const ROAM_PACK_VERSION = 1

const PACK_DIR = 'roam-pack'
const PACK_FILE = 'pack.json'

/** The radius the pack is pulled at. `GET /roam` caps this at 100 server-side; the Tahoe basin is
 *  ~40 km across, so the cap comfortably covers everything a rider can reach from one anchor. */
export const PACK_RADIUS_KM = 100

/** A saved pack past this age gets a SOFT "saved a while back" nudge. Roam pins carry no `revisedAt`
 *  token (unlike `driveClip`), so there is no content diff to detect a re-cut telling — age is the
 *  only freshness signal available, and it is a nudge, never a block: a stale telling beats silence
 *  in a dead zone. Mirrors OFFLINE_TTL_DAYS for drives. */
export const PACK_TTL_DAYS = 30

interface PackClip {
  /** RELATIVE filename within the pack dir (never an absolute uri — the container path moves). */
  name: string
  contentType: string
}

interface RoamPack {
  version: number
  /** When the PIN set was last cached (ISO). */
  savedAt: string
  /** When the AUDIO was last pulled (ISO), or null for a pins-only cache. */
  audioSavedAt: string | null
  /** Where the pin set was fetched from, and how wide — the coverage circle. */
  anchor: { lat: number; lng: number }
  radiusKm: number
  /** Every pin the anchor's fetch returned, WITHOUT its presigned url (see PackPin). */
  pins: PackPin[]
  /** poiId → the clip file that actually landed. A pin absent here has no audio. */
  clips: Record<string, PackClip>
}

function packDir(): Directory {
  return new Directory(Paths.document, PACK_DIR)
}
function packFile(): File {
  return new File(packDir(), PACK_FILE)
}

/** The outcome of reading the pack off disk. `stale` is deliberately distinct from `none`: a format
 *  this build can't read still occupies real disk and still deserves an honest word to the rider,
 *  rather than reading as "you never saved anything" while ~138 MB sits there unreachable. */
export type PackRead =
  | { state: 'none' }
  | { state: 'stale'; version: number }
  | { state: 'ok'; pack: RoamPack }

export function readPack(): PackRead {
  const f = packFile()
  if (!f.exists) return { state: 'none' }
  let raw: unknown
  try {
    raw = JSON.parse(f.textSync())
  } catch {
    return { state: 'none' } // unparseable is genuinely nothing — there's no shape to report on
  }
  const p = raw as Partial<RoamPack> | null
  if (!p || typeof p !== 'object') return { state: 'none' }
  if (p.version !== ROAM_PACK_VERSION) {
    return { state: 'stale', version: typeof p.version === 'number' ? p.version : -1 }
  }
  // Shape guard — a half-written pack must not reach the engine as a crash.
  if (
    !Array.isArray(p.pins) ||
    typeof p.clips !== 'object' ||
    p.clips === null ||
    !p.anchor ||
    typeof p.anchor.lat !== 'number' ||
    typeof p.anchor.lng !== 'number' ||
    typeof p.radiusKm !== 'number' ||
    typeof p.savedAt !== 'string'
  ) {
    return { state: 'stale', version: p.version }
  }
  return { state: 'ok', pack: p as RoamPack }
}

function writePack(pack: RoamPack): void {
  try {
    packDir().create({ intermediates: true, idempotent: true })
    packFile().write(JSON.stringify(pack))
  } catch {
    // Best-effort, exactly like roam-history: a failed write costs a cache, never a session.
  }
}

/** A clip's local `file://` uri, or null when its bytes aren't on disk. */
function clipUri(pack: RoamPack, poiId: string): string | null {
  const c = pack.clips[poiId]
  if (!c) return null
  try {
    const f = new File(packDir(), c.name)
    return f.exists && (f.size ?? 0) > 0 ? f.uri : null
  } catch {
    return null
  }
}

/**
 * Cache the pin set from a successful live fetch. FREE and automatic — the pins are a few hundred KB
 * of JSON, and having them on disk is what lets a session start at all without bars.
 *
 * ⚠ It refuses to move an anchor that a DOWNLOADED pack is built around. A rider who drives to
 * another basin gets a fetch from there, and adopting that anchor would leave ~138 MB of audio
 * describing places the pack no longer claims to cover. A deliberate download outranks an incidental
 * drive: the pins move freely while the pack is pins-only, and are pinned to the paid-for area once
 * audio exists. (Re-saving from the new area is the rider's call, in Settings.)
 */
export function cacheRoamPins(
  anchor: { lat: number; lng: number },
  radiusKm: number,
  pins: RoamPin[],
): void {
  const read = readPack()
  const existing = read.state === 'ok' ? read.pack : null
  const hasAudio = existing != null && Object.keys(existing.clips).length > 0
  if (hasAudio && !packCoversPoint(existing.anchor, existing.radiusKm, anchor)) return
  writePack({
    version: ROAM_PACK_VERSION,
    savedAt: new Date().toISOString(),
    audioSavedAt: existing?.audioSavedAt ?? null,
    // Keep the DOWNLOADED area's anchor/radius when audio exists — the fresh pins are a refresh of
    // the same circle, not a new one.
    anchor: hasAudio && existing ? existing.anchor : anchor,
    radiusKm: hasAudio && existing ? existing.radiusKm : radiusKm,
    pins: pins.map(stripUrl),
    clips: existing?.clips ?? {},
  })
}

/**
 * The pins a saved pack can narrate at `here`, with local `file://` uris — or null when there is no
 * usable pack for this spot. ZERO network. Only pins whose bytes actually landed come back
 * (`playablePins`), so a partial pack plays what it has instead of firing silent triggers.
 */
export function loadRoamPack(here: { lat: number; lng: number }): RoamPin[] | null {
  const read = readPack()
  if (read.state !== 'ok') return null
  const pack = read.pack
  if (!packCoversPoint(pack.anchor, pack.radiusKm, here)) return null
  const pins = playablePins(pack.pins, (poiId) => clipUri(pack, poiId))
  return pins.length > 0 ? pins : null
}

/** A poiId → local uri resolver for the ONLINE path, so a live session plays saved bytes where it
 *  can (`preferLocalUrls`). Returns a no-op resolver when nothing is saved. */
export function localClipResolver(): (poiId: string) => string | null {
  const read = readPack()
  if (read.state !== 'ok') return () => null
  const pack = read.pack
  return (poiId) => clipUri(pack, poiId)
}

export interface RoamPackStatus {
  /** Pins cached (with or without audio). */
  pinCount: number
  /** Pins whose audio is on disk — what would actually play in a dead zone. */
  clipCount: number
  savedAt: string
  audioSavedAt: string | null
  /** Total bytes the audio occupies on disk, for an honest "N MB" line. */
  bytes: number
  /** What the FULL pin set would weigh, from the cached durations — the number to show BEFORE a
   *  save, and the one that makes "138 MB" a promise the rider can check rather than a surprise. */
  estimatedBytes: number
  /** Past PACK_TTL_DAYS — a soft nudge to re-save, never a block. */
  expired: boolean
}

/** The pack's state for the Settings surface. `stale` reports a format this build can't read. */
export function roamPackStatus(): { state: 'none' } | { state: 'stale' } | ({ state: 'ok' } & RoamPackStatus) {
  const read = readPack()
  if (read.state === 'none') return { state: 'none' }
  if (read.state === 'stale') return { state: 'stale' }
  const pack = read.pack
  let bytes = 0
  let clipCount = 0
  for (const c of Object.values(pack.clips)) {
    try {
      const f = new File(packDir(), c.name)
      if (f.exists && (f.size ?? 0) > 0) {
        clipCount += 1
        bytes += f.size ?? 0
      }
    } catch {}
  }
  return {
    state: 'ok',
    pinCount: pack.pins.length,
    clipCount,
    savedAt: pack.savedAt,
    audioSavedAt: pack.audioSavedAt,
    bytes,
    estimatedBytes: estimateBytes(pack.pins.map((p) => p.durationMs)),
    expired: pack.audioSavedAt != null && isPastTtl(pack.audioSavedAt, Date.now(), PACK_TTL_DAYS),
  }
}

/** Remove the pack (pins + every clip). Idempotent — and the ONLY way to reclaim the bytes, so it
 *  stays reachable even when the pack's format is one this build can't read. */
export function deleteRoamPack(): void {
  const dir = packDir()
  if (dir.exists) {
    try {
      dir.delete()
    } catch {}
  }
}

export interface PackProgress {
  done: number
  total: number
}

export interface PackResult {
  saved: number
  total: number
}

const DOWNLOAD_CONCURRENCY = 4

/** Fetch the pin set for an anchor and download every clip's bytes. */
async function runPackDownload(
  anchor: { lat: number; lng: number },
  onProgress?: (p: PackProgress) => void,
  signal?: AbortSignal,
): Promise<PackResult> {
  if (signal?.aborted) throw abortError()

  // Fetch FIRST, before touching anything on disk — a save attempted in a dead zone must leave an
  // existing pack intact rather than wipe it and fail. (Same ordering rule as runDownload.)
  const manifest = await getRoamManifest(anchor.lat, anchor.lng, PACK_RADIUS_KM)
  if (manifest.pins.length === 0) throw new Error('There are no stories saved around here yet.')

  assertFreeSpaceFor(
    manifest.pins.map((p) => p.durationMs),
    'No room left in the hold — clear some space and I’ll stow the stories.',
  )

  const dir = packDir()
  dir.create({ intermediates: true, idempotent: true })

  const clips: Record<string, PackClip> = {}
  let done = 0
  const total = manifest.pins.length
  onProgress?.({ done, total })

  // One pass over a work list, `DOWNLOAD_CONCURRENCY` at a time. Returns the pins that failed.
  const pass = async (pins: RoamPin[]): Promise<RoamPin[]> => {
    const failed: RoamPin[] = []
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < pins.length) {
        if (signal?.aborted) throw abortError()
        const pin = pins[next++]!
        const name = clipFileName(pin.poiId, pin.contentType)
        const dest = new File(dir, name)
        try {
          // An already-verified file from a previous pass/run is kept — re-pulling 138 MB because
          // three clips failed would be absurd.
          if (!(dest.exists && (dest.size ?? 0) > 0)) {
            await downloadFileWithRetry(pin.url, dest, name, signal)
          }
          clips[pin.poiId] = { name, contentType: pin.contentType }
        } catch {
          if (signal?.aborted) throw abortError()
          try {
            if (dest.exists) dest.delete()
          } catch {}
          failed.push(pin)
        }
        done += 1
        onProgress?.({ done, total })
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, pins.length) }, () => worker()),
    )
    return failed
  }

  try {
    const failed = await pass(manifest.pins)

    // ⚠ A presigned R2 url lives ~1 h. A 138 MB pull on thin cellular can outlast that, and every
    // url in the manifest expires at once — so a run that starts fine can fail wholesale partway
    // through, which retries inside a single clip can never fix. Re-fetch the manifest ONCE for the
    // stragglers: fresh credentials, and it doubles as recovery from any transient outage. Bounded
    // to one extra pass so a genuinely dead network can't loop.
    if (failed.length > 0) {
      const fresh = await getRoamManifest(anchor.lat, anchor.lng, PACK_RADIUS_KM).catch(() => null)
      if (fresh) {
        const byId = new Map(fresh.pins.map((p) => [p.poiId, p]))
        const retryable = failed.map((p) => byId.get(p.poiId) ?? p)
        done -= failed.length // the second pass re-counts these
        await pass(retryable)
      }
    }

    const saved = Object.keys(clips).length
    if (saved === 0) {
      try {
        dir.delete()
      } catch {}
      throw new Error('Could not save any stories.')
    }

    // Written AFTER the bytes, so a pack.json on disk always describes clips that actually landed.
    // Partial-tolerant like the drive downloader: what came down stays, `playablePins` narrates
    // exactly that set, and re-saving picks up the rest without re-pulling what's already verified.
    writePack({
      version: ROAM_PACK_VERSION,
      savedAt: new Date().toISOString(),
      audioSavedAt: new Date().toISOString(),
      anchor,
      radiusKm: PACK_RADIUS_KM,
      pins: manifest.pins.map(stripUrl),
      clips,
    })
    return { saved, total }
  } catch (e) {
    // A cancel mid-run leaves verified bytes in place but no pack.json describing them; the next
    // save reuses them (the exists-check above), so a canceled download is resumable rather than
    // wasted. Only a total failure sweeps, and that's handled above.
    throw e
  }
}

// Dedupe concurrent saves so two taps can't race on the same files.
let inFlight: Promise<PackResult> | null = null

/**
 * Download the roam pack around `anchor` — or around the last place a roam session fetched pins,
 * when no anchor is given. Needs network. Concurrent calls share one run.
 *
 * The anchor default is why Settings needs no location permission of its own: a rider who has ridden
 * along even once has a cached anchor, and asking for location from a settings screen to download
 * audio would be a worse trade than telling them to take one ride first.
 */
export function downloadRoamPack(
  anchor?: { lat: number; lng: number },
  onProgress?: (p: PackProgress) => void,
  signal?: AbortSignal,
): Promise<PackResult> {
  if (inFlight) return inFlight
  const read = readPack()
  const at = anchor ?? (read.state === 'ok' ? read.pack.anchor : null)
  if (!at) {
    return Promise.reject(
      new Error('Take one Ride Along first and I’ll know which stories to stow.'),
    )
  }
  const p = runPackDownload(at, onProgress, signal).finally(() => {
    inFlight = null
  })
  inFlight = p
  return p
}
