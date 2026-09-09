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
import { db } from './client'
import { narrations, poiClusters, pois } from './schema'
import { CLUSTER_MAX_TRIGGER_RADIUS_M, clusterTrigger, exceedsPointTrigger } from '@skipper/engine'
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
  /** The tellable members' anchors, the same `speakableLat ?? lat` points `clusterTrigger` was
   *  derived from. Carried because a WIDE group is placed on its MEMBERS, not its centre — buildDrive
   *  takes the earliest one the route comes close enough to trigger. ⚠ Always populated (not just for
   *  wide groups): "which point represents this" is a question only the route can answer, and serving
   *  it conditionally would make the drive path depend on a flag computed for a different reason. */
  memberPoints: { lat: number; lng: number }[]
  /** GEOMETRY: `exceedsPointTrigger` on the UNCAPPED radius — "no single point can represent this
   *  group honestly". The drive path places these from `memberPoints` rather than freezing a
   *  mis-placed centre into a selection (buildDrive's second admission rule).
   *  ⚠ Cannot be recomputed downstream — `triggerRadiusM` below is served CAPPED, so by then the
   *  evidence is gone and `exceedsPointTrigger` would answer `false` for exactly these groups.
   *  ⚠ There used to be a second field here, `area` — a served convex hull, so a roaming rider could
   *  fire on CONTAINMENT instead of proximity. It went with roam: a drive knows its polyline, so it
   *  never needs to ask "am I inside?". Keeping the QUESTION (this boolean) separate from that one
   *  ANSWER is what let the mode be deleted without the refusal silently becoming an admission. */
  tooWideForPoint: boolean
}

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
 * is the difference between an invariant and a coincidence: the served set accounts for the release
 * gate, so a caller who is being withheld a telling cannot also lose that telling's members. The
 * earlier version asked "does a visible fused telling EXIST", which would have silently emptied
 * downtown Reno for any caller that could not see the fused clip.
 *
 * An empty list suppresses nothing, which is the correct no-op.
 */
export function notSupersededByServedCluster(servedClusterIds: readonly string[]) {
  if (servedClusterIds.length === 0) return undefined // nothing served ⇒ nothing suppressed
  const ids = sql.join(servedClusterIds.map((id) => sql`${id}::uuid`), sql`, `)
  // ⚠ RETURNS THE *KEEP* CONDITION, and the NULL handling is the whole reason.
  // `not(inArray(pois.clusterId, ids))` looks equivalent and is catastrophically wrong: for the ~1300
  // POIs with a NULL cluster_id, `NULL IN (…)` is NULL, so `NOT (…)` is NULL — which is not TRUE, so
  // Postgres drops the row. MEASURED when it was written that way: the pin list near Tahoe City fell
  // from 46 to 4 — it deleted every UNCLUSTERED place in the corpus. The previous `NOT EXISTS (…)` form
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
 * distance afterwards, the same way the poi paths trim the bbox's corners.
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
    // Is this group too spread out to be told from a single point? `exceedsPointTrigger` is the same
    // predicate the generation gate asks, so what we SERVE and what we agreed to GENERATE can never
    // disagree about which groups are tellable.
    // ⚠ A `true` here selects a PLACEMENT RULE, not a mode. 1.1 removed AREA tellings entirely —
    // there is no ring, no polygon and no area-aware client — and since 2026-08-03 `buildDrive`
    // places a wide group on the earliest MEMBER the route reaches instead of its centre
    // (packages/engine/src/drive-select.ts). That needs no polygon, so do not read the old "gets an
    // area instead of a fatter circle" framing back into this flag — the route supplies the geometry.
    // ⚠ Computed HERE on purpose: `triggerRadiusM` below is served already CAPPED, so this is the
    // last place the group's true extent is known. A consumer that re-asked `exceedsPointTrigger`
    // downstream would read the cap and get `false` for exactly the groups that need refusing.
    const tooWideForPoint = exceedsPointTrigger(trigger)
    // ⚠ These are still SERVED, not withheld, and that is deliberate: `servedClusterIds` (derived
    // from what this returns) drives `notSupersededByServedCluster`, so withholding here would leave
    // the members suppressed with nothing replacing them — downtown Reno would go from 46 pins to
    // ZERO. Withholding and suppressing must read from the same list. The refusal happens one level
    // down, in buildDrive, where the route geometry is known.
    out.push({
      tooWideForPoint,
      // The points `trigger` was computed from — buildDrive re-snaps them to place a wide group.
      memberPoints: pts,
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
      // ⚠ CAPPED for a wide group rather than served at its true enclosing radius (914 m for downtown
      // Reno). A client that fired on the uncapped value would hear the district a kilometre out on
      // the approach, retire it on recede, and lock it behind a long cooldown — the rider hears about
      // downtown everywhere EXCEPT downtown. The cap is the same line the generation gate uses, i.e.
      // "never looser than the loosest thing already shipping" (an un-anchored kindless POI's floor),
      // so the worst case degrades to today's worst case instead of past it.
      // ⚠ This is a LIVE code path since 2026-08-03 — `buildDrive` now admits wide groups (placed on
      // their members), so this capped radius is what downtown Reno actually fires on, not a dormant
      // safety floor behind a refusal. It matters more than it used to, not less. Keep the cap and the
      // generation gate consistent: loosening one without the other is how a group starts firing at
      // its uncapped extent.
      triggerRadiusM: tooWideForPoint
        ? Math.min(trigger.radiusM, CLUSTER_MAX_TRIGGER_RADIUS_M)
        : trigger.radiusM,
    })
  }
  return out
}
