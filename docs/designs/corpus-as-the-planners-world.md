# The corpus as the planner's world

> **Status:** 💡 **IDEA — not greenlit, nothing built (2026-08-04).** Proposes removing `places` from the
> PLANNING path entirely and letting the planner work from the narration corpus instead. Founder's case
> and founder's flow; the measurements are mine and several of them **overturned my own objections** —
> see *What I argued wrong*. Supersedes the "recognition list" half of
> [planner-lookup-tools.md](planner-lookup-tools.md) and reframes
> [what-is-a-drive-endpoint.md](what-is-a-drive-endpoint.md), whose destination/waypoint split becomes a
> flag on `pois` rather than on `places`. ⚠ Touches INV-1 (the wire allowlist) and INV-11 (rider spend);
> neither is broken by it, but both are re-founded on a different table. Carries a **concrete estimate**
> (roughly a week; the reconciliation and the prompt are what cannot be rushed) and the **taste test**
> that should be run before any of it.

## The flow being proposed

> Rider asks for a drive. Skipper asks where they're starting from. Rider says "Stateline", or
> "Heavenly". The model knows the names of 700+ POIs that have narrations, recognises Heavenly as a real
> place out here, and asks where they want to go. Rider says "Tahoe City". The model knows that is real
> too, and that there is a lot to talk about around it, and suggests a route.

Today none of that can happen, because the planner's entire world is 103 curated `places` rows and the
corpus is a different table it never sees.

## What was measured (2026-08-04, lake-tahoe)

| question | answer |
| --- | --- |
| Plausible rider asks resolving to a curated endpoint | **33 / 40** |
| …misses that ARE in the corpus, narrated + released | Sand Harbor, Rubicon, Vikingsholm |
| …misses genuinely outside the region bbox | Markleeville, Hope Valley, Kirkwood |
| Towns riders name, present in `pois` **as the town** | **14 / 15** (only Reno absent) |
| Released-narrated pois | **729** vs 103 curated endpoints |
| Duplicate names among those 729 | **1** (`Audrey Harris Park`) |
| Of those 729, carrying a road-snapped point | **703 (96%)** |
| The three inputs in the flow above | all present: `Heavenly Mountain Resort`, `Stateline, Nevada`, `Tahoe City, California` |

Two of those kill objections I had made confidently:

**Ambiguity is not the problem I claimed.** It looked fatal because "Carson City" *substring*-matches
St. Peter's Episcopal Church. But the model would be copying a name VERBATIM off a printed list, so the
server resolves by exact match — unique for 728 of 729 rows. Fuzzy matching was never required; I
invented it and then objected to it.

**The corpus is not landmarks-only.** I asserted it held no towns, from a query that exact-matched
`'Truckee'` against a corpus that stores `'Truckee, California'`. It holds 14 of 15.

## What `places` actually provides that `pois` does not

Vocabulary is not the answer — the corpus wins that 729 to 103. What the curated table holds is
**judgment**, in three parts, and all three are things built or hardened in the last two days:

1. **Endpoint-worthiness.** `pois` contains Fannette Island, `Homewood Canyon`, `Olcovich–Meyers House`,
   `The Montage Reno`. The endpoint-quality tail — five bad rows out of 103 — becomes an unvetted 729.
   ⚠ The mitigation is real but unproven: today a CURATOR prunes the list, whereas here the MODEL picks,
   and the model has taste plus the criterion we just wrote for the curation draft (*would a rider name
   it, and could they arrive at it*). Nobody has tested whether that survives contact with a list where
   two thirds of the entries are things you drive past.
2. **A drivable point.** `places.access_lat/lng` (built 2026-08-04) says where a car is actually sent.
   `pois.speakable_lat/lng` is the nearest analogue at 96% coverage — but it is snapped for SEEING a
   place from the road, not for stopping at one, and it was never vetted as somewhere a drive ends.
   ⚠ For Spooner Lake the nearest road is the gated NF-038; the restricted-road gate would catch that at
   the wire, but as a 422 rather than as a good answer.
3. **What to SUGGEST.** `featured` (14 rows) orders the roster and feeds the cold-open example chips
   ([../decisions/example-anchor-selection.md](../decisions/example-anchor-selection.md)). `pois` has no
   such notion and would need one.

## What the change actually is

**Not** "delete `places`". It is **move the judgment onto the corpus** and let the planner work there:

- `pois` gains endpoint-worthiness and an access point — the same two columns `places` carries.
- The planner's prefix carries released POI NAMES (~3.7k tokens, measured), not ids. Names only is what
  keeps it affordable (ids triple it to ~11k) and is not a safety property here, because —
- ⚠ **the wire allowlist has to move, not disappear.** Today `hydrateAnchors` re-asserts
  `endpoint_eligible` on a `places` row before any billed Routes call. The equivalent must exist against
  `pois`: a name the model emits resolves server-side to exactly one released poi in the region, or it
  is a 400 before spending. INV-1 survives — it is re-founded, not weakened. **Nothing about this design
  permits the model to emit a coordinate.**
