// Story-eligibility — is a POI story-grade NARRATION material? This is a property of the POI, shared
// by every consumer that narrates it: BOTH tours and roam select story-grade POIs from the same
// corpus (roam is one consumer, not the owner). SINGLE SOURCE OF TRUTH for the gates — the admin POIs
// table classifies with `classifyStoryEligibility`, and `generate-roam` reads the same constants for
// its queue. (Whether a roam CLIP exists / is fresh is a SEPARATE, roam-specific axis — computed in
// /admin/pois as `roamClip`, not here.)

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
 *  roam draw story-grade POIs from the same corpus). The FIRST failing gate names the reason.
 *
 *  NO char-length quality floor (the arbitrary 800-char `STORY_MIN_EXTRACT` was REMOVED 2026-06-16):
 *  whether a Wikipedia article is rich enough to NARRATE is the paid ENRICH step's call — it builds a
 *  curated fact sheet or DEFERS, and #1 downgrades an un-enriched poi to scenic. The only hard
 *  precondition here is ARTICLE TEXT the enricher can quote; an empty `facts.extract` (a wikidata pin
 *  or a text-less/disambiguation page) is genuinely un-enrichable. (Correctness over cost, CLAUDE.md —
 *  a sub-cent enrich call beats a guessed cutoff; see docs/decisions/corpus-enrichment.md.) */
export type StoryEligibility =
  | 'eligible' // wikipedia + has article text + not taste-denied → ENRICHABLE (the enricher decides if it becomes a telling)
  | 'filtered-source' // not a wikipedia story source (a wikidata scenic pin — wave layer later)
  | 'filtered-taste' // title hits the taste denylist
  | 'filtered-stub' // wikipedia, but NO article text to enrich (empty extract — a text-less/disambiguation page)

export function classifyStoryEligibility(p: {
  source: string
  name: string
  extractChars: number
}): StoryEligibility {
  if (p.source !== 'wikipedia') return 'filtered-source'
  if (STORY_TASTE_DENYLIST.test(p.name)) return 'filtered-taste'
  if (p.extractChars < 1) return 'filtered-stub' // no article text → nothing for the enricher to quote
  return 'eligible'
}
