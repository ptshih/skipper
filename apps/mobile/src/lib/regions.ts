// Pure, dependency-free helpers for THE DRIVES location filter. Kept import-free so the
// unit test (bun test) and the app tsc both stay clean — no React/RN pulled in here.
//
// Doctrine (carried from the design ideation, true as future filters land): a region
// *filters* — clean finite buckets, empty-recoverable by clearing the chip; a future
// COORDINATE (near-me / a geocoded destination) will *sort* the catalog nearest-first
// and must NEVER hard-filter to empty. v0 is the region filter — keyed by region SLUG
// (stable) and displayed by region NAME.

export interface RegionOption {
  slug: string
  name: string
  count: number
}

/** Distinct regions present in the catalog, each with its drive count, sorted by name.
 *  The picker lists ONLY regions that have drives, so picking one can never dead-end. */
export function deriveRegions(
  tours: readonly { regionSlug: string; regionName: string }[],
): RegionOption[] {
  const bySlug = new Map<string, { name: string; count: number }>()
  for (const t of tours) {
    const cur = bySlug.get(t.regionSlug)
    if (cur) cur.count += 1
    else bySlug.set(t.regionSlug, { name: t.regionName, count: 1 })
  }
  return [...bySlug.entries()]
    .map(([slug, { name, count }]) => ({ slug, name, count }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Narrow tours to a picked region slug; null = no filter (the "All regions" default). */
export function filterByRegion<T extends { regionSlug: string }>(
  tours: readonly T[],
  selectedSlug: string | null,
): T[] {
  return selectedSlug ? tours.filter((t) => t.regionSlug === selectedSlug) : [...tours]
}
