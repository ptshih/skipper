# The skipper's opinions ("the world off the rails") — build spec / handoff

> **Schema-names note (updated 2026-06-19):** identifiers below predate later refactors. `personaForRegion`→`personaFromKey` (persona is keyed by `persona_key`, decoupled from region). The `tours`/`corridors` tables were dropped — the live schema (`packages/db/src/schema.ts`) is the atom+sequences model: `regions`/`personas`/`pois`/`narrations`/`asides`/`drives`. `persona_key` now lives on `personas` and `asides`, NOT on any `tours` table; a `drive` carries a `selection` JSONB and references its persona via the seeded `personas` row (and `region_id`), not a `tours.persona_key` column.

**The skipper has a point of view about the world the drive passes through — the road, the
landscape, the stuff off the frozen route — surfaced as opinionated asides that make him a
*character*, not an audioguide.** Feature #4 of the future-features brainstorm.

> **Status: SPEC ONLY — nothing built.** Future feature, gated behind the proven phone player
> like the rest of the charm roadmap. **Builds ON `docs/specs/downtime-callouts-spec.md` — read that
> first**; this reuses its delivery system and gives its deferred Phase 2 (grounded spatial
> callouts) a content theory + discovery scope. Decided in a design session 2026-06-09.

## 0. TL;DR for the next Claude

