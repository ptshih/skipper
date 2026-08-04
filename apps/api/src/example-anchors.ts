// Which curated endpoint NAMES a region publishes on GET /regions — the tappable example asks on the
// conversation screen, and the in-persona offline/outage copy that has to name somewhere real without a
// network call. NAMES ONLY: no ids, no coordinates. An anchor id is the one thing that can bill a Google
// Routes call (INV-1), so it never rides an anonymous list route; the names are already public the
// moment the planner opens its mouth.
//
// Pure + env-free ON PURPOSE. The handler lives in ./index, which imports ./auth and THROWS at module
// load without BETTER_AUTH_SECRET, and `bun test` runs unwrapped by dotenvx — so anything importable
// from index.ts is untestable by construction. Same workaround as apps/api/test/planner.test.ts.

// ⚠ The one import, and it keeps this file's env-free property: @skipper/engine is zero-dep and
// RN-safe by design, so importing it needs no secret, no DB and no network — which is what lets this
// selection be tested without booting index.ts.
import { haversineMeters, parseRegionBbox, pointInRegionBbox } from '@skipper/engine'
import { byAnchorRank, flatten } from './anchor-format'

/** How many names a region publishes. A DISPLAY count: it prices nothing and bounds no request body,
 *  which is why it is here and not in ./limits (that file is the ONE home for rider-facing SPEND and
 *  SIZE caps — INV-11/INV-12 — and diluting it with cosmetics is how a real cap gets edited casually).
 *
 *  ⚠ Raised 6 → 8 when the client began ROTATING (2026-08-03). It is now a rotation DEPTH, not just a
 *  roster length: the cold open spends three names per launch (A→B start, A→B end, the loop's town),
 *  so six gave two launches' worth before repeating. Eight with a stride of three cycles every name
 *  through every slot before any pair comes back. The offline card renders all of them, so this is
 *  also the chip count on `PlannerUnavailableCard` — check that card if you raise it much further. */
export const EXAMPLE_ANCHORS_PER_REGION = 8

/** The floor on how far apart two published anchors may be, in metres.
 *
 *  ⚠ THIS IS THE BUG THIS FILE EXISTED TO GROW. Until 2026-08-03 the published list was the
 *  alphabetical head of the featured set, and in Tahoe that head was `Eagle Falls` then
 *  `Emerald Bay State Park` — 600 METRES apart. The app's highest-intent tap read "Eagle Falls to
 *  Emerald Bay State Park, the scenic way", i.e. it offered a rider a six-hundred-metre drive, and
 *  nothing failed because nothing was measuring. A separation floor makes that unreachable by
 *  construction rather than unlikely: the client pairs names blind (it is given no coordinates,
 *  INV-1), so the ONLY place this can be guaranteed is here.
 *
 *  8 km is deliberately well below the ~12 km the live Tahoe set actually achieves at k=8 — it is a
 *  floor against absurdity, not a target. It BINDS by publishing FEWER names, never worse ones; the
 *  client already degrades cleanly on a short list. */
export const MIN_ANCHOR_SEPARATION_M = 8_000

/** The most rows fed to the O(n²) spread below.
 *
 *  Bounds a per-request path: `GET /regions` is anonymous and every app launch hits it. 64 rows is
 *  ~2k haversines for the seed pair plus ~4k for the greedy fill — microseconds, and memoized on top.
 *  Today's whole featured set is 16, so this binds on nothing; it exists so that a region curated to
 *  hundreds of featured places cannot quietly turn a cosmetic field into a CPU cost. ⚠ When it DOES
 *  bind it truncates in rank order, which reintroduces exactly the alphabetical bias the spread was
 *  added to remove — raise it, or narrow the pool, before letting a region grow past it. */
export const SPREAD_POOL_LIMIT = 64

