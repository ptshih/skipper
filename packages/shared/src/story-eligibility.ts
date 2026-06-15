// Story-eligibility — is a POI story-grade NARRATION material? This is a property of the POI, shared
// by every consumer that narrates it: BOTH tours and roam select story-grade POIs from the same
// corpus (roam is one consumer, not the owner). SINGLE SOURCE OF TRUTH for the gates — the admin POIs
// table classifies with `classifyStoryEligibility`, and `generate-roam` reads the same constants for
// its queue. (Whether a roam CLIP exists / is fresh is a SEPARATE, roam-specific axis — computed in
// /admin/pois as `roamClip`, not here.)

/** A story-grade place needs at least this many chars of its (FULL) Wikipedia article — "enough to
 *  say". `facts.extract` IS the full article now (the region sweep deepens at discovery time), so this
 *  measures real article richness, not a lead proxy. Below it a place is wave-eligible only (the
 *  10–20s form, not yet shipped), so today the floor simply excludes stub articles. STARTING value,
 *  ear-tunable (like the LUFS target): the deep fetch caps articles at ~1200 chars (`fetchDeepExtracts`
 *  exchars), so the meaningful floor lives in (stub, ~1200). `generate-roam --min-extract` overrides. */
export const STORY_MIN_EXTRACT = 800

/** TASTE gate: violent-crime / personal-tragedy articles are never a charming narration target — a
 *  joke-forward persona can't carry them (the sweep is breadth-first, so these slip in). Applies to
 *  ANY telling (tour OR roam). Title-keyed; tuned for MODERN personal/violent crime while preserving
 *  the historical/civic-tragedy carve-out the persona CAN play straight (a wildfire, a shipwreck, an
 *  earthquake, the Donner Party, a wild-west gunfight) — so it deliberately omits broad words like
 *  "attack"/"fire"/"shootout"/"wreck". Two guards dodge benign POIs: `shooting(?! range)` keeps gun
 *  ranges, `\brape\b` keeps "Grapevine"/"grape". Cheap to over-filter (a skipped POI is just silence,
 *  visible in the admin); a leak gets the founder ear. (NOTE: enforced in roam's queue today; tours
 *  should adopt it too — tracked in TODO.) */
export const STORY_TASTE_DENYLIST =
  /kidnap|abduction|murder|manslaughter|homicide|killing of|mass killing|massacre|lynching|shooting(?! range)|stabbing|gunman|hostage|\brape\b|sexual assault|assault|suicide|death of|serial killer|execution of|terrorism|terrorist|genocide|torture/i

/** Whether a POI is story-grade narration material — a POI property, NOT roam-specific (tours AND
 *  roam draw story-grade POIs from the same corpus). The FIRST failing gate names the reason. */
export type StoryEligibility =
  | 'eligible' // passes every gate → a tour OR a roam encounter can tell it
  | 'filtered-source' // not a wikipedia story source (a wikidata scenic pin — wave layer later)
  | 'filtered-taste' // title hits the taste denylist
  | 'filtered-stub' // wikipedia, but the article is below the story floor (a stub — too short to narrate)

export function classifyStoryEligibility(p: {
  source: string
  name: string
  leadExtractChars: number
}): StoryEligibility {
  if (p.source !== 'wikipedia') return 'filtered-source'
  if (STORY_TASTE_DENYLIST.test(p.name)) return 'filtered-taste'
  if (p.leadExtractChars < STORY_MIN_EXTRACT) return 'filtered-stub'
  return 'eligible'
}
