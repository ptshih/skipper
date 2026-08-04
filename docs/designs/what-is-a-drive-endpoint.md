# What is a drive endpoint?

> **Status:** ✅ **ACTED ON AND SUPERSEDED 2026-08-04** — the role split this entry proposed was overtaken
> by removing roles entirely (see *What I would do*). Kept for the reasoning and the measurements.
> Originally: 💡 IDEA for the role split; partly acted on 2026-08-04 — five rows lost the endpoint
> role, and the arrivability criterion is now IN both draft prompts (see *What I would do*, which records
> both reversals: the "defer the prompt change" call, and the claim that the tail was mostly bad). The
> destination/waypoint split remains unbuilt. Written from a founder observation
> ("the main purpose of places is start/end/via, and a lot of these don't fit") plus a full audit of the
> live Tahoe set. It proposes a CRITERION and a role split; it does not propose a migration. The build
> record for the machinery this is about is
> [places-endpoints-spec.md](places-endpoints-spec.md) — that spec is BUILT and correct about how the
> curated set WORKS; this entry is about what should be IN it. Related:
> [../decisions/undrivable-endpoint-anchors.md](../decisions/undrivable-endpoint-anchors.md) (where a car
> is routed, once a place is already an endpoint).

## The observation

`places` exists so a rider can name a start, an end, or a via. Much of what is in it could not play
that part. Measured on the live Tahoe set, 2026-08-04:

| | count |
| --- | --- |
| `endpoint_eligible` | 108 |
| …of those, localities (towns) | 45 |
| `break_eligible` | 85 |
| carrying BOTH roles | 57 |
| endpoints that are also a `pois` row | 27 |
| …of those, already NARRATED | 21 |
| `featured` | 14 |

The 45 towns are exactly right. The tail is where it goes wrong: an **island** (Fannette Island — it is
in the middle of Emerald Bay), a **castle** a mile's walk down a trail from the nearest parking
(Vikingsholm), a **tavern**, a **shopping mall**, a **visitor centre**, three **trailheads**, and — until
it was pruned on 2026-08-04 — a ski resort's **private parking structure**.

## Three problems, and they are not the same problem

**1. There is no definition of "endpoint" anywhere a draft or a guard can apply.** The schema comment
says "pickable as a drive START/END/MIDPOINT", which describes the MECHANISM, not the criterion. So the
curation prompt asks Opus for recognizable places inside a bbox and Opus returns recognizable places.
It is doing exactly what it was asked. Nobody ever told it that an endpoint is a narrower thing than a
landmark.

**2. The break role is consumed by nothing.** 85 rows carry `break_eligible`; the only readers outside
the admin console are `curate-places` (which writes it) and the schema itself. `detours` — the table it
was meant to feed — is still stubbed, and break selection is deferred (CLAUDE.md). So the second half of
"endpoints and pitstops" is a promise the schema makes and no code keeps. That is also why 57 rows carry
both roles: with nothing downstream to disagree, the curator had no reason to choose, and tagging both
is free.

**3. A landmark is legitimately two things at once.** 27 endpoints are also `pois`, 21 of them narrated
— the same real-world thing in two tables under two identities (Wikidata QID in `pois`, Google place id
in `places`). For a town this never happens. For Emerald Bay State Park, Cave Rock, Vikingsholm and
Fannette Island it always does, because a landmark is both a thing you are TOLD about and a thing you
might DRIVE to. This overlap is not itself a bug and should not be "fixed" by deduplicating the tables —
the two identities serve different jobs and the QID/PID split is deliberate. It is listed here because it
explains why the endpoint list fills up with narration subjects: they are the most recognizable names in
the region, so a model asked for recognizable names returns them first.

## The criterion

The narrowest honest test, in the product's own terms — **both halves required**:

> **Would a rider NAME it, and could they ARRIVE at it?**

- *Fannette Island* — passes the first, fails the second. You cannot drive to an island.
- *Vikingsholm* — passes the first, fails the second. The car stops a mile up the hill.
- *Bridgetender Tavern and Grill* — fails the first. You would name it as a lunch stop, which is a
  BREAK, which is the role that does not work yet.
- *Truckee*, *Emerald Bay State Park*, *Zephyr Cove* — pass both.

⚠ The second half is NOT the same test as
[undrivable-endpoint-anchors.md](../decisions/undrivable-endpoint-anchors.md). That record asks "can a
car get near it?" and answers with an access point; this asks "is arriving there the END of a drive?"
Baldwin Beach passes both — it has a car park and a rider would say it. Fannette Island passes neither,
and no access point can rescue it, because there is nowhere to arrive.

## The tension this has to survive

