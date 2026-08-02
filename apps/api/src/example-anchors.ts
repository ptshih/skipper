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
import { parseRegionBbox } from '@skipper/engine'

/** How many names a region publishes. A DISPLAY count: it prices nothing and bounds no request body,
 *  which is why it is here and not in ./limits (that file is the ONE home for rider-facing SPEND and
 *  SIZE caps — INV-11/INV-12 — and diluting it with cosmetics is how a real cap gets edited casually).
 *  Six is the top of the reviewed 3-6 range: copy can use fewer, it cannot invent more. */
export const EXAMPLE_ANCHORS_PER_REGION = 6

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

/** Collapse whitespace — the same `flatten` the planner's roster block applies. A name carrying a
 *  newline renders as a broken two-line chip. */
const flatten = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Featured first, then by name, then by id.
 *
 *  ⚠ CODEPOINT comparison, NOT `localeCompare` — mirrors `buildRosterBlock` (apps/api/src/planner.ts).
 *  There the payoff is a byte-stable cached prompt prefix; here it is that the example chips must not
 *  reshuffle between app launches or between Cloud Run instances, which is exactly what an ICU/locale
 *  difference between processes would do. `id` is a TIEBREAK ONLY (it makes the order total) and is
 *  never emitted.
 *
 *  `featured` is the curator's "float the popular ones to the top" judgment, which is precisely what
 *  should seed an example ask — but it ORDERS, it does not FILTER: filtering would hand a region with
 *  nothing flagged an empty list and kill the example asks for the launch region.
 *  ⚠ Product hazard with no code fix: featured-then-alphabetical can return six names clustered in one
 *  corner, which makes a poor "from X to Y" example. The lever is the curator's flag (an admin
 *  surface), not a heuristic here — this stays deterministic. */
function byRank(a: ExampleAnchorPlace, b: ExampleAnchorPlace): number {
  if (a.featured !== b.featured) return a.featured ? -1 : 1
  if (a.name !== b.name) return a.name < b.name ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * regionId → up to `EXAMPLE_ANCHORS_PER_REGION` display names.
 *
 * Bucketing is point-in-bbox in JS from ONE scan of the curated set, not a query per region: `places`
 * carries no region_id (geometry-first, docs/decisions/geometry-first-regions.md), and a per-region
 * query would be N+1 on an anonymous route every app launch hits. Overlapping bboxes therefore share a
 * place, which is correct — there is no single-assignment rule.
 *
 * NEVER THROWS. Every region gets an entry; a missing bbox, a malformed bbox, or no curated places all
 * map to `[]`, because this feeds decoration and a decoration must not be able to 500 the region list.
 */
export function pickExampleAnchors(
  regionRows: readonly ExampleAnchorRegion[],
  placeRows: readonly ExampleAnchorPlace[],
): Map<string, string[]> {
  // Sorted ONCE for all regions, and re-sorted here even though the SQL already ordered: `asc(name)` in
  // Postgres runs under the DATABASE COLLATION, not codepoint. Same technique, same reason as the
  // planner's roster block — make the guarantee local instead of dependent on a query staying sorted.
  const ranked = [...placeRows].sort(byRank)
  const out = new Map<string, string[]>()
  for (const r of regionRows) {
    const box = parseRegionBbox(r.bbox)
    if (!box) {
      out.set(r.id, [])
      continue
    }
    // ⚠ The engine's parser is the ONE reader of `regions.bbox` (1.1 sweep) — this file used to carry
    // its own, and a region IS a bbox rather than a stored FK, so two parsers disagreeing about axis
    // order would put a region's example anchors on the wrong side of the lake.
    const { swLng: lngMin, swLat: latMin, neLng: lngMax, neLat: latMax } = box
    const names: string[] = []
    const seen = new Set<string>()
    for (const p of ranked) {
      if (names.length >= EXAMPLE_ANCHORS_PER_REGION) break
      // Inclusive on both edges — matches the `between()` in loadRegionAnchors, so a place is in
      // exactly the same region here as it is in the planner's allowlist.
      if (p.lat < latMin || p.lat > latMax || p.lng < lngMin || p.lng > lngMax) continue
      const name = flatten(p.name)
      // Two curated rows can legitimately share a display name; a duplicate chip reads as a bug, and a
      // blank one reads as a broken render.
      if (!name || seen.has(name)) continue
      seen.add(name)
      names.push(name)
    }
    out.set(r.id, names)
  }
  return out
}
