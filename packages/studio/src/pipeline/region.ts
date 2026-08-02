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
 * Resolve a region by its SLUG (e.g. `lake-tahoe`) OR its uuid → identity + parsed discovery bbox.
 * The `::text` cast lets a slug and a uuid both match in one query without a uuid-parse crash on the
 * non-uuid input (Postgres would throw "invalid input syntax for type uuid" on `id = 'lake-tahoe'`).
 */
export async function resolveRegion(idOrSlug: string): Promise<ResolvedRegion> {
  const key = idOrSlug.trim()
  if (!key) throw new Error('--region is required (a region slug, e.g. lake-tahoe, or its id).')
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
  if (!row) throw new Error(`No region matches "${key}" — pass a region slug (e.g. lake-tahoe) or its id.`)
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