**Pruning has a real cost, and it is the opposite of the last change made here.** The draft target was
deliberately raised from 30 to 100 because the curated set is the PLANNER's entire world since the
tap-to-pick form was deleted in 1.1 — so every name missing from it is an in-persona *"I don't know that
one"* to a rider (see [places-endpoints-spec.md](places-endpoints-spec.md)). Cutting 60 rows to make the
endpoint list precise makes the Skipper dumber in conversation.

Both wants are legitimate, which is the signal that they are **different roles wearing one flag**. A
rider may well mention Fannette Island; the Skipper should know it and be able to route *past* it. It
just should not offer to end a drive there.

## The shape that falls out

Three roles, not two — and the first two are today's single `endpoint_eligible`:

| role | test | example that passes | example that fails |
| --- | --- | --- | --- |
| **Destination** (start / end) | named AND arrivable | Truckee, Emerald Bay State Park | Fannette Island |
| **Waypoint** (via) | named AND on a road | Cave Rock, Fannette Island's shore | a private lane |
| **Break** (pitstop) | offered, not named; has amenities | a coffee stop, a rest area | a town |

⚠ **`featured` is already doing the destination job.** The 14 featured rows are 9 towns, 3 state parks, a
ski resort and a shopping mall — that list is much closer to "somewhere a drive ends" than
`endpoint_eligible` is. Whatever shape this takes, the curator's existing `featured` judgment is
evidence that the distinction is real and that a human already makes it intuitively. It is also why the
cold-open example chips look fine today despite the tail: they draw from `featured`, not from every
endpoint.

## Options

1. **Write the criterion into the draft prompt and prune once.** No schema. Cheapest. ⚠ Both copies of
   the prompt must change (`packages/studio/src/curate-places.ts` + `apps/admin/server/places.ts` are
   byte-identical BY HAND). Does not fix the breadth cost — pruned names become "don't know that one".
2. **Split destination from waypoint** (a third boolean, or `endpoint_eligible` narrowed + a new
   `via_eligible`). Keeps breadth for the planner while making "end here" honest. Costs a migration, a
   planner-prompt change, and a wire change to `resolveRouteAnchors` (which today applies ONE eligibility
   test to start, end and every via — the single test is itself load-bearing, see INV-1).
3. **Retire `break_eligible` until `detours` lands.** Honest, small, and independent of the above. The
   counter-argument is that the tags are curated judgment that would have to be re-made later.
4. **Do nothing before 1.1.** Nothing here is rider-breaking: a weird endpoint still routes, it is just
   an odd thing to be offered. ⚠ The cost is that the NEXT region is curated under the same undefined
   criterion, so the mess doubles rather than staying one region's problem.

## What I would do

⚠ **THIS SECTION WAS REVISED THE SAME DAY IT WAS WRITTEN.** The first version said "state the criterion
in both draft prompts NOW". That was wrong for a reason worth keeping: **a prompt change cannot be
validated without a paid curation run**, and there is no new region coming before 1.1 — so it would ship
untested and be discovered months later, in the one artifact (the draft prompt) whose failures are
invisible until someone reads a list of places. The corrected sequencing is below.

**Also revised: how big the problem is.** The first pass characterised the tail from the TYPE histogram,
where `island`, `castle` and `american_restaurant` jump out, and called it "a long tail that mostly
isn't". Reading all 57 rows says otherwise — seven ski resorts, six state parks, six marinas, the
beaches and the trailheads are all legitimately places a rider would name and arrive at. The genuinely
wrong ones were **five**, not sixty. A histogram is not a list.

**Done 2026-08-04 (endpoint role only; the rows stay, and so do their break roles):**

| dropped | why |
| --- | --- |
| Fannette Island | an island in the middle of Emerald Bay — there is nowhere to arrive |
| Vikingsholm | the car stops at Emerald Bay and you walk a mile down; a rider would say "Emerald Bay" |
| Bridgetender Tavern and Grill | a restaurant — that is a break, not a destination |
| Marriott's Timber Lodge | a hotel |
| Sunnyside Marina & Watersport Rentals | a rental counter |

108 → **103 endpoints**. ⚠ `endpoint_eligible` is OR-merged, so a re-curation of this region can restore
all five; this prune is not durable on its own.

**Also done 2026-08-04 — the criterion is IN both draft prompts.** ⚠ This reverses the deferral written
two hours earlier in this same section, and the reason it was deferred turned out to be false: *"a
prompt change cannot be validated without a paid curation run"* conflated the DRAFT with the CURATE. The
draft (`draftCuratedPlaces`, `apps/admin/server/places.ts`) is **one Opus call that writes nothing and
makes no Places calls**, ~$0.60 — which is precisely the instrument for judging a prompt, with today's
137 rows as the baseline.