- **TASTE is the soul; grounding is subordinate scaffolding.** A fact without an opinion is
  Shaka Guide (violates principle #2 — "if the model just reads a fixed script you've rebuilt
  Shaka Guide with extra steps"). An opinion without a fact is hot air. **The opinion is the
  point; the fact is just the occasion to have one.**
- **The central tension: the skipper has no eyes.** His only senses are GPS position/heading/
  speed, the clock, and the frozen route. So "opinions about the world out the window" =
  *pre-authored opinions about KNOWN, frozen features, timed to the GPS moment so they FEEL
  spontaneous.* Never live perception — that's the hallucination sin wearing a charming hat.
- **The design rule:** *never surface a grounded observation he can't have a TAKE on. Silence
  beats a fact-dump* — the complement of "silence beats a hallucinated battle" and of the
  existing validation rule "a fact must survive the joke being deleted."
- **Delivery is NOT new.** This rides the callout system. The **taste tier** = v1 (placeless,
  persona-only) callouts with an opinionated register. The **grounded tier** = the deferred
  **Phase 2 spatial callouts** (positioned, attributed). This spec supplies their content + data.
- **Geology is the flagship grounded content.** Macrostrat is already shipped
  (`pipeline/macrostrat.ts`, CC BY, freezable, *literally the entire landscape*), and "the
  skipper is a rock nerd" is itself a TASTE — so geology arrives **pre-fused with character.**
- **Build order:** taste-first (cheap, drive-one, low-risk) → geology as grounded fuel → broad
  off-route geography last.

## 1. The reframe — he has no eyes

The naive pitch is "he reacts to the world streaming past." He can't: he has no camera, no
microphone on the view, no live feed. His sensorium is **GPS (where + which way + how fast), the
clock, and a pre-loaded frozen route.** That's all.

So the feature is really: **he has pre-authored opinions about the corridor's known, frozen
features — including off-route ones — and surfaces them at the exact position where they're true,
so it *feels* like he just noticed.** The charm is the *illusion* of spontaneous observation,
manufactured by knowing the corridor cold at generation time and timing the delivery. He isn't
looking out the window; he's *remembering what's there and pretending he just clocked it.*

The failure mode — the thing this spec exists to prevent — is **perception hallucination**: him
claiming to see transient things he has no sensor for (a car, a deer, a person, today's weather,
"look at *that*"). That's the same sin as a hallucinated battle. "Persona lives in DELIVERY, never
in FACTS," with a new face: **don't let *opinions* become a backdoor for *pretending to perceive.***

## 2. The grounding decomposition (the invariant, applied)

> **The OPINION is delivery (free, persona). The ANCHOR is fact (grounded + freezable).**

- *"That wall of granite is gorgeous in this light"* = opinion(gorgeous — free) + anchor(granite —
  grounded, Macrostrat) ✅
- *"I'd never take that pass in January"* = opinion(wariness — free) + anchor(the pass — route/OSM)
  + a **seasonal claim to hedge** ⚠️
- *"Look at that lowrider"* = pure perception, no anchor he can possibly hold ❌ **out, always.**

The danger exists *only* when an opinion smuggles in a **false anchor** (a fact he doesn't have) or
a **volatile/perceptual** one (a business that closed, a thing he can't see). Otherwise he can be as
opinionated as you like — opinions are free. The **opinion-required rule** is the gate: if he has
nothing to *feel* about a feature, he stays quiet (§7.6). The grounding is load-bearing scaffolding
but subordinate — it exists to give his opinions something true to stand on, not to be shipped.

## 3. The spectrum (content theory, safest → spiciest)

1. **Opinions about the drive itself** — "best pavement in the state," "say goodbye to the lake
   for a while." His domain, *zero* facts, totally safe, and the most *character*. Underrated.
2. **The landscape — especially geology** — the flagship (§4). Grounded but freezable.
3. **Time / calendar inference** — "Sunday morning, you've got the road to yourself," "about now
   the aspens start turning." **Hedge anything seasonal; never assert current conditions** (§7.5).
4. **The off-route temptation** (the "pie place"). **Verdict: no named live businesses in frozen
   audio** — collides with the break-stop volatility invariant *and* you can't speak a freshly
   fetched name from a baked clip (no live TTS in v1). **But the bit survives if the vagueness IS
   the joke:** he's *contractually forbidden from rerouting you*, so he gestures and won't name
   names — "there's something good down every one of these side roads; not my job to find it for
   you." **The constraint becomes the character.** Charm without the liability.

## 4. Geology — the bridge (flagship grounded content)

Geology is the one grounded subject that *doesn't read as a fact-dump*, because the obsession is
the personality. It's also the perfect off-route subject: **it's everywhere, it never goes stale,
it's grounded, and it's already built** (`pipeline/macrostrat.ts` — coordinate-keyed CC-BY geology,
attribution array, with a persona-prompt geology carve-out already in place incl. scenic).

Two registers, mapping to the two delivery tiers:
- **Regional / ambient** — "this is granite country, the whole spine of the range." Not tied to a
  single point → a **placeless taste-tier callout** (low grounding, broadly true).
- **Specific feature** — "*that* wall right there, granite that crystallized miles down and only
  rode up because the whole block tilted." Tied to a visible feature → a **positioned grounded
  callout** (§6), heading-aware, attributed.

Make geology the Tahoe skipper's *pet topic*. That single move turns a shipped data source into a
defining character trait and demonstrates the whole opinion-carries-the-fact thesis at once.

## 5. The taste layer (generation side — the soul)

Taste must live somewhere stable, or "opinions" become random noise. A character has a *consistent*
point of view. So extend the per-region **`PersonaDef`** (the persona registry — `personaForRegion`)
with a **taste profile**: pet topics (geology), what he loves (a good mountain pass), pet peeves,
recurring bits (the off-route tease), things he's wary of (a winter summit). This:
- **feeds the narration prompt** so every aside is consistent and *in character* — not a grab-bag.
- **is per-region** — the Tahoe skipper's taste flows from his ex-ski-bum-mechanic backstory; the
  Yosemite skipper's from a grizzled-climber one. **This operationalizes the region-skipper
  "backstory colors the jokes" idea** — taste is *where* that differentiation concretely lives.
- **respects the backstory-is-DELIVERY rule** — taste colors what he riffs on; it must NEVER invent
  regional history (same guard as Ask-the-Skipper and region backstories).

Generation: extend `narrateCallouts` (or a sibling) to produce **opinionated placeless beats** from
the taste profile — persona-only, tagged, joining the v1 callout pool. Kit stays banned outside the
intro (existing guard).

## 6. The grounded off-route layer (= callouts Phase 2, concretized)

This is the deferred "fact-grounded spatial callouts" phase of `downtime-callouts-spec.md`, now with
content + data:

- **Off-route discovery scope.** Today discovery is on-route within `OFF_ROUTE_MAX_M = 700m`
  (`config.ts`). The grounded tier needs a **wider scope for freezable NATURAL features only** — a
  peak 10 km away is visible and nameable; a geology unit spans the whole view; the road network is
  permanent. **Never businesses.** Sources, all freezable and mostly built:
  - **Macrostrat** (geology — built, CC BY)
  - **Wikidata** (peaks / ranges / named-after — built, CC0, QID-join)
  - **OSM** (the road network / "the old highway" / trailheads — discovery tier)
- **Generation** produces an *opinionated* aside (opinion + grounded anchor), **attributed**
  (`AttributionSnapshot[]`), positioned where the feature is relevant, **heading-hinted**, and
  passed through the **opinion-required gate** (§7.6 — drop pure facts).
- **Schema = the Phase-2 widening of `tour_callouts`** (the columns v1 deliberately omitted): add
  nullable `lat` / `lng` / `approach_heading_deg` / `trigger_radius_m` + `attribution` +
  `facts_hash`. A callout with coords is **positioned**; without, **placeless**.
- **Positioned callouts fire via a GEOFENCE, not the downtime scheduler** — a *second*
  `TriggerEngine` instance fed the positioned callouts (the engine is reused AS-IS, unmodified; just
  a second triggerable set). **Stops win priority** over a co-located grounded aside; the aside also
  ducks-overlays and rides the same audio queue. Placeless taste/ambient asides still fire via the
  downtime scheduler.

## 7. The guards (invariant extensions — "getting it right")

1. **No-eyes / anti-perception.** Ban perception verbs about transient subjects ("look at that
   _<car/deer/person>_," "see the _<weather>_"). He surfaces *known frozen features* timed to
   position, never live sight. Lint + generation guard.
2. **Volatility.** No named businesses / hours / transient data in frozen audio (the break-stop
   invariant, extended). The off-route tease is deliberately vague (§3.4). Lint: no named business.
3. **Freezability.** Anchors must outlive the frozen clip (geology, peaks, ranges, established
   roads). No ephemeral anchors — the attribution snapshot freezes in the clip.
4. **Position-dependence.** A spatial aside ("ridge to your north") is valid *only* at the right
   position + heading; firing it wrong shatters the illusion — **worse than silence.** Hence the
   geofence + `approach_heading_deg` gate + a "still true here" check.
5. **Seasonal hedging.** Temporal/seasonal claims hedged ("about now…") or date-range-gated; never
   assert current conditions he can't sense.
6. **Opinion-required (silence beats a fact-dump).** Every grounded aside MUST carry a genuine take
   or it's dropped. A judge/lint gate: *"would this survive deleting the opinion? If what's left is
   just a fact, cut it."* This is the deliberate complement of the existing validation rule (there:
   the fact must survive deleting the joke; here: the opinion must be present or the fact is cut).

## 8. Delivery — reuse the callout system

Nothing new in playback. Per `downtime-callouts-spec.md`:
- **Taste / ambient asides** = v1 callouts: placeless, downtime-scheduler-fired, duck-overlay.
- **Grounded spatial asides** = Phase-2 callouts: positioned, **geofence-fired** (second
  `TriggerEngine`, stops win), duck-overlay, attributed.
- Both ride the existing queue + pump + single audio player under callout sentinel seqs, duck the
  soundtrack (don't replace it), and don't advance the song rotation.

What's actually NEW for #4 vs. the callouts spec: the **taste profile** in `PersonaDef`, the
**opinionated generation** (both tiers), the **off-route discovery** of freezable natural features,
the **schema widening** for positioned/attributed callouts + the **second geofence pass**, and the
**§7 guards**.

## 9. Build phases (file-level)

1. **Taste profile + opinionated beats (taste tier).** Extend `PersonaDef` with the taste profile;
   extend `narrateCallouts` to author opinionated placeless beats from it. Rides v1 callouts —
   persona-only, drive-one, low risk. *(Soft-depends on the v1 callout system existing.)*
2. **Geology asides — ambient first.** Placeless "granite country" beats off the already-keyed
   Macrostrat data (low grounding). Then specific-feature geology as positioned asides (phase 3).
3. **The grounded positioned layer (the heavy lift, shared with callouts Phase 2).** Schema widening
   of `tour_callouts` (coords + heading + attribution + facts_hash); off-route discovery for natural
   features (Macrostrat/Wikidata/OSM); the opinion-required generation gate; the second
   `TriggerEngine` pass with stop-priority.
4. **Tune by ear (CHECKPOINT — real drive).** Opinion density, the opinion-required gate's
   strictness, the off-route-tease cadence, whether geology lands as charm or as a lecture.

## 10. Open forks (left for later)

- **How opinionated is too opinionated?** Can he have *hot* takes, be wrong-*as-opinion* (a bit he's
  cranky about), or must opinions stay genial? (A character with edges is more real; a toy shouldn't
  alienate.)
- **Does taste evolve with familiarity?** A skipper who's done 40 drives with you might get more
  opinionated / more inside-joke-y — ties to the logbook familiarity arc.
- **Does the off-route tease ever pay off?** If a rider actually detours toward the thing he wouldn't
  name — he can't know (no live input) unless it's wired to Ask-the-Skipper. Likely a v2+ delight.
- **Per-region taste authoring cost** — each region's skipper needs a hand-tuned taste profile (the
  charm-per-region multiplier; pairs with the region-skipper roadmap).

## 11. Provenance

Designed 2026-06-09. Builds on and cites for re-check:
- `docs/specs/downtime-callouts-spec.md` — the delivery system (scheduler, duck-overlay, sentinel seqs,
  the `tour_callouts` table) and its deferred Phase 2 (grounded spatial callouts) that this concretizes.
- `packages/studio/src/pipeline/macrostrat.ts` — coordinate-keyed CC-BY geology + the persona-prompt
  geology carve-out (already shipped); Wikidata (CC0, QID-join) + OSM (discovery tier) from the
  fact-source-expansion direction.
- `packages/studio/src/config.ts` — `OFF_ROUTE_MAX_M = 700` (the on-route discovery scope this
  widens for natural features).
- The per-region persona registry (`personaForRegion`, `PersonaDef`, the kit) — where the taste
  profile lives; and the region-skipper-identities roadmap ("backstory colors the jokes").
- `packages/engine/src/trigger.ts` — `TriggerEngine` reused AS-IS for the second (positioned-
  callout) geofence pass; `approach_heading_deg` (migration 0003 / backfill-trigger-points) mirrored
  on positioned callouts.
- Grounding doctrine: "persona lives in DELIVERY, never in FACTS"; the break-stop no-volatile-data
  invariant; the validation rule "a fact must survive the joke being deleted" (the opinion-required
  gate is its complement); `attribution` as `AttributionSnapshot[]` frozen at narration time.

**Decisions locked this session:** taste is the soul / grounding subordinate; the no-eyes reframe
(pre-authored, timed, never live perception); the opinion = delivery / anchor = grounded-freezable
decomposition + the opinion-required gate; geology (Macrostrat) as the flagship that fuses both;
the off-route tease as the deliberately-vague constraint-as-bit (no named businesses); delivery via
the callout system (taste = v1 placeless, grounded = Phase-2 positioned); build taste-first.