- `places` keeps the break role (unbuilt) or is retired with it.

### Can the 103 judgments actually MOVE? (measured — and the first answer was wrong)

Matching the two tables is not a join: `places` is keyed by Google place id and `pois` by Wikidata QID,
so a curated endpoint and its corpus twin agree on neither identity nor coordinate.

By nearest-POI distance:

| distance to nearest poi | curated endpoints |
| --- | --- |
| ≤250 m — confident | **59** |
| ≤500 m | 24 |
| ≤1 km | 8 |
| >1 km | 12 |

⚠ **That last row is NOT "missing", and reading it that way produced a wrong conclusion.** Checked by
NAME instead, **eleven of the twelve are in the corpus with released tellings** — `Northstar
California`, `Alpine Meadows (ski resort)`, `Fallen Leaf Lake`, `Mount Tallac`, `Washoe City, Nevada`,
`Washoe Lake State Park`, `Tahoe Keys, California`, `Tahoe Meadows`, `Boca, California`, `Prosser Creek
Dam`. Only `Empire` looks genuinely absent. The proximity test was measuring **coordinate disagreement
between two identity systems**, not absence.

**So decoupling loses no destinations.** What it costs is a one-time RECONCILIATION: 59 rows match
confidently, and ~44 need a human deciding which poi *is* the endpoint — a real judgment, not a lookup.
The worked example: `Palisades Tahoe` (the curated endpoint) sits 1 km from `Palisades Tahoe` (a poi
with NO narration), while `Palisades Tahoe Aerial Tram` (a poi WITH a released telling) is a third
thing. Which of those a rider means by "drive me to Palisades" is not something a script can answer.

### What the PROMPT has to become

⚠ **Bigger than swapping the list, and it is the part with no eval gate in front of it.** Today's
`planner-prompt.ts` is written around a small curated allowlist, and four things in it stop being true:

1. **The opening frame inverts.** *"Your whole world is two things: the country you work, and a list of
   places you can start or end a drive at… That list is not a sample of what is out there. It is
   everything you have."* Under the corpus it becomes ~729 things the skipper can TALK about, most of
   which are emphatically not places to end a drive.
2. **`== When they name something you do not have ==` rewrites.** It is built around misses being
   common; they become rare, and a NEW failure appears that the section has no words for — a name that
   IS on the list but is not somewhere a drive can end.
3. **Ids become names**, in the three prose rules that say "copied off the list exactly" plus the two
   `PLAN_ROUTE_TOOL` field descriptions.
4. **The endpoint criterion has to move IN** — *would a rider name it, and could they arrive at it* —
   from the curation draft prompt where it landed 2026-08-04.

⚠ **Which is the real cost of decoupling, and it is not code.** Today endpoint-worthiness is decided
OFFLINE, once per region, by a paid draft a human then prunes. Afterwards it is decided by the model,
per rider, per turn, in the one prompt this repo says to iterate on more carefully than anything else
because nothing gates it. An `endpoint_eligible` flag on `pois` keeps that judgment offline; without
one, the prompt is the only thing standing between a rider and a drive that ends at
`Olcovich–Meyers House`.

### What breaks and has to move

- The wire contract for `POST /drives/propose` and `POST /drives` (place ids → poi ids or verbatim names).
- `apps/mobile`'s planner-route plumbing, which passes `startId`/`endId` through verbatim.
- `drives.start_lat/end_lat`, `driveLabel`, `sameSpot`, `routeSigOf` — all read a resolved endpoint.
- The access-point work of 2026-08-04, re-homed.
- `curate-places`, the admin `/places` page, the `example-anchors` selection, and `MAX_PLAN_ANCHORS`.

## The soft spot in the flow

*"…and that there is a lot to talk about around it"* is the one step that cannot come from the data.

A flat name list carries no geometry, so density can only be inferred from the model's own world
knowledge. And the obvious server-side substitute is **measurably wrong**: a corridor count around the
straight line between two anchors ranks the Carson City → Spooner drive (which delivered TWO stories) as
the densest of the four real drives tested, at every buffer width
([planner-lookup-tools.md](planner-lookup-tools.md) records the numbers). Stop count is a function of the
ROUTE, and the route is not knowable without the billed call.

So this flow gets the vocabulary right and should not be sold as also fixing thin drives. The honest fix
for that is downstream and already computed: `/drives/propose` runs the real selection and returns
`estStopCount`, and nothing reacts to it.

## Staging

