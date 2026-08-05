// MY DRIVES' region filter — the rules, as pure functions, away from the screen that renders them.
//
// WHY A FILTER AT ALL. A free account may hold `FREE_DRIVE_CAP` drives in one flat reverse-chronological
// list where every title is machine-made `A → B`. At a second region that list mixes two places with
// nothing saying which is which. See `docs/designs/my-drives-legibility.md`.
//
// ⚠ THE REGION IS SERVER-DERIVED AND MAY BE ABSENT. `DriveSummary.region` is computed per request from
// the drive's start point (`apps/api/src/region-geo.ts`), never stored, so `null` is a REAL answer —
// a drive outside every released region's bbox, or a summary restored from an offline download written
// before the field existed. Every rule below has to keep such a drive REACHABLE.

import type { DriveSummary } from './api'

/** One region present among a rider's drives, with how many sit in it. */
export interface RegionFacet {
  id: string
  displayName: string
  count: number
}

/**
 * The regions actually represented in this list, in first-appearance order (so the newest drive's
 * region leads, matching the list's own reverse-chronological order).
 *
 * ⚠ UNLABELLED DRIVES PRODUCE NO FACET, deliberately. A "no region" chip would be a category a rider
 * cannot act on and cannot have chosen, and it would put the awkward case on screen permanently at a
 * single region. Those drives stay reachable through "All" instead — which `shouldOfferRegionFilter`
 * below guarantees is present whenever any filtering is possible at all.
 */
export function regionFacets(drives: readonly DriveSummary[]): RegionFacet[] {
  const byId = new Map<string, RegionFacet>()
  for (const d of drives) {
    const r = d.region
    if (!r) continue
    const hit = byId.get(r.id)
    if (hit) hit.count += 1
    else byId.set(r.id, { id: r.id, displayName: r.displayName, count: 1 })
  }
  return [...byId.values()]
}

/**
 * Show the filter control at all?
 *
 * ⚠ ONLY WHEN IT CAN DO SOMETHING — two or more regions present. This is what keeps the feature
 * INVISIBLE at one region (today, and forever for a rider who only ever drives Tahoe) instead of
 * parking a permanently pointless control on the screen. It is also why this rung needed no "wait for
 * Yosemite" gate in the code: the control's own condition is the gate.
 */
export function shouldOfferRegionFilter(facets: readonly RegionFacet[]): boolean {
  return facets.length > 1
}

/**
 * Which filter to start on. `null` means "All regions".
 *
 * ⚠ THE CACHED REGION IS ONLY HONOURED IF IT IS ACTUALLY PRESENT, and that guard is the whole reason
 * this is a named function rather than a default in the screen. A rider whose chip says Yosemite but
 * whose drives are all Tahoe would otherwise open MY DRIVES to an EMPTY list — the exact "a chip tap
 * ate my library" reading this feature has to avoid. Defaulting to All in that case means the opening
 * state can never be empty while drives exist.
 */
export function initialRegionFilter(
  facets: readonly RegionFacet[],
  cachedRegionId: string | null,
): string | null {
  if (!cachedRegionId) return null
  return facets.some((f) => f.id === cachedRegionId) ? cachedRegionId : null
}

/**
 * Apply the filter. `null` → everything, untouched.
 *
 * ⚠ Order is preserved (the server already sorted by `createdAt DESC`); this only ever REMOVES rows.
 */
export function filterDrivesByRegion(
  drives: readonly DriveSummary[],
  regionId: string | null,
): DriveSummary[] {
  if (!regionId) return [...drives]
  return drives.filter((d) => d.region?.id === regionId)
}
