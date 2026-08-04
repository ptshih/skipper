// Shared formatting + ordering for curated anchors.
//
// WHY A THIRD FILE rather than one importing the other: both readers are load-bearing for DIFFERENT
// reasons and neither is the natural owner. ./planner turns anchors into the model's roster block —
// a cached prompt prefix billed on every anonymous turn (INV-11). ./example-anchors turns them into
// the region list's example chips — decoration that must never 500 and must never reshuffle between
// launches. Their doc comments already cross-referenced each other by name, which is the shape of a
// rule with no home; this is the home.
//
// ⚠ Pure + env-free, like ./example-anchors: no DB, no vendor SDK, no secret. ./planner imports
// `@anthropic-ai/sdk`, so the arrow could only ever point this way.

/** Collapse whitespace to single spaces and trim.
 *
 *  ⚠ Load-bearing on BOTH sides for different reasons. In the planner's roster this is a SYSTEM block
 *  the model reads as authoritative, so a curated name carrying a newline would forge an extra roster
 *  row — an off-list place the planner believes it can send a rider to. In the example chips a newline
 *  simply renders as a broken two-line chip. Same transform, two very different worst cases. */
export const flatten = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** The shape both readers order by. `rank` is OPTIONAL because `PlannerAnchor` declares it that
 *  way; see the comparator for why that difference is preserved rather than normalized. */
export interface RankableAnchor {
  id: string
  name: string
  rank?: number | null
}

/**
 * Featured first, then by name, then by id.
 *
 * ⚠ CODEPOINT comparison, NOT `localeCompare`, and this is the single most breakable line here. On the
 * planner side it keeps the cached prompt prefix BYTE-STABLE across Cloud Run instances — an ICU/locale
 * difference between two processes would silently bust the cache for the same region and re-bill the
 * whole prefix at full price on every turn, with nothing failing. On the example-chip side it keeps the
 * chips from reshuffling between app launches or between instances. "Tidying" this to `localeCompare`
 * breaks the expensive one invisibly.
 *
 * `rank` ORDERS, it never FILTERS: filtering would hand a region whose draft carried no ranks an empty
 * list and kill the example asks for the launch region. It is never a printed field either — on the
 * planner side that would be a place FACT, which D9 gives the model none of.
 *
 * `id` is a TIEBREAK ONLY (it makes the order total) and is never emitted.
 *
 * ⚠ NULL AND UNDEFINED SORT LAST, TOGETHER. A rank is the LLM draft's judgement of how likely a visitor
 * is to say the name; a row without one is a hand-add, and putting an operator's manual entry ahead of
 * the model's considered order is the opposite of what either of them meant. Ascending otherwise — 1 is
 * the most-named, which is the reverse of the `featured` boolean this replaced, so read the comparison
 * rather than assuming it kept its sign.
 */
export function byAnchorRank<T extends RankableAnchor>(a: T, b: T): number {
  const ar = a.rank ?? Number.POSITIVE_INFINITY
  const br = b.rank ?? Number.POSITIVE_INFINITY
  if (ar !== br) return ar - br
  if (a.name !== b.name) return a.name < b.name ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
