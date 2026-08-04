// Region resolution for the corpus CLIs — the ONE place "a region" becomes a bbox.
//
// Geometry-first doctrine (docs/decisions/geometry-first-regions.md): a region is a BBOX, never a
// stored FK; the corpus CLIs take `--region <slug>` and resolve it HERE to the region's discovery
// bbox, then select pois by point-in-bbox. `--bbox` is no longer a user-facing input. A POI's region
// is always this geometric query — `pois` carries no region_id.

import { eq, or, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { regions } from '@skipper/db/schema'
import { parseRegionBbox, type RegionBbox } from '@skipper/engine'
import { withRetry } from './http'

// ⚠ `RegionBbox` and its parser moved to @skipper/engine in the 1.1 sweep — there were FOUR
// independently-written parsers of `regions.bbox` that agreed only by luck. Re-exported here so the
// studio's existing importers are unchanged; the engine is the one home.
export type { RegionBbox } from '@skipper/engine'

export interface ResolvedRegion {
  id: string
  slug: string
  displayName: string
  /** Parsed from `regions.bbox` ("lng_min,lat_min,lng_max,lat_max"); null if unset/malformed. */
  bbox: RegionBbox | null
}


/**
 * The `--region` a run must name, or a clear failure. THE one expression that owns "a corpus run
 * says which region it is for" — `resolveRegion` delegates to it, so the rule and its wording cannot
 * drift between the CLIs that check early and the ones that check at resolve time.
 *
 * ⚠ THERE IS DELIBERATELY NO DEFAULT, and that is a SPEND control (founder, 2026-08-03). Every CLI
 * used to read `flags.value('region') ?? DEFAULT_REGION_SLUG`, which silently scoped a region-less
 * run to lake-tahoe. Harmless while Tahoe was the only region; a money bug the moment a second one
 * existed — `enrich-pois --apply` typed for Yosemite would bill a full Tahoe run and report success,
 * which is precisely the "a run that did nothing must not settle GREEN" failure with a receipt
 * attached. Failing costs one retyped flag. Guessing costs real GCP credits against the wrong corpus.
 */
export function requireRegionKey(value: string | null | undefined): string {
  const key = value?.trim()
  if (!key) throw new Error('--region is required (a region slug, e.g. lake-tahoe, or its id).')
  return key
}

/**
 * Resolve a region by its SLUG (e.g. `lake-tahoe`) OR its uuid → identity + parsed discovery bbox.
 * The `::text` cast lets a slug and a uuid both match in one query without a uuid-parse crash on the
 * non-uuid input (Postgres would throw "invalid input syntax for type uuid" on `id = 'lake-tahoe'`).
 *
 * ⚠ Takes the RAW flag value (nullable) on purpose: the missing-region failure belongs to
 * `requireRegionKey` above, so a call site can never re-spell it as a different message — or paper
 * over it with a default.
 */
export async function resolveRegion(idOrSlug: string | null | undefined): Promise<ResolvedRegion> {
  const key = requireRegionKey(idOrSlug)
  const rows = await withRetry(
    () =>
      db
        .select({
          id: regions.id,
          slug: regions.slug,
          displayName: regions.displayName,
          bbox: regions.bbox,
        })
        .from(regions)
        .where(or(sql`${regions.id}::text = ${key}`, eq(regions.slug, key)))
        .limit(1),
    { label: `resolveRegion(${key})` },
  )
  const row = rows[0]
  // ⚠ LIST THE REAL SLUGS on a miss. Now that `--region` is required rather than defaulted, a typo is
  // the common failure instead of a rare one — and the match is exact and CASE-SENSITIVE, so a slug
  // that differs only in case is simply unreachable. That was not hypothetical: Yosemite was seeded
  // as `Yosemite-national-park` before the admin validated lowercase-kebab, so the name any operator
  // would guess resolved to nothing (the row was renamed 2026-08-03; the hazard is the case-sensitive
  // match, which remains). One extra query, only on the error path, turns "No region matches" from a
  // dead end into the answer.
  if (!row) {
    const known = await withRetry(() => db.select({ slug: regions.slug }).from(regions).orderBy(regions.slug), {
      label: 'resolveRegion.known',
    })
    const list = known.map((r) => r.slug).join(', ') || '(none — create one in the admin Regions view)'
    throw new Error(`No region matches "${key}" — pass a region slug or its id. Known slugs: ${list}`)
  }
  return { id: row.id, slug: row.slug, displayName: row.displayName, bbox: parseRegionBbox(row.bbox) }
}

/** A region's bbox or a clear error — for the SELECT CLIs (enrich/generate) that REQUIRE one to scope. */
export function requireRegionBbox(region: ResolvedRegion): RegionBbox {
  if (!region.bbox)
    throw new Error(
      `Region "${region.slug}" has no discovery bbox — set one in the admin Regions view before enriching/generating.`,
    )
  return region.bbox
}
