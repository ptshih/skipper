// Pure, dependency-free helpers for THE DRIVES location filter. Kept import-free so the
// unit test (bun test) and the app tsc both stay clean — no React/RN pulled in here.
//
// Doctrine (carried from the design ideation, true as future filters land): a region
// STRING *filters* — clean finite buckets, empty-recoverable by clearing the chip; a
// future COORDINATE (near-me / a geocoded destination) will *sort* the catalog
// nearest-first and must NEVER hard-filter to empty. v0 is the string filter.

export interface RegionOption {
  region: string
  count: number
}

/** Distinct regions present in the catalog, each with its drive count, sorted by name.
 *  The picker lists ONLY regions that have drives, so picking one can never dead-end. */
export function deriveRegions(corridors: readonly { region: string }[]): RegionOption[] {
  const counts = new Map<string, number>()
  for (const c of corridors) counts.set(c.region, (counts.get(c.region) ?? 0) + 1)
  return [...counts.entries()]
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => a.region.localeCompare(b.region))
}

/** The location control is meaningful only with >=2 distinct regions. Below that a region
 *  filter is tautological (today's Lake-Tahoe-only catalog), so the chip stays HIDDEN and
 *  the seam ships unchanged — the pattern is built but dormant until breadth lands. */
export function showRegionFilter(regions: readonly RegionOption[]): boolean {
  return regions.length >= 2
}

/** Narrow corridors to a picked region; null = no filter (the "All regions" default). */
export function filterByRegion<T extends { region: string }>(
  corridors: readonly T[],
  selectedRegion: string | null,
): T[] {
  return selectedRegion ? corridors.filter((c) => c.region === selectedRegion) : [...corridors]
}
