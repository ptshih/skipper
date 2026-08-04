# A loop may not drive the same road twice

> **Status:** ✅ DECIDED + BUILT 2026-08-03 (founder). A round trip now needs a WAY HOME the rider
> names, and a materialized loop that retraces itself past `LOOP_MAX_RETRACE` is refused at the wire on
> both billed paths. Closes the open question left by
> [drive-density-and-the-return-leg.md](drive-density-and-the-return-leg.md) §5 — which measured the
> problem and deliberately greenlit nothing.
> ⚠ **REFINED later the same day (founder): a loop is an EXPLICIT-ASK EXCEPTION and one-way is the voiced
> default.** The planner never offers a loop. See §8, which supersedes §5's cost accounting — and which is
> **VERIFIED on a paid eval arm**, not just reasoned: routing 0.93 → 1.00.

## 0. The complaint, and why it was not a selection bug

*"It doesn't make sense to create drives where 90% of stops are going one way and the return trip has
one stop."* Correct, and the cause is geometric rather than a tuning miss.

A round trip was built as `start → far end → start`. Google answers that with the shortest path in both
directions, which is the **same road**. `nearestOnRoute` returns the single closest point on the
polyline, so a place beside a road you drive twice gets exactly ONE along-route time — it is told on the
way out and is silent on the way home. **A round trip was twice as long and held the same content.**

Measured on the one saved loop (`Stateline → Emerald Bay → Stateline`, 27.1 mi):

| | |
| --- | --- |
| share of the route retraced | **94%** |
| reachable candidates on the outbound half | 17 of 18 |
| coverage, full loop | 16% |
| coverage, the same corpus over the outbound half alone | 33% |

The density work of the same day had already cleared every suspect a tuning fix would reach: the stop
cap was innocent, the trigger reach was a thin tail, and the loop stayed at 7 stops under **every**
setting swept. There was nothing left to select.

## 1. What was decided

**A loop is a RING or it is not a loop.** Three parts, and the middle one is the whole design:

1. The planner asks for a way home. `round_trip` gained a companion `return_anchor_id`, and the prompt
   gained the beat that produces it: *"And which way do you want to come home?"*
2. **The RIDER supplies the geography, not the model.** This is the part that makes the feature
   possible at all — see §2.
3. The wire refuses a loop that retraces anyway. The rider's answer is an intention, not a guarantee.

## 2. Why the model cannot pick the way home

The obvious design — let the planner choose a circuit — is not available, and the reason is structural
rather than a matter of prompt quality.

**D9 hands the model no coordinates.** `buildRosterBlock` renders the roster as `name | id` and nothing
else, and it carries an explicit guard sentence telling the model that a place's position in the list
says nothing about its position on the map. A model with no coordinates and no road graph cannot know
which anchors form a ring; asking it to try would produce confident guesses about road connectivity,
which is exactly the class of claim this project refuses to let a model make.

Handing it coordinates was rejected. It would repeal D9's core property for a job it still could not do
well — coordinates are not a road network, and two places 3 km apart across a lake are not connected.

The rider, on the other hand, knows their own country. "Out to Emerald Bay, home by Incline Village" is
a thing a person says. So the geography enters through the conversation, where it is grounded by the
same construction as everything else: an anchor id from the curated list, re-asserted at the wire.

## 3. Why a wire gate is still required

The rider's answer says what they WANT, not what the road does. Google is free to route the return leg
straight back down the outbound road when that is shorter — and around Tahoe it often is. Naming a way
home therefore makes a ring *likely*, never *certain*, and the only evidence that settles it is the
polyline that comes back.

So `retraceFraction` (`@skipper/engine`, `geo.ts`) measures the returned route and
`loopShapeOf` (`apps/api/src/drives.ts`) decides. It runs on **both** billed sites: `/drives/propose`
refuses on the free preview so the rider meets it before any credit, and `POST /drives` refuses again
because a client can reach create without ever calling propose. Both read one expression — a create
stricter than propose would sell a rider a drive and then refuse it at the till.

It is cheap enough not to be an argument: measured **2.2 ms** on a saved 48 km drive, **4.2 ms** on a
91 km ring and **6.5 ms** on a pessimistic 182 km double, against a Google Routes call of several
hundred. The sweep is a hash grid at the proximity radius rather than the pairwise comparison, which is
what keeps it linear — a 125 km ring is 25M haversines done naively, and that is the kind of cost that
gets a correct guard deleted later for being slow.

