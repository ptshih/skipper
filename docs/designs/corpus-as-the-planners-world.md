# The corpus as the planner's world

> **Status:** 💡 **IDEA — not greenlit, nothing built (2026-08-04).** Proposes removing `places` from the
> PLANNING path entirely and letting the planner work from the narration corpus instead. Founder's case
> and founder's flow; the measurements are mine and several of them **overturned my own objections** —
> see *What I argued wrong*. Supersedes the "recognition list" half of
> [planner-lookup-tools.md](planner-lookup-tools.md) and reframes
> [what-is-a-drive-endpoint.md](what-is-a-drive-endpoint.md), whose destination/waypoint split becomes a
> flag on `pois` rather than on `places`. ⚠ Touches INV-1 (the wire allowlist) and INV-11 (rider spend);
> neither is broken by it, but both are re-founded on a different table.

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

## Open questions

- Does a model handed 729 names, two thirds of which are things you drive PAST, still pick good
  endpoints? Cheap to test: draft prompt + list + a dozen rider openings, no wire changes.
- Is a speakable anchor an acceptable place to END a drive, or does endpoint-worthiness need its own
  access point on every promoted row?
- What replaces `featured` for the cold open, and does the corpus have a usable notability signal?
- Does the region still come from the client, or does the planner infer it from the names? (Today
  `regionId` is a request field and the roster is memoized per region.)
