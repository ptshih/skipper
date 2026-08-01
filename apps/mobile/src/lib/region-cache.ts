// REGION CACHE — the last good GET /regions answer, on disk, so the offline and outage states can
// still name real places instead of only apologising.
//
// ⚠ WHAT THIS STORES, PLAINLY: a region id, its display name, and a handful of PUBLIC PLACE NAMES
// (`region.exampleAnchors`) that the server already publishes anonymously. It stores NO rider
// content — no transcript, no typed line, no `say`, not one token of a planner turn. INV-13 forbids
// persisting any of that anywhere on the client, and nothing here weakens it. If a future edit is
// tempted to stash "the last conversation" beside this, that is the invariant it would be breaking.
//
// ⚠ Names ONLY — never anchor ids, never coordinates. An endpoint is named on the wire by anchor id
// and only the server holds that mapping (INV-1); a cached display string must never be turned back
// into one.
//
// Document dir, not cache dir: this file exists FOR the moment there is no network, and the OS may
// evict the cache dir at exactly the wrong time. It is a few hundred bytes. (offline.ts's house
// style: `File`/`Paths`, `write(str)`/`textSync()`, every disk touch defensive.)

import { File, Paths } from 'expo-file-system'

export interface CachedRegion {
  regionId: string
  displayName: string
  /** Public place names for display only. Never ids, never coordinates. */
  exampleAnchors: string[]
}

const cacheFile = (): File => new File(Paths.document, 'region-cache.json')

/** The last successfully-fetched region, or null if there has never been one (or the file is
 *  unreadable/half-written). Never throws — a caller in a dead zone has no way to act on a disk
 *  error, and the whole point of this file is to degrade to "no examples", never to a broken screen. */
export function readCachedRegion(): CachedRegion | null {
  try {
    const f = cacheFile()
    if (!f.exists) return null
    const raw = JSON.parse(f.textSync()) as Partial<CachedRegion> | null
    if (!raw || typeof raw.regionId !== 'string' || typeof raw.displayName !== 'string') return null
    const names = Array.isArray(raw.exampleAnchors)
      ? raw.exampleAnchors.filter((n): n is string => typeof n === 'string')
      : []
    return { regionId: raw.regionId, displayName: raw.displayName, exampleAnchors: names }
  } catch {
    return null
  }
}

/** Overwrite the cache after a successful GET /regions. Best-effort: a failed write costs the offline
 *  card its place names next launch, never the request that just succeeded. */
export function writeCachedRegion(region: CachedRegion): void {
  try {
    cacheFile().write(JSON.stringify(region))
  } catch {}
}
