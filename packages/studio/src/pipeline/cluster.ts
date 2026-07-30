// Cluster membership — the ONE resolver for "which places does a fused telling speak for".
//
// Phase 4 of the legibility layer (docs/specs/fused-cluster-generation-spec.md) has four consumers of
// that answer, and they must not each invent it:
//   · the grounding well + the attribution union   (generation)
//   · `narrations.facts_hash`                      (staleness)
//   · the trigger position + radius                (the engine)
//   · which member clips retire                    (the retirement pass)
// If the hash's member set and the well's member set ever differ by one place, the fused clip is either
// permanently stale — re-narrated and re-synthesized on every run, for real money, producing byte-
// identical audio — or permanently fresh while grounded on something else. Neither shows up in a test.
// So the set is resolved ONCE, here, and every consumer derives from the SAME returned array.
//
// ⚠ `pois.cluster_id` is NOT that set. Membership is assigned by `classify-treatments` at grouping
// time and never re-checked, while a member can afterwards be excluded (`prune-corpus`, the admin
// toggle), stay un-enriched, or have been grouped for its raw article alone. `tellableMembers` is the
// filter that turns raw membership into the set a telling may actually be written over.

import { inArray } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois } from '@skipper/db/schema'
import { clusterFactsHash, type ClusterHashInput } from '@skipper/db/hash'
import { clusterTrigger, exceedsPointTrigger } from '@skipper/engine'
import { isNarratableStoryPoi, type DeliveryRegister } from '@skipper/shared'
import type { PoiFacts, FactSheetEntry } from '@skipper/db/schema'

/** A cluster member, loaded with everything the four consumers need — so none of them re-queries and
 *  risks resolving a different set. */
export interface ClusterMemberRow {
  id: string
  clusterId: string
  name: string
  kind: string | null
  source: string
  qid: string | null
  excludedReason: string | null
  lat: number
  lng: number
  /** The road-snapped "where to look" anchor, when the snap found a drivable road. Null = the raw pin
   *  is all there is. The cluster's trigger position is computed over these (spec §4.1). */
  speakableLat: number | null
  speakableLng: number | null
  speakableRoadClass: string | null
  deliveryRegister: DeliveryRegister | null
  facts: PoiFacts | null
  factSheet: FactSheetEntry[] | null
  /** The enrich stamp — the sheet's frozen credit instant, which a fused clip's attribution needs
   *  (`factSheetToAttribution` takes ONE retrievedAt for the union, so the caller takes the latest). */
  enrichedAt: Date | null
  factsHash: string | null
}

/** The `poi_clusters` fields a fused telling is generated FROM — structural, so the admin server can
 *  pass a row it loaded itself without importing studio. */
export interface ClusterGroupingRow {
  title: string
  highlights: readonly string[]
  dropped: readonly string[]
}

/**
 * Every member row for the given clusters, keyed by cluster id and ordered by poi id.
 *
 * Deliberately UNFILTERED in SQL. The eligibility rule lives in `tellableMembers` (TS) alone — one
 * definition, no SQL/TS pair to drift apart, and it mirrors how `generate-narrations` already works
 * (load the region, then filter in a loop). The corpus makes this free: cluster membership is a few
 * hundred rows, so there is nothing to push down. It also means a caller that wants the RAW membership
 * — the retirement pass, which must retire a member's clip whether or not that member was tellable —
 * gets it from the same call.
 */
export async function loadClusterMembers(
  clusterIds: readonly string[],
): Promise<Map<string, ClusterMemberRow[]>> {
  const byCluster = new Map<string, ClusterMemberRow[]>()
  if (clusterIds.length === 0) return byCluster
  const rows = await db
    .select({
      id: pois.id,
      clusterId: pois.clusterId,
      name: pois.name,
      kind: pois.kind,
      source: pois.source,
      qid: pois.qid,
      excludedReason: pois.excludedReason,
      lat: pois.lat,
      lng: pois.lng,
      speakableLat: pois.speakableLat,
      speakableLng: pois.speakableLng,
      speakableRoadClass: pois.speakableRoadClass,
      deliveryRegister: pois.deliveryRegister,
      facts: pois.facts,
      factSheet: pois.factSheet,
      enrichedAt: pois.enrichedAt,
      factsHash: pois.factsHash,
    })
    .from(pois)
    .where(inArray(pois.clusterId, [...clusterIds]))
    .orderBy(pois.id) // stable input order — the hash sorts anyway, but previews should not shuffle
  for (const r of rows) {
    if (r.clusterId == null) continue // unreachable under the WHERE; narrows the nullable column
    const list = byCluster.get(r.clusterId)
    if (list) list.push({ ...r, clusterId: r.clusterId })
    else byCluster.set(r.clusterId, [{ ...r, clusterId: r.clusterId }])
  }
  return byCluster
}

/** The members a fused telling may be written over — the ones that reach the grounding well. Every
 *  other consumer of "the cluster's places" derives from THIS array, never from raw membership. */
export function tellableMembers(members: readonly ClusterMemberRow[]): ClusterMemberRow[] {
  return members.filter((m) =>
    isNarratableStoryPoi({
      source: m.source,
      name: m.name,
      excludedReason: m.excludedReason,
      hasFacts: m.facts != null,
      sheetLength: Array.isArray(m.factSheet) ? m.factSheet.length : 0,
    }),
  )
}

/**
 * The fused telling's `narrations.facts_hash` — `clusterFactsHash` over the TELLABLE members plus the
 * cluster's naming evidence. NULL when nothing is tellable, which is not an error: half the grouped
 * corpus is un-enriched, so a null here means "this cluster cannot be generated yet", and the caller
 * must skip it BEFORE consulting freshness (a null hash reads as permanently stale, which would queue
 * the cluster for paid narration on every run).
 */
export function clusterGroundingHash(
  cluster: ClusterGroupingRow,
  members: readonly ClusterMemberRow[],
): string | null {
  const tellable = tellableMembers(members)
  const input: ClusterHashInput = {
    members: tellable.map((m) => ({ poiId: m.id, factsHash: m.factsHash })),
    title: cluster.title,
    highlights: cluster.highlights,
    dropped: cluster.dropped,
  }
  return clusterFactsHash(input)
}

/**
 * Why this cluster CANNOT be generated yet, or null when it can. The one gate step 4's queue asks,
 * so "generatable" has a single definition rather than one per caller.
 *
 * Two reasons, and they are different in kind: nothing tellable is a corpus state that an `enrich`
 * run fixes, while too-wide is a design limit that needs the districts' area trigger. Both are
 * reported rather than silently skipped — a cluster vanishing from a preview with no reason given is
 * how the un-enriched Yosemite half stayed invisible for a week.
 */
export function clusterGenerationBlock(members: readonly ClusterMemberRow[]): string | null {
  const tellable = tellableMembers(members)
  if (tellable.length === 0) return 'no tellable members (un-enriched, excluded, or taste-denied)'
  const trigger = clusterTrigger(tellable.map((m) => ({ lat: m.speakableLat ?? m.lat, lng: m.speakableLng ?? m.lng })))
  if (trigger && exceedsPointTrigger(trigger)) {
    return `too spread out for a point trigger (${trigger.radiusM} m) — deferred with the districts`
  }
  return null
}
