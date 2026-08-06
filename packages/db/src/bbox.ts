// The SQL half of "is this row inside this region" — the query-side twin of @skipper/engine's
// `pointInAnyRegionBbox`.
//
// ⚠ WHY THIS EXISTS AT ALL. A region may be SEVERAL boxes (see `parseRegionBboxes`), so every
// region-scoped query stops being one `and(between(lat), between(lng))` and becomes an OR over the
// boxes. There were already ~12 hand-written copies of the single-box predicate across the API, the
// admin server and the studio CLIs, and this file's whole job is to stop that becoming ~12
// hand-written copies of a harder expression. `regions.bbox` is the only thing standing between a poi
// and the region it belongs to; two readers disagreeing about it silently move places between
// regions, which is the same argument that put the PARSER in one place during the 1.1 sweep.
//
// ⚠ INCLUSIVE ON ALL FOUR EDGES, because `pointInRegionBbox` is. That agreement is what lets an
// operator read the admin's region poi-count and the API's anchor query as the same number — a region
// boundary decided one way in JS and another in SQL surfaces as two screens disagreeing about one poi.
// drizzle's `between` is inclusive, which is why it is used rather than a hand-rolled `>= AND <=`.
//
// ⚠ NO @skipper/engine IMPORT ON PURPOSE. The box is taken STRUCTURALLY, so `@skipper/db` gains no
// dependency on the engine package (and the engine, which is zero-dep and ships into the mobile
// bundle, gains no knowledge of drizzle). The two shapes are checked against each other by the
// callers, which hold both.

import { and, between, or, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

/** A box, structurally — matches @skipper/engine's `RegionBbox` without importing it. */
export interface SqlRegionBbox {
  swLng: number
  swLat: number
  neLng: number
  neLat: number
}

/**
 * `lat`/`lng` fall inside ANY of `boxes`.
 *
 * ⚠ AN EMPTY LIST MATCHES NOTHING, and that is the load-bearing case rather than an edge one. A
 * region with a null or malformed bbox parses to `[]`, and the honest answer to "I cannot read this
 * region's extent" is "match nothing" — never "match everything", which is what an unguarded
 * `and(...[])` would produce, since drizzle folds an empty `and()` away and leaves the query
 * UNFILTERED. That is not a hypothetical: an unfiltered region scope is how a paid run bills the
 * wrong corpus (docs/decisions/no-default-region.md) and how a release publishes rows nobody
 * authorised. `sql\`false\`` is the fail-closed answer and it is deliberate.
 */
export function inAnyBbox(
  lat: AnyPgColumn,
  lng: AnyPgColumn,
  boxes: readonly SqlRegionBbox[],
): SQL {
  if (boxes.length === 0) return sql`false`
  const clauses = boxes.map((b) =>
    and(between(lat, b.swLat, b.neLat), between(lng, b.swLng, b.neLng)),
  )
  // A single box stays a plain AND — same SQL the hand-written predicates emitted, so this is a
  // no-op rewrite for every region that never needed a second box.
  return clauses.length === 1 ? clauses[0]! : or(...clauses)!
}