/** The ceiling on the ONE endpoint-eligible scan that feeds every region's examples (the handler's
 *  `.limit()`).
 *
 *  ⚠ Deliberately NOT `MAX_PLAN_ANCHORS`. That constant is a per-region ceiling on the planner's
 *  allowlist, where truncating costs a rider a place they can actually drive to; this is a global
 *  ceiling on a cosmetic scan, where truncating costs a chip. One number governing both would mean a
 *  future tightening of the planner's spend cap silently starves the example asks of a multi-region
 *  deployment — two different failure modes deserve two numbers.
 *
 *  Safe to truncate because the query orders `featured DESC` FIRST: every curated-popular row across
 *  every region is fetched before any un-featured one, so a truncation can only trim a tail that was
 *  never going to be published. Far above the curated set today (tens of rows); revisit if
 *  `SELECT count(*) FROM places WHERE endpoint_eligible` approaches it. */
export const EXAMPLE_ANCHOR_SCAN_LIMIT = 500

/** A region as this module needs it: an id and its bbox string. No `displayName` — the caller projects
 *  the wire DTO; this only decides WHICH names belong to WHICH id. */
export interface ExampleAnchorRegion {
  id: string
  bbox: string | null
}

/** A curated endpoint row. `lat`/`lng` are read here to bucket by bbox and are NEVER emitted — the
 *  return type is `string[]`, which is the type system carrying INV-1 for us. */
export interface ExampleAnchorPlace {
  id: string
  name: string
  lat: number
  lng: number
  featured: boolean
}

/** The TOTAL ORDER over candidates — no longer the published order.
 *
 *  ⚠ This used to BE the answer, and the note here used to say the clustering it causes was "a product
 *  hazard with no code fix", lever = the curator's `featured` flag. That was wrong twice over, and both
 *  halves were measured on 2026-08-03 (founder). The flag is not a usable lever, because flagging a
 *  place for the picker is not the same judgement as putting it in the shop window — one `curate-places
 *  --apply` added `Carson City` and it took slot 0 from `Eagle Falls` on the strength of C sorting
 *  before E, with no curator intending anything. And the clustering was never merely a hazard: the
 *  pre-existing pair was 600 m apart (see MIN_ANCHOR_SEPARATION_M).
 *
 *  What it is FOR now: `featured` still decides POOL MEMBERSHIP (below), and name/id still break ties
 *  so the spread is deterministic — same rows in, same names out, on every Cloud Run instance. It just
 *  no longer decides what a rider READS. */
const byRank = byAnchorRank<ExampleAnchorPlace>

/**
 * Greedy farthest-point (k-center) selection: the seed is the two most distant members of `pool`,
 * then each further pick is whichever candidate is furthest from everything already chosen.
 *
 * ⚠ THE STOPPING RULE IS THE POINT, not the ordering. Greedy max-min is monotonically non-increasing,
 * so the score of the LAST pick IS the minimum pairwise separation of the whole result. Stopping when
 * that score drops below `minSeparationM` therefore buys a guarantee about EVERY pair, not just
 * adjacent ones — which is exactly what the client needs, because it pairs these names blind.
 *
 * ⚠ DETERMINISTIC BY TIE-BREAK, and it has to be: `pool` arrives in `byRank` order and every
 * comparison here is strict `>`, so the earliest-ranked candidate wins any tie. Two co-located places
 * therefore resolve the same way on every instance and between launches. A `>=` here would make the
 * published chips depend on array order — the same class of instability the codepoint sort in
 * ./anchor-format exists to prevent.
 *
 * ⚠ Spread is ANTI-CORRELATED WITH QUALITY, which is why the caller narrows the pool first and this
 * function is not given the whole curated set. Maximising distance seeks the CORNERS of a bbox, and a
 * region's corners hold its most marginal places: run over all 109 Tahoe endpoints it returns
 * `Stampede Reservoir` and `Tahoe Meadows Ophir Creek Trailhead`, not one featured name among eight.
 * Geometry decides the SHAPE of the set; the curator still decides who is eligible for it.
 */
