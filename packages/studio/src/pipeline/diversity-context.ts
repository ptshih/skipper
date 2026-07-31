// "Which tellings already exist here" — the context the cross-clip diversity lint is scored against,
// and the geometry-first membership rule underneath it.
//
// ONE definition, because both generators need it and both got it wrong the same way first. The lint
// can only see repetition it is HANDED, and each generator originally handed it a single-element
// array — in which every cross-clip rule is a no-op by arithmetic. That is how one geology sentence
// reached 17 released Tahoe clips and "national register of historic places" reached 67: nothing was
// ever in a position to see the second use. The solo path was fixed in 0f80d97 and the fused path in
// d73d681, as two separate edits to two hand-copied queries whose comments cross-referenced each other
// as the thing keeping them in step. This is that step, made structural.
//
// ⚠ BOTH SUBJECT KINDS, always. A fused telling replaces its members on the read paths, so one that
// echoes the member clips it retired is the same defect wearing a hat — and the member audio still
// exists, so a rider with a saved drive can hear both.
//
// ⚠ A fused narration carries `poi_id` NULL (`narrations_subject_xor`), so it has no poi to take a
// bbox from. An inner join to `pois` — or coalescing that NULL away — silently drops every fused clip
// from its own context. Region membership therefore resolves PER SUBJECT KIND: a solo telling by its
// poi's point, a fused one by whether any MEMBER poi sits in the box. That is the same geometry-first
// rule the rest of the repo uses; `poi_clusters` deliberately stores no coordinates of its own.

import { and, between, isNotNull, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { narrations, pois } from '@skipper/db/schema'
import { withRetry } from './http'
import type { RegionBbox } from './region'

/** Poi ids whose point falls in the box. A sub-select, not a round trip — it inlines into the query. */
export function poiIdsInBbox(bbox: RegionBbox) {
  return db
    .selectDistinct({ id: pois.id })
    .from(pois)
    .where(and(between(pois.lat, bbox.swLat, bbox.neLat), between(pois.lng, bbox.swLng, bbox.neLng)))
}

/** Cluster ids with at least one MEMBER poi in the box — a cluster is in a region the same
 *  geometry-first way everything else is, by where its members are. */
export function clusterIdsInBbox(bbox: RegionBbox) {
  return db
    .selectDistinct({ id: pois.clusterId })
    .from(pois)
    .where(
      and(
        isNotNull(pois.clusterId),
        between(pois.lat, bbox.swLat, bbox.neLat),
        between(pois.lng, bbox.swLng, bbox.neLng),
      ),
    )
}

/**
 * Every existing telling's script for the diversity lint to check a new take against.
 *
 * `bbox` NULL means WHOLE CORPUS, and that is deliberate rather than a degenerate case: an
 * `--include-ids` run picks pois by hand and has no region, and the clips it is repairing are usually
 * the ones that repeat what the corpus already says. Falling back to NO context there would quietly
 * reproduce the original bug on the most common repair path. Whole-corpus is the honest scope for it —
 * a rider can hear two clips from different regions on one drive, so repetition across them is still
 * repetition.
 */
export async function loadDiversityContext(bbox: RegionBbox | null): Promise<string[]> {
  const where = bbox
    ? and(
        isNotNull(narrations.script),
        sql`(${narrations.poiId} in ${poiIdsInBbox(bbox)} or ${narrations.clusterId} in ${clusterIdsInBbox(bbox)})`,
      )
    : isNotNull(narrations.script)
  const rows = await withRetry(
    () => db.select({ script: narrations.script }).from(narrations).where(where),
    { label: 'load diversity context' },
  )
  return rows.map((r) => r.script).filter((s): s is string => !!s)
}
