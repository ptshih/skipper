// A coarse "what sort of thing is this" bucket, for the drive selector's VARIETY rule.
//
// The problem it fixes: `drive-select.ts` `better()` prefers a candidate whose kind DIFFERS from the
// previous pick, so a drive doesn't narrate four houses in a row. But `pois.kind` comes from
// `featureKind()`, an allowlist of evocative NATURAL features (bay, peak, cove) — correct by design, and
// null for 85% of the corpus, because most places are built. `null !== null` is false, so the variety
// rule silently no-opped across the entire built world.
//
// Wikidata P31 types cover that gap: 336 of the kindless narrated POIs carry one, and they are exactly
// the vocabulary needed (house 43, hotel 33, casino 7, railway station 6, ski resort 6, church 5).
//
// ⚠ This is DELIBERATELY coarse and separate from `kind`. `kind` drives `radiusForKind` — a physical
// size question — and must keep its natural-feature vocabulary. This answers "would hearing these two
// back-to-back feel repetitive", which is an editorial question with different right answers: a hotel
// and a casino are one bucket here (both "a big building you check into") though nothing else treats
// them alike.

/** Coarse buckets, ordered MOST-SPECIFIC FIRST because matching is first-hit. That ordering is
 *  load-bearing, not cosmetic: `ski resort` contains `resort`, so with lodging first a ski area came back
 *  as somewhere you sleep. When adding a pattern, put the multiword one above the word it contains. */
const BUCKETS: readonly (readonly [string, RegExp])[] = [
  ['leisure', /\b(ski resort|sports venue|stadium|arena|theatre|theater|golf|campground|racetrack)\b/],
  ['lodging', /\b(hotel|motel|inn|resort|casino|lodge)\b/],
  ['dwelling', /\b(house|home|mansion|cabin|residence|villa)\b/],
  ['worship', /\b(church|chapel|cathedral|temple|synagogue|mission)\b/],
  ['civic', /\b(school|university|college|library|courthouse|post office|hospital|museum|capitol|government)\b/],
  ['transport', /\b(railway station|train station|station|airport|bridge|tunnel|depot|railroad)\b/],
  ['recreation', /\b(park)\b/],
  ['industry', /\b(mine|mill|factory|brewery|ranch|farm|dam|power|works|warehouse)\b/],
  ['settlement', /\b(census-designated place|unincorporated|human settlement|city|town|village|ghost town)\b/],
  ['commerce', /\b(store|shop|restaurant|bar|saloon|business|company|bank)\b/],
]

/**
 * The variety key for a candidate. Prefers the natural-feature `kind` when present (it is the more
 * specific signal and already differentiates lakes from peaks), else derives a coarse bucket from the
 * Wikidata P31 labels, else null.
 *
 * Null means "unknown", and callers must treat two nulls as NOT a repeat — asserting sameness on absent
 * data is exactly the bug this exists to fix.
 */
export function varietyKey(kind?: string | null, wikidataTypes?: string[] | null): string | null {
  if (kind) return kind
  for (const raw of wikidataTypes ?? []) {
    const t = raw.toLowerCase()
    for (const [bucket, re] of BUCKETS) if (re.test(t)) return bucket
  }
  return null
}