export function spreadAnchors<T extends { lat: number; lng: number }>(
  pool: readonly T[],
  k: number,
  minSeparationM: number,
): T[] {
  if (k <= 0 || pool.length === 0) return []
  if (pool.length === 1) return [pool[0]!]

  const metres = (a: T, b: T): number => haversineMeters([a.lng, a.lat], [b.lng, b.lat])

  // Seed with the diameter of the set. Seeding from the highest-RANKED row instead would re-anchor the
  // whole result on the alphabetical head — i.e. hand slot 0 straight back to Carson City, which is the
  // complaint that started this.
  let seedA = pool[0]!
  let seedB = pool[1]!
  let widest = -1
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const d = metres(pool[i]!, pool[j]!)
      if (d > widest) {
        widest = d
        seedA = pool[i]!
        seedB = pool[j]!
      }
    }
  }
  // The pair itself must clear the floor, or there is nothing here worth publishing as two places.
  // Returning ONE name is the honest answer, and the client degrades to the loop + open asks.
  if (widest < minSeparationM) return [seedA]

  const out: T[] = [seedA, seedB]
  while (out.length < k) {
    let pick: T | null = null
    let best = -1
    for (const cand of pool) {
      if (out.includes(cand)) continue
      let nearest = Infinity
      for (const chosen of out) nearest = Math.min(nearest, metres(cand, chosen))
      if (nearest > best) {
        best = nearest
        pick = cand
      }
    }
    if (!pick || best < minSeparationM) break
    out.push(pick)
  }
  return out
}

/** What one region publishes, and whether it can be driven at all.
 *
 *  ⚠ BOTH COME FROM ONE PASS, deliberately. They answer different questions off the same containment
 *  test, and computing them in two places is how this file already got burned once — it used to carry
 *  its own bbox parser AND its own containment test, and two readers disagreeing about axis order or
 *  edge-inclusivity puts a region's anchors on the wrong side of the lake. A second function asking
 *  "is anything in this bbox" would be that mistake again, one refactor later. */
export interface RegionAnchors {
  /** Up to `EXAMPLE_ANCHORS_PER_REGION` display names. DECORATION — see the DTO. */
  names: string[]
  /** At least one curated endpoint-eligible place falls inside this region's bbox. A CAPABILITY: the
   *  client hides the composer when it is false, so this must never be read off `names`. */
  ready: boolean
}

/**
 * regionId → its display names and whether it is plannable.
 *
 * SELECTION, in one line: contained → eligible (`featured` if any, else all) → name-deduped →
 * farthest-point spread with a separation floor. `featured` gates membership and geometry orders the
 * result; NOTHING here is alphabetical any more, which is the whole point (see `byRank`).
 *
 * ⚠ THE RETURNED ORDER IS LOAD-BEARING AND THE CLIENT ROTATES THROUGH IT. It spends three names per
 * cold open (A→B start, A→B end, the loop's town) at a stride of three, so which names sit ADJACENT
 * decides which pairs a rider ever sees. Every pair is safe here only because `spreadAnchors`
 * guarantees a minimum separation across the whole set rather than between neighbours — do not
 * "tidy" this into a post-sort (alphabetical, by featured, anything), or the guarantee the client is
 * leaning on quietly stops holding while every test still passes.
 *
 * Bucketing is point-in-bbox in JS from ONE scan of the curated set, not a query per region: `places`
 * carries no region_id (geometry-first, docs/decisions/geometry-first-regions.md), and a per-region
 * query would be N+1 on an anonymous route every app launch hits. Overlapping bboxes therefore share a
 * place, which is correct — there is no single-assignment rule.
 *
 * NEVER THROWS. Every region gets an entry; a missing bbox, a malformed bbox, or no curated places all
 * map to no names and `ready: false`, because this feeds decoration and a decoration must not be able
 * to 500 the region list. A region with no EXTENT cannot be planned, so `false` is the honest answer
 * there rather than a degradation.
 *
 * ⚠ `ready` INHERITS THE SCAN CAP and that is the one way it can lie. The handler's single query is
 * `.limit(EXAMPLE_ANCHOR_SCAN_LIMIT)` ordered `featured DESC` first, so a region whose ONLY curated
 * endpoints sit in the un-featured tail beyond that limit would be reported not-ready and lose its
 * composer. Harmless while the whole curated set is tens of rows; the constant's own note already says
 * to revisit as it approaches the limit, and this is now a second reason to.
 */