The prompt already carried HALF the criterion and had for weeks: *"The test is whether somebody says
'let's drive from ___ to ___'"*. What was missing was arrivability. So the change is one clause, not a
rewrite: two tests, both required, plus the concrete failure shapes (an island, a summit with no road, a
mansion a mile down a trail) and the instruction to *name the place a car arrives AT, never the thing you
walk to from it*.

**What a draft against it showed** (105 places, 85 endpoint-or-both):

- Fannette Island, the tavern, the hotel and the rental counter: **gone**.
- Vikingsholm came back as **"Vikingsholm Overlook", tagged break** — not dropped but RENAMED to the
  thing a car can reach. That is the instruction working better than asked.
- Emerald Bay, Truckee, Tahoe City, Cave Rock: still there.
- ⚠ **Donner Pass vanished and Echo Summit fell to break-only.** The clause said "a peak", and a model
  reasonably reads a mountain pass as one. Since the planner roster is ENDPOINT-ONLY
  (`loadRegionAnchors` filters on `endpoint_eligible`), break-only means the Skipper stops knowing it —
  so this was a real loss, not a tidy reclassification. Fixed by carving out the opposite case
  explicitly: a pass or summit **the road itself crosses** belongs on the list, because the highway goes
  over the top and you can pull over there.

⚠ **THE CARVE-OUT IS UNVERIFIED AT SCALE, AND ONE DRAFT IS A SAMPLE, NOT A MEASUREMENT** — two runs of
the same prompt returned 105 and 96 places with different composition. It was landed anyway on the
grounds that the previous prompt had NO arrivability test at all and demonstrably produced an island as
a drive destination, so this is strictly better even unmeasured. **The real validation is the next
region's curation**, where a human prunes the draft regardless: read that list for passes and summits
before applying it.

⚠ Both copies must change together and are byte-identical BY HAND (`packages/studio/src/curate-places.ts`
+ `apps/admin/server/places.ts`), since the admin deliberately does not depend on `@skipper/studio`.

**SUPERSEDED 2026-08-04 — the founder took a bigger hammer than this entry proposed, and it went further
in a better direction.** `places` is now ONE thing: the region's DESTINATIONS, ranked.

- `break_eligible` **deleted**, not deferred. It was read by nothing outside the admin console.
- `endpoint_eligible` **deleted** with it — once break left, every row is an endpoint, so the flag was a
  second copy of "the row exists". INV-1 became `inArray(places.id, …)`: same guarantee, one fewer
  predicate. Pruning is a DELETE now, which is what an operator always meant (the OR-merge made
  clearing the flag impossible to make stick).
- `featured` **became `rank`** — how likely a visitor is to name the place, 1 = most, null sorts last.
  ⚠ NOT a Google review count: Places policy exempts only `place_id` from its caching rules and the
  resolve deliberately fetches no rating. The draft model's own world knowledge is the signal, and it
  ranked **Sand Harbor 2nd** — a place with no Wikipedia article that the corpus tier system is
  structurally blind to (see [corpus-as-the-planners-world.md](corpus-as-the-planners-world.md)).
- The **draft prompt** now asks for destinations only, with the arrivability test and the ranking.
  Validated before anything was deleted: Sand Harbor in at rank 2; Fannette Island, Audrey Harris Park,
  Bridgetender Tavern and Boca Dam all absent.

Migrations `0045` (add `rank`) + `0046` (drop the three). ⚠ Split in two DELIBERATELY: one migration
would have made drizzle-kit ask whether `featured` was renamed to `rank`, and that prompt needs a TTY.

**Still deferred:**
- **The destination/waypoint split** — same trigger, same reason. `Echo Summit`, `Donner Pass`,
  `Mount Rose Summit` and `Cave Rock` are the standing evidence for it: perfect to route PAST, odd to
  end at. Four rows is not enough to justify a migration; a second region probably is.

**Left alone on purpose:** `Secret Cove Nude Beach` is arrivable and real; whether the Skipper should
offer it unprompted is taste, not correctness, and it is the founder's call rather than a cleanup.

## Open questions

- **Does a drive that ENDS at a narrated place let the rider hear it?** 21 endpoints are narrated, so
  this is the common case, not a corner. No end-of-route trimming was found in `drive-select`, which
  suggests the story fires as you arrive — which would be charming rather than a problem. Unverified;
  worth a simulator pass before anyone treats it as either.
- **Should a town be break-eligible at all?** 57 rows carry both roles. When `detours` lands, "pull off
  at South Lake Tahoe" is not a pitstop.
- **Who owns the criterion at write time?** The existing street-name guard (`isAddressLike`) shows the
  shape of a mechanical test, and also its limit — `Mount Tallac Trail` and `Luther Pass Road` are kept
  ON PURPOSE despite failing it. "Is this arrivable?" is a judgment, and may belong to a curator with a
  checklist rather than to a lint.