1. **POI names in the prefix, additive.** Built and then PARKED unlanded on 2026-08-04 — four pieces,
   ~210 lines, all straightforward to redo from this description: a `MAX_PLAN_KNOWN_PLACES` cap in
   `apps/api/src/limits.ts`; `loadRegionKnownPlaces(bbox)` in `drives.ts` (distinct names, released
   narrations, bbox-scoped, sorted, `+1` limit so truncation is detectable); threading it through
   `roster-cache.ts` in PARALLEL with the anchor load so the memo still saves a round-trip; and a
   `buildKnownPlacesBlock` rendered inside the cached prefix. Recognition only, and it is the half that
   has to exist under every later step. ⚠ It was parked rather than landed because its prompt prose says
   *"this is not somewhere you can start or end a drive"* — the exact sentence step 3 inverts, and
   landing prose you intend to reverse is how a prompt ends up arguing with itself.
2. **Endpoint-worthiness + access point on `pois`**, and a migration of the 103 curated judgments so the
   good endpoints stay good.
3. **The wire moves** to poi-based resolution, and the prompt block's refusal is replaced by the
   criterion.
4. **`places` retires** from the planning path.

Steps 2–4 are one release, not three: between them the two tables disagree about what an endpoint is.

### What it takes, concretely

Roughly a week of focused work. Two parts cannot be rushed and they are not the coding.

| piece | shape |
| --- | --- |
| Migration | `pois` gains endpoint-worthiness + `access_lat/lng`. One migration, additive. |
| **Reconciliation** | 103 judgments onto poi rows. 59 confident, **~44 need a human**. Wants a side-by-side tool; half a day of operator time. |
| Roster + resolution | Roster loads pois; prompt prints NAMES, server holds name→id. The tool takes a name; `toPlannedRoute` resolves against the roster it already has — **no new query**. |
| **Prompt** | The four rewrites above. The one with no eval gate. |
| Wire | ⚠ **Shape UNCHANGED** — still uuids, different source table. `hydrateAnchors` repoints. |
| Mobile | **Nothing.** `planner-route.ts`, `PreviewCard`, `index.tsx` never see a name. |
| Re-homing | `access_lat/lng`, `checkAccessPoint`, `audit-endpoint-routability` all move to `pois`. |
| Cold open | `example-anchors` needs a `featured` equivalent; `pois` has no notability signal. |
| Tests | 12 files touch the endpoint wire — mostly fixtures, not logic. |
| Retirement | `curate-places`, admin `/places`, and `places` keeps only its unbuilt break role. |

⚠ **The wire keeping its shape is the single biggest simplifier and it hangs on one choice**: resolve
the model's name → id in `plan-route.ts`, before `PlannedRoute` reaches the client. Put the resolution
anywhere later and names hit the wire, the mobile client changes, and `driveProposeRequest` changes with
it.

### Buy this down first

**The taste test — ~$1, no wire changes, nothing written.** Hand a model the 729 names and a dozen
realistic rider openings, and see whether it picks sane endpoints when two thirds of the list are things
you drive PAST. Today a curator is the filter; afterwards the model is. If it proposes ending a drive at
`Olcovich–Meyers House`, the endpoint-worthiness column is mandatory rather than optional and the
reconciliation grows. This is the cheapest question with the biggest effect on the estimate.

## What I argued wrong

Recorded because the pattern matters more than the individual errors: **every objection I raised was
plausible, and I checked none of them until pushed.**

- *"The corpus has no towns"* — from an exact-match query against `', California'`-suffixed names. It
  has 14 of 15.
- *"Name resolution is dangerously ambiguous"* — from substring matching I invented. Verbatim copy off a
  printed list is unique 728/729.
- *"A prompt change can't be validated without a paid curation run"* — conflated the ~$0.60 draft with
  the full curate.
- *"729 blows past MAX_PLAN_ANCHORS"* — true of the CAP, irrelevant to the argument: the cap is a number
  we set, and names-only costs 3.7k tokens.
- *"Twelve curated endpoints have no poi to move onto, so decoupling loses Northstar"* — from a
  PROXIMITY query. Checked by name, eleven of the twelve are in the corpus with released tellings. The
  measurement was of coordinate disagreement between two identity systems, not of absence.

⚠ **Four of those five errors were the same mistake**: a single query, run once, whose shape did not
match the question — exact-match where the data is suffixed, substring where it needed to be exact,
proximity where it needed to be name. Each produced a confident wrong conclusion that survived until it
was pushed on. Treat a first number in this area as a hypothesis.

## Open questions

- Does a model handed 729 names, two thirds of which are things you drive PAST, still pick good
  endpoints? Cheap to test: draft prompt + list + a dozen rider openings, no wire changes.
- Is a speakable anchor an acceptable place to END a drive, or does endpoint-worthiness need its own
  access point on every promoted row?
- What replaces `featured` for the cold open, and does the corpus have a usable notability signal?
- Does the region still come from the client, or does the planner infer it from the names? (Today
  `regionId` is a request field and the roster is memoized per region.)
