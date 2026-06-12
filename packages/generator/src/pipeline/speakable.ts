// Curated "where to look" anchors — a place's speakable vantage, relocated off poi_overrides
// (side_anchor) onto pois.speakable. The side (left/right) is still computed per-segment from
// approach_heading_deg × this anchor (select.ts). Keyed by the pois identity (source, sourceId).
const SPEAKABLE_ANCHORS: Record<string, { lat: number; lng: number }> = {
  // Ed Z'berg Sugar Pine Point State Park — pin sits inland; speakable content (shoreline,
  // Sugar Pine Point Light) is lakeside. (Was the lone poi_overrides side_anchor row.)
  'wikipedia:41195091': { lat: 39.061266, lng: -120.113971 },
}

export function speakableAnchorFor(source: string, sourceId: string) {
  return SPEAKABLE_ANCHORS[`${source}:${sourceId}`]
}
