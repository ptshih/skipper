import type { StoryEligibility } from '@/lib/api'

export type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'outline'

// Keyed to the real poi_source pgEnum (wikipedia | wikidata) — the corpus is Wikidata-spine ONLY
// (every poi has a QID). Google break anchors are NOT pois — they live in the `places` table.
export const SOURCE_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  wikipedia: { label: 'Wikipedia', variant: 'default' },
  wikidata: { label: 'Wikidata', variant: 'secondary' },
}

/** Story-eligibility → badge. A POI property (roam draws story-grade POIs from the corpus).
 *  `eligible` is the actionable one; the filtered-* states are intentional exclusions, muted. */
export const STORY_ELIGIBILITY_META: Record<StoryEligibility, { label: string; variant: BadgeVariant; hint: string }> = {
  eligible: { label: 'eligible', variant: 'default', hint: 'Story-grade — a roam telling can use it' },
  'filtered-source': { label: 'scenic pin', variant: 'outline', hint: 'Wikidata pin — not a story source (wave layer later)' },
  'filtered-taste': { label: 'taste-gate', variant: 'outline', hint: 'Title hits the taste denylist' },
  'filtered-stub': { label: 'stub', variant: 'secondary', hint: 'No article text to enrich (empty/disambiguation page)' },
}

/** The SEPARATE narration axis — shown as a secondary badge only when a narration exists. */
export const NARRATION_META: Record<'fresh' | 'stale', { label: string; variant: BadgeVariant; hint: string }> = {
  fresh: { label: 'narration', variant: 'success', hint: 'Has a narration on current facts' },
  stale: { label: 'narration · stale', variant: 'warning', hint: 'Facts moved — a run would regenerate it' },
}