⚠ The refusal necessarily lands **after** the Routes call: the polyline IS the evidence. That is why
`route_spend` now carries a `retrace` field — "how many loops did we pay for and then refuse" is a real
operating question, and the cost line is the only thing that can answer it. On the create path the gate
still sits well before the ledger batch, so a refused loop never costs a rider a credit.

## 4. The threshold, measured

`LOOP_MAX_RETRACE = 0.20`. Calibrated against the frozen polylines of the four saved Tahoe drives,
including two stitched into synthetic routes of known shape (read-only, no billed calls):

| route | retrace |
| --- | --- |
| west shore + east shore, 91 km of genuinely distinct road | **0%** |
| any single saved one-way drive | **0%** |
| half-retrace followed by a distinct arc | **51%** |
| the saved `Stateline → Emerald Bay → Stateline` | **94%** |
| a polyline followed by its own reverse | **98%** |

The distribution is bimodal with an enormous gap, and it barely moves across proximity settings from
35 m to 60 m — so 0.20 is a band, not a knife edge. It also leaves room for the shape that matters: a
ring reached down a shared access spur. On a 100 km ring that is 20 km of shared road before the gate
fires, which is generous for a spur and nowhere near a there-and-back.

## 5. What this costs, and the founder call it rests on

**Forcing circular makes loops longer, and in a region with no ring it makes them impossible.** In
Tahoe the only true circuit is the lake itself: roughly 125 km / ~2 hours, estimated by adding the
frozen west-shore (47.7 km / 48 min) and east-shore (43.6 km / 40 min) polylines to the north-shore gap.
So today's 54-minute Stateline out-and-back is not becoming a 54-minute loop — it is becoming either a
~2-hour ring or a one-way drive.

That trade was put to the founder explicitly (2026-08-03) alongside three alternatives — a server-side
geometric pick, cutting the loop shape entirely, and a silent fall back to out-and-back when the ring
does not fit. **The rider-named return leg was chosen.** The reasoning that decided it: the alternative
that "always works" is the silent fallback, and a fallback that quietly hands back the exact drive the
rule exists to prevent is worse than a refusal the rider can answer. A loop the geography cannot
support should be a sentence the Skipper says, not a drive the app pretends is fine.

⚠ **The 111 curated Tahoe anchors ring the full compass**, so the roster is not the limiting factor —
road connectivity is. Smaller circuits do exist (the Truckee–Kings Beach–Tahoe City triangle, the Carson
Valley), so "every loop is the whole lake" is a Tahoe-south-shore statement, not a general one.

## 6. What is NOT in scope

- **One-way drives are never second-guessed.** A one-way route that doubles back does so because the
  rider asked to pass through somewhere on the way ("out to Incline, but go by Emerald Bay first").
  That retrace is their own explicit request and refusing it would be overruling them. "Bring me back
  around" is different in kind: nobody asking for a loop is asking to see the same road twice.
- **Nothing here re-tells a place on a return leg.** The b-side idea from §5 of the density record
  stays not scheduled; this removes the need for it on loops rather than answering it.
- **The player's `trigger.ts` re-arm is still unreachable in practice** — it retires a passed stop and
  re-arms "when it's well out of range again (a later there-and-back)". `buildDrive` still places one
  stop per place, and a ring does not pass anything twice, so the two sides no longer disagree about
  a shape that can occur. Left alone deliberately.

## 7. Where it lives

| piece | home |
| --- | --- |
| `retraceFraction`, `LOOP_MAX_RETRACE`, the sweep constants | `packages/engine/src/geo.ts` |
| the decision, once, for both billed sites (`loopShapeOf`) | `apps/api/src/drives.ts` |
| tool field `return_anchor_id` + the way-home beat | `apps/api/src/planner-prompt.ts` |
| loop → wire shape, and the "no way home" answer | `apps/api/src/plan-route.ts` |
| the far end at `via.at(-2)`, the way home at `.at(-1)` | `apps/mobile/src/lib/planner-route.ts` |

⚠ **The loop's via ORDER is a contract.** The server appends the turnaround and THEN the way home, and
the card reads the far end at `.at(-2)`. It read `.at(-1)` while a loop appended only the turnaround —
correct then, and it would now print the return leg where the destination belongs, on the one screen
that costs a credit to act on. That is the same defect as the earlier `via[0]` bug, one position over.

