// Cluster membership — the ONE resolver for "which places does a fused telling speak for".
//
// Phase 4 of the legibility layer (docs/designs/fused-cluster-generation-spec.md) has four consumers of
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
import { clusterTrigger, exceedsPointTrigger } from '@skipper/engine'
import { db } from '@skipper/db'
import { pois } from '@skipper/db/schema'
import { clusterFactsHash, groundingHash, type ClusterHashInput } from '@skipper/db/hash'
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
  /** With `source`, the `poi_overrides` key — a fused telling speaks its members' text, so the fused
   *  generator has to be able to ask whether a curated CORRECTION postdates these cached facts. */
  sourceId: string
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
  /** The EXTRACT fetch clock — the instant `pois.facts` was read from Wikipedia. Paired with
   *  `overrideStaleFor` it answers "does this member's text predate a correction?". */
  factsFetchedAt: Date | null
  factsHash: string | null
  /** The poi's SHEET digest, or null when un-enriched. Carried so each member contributes its
   *  GROUNDING hash (coalesce of the two) to the fused fingerprint — see `clusterGroundingHash`. */
  sheetHash: string | null
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
      sourceId: pois.sourceId,
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
      factsFetchedAt: pois.factsFetchedAt,
      factsHash: pois.factsHash,
      sheetHash: pois.sheetHash,
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

/** Fold a place NAME for comparing the classifier's free-text `dropped`/`highlights` lists against
 *  `pois.name`: case- and punctuation-insensitive, whitespace collapsed. Lives here, beside the
 *  membership rules it serves, so the generator and the generatability gate fold names identically —
 *  two copies would let "can this be generated?" and "what does it name?" disagree. */
export function nameKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * The tellable members a fused telling may actually NAME ALOUD — tellable minus the ones the treatment
 * classifier put on `dropped`.
 *
 * ⚠ Keyed off `dropped`, NOT `highlights`. Both are the model's free text, but measured live `dropped`
 * matches `pois.name` 68 of 69 while `highlights` manages 165 of 186 — so the fuzzy match goes on the
 * near-exact list, and a miss fails SAFE (an unmatched member stays NAMEABLE rather than silently
 * muting a place the telling exists for).
 */
export function nameableMembers(
  members: readonly ClusterMemberRow[],
  dropped: readonly string[] = [],
): ClusterMemberRow[] {
  const droppedKeys = new Set(dropped.map(nameKey))
  return tellableMembers(members).filter((m) => !droppedKeys.has(nameKey(m.name)))
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
    // ⚠ Each member contributes its GROUNDING hash, not its raw facts digest. A member's own telling
    // grounds on its sheet, so the fused telling — which is written from the same sheets — must move
    // when a sheet moves and must NOT move when the free sweep merely refreshes an extract. Feeding
    // `facts_hash` here would do the opposite on both counts: every sweep would stale all 37 fused
    // clips, and a re-enrich would leave them reading fresh.
    members: tellable.map((m) => ({
      poiId: m.id,
      name: m.name,
      factsHash: groundingHash({ factsHash: m.factsHash, sheetHash: m.sheetHash }),
    })),
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
 * THREE reasons: two corpus states an operator run fixes, and one GEOMETRY refusal that mirrors the one
 * the serving side already makes. Each is REPORTED rather than silently skipped: a cluster vanishing
 * from a preview with no reason given is how the un-enriched Yosemite half stayed invisible for a week.
 */
export function clusterGenerationBlock(
  members: readonly ClusterMemberRow[],
  dropped: readonly string[] = [],
): string | null {
  const tellable = tellableMembers(members)
  if (tellable.length === 0) return 'no tellable members (un-enriched, excluded, or taste-denied)'
  // ⚠ Every tellable member is on the classifier's `dropped` list, so the fused sheet would carry a
  // BACKGROUND ONLY block and nothing else. That sheet tells the model to name nothing, invent nothing,
  // and treat the stop as scenic — and it was reachable on a PAID story generation, which then
  // narrated, gated and synthesized whatever came back. Degenerate but silent: the clip shipped as a
  // story. Blocking here keeps "generatable" one definition, and the fix is an operator action
  // (re-run the treatment classifier, or shorten `dropped`), which is what a block is for.
  if (nameableMembers(members, dropped).length === 0)
    return 'every tellable member is on the dropped list — the telling would have nothing to name'
  // ⚠ GEOMETRY BLOCKS AGAIN (founder call 2026-08-03) — read the reversal, it is the whole point.
  //   · 2026-07-30 it STOPPED blocking, on an explicit rationale: `exceedsPointTrigger` had become a
  //     MODE selector, so a group too spread out for a point still shipped as an AREA telling and "the
  //     read path serves them a polygon".
  //   · 2026-07-31 (D42/D42a, docs/designs/drives-first-1-1.md) DELETED area mode along with roam —
  //     which deleted that RATIONALE, not just the feature. No ring, no polygon, no area-aware client
  //     remains for a wide group to fall back to, so `exceedsPointTrigger` is a plain REFUSAL THRESHOLD
  //     now (see the history on `CLUSTER_MAX_TRIGGER_RADIUS_M`), and the serving side already refuses:
  //     `buildDrive` skips a `tooWideForPoint` candidate outright (packages/engine/src/drive-select.ts).
  // Asking the SAME predicate here is what keeps "generatable" and "selectable" one definition. Without
  // it a PAID `--apply` narrates, gates, synthesizes and PERSISTS a clip no drive can ever select — and
  // a fused clip lands staged, publishes with the region release, and `releasedAt` is never cleared, so
  // that is a permanently-released, permanently-unplayable clip bought with real money.
  // ⚠ Measured HERE, on the UNCAPPED radius, because this is one of the two places it still exists:
  // apps/api serves `triggerRadiusM` already capped at `CLUSTER_MAX_TRIGGER_RADIUS_M`, and a predicate
  // reading a capped radius answers `false` for exactly the groups that need refusing. Never re-derive
  // this from a served value. The points are `speakableLat ?? lat`, the same rule serving measures on —
  // a different point rule would put the two answers back out of step.
  // Like the blocks above, the fix is an operator action: re-run the treatment classifier to split the
  // group into ones a single point can honestly speak for.
  const trigger = clusterTrigger(
    tellable.map((m) => ({ lat: m.speakableLat ?? m.lat, lng: m.speakableLng ?? m.lng })),
  )
  // Null only for an empty member set, which the first block already returned on.
  if (trigger && exceedsPointTrigger(trigger))
    return `too spread out for a point trigger (${trigger.radiusM} m enclosing radius, over CLUSTER_MAX_TRIGGER_RADIUS_M) — buildDrive would refuse the clip, so generating it would spend on an unplayable telling`
  return null
}
