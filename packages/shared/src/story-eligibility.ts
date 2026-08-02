// Story-eligibility — is a POI story-grade NARRATION material? This is a property of the POI, shared
// by every consumer that narrates it: solo and FUSED cluster tellings alike draw story-grade POIs
// from the same corpus (a consumer is never the owner of this verdict). SINGLE SOURCE OF TRUTH for the gates — the admin POIs
// table classifies with `classifyStoryEligibility`, and `generate-narrations` reads the same constants for
// its queue. (Whether a narration exists / is fresh is a SEPARATE axis — computed in
// /admin/pois as `narrationStatus`, not here.)

/** TASTE gate: violent-crime / personal-tragedy articles are never a charming narration target — a
 *  joke-forward persona can't carry them (the sweep is breadth-first, so these slip in). Applies to
 *  ANY telling. Title-keyed; tuned for MODERN personal/violent crime while preserving
 *  the historical/civic-tragedy carve-out the persona CAN play straight (a wildfire, a shipwreck, an
 *  earthquake, the Donner Party, a wild-west gunfight) — so it deliberately omits broad words like
 *  "attack"/"fire"/"shootout"/"wreck". Two guards dodge benign POIs: `shooting(?! range)` keeps gun
 *  ranges, `\brape\b` keeps "Grapevine"/"grape". Cheap to over-filter (a skipped POI is just silence,
 *  visible in the admin); a leak gets the founder ear. Enforced once in the shared narration pipeline
 *  (generate-narrations.ts), so every drive inherits it via the one `narrations` corpus. */
export const STORY_TASTE_DENYLIST =
  /kidnap|abduction|murder|manslaughter|homicide|killing of|mass killing|massacre|lynching|shooting(?! range)|stabbing|gunman|hostage|\brape\b|sexual assault|assault|suicide|death of|serial killer|execution of|terrorism|terrorist|genocide|torture/i

/** Whether a POI is story-grade narration material — a property of the PLACE, not of whoever is
 *  asking (every consumer draws story-grade POIs from the one corpus). The FIRST failing gate names
 *  the reason.
 *
 *  NO char-length quality floor (the arbitrary 800-char `STORY_MIN_EXTRACT` was REMOVED 2026-06-16):
 *  whether a Wikipedia article is rich enough to NARRATE is the paid ENRICH step's call — it builds a
 *  curated fact sheet or DEFERS, and #1 downgrades an un-enriched poi to scenic. The only hard
 *  precondition here is ARTICLE TEXT the enricher can quote; an empty `facts.extract` (a wikidata pin
 *  or a text-less/disambiguation page) is genuinely un-enrichable. (Correctness over cost, CLAUDE.md —
 *  a sub-cent enrich call beats a guessed cutoff; see docs/decisions/corpus-enrichment.md.) */
export type StoryEligibility =
  | 'eligible' // wikipedia + has article text + not taste-denied → ENRICHABLE (the enricher decides if it becomes a telling)
  | 'filtered-source' // not a wikipedia story source (a wikidata scenic pin: no article to enrich)
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

/** Can this poi contribute to a STORY telling *right now*? The downstream half of the gate above:
 *  `classifyStoryEligibility` answers "is it worth ENRICHING", this answers "has it been enriched and
 *  is it still in the corpus". Structural (no DB row type) so the studio pipeline and the admin server
 *  share one definition — a fused cluster telling names a SUBSET of its members, and the set it grounds
 *  on has to be computed identically wherever it's asked about, or the clip's `facts_hash` describes a
 *  different telling than the one that was synthesized.
 *
 *  ⚠ The `excludedReason` clause is the one place this is STRICTER than `generate-narrations`'s solo
 *  queue, which doesn't check it. For a solo clip that's harmless — the read paths hide an excluded poi,
 *  so the audio is merely unreachable. For a FUSED clip it is not: an excluded member that still reaches
 *  the well gets NAMED ALOUD inside a telling for the places around it, and no read-path filter can
 *  unsay it. */
export function isNarratableStoryPoi(p: {
  source: string
  name: string
  excludedReason: string | null
  hasFacts: boolean
  /** `pois.fact_sheet.length` — the paid enrich output. 0 / absent = un-enriched → scenic, no story. */
  sheetLength: number
}): boolean {
  if (p.excludedReason != null) return false
  if (p.source !== 'wikipedia') return false
  if (!p.hasFacts) return false
  if (p.sheetLength < 1) return false
  return !STORY_TASTE_DENYLIST.test(p.name)
}
