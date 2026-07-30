// Serving a FUSED CLUSTER telling — the read side of phase 4 (spec §2, §4.1b).
//
// A `narrations` row is about a poi XOR a `poi_clusters` row. Every read path was written when only
// the first kind existed and inner-joins `pois`, which made a fused telling INVISIBLE — the deliberate
// safe default when `poi_id` went nullable (silence beats a wrong place-name). This module is the
// other branch: it loads the cluster tellings and synthesizes the geometry `poi_clusters` doesn't
// store, so the two kinds can be concatenated into one corpus.
//
// ⚠ STRICTLY ADDITIVE AT RUNTIME. Every query here is scoped to `narrations.cluster_id IS NOT NULL`.
// Until fused generation runs there are zero such rows, so each of these returns [] and every caller
// behaves exactly as it did before. That is the whole safety argument for landing this ahead of the
// audio it serves — there is no intermediate state where a rider sees something new.
//
// ⚠ The member-eligibility RULE is single-sourced in `@skipper/shared` (`isNarratableStoryPoi`); only
// the SELECT is local. `apps/api` cannot import `@skipper/studio` (no dependency, and
// `apps/admin/server/places.ts` documents the standing policy of duplicating a query rather than
// pulling studio's graph in), so the rule travels and the plumbing doesn't.

import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { narrations, poiClusters, pois } from '@skipper/db/schema'
import { clusterTrigger } from '@skipper/engine'
import { isNarratableStoryPoi } from '@skipper/shared'

/** A fused telling resolved to something triggerable: the clip, plus the geometry derived from the
 *  members it names. Deliberately shaped to match the poi-side corpus row field for field. */
export interface ClusterTelling {
  narrationId: string
  clusterId: string
  form: string
  key: string
  durationMs: number
  attribution: unknown
  revisedAt: Date | null
  /** `poi_clusters.title` — what a driver calls the place ("Emerald Bay"). The one field that maps
   *  cleanly from a cluster to the name a poi telling gets from `pois.name`. */
  name: string
  lat: number
  lng: number
  /** From `clusterTrigger` — a cluster has no `kind`, so the radius vocabulary can't answer this and
   *  the floor has to be carried explicitly. */
  triggerRadiusM: number
}

/** The variety bucket every fused telling shares. NOT null: `drive-select` treats two nulls as
 *  DIFFERENT (asserting sameness on absent data was the original variety bug), and two "here is a
 *  group of places" stops back to back genuinely do feel repetitive — which is the exact question
 *  `varietyKey` answers. A constant is honest here; the members' own buckets describe the parts, not
 *  the fused whole. */
export const CLUSTER_VARIETY_KEY = 'cluster'

/**
 * A poi is SUPERSEDED when its cluster already has a fused telling this caller can see — spec §4.2,
 * founder-settled: a clustered member is not an active POI in either mode once the fused clip exists.
 * The fused clip is the only telling for that place; keeping the members would leave a rider in
 * downtown Reno with 46 competing pins plus a fused one.
 *
 * ⚠ Keyed on "its cluster HAS a visible fused telling", NEVER on `cluster_id IS NOT NULL`. Most of the
 * grouped corpus has no fused clip and never will until it is enriched — 30 Yosemite clusters have
 * zero enriched members, and the UNR campus is deferred by the geometry gate. Suppressing on
 * membership alone would delete those places from roam and from drives with NOTHING to replace them.
 * Self-gating is also what makes the retirement safe to ship BEFORE a release: with every fused clip
 * staged, this predicate suppresses nothing.
 *
 * `includeStaged` mirrors the caller's own release filter, so an admin previewing staged content sees
 * what RELEASE would look like rather than both layers at once.
 */
export function supersededByFusedTelling(includeStaged: boolean) {
  return sql`exists (
    select 1 from ${narrations} n2
    where n2.cluster_id = ${pois.clusterId}
      ${includeStaged ? sql`` : sql`and n2.released_at is not null`}
  )`
}

/** Members of the given clusters, filtered to the ones a telling may be written over. Mirrors the
 *  studio-side resolver (`pipeline/cluster.ts`); the shared predicate is what keeps them in step. */
