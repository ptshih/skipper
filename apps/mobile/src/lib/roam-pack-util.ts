// Pure, native-free helpers for the ROAM OFFLINE PACK (no expo-file-system / api imports) so they
// unit-test under `bun test`. roam-pack.ts (which IS native) wires these to disk. Mirrors the
// offline-util.ts / offline.ts split that drives already use.
//
// @skipper/engine is RN-free, so importing its geo math here keeps this file testable.

import { haversineMeters } from '@skipper/engine'
import type { RoamPin } from '@skipper/shared'
import { extForContentType } from './offline-util'

/**
 * A pin as SAVED. The wire `RoamPin.url` is a presigned R2 credential with a ~1 h TTL, so it must
 * never reach disk (the drive manifest nulls its equivalent for the same reason — audit #9). Here the
 * TYPE does the enforcing rather than a `map(c => ({...c, url: null}))` anyone can forget: `url` is
 * absent from the saved shape, so persisting one is a compile error, and it is reconstructed as a
 * `file://` uri at read time.
 */
export type PackPin = Omit<RoamPin, 'url'>

/** Drop the credential. The rest of the pin — geometry, radius, hull, duration, attribution — is
 *  exactly what the RoamEngine and the encounter sheet need, and none of it expires. */
export function stripUrl(pin: RoamPin): PackPin {
  const { url: _url, ...rest } = pin
  return rest
}

/** A clip's on-disk filename. Keyed by `poiId`, which is a uuid for BOTH a poi pin and a cluster
 *  telling (the server reuses the field to carry the cluster id — opaque to us, and safe as a
 *  filename either way). The extension follows the served contentType, never a hardcoded guess. */
export function clipFileName(poiId: string, contentType: string): string {
  return `${poiId}.${extForContentType(contentType)}`
}

/**
 * The pins a SAVED pack can actually narrate: those whose audio is on disk, with `url` rebuilt as a
 * local `file://` uri.
 *
 * ⚠ The filter is the point, not a detail. A pin whose bytes never landed would still fire its
 * trigger and then stall for CLIP_STALL_MS before being silently skipped — so an offline session
 * built from unfiltered pins is a rider watching an encounter sheet buffer forever. Pins and audio
 * ship together or the pin doesn't ship: silence beats a promise the pack can't keep.
 */
export function playablePins(pins: PackPin[], uriFor: (poiId: string) => string | null): RoamPin[] {
  const out: RoamPin[] = []
  for (const p of pins) {
    const uri = uriFor(p.poiId)
    if (uri) out.push({ ...p, url: uri })
  }
  return out
}

/**
 * Fresh pins from the network, with a local `file://` swapped in wherever the pack already holds
 * that clip's bytes. Best of both: the CURRENT pin set (the corpus keeps improving, and a stale pin
 * set means a stale telling), with playback off the disk so a mid-drive signal drop can't stall a
 * clip and a presign can never expire under it. A pin the pack doesn't have simply streams, as today.
 */
export function preferLocalUrls(fresh: RoamPin[], uriFor: (poiId: string) => string | null): RoamPin[] {
  return fresh.map((p) => {
    const uri = uriFor(p.poiId)
    return uri ? { ...p, url: uri } : p
  })
}

/** Rough bytes/sec for the shipped 64 kbps AAC clips (64 kbit/s ÷ 8) — the same figure the download
 *  free-space guard uses. Pure copy so this file stays native-free and testable. */
const APPROX_BYTES_PER_SEC = 8_000

/** What the audio for these pins will WEIGH, estimated from their durations. The pack is ~138 MB, so
 *  the rider is owed the number BEFORE they tap, not a progress bar that turns out to be enormous. */
export function estimateBytes(durationsMs: number[]): number {
  return durationsMs.reduce((sum, ms) => sum + Math.max(0, ms / 1000) * APPROX_BYTES_PER_SEC, 0)
}

/** A glanceable size, in the unit a rider thinks in. Deliberately coarse: this is a download
 *  expectation, not an accounting figure, and a spurious decimal reads as false precision. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const mb = bytes / 1_000_000
  if (mb < 1) return '<1 MB'
  if (mb < 1000) return `${Math.round(mb)} MB`
  return `${(mb / 1000).toFixed(1)} GB`
}

/**
 * Is `here` inside the area this pack was fetched for? The pack is a point+radius pull (that is all
 * `GET /roam` offers — no bbox, no region parameter), so coverage is just "am I still inside the
 * circle it was anchored on".
 *
 * Deliberately strict rather than generous: a rider 200 km away would otherwise be handed a pin set
 * from another basin and told "238 nearby" while the skipper never speaks. Being INSIDE the circle
 * doesn't guarantee full coverage in every direction either — only out to `radiusKm` minus how far
 * you've moved — which is exactly the same honest limitation a live session has between refetches.
 */
export function packCoversPoint(
  anchor: { lat: number; lng: number },
  radiusKm: number,
  here: { lat: number; lng: number },
): boolean {
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) return false
  return haversineMeters([anchor.lng, anchor.lat], [here.lng, here.lat]) / 1000 <= radiusKm
}
