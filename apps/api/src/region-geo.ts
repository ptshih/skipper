// Which region a saved drive belongs to — DERIVED, never stored.
//
// WHY THIS EXISTS. `GET /drives` returns a flat, unbounded list (a free account may hold
// `FREE_DRIVE_CAP` drives) in which every title is machine-made `A → B`, so at a second region the
// list mixes two places with nothing saying which is which. The fix is a region label per row.
//
// ⚠ IT IS DERIVED BECAUSE THE SCHEMA SAYS SO, not as a preference. `drives.bbox_*`'s own comment:
// "the geometry-first replacement for a region FK: a drive's region(s) are DERIVED by intersecting
// this bbox with regions, NEVER stored", and `docs/decisions/geometry-first-regions.md` pre-blesses
// exactly this read ("A drive's region(s) CAN be derived by intersecting its bbox with `regions`
// where a label is wanted"). A 2026-08-05 pass considered stamping `drives.region_id` instead and
// reversed — see `docs/designs/my-drives-legibility.md` §4 for that deliberation. ⚠ Do NOT "simplify"
// this away by adding the column: the read path here is the whole point, and stamping it would
// materialize a spatial join onto a row, which is the one thing that record forbids.
//
// ⚠ THE POINT TESTED IS THE DRIVE'S START, NOT ITS BBOX, and that is precision rather than laziness.
// The planner's anchor roster is itself selected BY BBOX (`loadRegionAnchors(region.bbox)`), so a
// drive's start anchor is inside its region's box BY CONSTRUCTION — testing that one point recovers
// exactly the region the planner was working in. A bbox-vs-bbox intersect would be strictly worse: a
// route's rectangle can clip a neighbouring region it never enters, which manufactures a second,
// wrong label out of geometry the rider never drove.

import { isNotNull } from 'drizzle-orm'
import { db } from '@skipper/db'
import { regions } from '@skipper/db/schema'
import { parseRegionBbox, pointInRegionBbox, type RegionBbox } from '@skipper/engine'
import { REGION_GEO_MEMO_TTL_MS } from './limits'
import { withRetry } from './retry'

/** One released region, reduced to what labelling a drive needs: its identity and its box. */
export interface RegionBox {
  id: string
  slug: string
  displayName: string
  box: RegionBbox
}

/**
 * Single-slot, per-instance memo — the same first-cut shape as `regionsMemo` in ./index.ts.
 *
 * ⚠ A SINGLE SLOT rather than the Map ./roster-cache uses, and the difference is the QUESTION, not an
 * inconsistency: that cache answers "this one region's roster" and would thrash on a single slot once
 * a second region ships; this one needs EVERY region at once to ask which box contains a point, so
 * there is only ever one entry to hold. Bounded by the region count either way — data we control.
 */
let memo: { at: number; boxes: RegionBox[] } | null = null

/**
 * The released regions' boxes, from cache when fresh.
 *
 * ⚠ RELEASED ONLY (`released_at IS NOT NULL`), and this is a leak guard, not a filter for tidiness. A
 * DRAFT region is not public — its name is still being tuned and none of its corpus is visible — so
 * naming one to a rider through their own drive list would publish it early, by the back door, on a
 * route that has nothing to do with the release gate. A drive whose start sits in a draft region's box
 * therefore derives to `null` and simply shows unlabelled, which is the correct direction for that
 * error to point. See `docs/decisions/region-release-gate.md`.
 *
 * ⚠ A region with a null or malformed `bbox` is DROPPED rather than defaulted. `regions.bbox` is
 * nullable, and there is no sane fallback box: guessing one would label drives with a region that does
 * not geographically contain them, and `docs/decisions/no-default-region.md` records what a defaulted
 * region bbox already cost once (it billed the wrong corpus and settled green).
 */
export async function loadRegionBoxes(): Promise<RegionBox[]> {
  if (memo && Date.now() - memo.at < REGION_GEO_MEMO_TTL_MS) return memo.boxes

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
        .where(isNotNull(regions.releasedAt)),
    { label: 'drive.regionBoxes' },
  )

  const boxes: RegionBox[] = []
  for (const r of rows) {
    const box = parseRegionBbox(r.bbox)
    if (!box) continue // null or malformed — see the ⚠ above; never defaulted
    boxes.push({ id: r.id, slug: r.slug, displayName: r.displayName, box })
  }
  memo = { at: Date.now(), boxes }
  return boxes
}

/** A drive's derived region, as the wire carries it. */
export interface DriveRegionLabel {
  id: string
  slug: string
  displayName: string
}

/** Box area in raw degrees². Only ever COMPARED, never shown — so the fact that a degree of longitude
 *  is not a degree of latitude does not matter here: any monotonic measure of "smaller box" ranks two
 *  nested regions the same way, and nested is the only case this decides. */
const areaOf = (b: RegionBbox) => (b.neLat - b.swLat) * (b.neLng - b.swLng)

/**
 * Which region contains this point? `null` when none does.
 *
 * PURE, and separate from the loader above precisely so it is testable without a database — the
 * containment rule is the part with edge cases, and the query is the part that is boring.
 *
 * ⚠ MOST SPECIFIC WINS when boxes overlap or nest. `geometry-first-regions.md`'s tripwire names this
 * exact case as a "stop and reconsider" moment — a broad "Sierra Nevada" containing "Lake Tahoe" —
 * and a rider in Tahoe means Tahoe, not the range. Picking the smallest containing box is also what
 * makes this DETERMINISTIC: without a rule, the answer would be whatever order Postgres returned, and
 * a drive would change its label between requests for no reason a log could explain.
 *
 * ⚠ Containment is `pointInRegionBbox`, which is INCLUSIVE on all four edges — deliberately the same
 * answer the admin's region poi-count and the API's `between` anchor query give, so a place exactly on
 * a boundary cannot belong to a region on one screen and not on another.
 */
export function regionForPoint(
  boxes: readonly RegionBox[],
  lat: number,
  lng: number,
): DriveRegionLabel | null {
  let best: RegionBox | null = null
  for (const r of boxes) {
    if (!pointInRegionBbox(r.box, lat, lng)) continue
    if (!best || areaOf(r.box) < areaOf(best.box)) best = r
  }
  return best ? { id: best.id, slug: best.slug, displayName: best.displayName } : null
}

/**
 * Drop the memo. TESTS ONLY.
 *
 * ⚠ Same reason ./roster-cache carries one: a process-wide cache and bun's process-wide `mock.module`
 * are the same hazard — the first test to resolve the region list would otherwise pin it for every
 * later test in the process, and a test that makes a region vanish would read a stale hit and fail
 * for a reason nothing in it names.
 */
export function resetRegionGeoMemo(): void {
  memo = null
}