async function tellableMembersByCluster(clusterIds: string[]): Promise<Map<string, { lat: number; lng: number }[]>> {
  const byCluster = new Map<string, { lat: number; lng: number }[]>()
  if (clusterIds.length === 0) return byCluster
  const rows = await db
    .select({
      clusterId: pois.clusterId,
      name: pois.name,
      source: pois.source,
      excludedReason: pois.excludedReason,
      lat: pois.lat,
      lng: pois.lng,
      speakableLat: pois.speakableLat,
      speakableLng: pois.speakableLng,
      hasFacts: sql<boolean>`${pois.facts} is not null`,
      sheetLength: sql<number>`coalesce(case when jsonb_typeof(${pois.factSheet}) = 'array'
        then jsonb_array_length(${pois.factSheet}) else 0 end, 0)`,
    })
    .from(pois)
    .where(inArray(pois.clusterId, clusterIds))
    .orderBy(pois.id)

  for (const r of rows) {
    if (r.clusterId == null) continue
    if (!isNarratableStoryPoi({
      source: r.source,
      name: r.name,
      excludedReason: r.excludedReason,
      hasFacts: Boolean(r.hasFacts),
      sheetLength: Number(r.sheetLength),
    })) continue
    // The same `speakableLat ?? lat` rule every read path uses — the road-snapped anchor when the
    // snap found one, else the raw pin.
    const p = { lat: r.speakableLat ?? r.lat, lng: r.speakableLng ?? r.lng }
    const list = byCluster.get(r.clusterId)
    if (list) list.push(p)
    else byCluster.set(r.clusterId, [p])
  }
  return byCluster
}

/**
 * Every released (or staged, for an admin) fused telling, resolved to a trigger point.
 *
 * Unlike the poi paths there is no SQL bbox prefilter: `poi_clusters` stores no coordinates, so the
 * position only exists once the members are loaded. That is fine at this scale — the whole grouped
 * corpus is a few hundred rows and only a few dozen carry a telling — and the caller trims by
 * distance afterwards, exactly as `/roam` already trims the bbox's corners.
 *
 * A cluster whose members have all become un-tellable (excluded, un-enriched) yields NO position and
 * is DROPPED. That is the correct failure: the clip names places that are no longer in the corpus, so
 * silence beats playing it. It will also read as stale, because the same member set feeds the hash.
 */
export async function loadClusterTellings(opts: {
  includeStaged: boolean
  /** Restrict to specific clusters (the frozen-drive replay path, whose selection items name their
   *  subject). Omit for "every fused telling". An EMPTY array means "none" and short-circuits — it
   *  must never be read as "no filter", which would serve the whole corpus into one drive. */
  clusterIds?: string[]
}): Promise<ClusterTelling[]> {
  if (opts.clusterIds && opts.clusterIds.length === 0) return []
  const rows = await db
    .select({
      narrationId: narrations.id,
      clusterId: poiClusters.id,
      form: narrations.form,
      key: narrations.audioUrl,
      durationMs: narrations.audioDurationMs,
      attribution: narrations.attribution,
      revisedAt: narrations.updatedAt,
      name: poiClusters.title,
    })
    .from(narrations)
    .innerJoin(poiClusters, eq(poiClusters.id, narrations.clusterId))
    .where(
      and(
        isNotNull(narrations.clusterId),
        opts.includeStaged ? undefined : isNotNull(narrations.releasedAt),
        opts.clusterIds ? inArray(poiClusters.id, opts.clusterIds) : undefined,
      ),
    )
  if (rows.length === 0) return []

  const members = await tellableMembersByCluster(rows.map((r) => r.clusterId))
  const out: ClusterTelling[] = []
  for (const r of rows) {
    const trigger = clusterTrigger(members.get(r.clusterId) ?? [])
    if (!trigger) continue // nothing tellable left — drop it rather than fire it somewhere arbitrary
    out.push({
      narrationId: r.narrationId,
      clusterId: r.clusterId,
      form: r.form,
      key: r.key,
      durationMs: r.durationMs,
      attribution: r.attribution,
      revisedAt: r.revisedAt,
      name: r.name,
      lat: trigger.lat,
      lng: trigger.lng,
      triggerRadiusM: trigger.radiusM,
    })
  }
  return out
}
