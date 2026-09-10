// GENERATION-specific route geometry for the studio pipeline: the sub-region narration label
// (regionLabel) and polyline encoding for Places search-along-route (encodePolyline). The shared
// route-geometry primitives (haversineMeters, nearestOnRoute, totalMeters, …) live in @skipper/engine
// — import them from there directly. `LngLat` is re-exported here only because these helpers'
// signatures use it and studio call sites already import the type from this module.
// [lng, lat] axis order throughout, matching drives.polyline.

import { parseRegionBboxes, type LngLat } from '@skipper/engine'
import { db } from '@skipper/db'
import { regions } from '@skipper/db/schema'
import { withRetry } from './http'

export { type LngLat } from '@skipper/engine'

type NarrationRegion = { displayName: string; bbox: string | null }

/** Region boundaries include gateway approaches, so membership never proves park entry,
 * a lake view, or proximity to water. Unknown/overlapping areas must not inherit Tahoe.
 */
export function regionLabelFromRegions(lat: number, lng: number, catalog: NarrationRegion[]): string {
  const matches = catalog.filter(r => parseRegionBboxes(r.bbox).some(b =>
    lng >= b.swLng && lng <= b.neLng && lat >= b.swLat && lat <= b.neLat))
  return matches.length === 1 ? `the wider ${matches[0]!.displayName} area` : 'the surrounding area'
}

// Freeze the catalog for one operator process; failures stop generation rather than supplying
// invented geography. The DB client stays lazy, so importing geometry does not require secrets.
let regionCatalog: Promise<NarrationRegion[]> | undefined
export async function regionLabel(lat: number, lng: number): Promise<string> {
  regionCatalog ??= withRetry(() => db.select({ displayName: regions.displayName, bbox: regions.bbox }).from(regions),
    { label: 'narration region catalog' })
  return regionLabelFromRegions(lat, lng, await regionCatalog)
}

/**
 * Encode an [lng, lat] polyline to Google's precision-5 encoded-polyline string.
 *
 * The Places "search along route" API accepts ONLY the encoded string, never a
 * coordinate array — but @skipper/routing's materializeRoute decoded the Routes-API polyline and froze
 * only the [lng, lat] points (the encoded string was discarded). Rather than
 * re-call the Routes API (the frozen route is "never recomputed"), we re-encode
 * the frozen points. Decode→encode round-trips cleanly at precision 5 (the points
 * were already quantized to 1e-5 on decode), so the result is a valid polyline
 * that SAR accepts. Inverse of @skipper/routing's decodePolyline (used inside materializeRoute).
 */
export function encodePolyline(polyline: LngLat[]): string {
  let lastLat = 0
  let lastLng = 0
  let out = ''
  const encodeSigned = (value: number): string => {
    let v = value < 0 ? ~(value << 1) : value << 1
    let chunk = ''
    while (v >= 0x20) {
      chunk += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
      v >>= 5
    }
    chunk += String.fromCharCode(v + 63)
    return chunk
  }
  for (const [lng, lat] of polyline) {
    const latE5 = Math.round(lat * 1e5)
    const lngE5 = Math.round(lng * 1e5)
    out += encodeSigned(latE5 - lastLat)
    out += encodeSigned(lngE5 - lastLng)
    lastLat = latE5
    lastLng = lngE5
  }
  return out
}