export function pickExampleAnchors(
  regionRows: readonly ExampleAnchorRegion[],
  placeRows: readonly ExampleAnchorPlace[],
): Map<string, RegionAnchors> {
  // Sorted ONCE for all regions, and re-sorted here even though the SQL already ordered: `asc(name)` in
  // Postgres runs under the DATABASE COLLATION, not codepoint. Same technique, same reason as the
  // planner's roster block — make the guarantee local instead of dependent on a query staying sorted.
  const ranked = [...placeRows].sort(byRank)
  const out = new Map<string, RegionAnchors>()
  for (const r of regionRows) {
    const box = parseRegionBbox(r.bbox)
    if (!box) {
      out.set(r.id, { names: [], ready: false })
      continue
    }
    // ⚠ The engine owns BOTH halves of "is this poi in this region" (1.1 sweep) — this file used to
    // carry its own parser AND its own containment test, and a region IS a bbox rather than a stored
    // FK, so two readers disagreeing about axis order or edge-inclusivity would put a region's example
    // anchors on the wrong side of the lake. `pointInRegionBbox` is inclusive on all four edges, which
    // is what matches the `between()` in loadRegionAnchors — a place is in exactly the same region
    // here as it is in the planner's allowlist.
    // ⚠ ONE FULL CONTAINMENT PASS, no early break. The old loop stopped as soon as the display list
    // filled, which was safe when the published names WERE the first few contained rows; the spread
    // below has to see every candidate before it can pick the widest-separated ones, so stopping early
    // would silently narrow it to the alphabetical head again.
    const contained: ExampleAnchorPlace[] = []
    let ready = false
    for (const p of ranked) {
      if (!pointInRegionBbox(box, p.lat, p.lng)) continue
      // ⚠ SET FROM CONTAINMENT ALONE, ABOVE every filter below — that is what makes `ready` a real
      // answer rather than `names.length > 0` spelled differently. A region whose only curated
      // endpoint has a blank or duplicated display NAME is still perfectly drivable; deriving this
      // from the published list would hide its composer over a cosmetic defect, which is the whole
      // class of bug this field was added to end. Now doubly worth stating: the separation floor can
      // legitimately publish ONE name for a tightly-clustered region, and that region is still ready.
      ready = true
      contained.push(p)
    }

    // ⚠ `featured` FILTERS HERE AND ORDERS NOWHERE — the inversion this change is really about.
    // Curator judgement decides who is ELIGIBLE to be an example (spread alone would return a region's
    // most obscure corners, measured); geometry decides which of the eligible actually appear. The
    // fallback to the whole contained set is not tidiness: ./anchor-format's rule that "featured
    // ORDERS, it never FILTERS" was protecting a real case — a region nobody has flagged yet must not
    // lose its example asks entirely, which is what a bare `.filter(featured)` would do to the next
    // region curated.
    const flagged = contained.filter((p) => p.featured)
    const eligible = flagged.length > 0 ? flagged : contained

    // Name hygiene BEFORE the spread, so a blank or duplicated display name can never consume one of
    // the k slots. Two curated rows can legitimately share a name; a duplicate chip reads as a bug and
    // a blank one reads as a broken render.
    const pool: ExampleAnchorPlace[] = []
    const seen = new Set<string>()
    for (const p of eligible) {
      const name = flatten(p.name)
      if (!name || seen.has(name)) continue
      seen.add(name)
      pool.push({ ...p, name })
      if (pool.length >= SPREAD_POOL_LIMIT) break
    }

    const picked = spreadAnchors(pool, EXAMPLE_ANCHORS_PER_REGION, MIN_ANCHOR_SEPARATION_M)
    out.set(r.id, { names: picked.map((p) => p.name), ready })
  }
  return out
}
