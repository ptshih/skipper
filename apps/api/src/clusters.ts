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
import {
  CLUSTER_MAX_TRIGGER_RADIUS_M,
  clusterTrigger,
  convexHull,
  exceedsPointTrigger,
  type LngLat,
} from '@skipper/engine'
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
  /** AREA mode: the convex hull of the members, for a group too spread out to be a point. Undefined
   *  for a compact group, which triggers on the point above exactly as before. */
  area?: { ring: LngLat[]; marginM: number }
}

/** Slack outside a district's hull that still counts as arriving. The hull passes THROUGH the member
 *  anchors rather than around the block they sit on, so a rider on the far kerb is a few tens of metres
 *  "outside" a district they are plainly in. Sized for that plus consumer GPS error between tall
 *  buildings — which is exactly where districts are. */
const AREA_MARGIN_M = 60

/** The variety bucket every fused telling shares. NOT null: `drive-select` treats two nulls as
 *  DIFFERENT (asserting sameness on absent data was the original variety bug), and two "here is a
 *  group of places" stops back to back genuinely do feel repetitive — which is the exact question
 *  `varietyKey` answers. A constant is honest here; the members' own buckets describe the parts, not
 *  the fused whole. */
export const CLUSTER_VARIETY_KEY = 'cluster'

/**
 * A poi is SUPERSEDED when the fused telling that speaks for it is one we are ACTUALLY SERVING to
 * this caller — spec §4.2, founder-settled: a clustered member is not an active POI once the fused
 * clip exists. The fused clip is the only telling for that place; keeping the members would leave a
 * rider in downtown Reno with 46 competing pins plus a fused one.
 *
 * ⚠ Takes the ids of the tellings actually being served, NOT a predicate that re-derives them. That
 * is the difference between an invariant and a coincidence: the served set already accounts for the
 * release gate AND the client's area capability, so a caller who is being withheld a district cannot
 * also lose that district's members. The earlier version asked "does a visible fused telling EXIST",
 * which would have silently emptied downtown Reno for every area-unaware client.
 *
 * An empty list suppresses nothing, which is the correct no-op.
 */
export function notSupersededByServedCluster(servedClusterIds: readonly string[]) {
  if (servedClusterIds.length === 0) return undefined // nothing served ⇒ nothing suppressed
  const ids = sql.join(servedClusterIds.map((id) => sql`${id}::uuid`), sql`, `)
  // ⚠ RETURNS THE *KEEP* CONDITION, and the NULL handling is the whole reason.
  // `not(inArray(pois.clusterId, ids))` looks equivalent and is catastrophically wrong: for the ~1300
  // POIs with a NULL cluster_id, `NULL IN (…)` is NULL, so `NOT (…)` is NULL — which is not TRUE, so
  // Postgres drops the row. Measured when I wrote it that way: /roam near Tahoe City fell from 46 pins
  // to 4, i.e. it deleted every UNCLUSTERED place in the corpus. The previous `NOT EXISTS (…)` form
  // was NULL-safe by accident; this one is NULL-safe on purpose.
  return sql`(${pois.clusterId} is null or ${pois.clusterId} not in (${ids}))`
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
    const pts = members.get(r.clusterId) ?? []
    const trigger = clusterTrigger(pts)
    if (!trigger) continue // nothing tellable left — drop it rather than fire it somewhere arbitrary
    // A group too spread out for a point gets an AREA instead of a fatter circle. `exceedsPointTrigger`
    // is the same predicate the generation gate asks, so what we SERVE and what we agreed to GENERATE
    // can never disagree about which mode a group is in.
    const needsArea = exceedsPointTrigger(trigger)
    const area = needsArea
      ? { ring: convexHull(pts.map((p): LngLat => [p.lng, p.lat])), marginM: AREA_MARGIN_M }
      : undefined
    if (needsArea && (!area || area.ring.length < 3)) continue // collinear members: no honest polygon
    out.push({
      ...(area ? { area } : {}),
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
      // ⚠ For an AREA telling this is the POINT FALLBACK, not the real trigger — an area-aware client
      // uses the ring and ignores it. It is CAPPED rather than the true enclosing radius (914 m for
      // downtown Reno) because an area-unaware client fires on it: uncapped, it hears the district a
      // kilometre out on the approach, the recede gate retires it, and a long cooldown locks it — the
      // rider hears about downtown everywhere EXCEPT downtown. The cap is the same line the generation
      // gate uses, i.e. "never looser than the loosest thing already shipping" (an un-anchored kindless
      // POI's floor), so the worst case degrades to today's worst case instead of past it.
      triggerRadiusM: needsArea
        ? Math.min(trigger.radiusM, CLUSTER_MAX_TRIGGER_RADIUS_M)
        : trigger.radiusM,
    })
  }
  return out
}