## 8. Refinement: the loop is an exception the RIDER raises (founder, 2026-08-03)

> *"A user can just create an A to B and when they get to B they can shut off Skipper and drive home.
> Loops should be real like the Tahoe ring or Yosemite Valley."*

**This retires the out-and-back question rather than trading against it, and it supersedes §5.** That
section files "a 54-minute out-and-back becomes a ~2-hour ring or a one-way drive" as a cost the founder
accepted. It is not a cost. **The rider never needed the app to route them home** — they stop listening at
the far end and drive back. So the out-and-back loop was never serving a need the one-way drive does not
already serve, and it served it worse: the same audio, twice the wheel time, half the coverage (§0), and a
non-refundable credit spent on a second half that was silent by construction.

**What changed in the prompt** (`planner-prompt.ts`):

- **One-way is the DEFAULT and it is now voiced, not implied** — the skipper gets them to the far end and
  says plainly that home again is theirs. That is stated as the normal drive, not a shortfall.
- **The model must never RAISE coming back around.** The grounds are the same ones §2 already
  established: with no coordinates and no road graph it cannot know which places make a circuit, so
  offering one is a promise it has no standing to make. It was removed from "your one job" and from the
  plan shape it works toward.
- **A loop opens only on an outright ask** — *"make it a loop," "bring me back around," "I'd rather end up
  where I started."* Wanting a few hours out is not one, and neither is starting and ending in the same
  town by coincidence. `round_trip: false` is now stated as the normal answer in the tool schema itself.
- **Both no-way-home branches land on the default instead of a menu**: if they will not name a way home,
  or the road cannot honour the one they named, the skipper says the honest sentence and runs them
  one-way.

⚠ **Two either/or instructions were deleted, and they were the measured defect.** The prompt banned the
construction in one place — *"do not hand them a choice in the same breath as the ask ('straight through,
or back around?')"* — while **instructing it in two others** (*"say what the choice actually is and let
them take it"*; *"do they want it straight through instead, or a different way home?"*). The 2026-08-04
eval caught the model producing nearly the banned sentence verbatim on `midpoint` #0 — a scenario whose
rider asks for a plain A→B and never mentions a loop. **That was filed as a prompt-ADHERENCE problem and
it was a CONTRADICTION**: the model was obeying the other rule. Strengthening the ban would have chased a
rule the prompt taught against elsewhere.

✅ **VERIFIED, not just reasoned (2026-08-03, $0.0616).** `--only midpoint --no-judge` on the scenario
that measured the defect: **routing 0.93 → 1.00, 0/3 turns flagged**, voice and discipline 1.00, 0
durations asserted as road fact. Turn #0 went from *"Straight run up, or did you want to come back
around?"* to *"Nice and simple — South Lake Tahoe up to Kings Beach, one way. Want me to draw that one
up?"*, and turn #2 DREW on *"yes that"* where it previously re-asked. That second half is the important
one: it confirms the **mechanism** the finding predicted — an either/or leaves no turn presenting a plan a
yes can land on, so the draw slips. Remove the question and the yes lands.

**This also retires a backlog item outright.** `TODO.md`'s *"A round trip goes QUIET on the return leg"*
proposed two fixes — snapping a candidate to every LOCAL minimum so one place could be told on both legs,
and putting a b-side on the return. Both exist to rescue a **retraced** route, which is the shape §3's
wire gate refuses and §8 says should never have been a loop. Deleted 2026-08-03. ⚠ The one case that
survives is a ONE-WAY that doubles back because the rider asked to pass through somewhere on the way (§6),
and that is their explicit request rather than a defect.

⚠ **Region note for whoever scopes Moab.** Of the three examples the founder named, Tahoe's lake ring and
Yosemite Valley (Northside/Southside Drive are a one-way pair) are genuine circuits at ~0% retrace.
**Arches is not** — its main scenic drive runs ~18 miles in to Devils Garden and back out the same road,
with only small spur loops off it, so an Arches "loop" measures near-100% and the wire refuses it. That is
the rule working rather than failing: Arches is an A→B drive, narrated on the way in. Confirm against the
park's road network when the region is scoped, but plan for that shape — otherwise it gets filed as a bug.

