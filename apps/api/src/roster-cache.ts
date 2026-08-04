// The planner's region + anchor roster, memoized per instance.
//
// WHY THIS EXISTS. `POST /drives/plan` resolved the region and then loaded its curated anchors on
// EVERY rider message — two SEQUENTIAL Neon round-trips (the anchor query needs the bbox the region
// query returns) in front of every single turn of every conversation. What those two queries fetch is
// identical for every rider in a region and changes only when an operator releases a region or runs
// `curate-places`. `GET /regions` already solved exactly this with `REGIONS_MEMO_TTL_MS`; the planner
// never got the same treatment, and it is the hotter path of the two — `/regions` is hit once per app
// launch, this once per MESSAGE.
//
// ⚠ WHAT IT IS ACTUALLY FOR, stated precisely so nobody oversells it later. Two things:
//   1. It takes two round-trips off the latency path of every rider message, and off the shared DB.
//      ./limits is explicit that DB capacity is shared with the paid endpoints, so hammering it
//      degrades `/drives/plan` and `/drives/propose` — the two that cost money.
//   2. It makes the roster STABLE ACROSS THE TURNS OF ONE CONVERSATION. The roster rides inside the
//      CACHED system-prompt prefix, so an operator running `curate-places` mid-conversation would
//      otherwise change the prefix between turns and silently re-bill the whole thing at full price.
// ⚠ It is NOT what makes the prefix byte-stable in general — `buildRosterBlock` re-sorts, so the
// rendered block is already a pure function of the row set. Do not cite this module for that.
//
// ⚠ THE COST IS OPERATOR-VISIBLE, NEVER RIDER-VISIBLE, and it is the same trade `/regions` already
// accepted: after releasing a region or curating places, an operator waits up to one TTL, per live
// instance, before the planner sees it. Nobody gets a wrong answer; somebody waits.

import { eq } from 'drizzle-orm'
import { db } from '@skipper/db'
import { regions } from '@skipper/db/schema'
// ⚠ `RankableAnchor` (./anchor-format), NOT the `RegionAnchor` WIRE DTO this used to hold. The DTO
// carries lat/lng and `kind` because it once served a client-facing picker route; that route is gone,
// and the planner is now the only consumer — a model D9 gives no coordinates and no place facts. The
// narrower type is what makes "the roster cannot leak a coordinate" a fact about the TYPE rather than
// a promise about who reads it. (And it is a pure, env-free module, which keeps this one importable
// without dragging anything in.)
import type { RankableAnchor } from './anchor-format'
import { loadRegionAnchors } from './drives'
import { PLAN_ROSTER_MEMO_TTL_MS } from './limits'
import { withRetry } from './retry'

/** Everything the planner needs to know about the region it is working, and nothing else. */
export interface RegionRoster {
  /** The region's stored display name — rides in the cached prefix, so never anything per-request. */
  name: string
  /** The curated places: the planner's ENTIRE world besides that name (D9) — ids and names, plus the
   *  `rank` that ORDERS them and is never printed. No coordinates, by type. */
  anchors: RankableAnchor[]
}

/**
 * Per-instance, in-memory, keyed by region id — the same first-cut shape as `regionsMemo` in
 * ./index.ts and ./rate-limit, and acceptable for the same reason: the worst case of a cold instance
 * is one extra pair of queries, never a wrong answer.
 *
 * ⚠ A MAP RATHER THAN A SINGLE SLOT because a Cloud Run instance serves every region, and a
 * single-slot cache would thrash between them the moment a second region ships — turning a cache into
 * a cache MISS generator without anything failing.
 */
const memo = new Map<string, { at: number; roster: RegionRoster }>()

/**
 * Resolve a region's name + anchors, from cache when fresh.
 *
 * Returns null when the region does not exist — the caller answers that in persona, not as an error.
 *
 * ⚠ ONLY HITS ARE MEMOIZED, AND THAT IS A BOUNDEDNESS PROPERTY, not an oversight. This route is open
 * and anonymous, so `regionId` is attacker-controlled: caching misses would let a stranger grow this
 * map without limit by sending fresh UUIDs. Caching only hits bounds it by the number of REAL regions
 * — data we control — forever. The cost is that an unknown id pays its DB read every time, which the
 * two stacked rate limiters at the mount already bound.
 * ⚠ It also means a region CREATED after a miss is visible immediately rather than after a TTL, which
 * is the direction you want that error to point.
 */
export async function loadRegionRoster(regionId: string): Promise<RegionRoster | null> {
  const hit = memo.get(regionId)
  if (hit && Date.now() - hit.at < PLAN_ROSTER_MEMO_TTL_MS) return hit.roster

  const [region] = await withRetry(
    () => db.select({ bbox: regions.bbox, name: regions.displayName }).from(regions).where(eq(regions.id, regionId)).limit(1),
    { label: 'plan.region' },
  )
  if (!region) return null

  const roster: RegionRoster = { name: region.name, anchors: await loadRegionAnchors(region.bbox) }
  memo.set(regionId, { at: Date.now(), roster })
  return roster
}

/**
 * Drop everything cached. TESTS ONLY.
 *
 * ⚠ IT EXISTS BECAUSE A PROCESS-WIDE CACHE AND A PROCESS-WIDE MOCK ARE THE SAME HAZARD. bun's
 * `mock.module` is process-wide, and `test/plan-stream.test.ts` deliberately MUTATES its stubbed
 * region rows between tests ("Mutable so a test can make the region vanish") — so without this, the
 * first test to resolve a region would pin it for every later one, and the unknown-region test would
 * read a cached hit and fail for a reason nothing in it names.
 * ⚠ NOT a `NODE_ENV === 'test'` bypass. ./limits records why that shape is wrong: a control that
 * disables itself under test is untestable BY CONSTRUCTION, which is exactly how `rateLimit()` ended
 * up unable to prove its own 429.
 */
export function resetRosterMemo(): void {
  memo.clear()
}
