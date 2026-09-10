import { and, eq, inArray } from 'drizzle-orm'
import { pois } from '@skipper/db/schema'
import { inAnyBbox } from '@skipper/db/bbox'
import type { RegionBbox } from '@skipper/engine'

/** Explicit IDs always constrain spend, even when a region is supplied for context.
 * A region may narrow that selection; it must never replace it with the whole corpus.
 */
export function narrationScope(ids: string[], boxes: RegionBbox[] | null) {
  if (ids.length) return and(inArray(pois.id, ids), boxes ? inAnyBbox(pois.lat, pois.lng, boxes) : undefined)
  if (!boxes?.length) throw new Error('Narration selection requires explicit IDs or a region')
  return and(eq(pois.source, 'wikipedia'), inAnyBbox(pois.lat, pois.lng, boxes))
}
