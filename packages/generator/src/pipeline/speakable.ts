// Curated "where to look" anchors — the SEED defaults for a place's speakable vantage. The
// region sweep (discover-pois.ts) applies these onto `pois.speakable` when it discovers a place;
// from then on the DB column is the source of truth (an admin edit overrides the seed, and the
// upsert coalesce keeps the existing value so a re-sweep never clobbers an admin change). select.ts
// reads the anchor off the corpus candidate (NOT this map) and recomputes the per-segment side
// (left/right) from approach_heading_deg × the anchor. Keyed by the pois identity (source, sourceId).
const SPEAKABLE_ANCHORS: Record<string, { lat: number; lng: number }> = {
  // Ed Z'berg Sugar Pine Point State Park — pin sits inland; speakable content (shoreline,
  // Sugar Pine Point Light) is lakeside. (Was the lone poi_overrides side_anchor row.)
  'wikipedia:41195091': { lat: 39.061266, lng: -120.113971 },
}

export function speakableAnchorFor(source: string, sourceId: string) {
  return SPEAKABLE_ANCHORS[`${source}:${sourceId}`]
}
