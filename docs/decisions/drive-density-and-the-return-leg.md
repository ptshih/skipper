# Drive density: the glance fill's arity, the cluster orphan, and the return leg

> **Status:** DECIDED + BUILT 2026-08-03 (founder). FOUR changes in `@skipper/engine` + `apps/api`:
> the glance fill takes as many call-outs as fit rather than one per window; `DRIVE_MIN_GAP_SEC` moved
> 180 → 120; a fused telling a route cannot REACH no longer suppresses its own members; and (§6, found
> last and the most consequential) **selection admits on the `OFF_ROUTE_MAX_M` honesty bound alone** —
> the trigger-radius reach filter was modelling a pipeline we do not run, and is deleted.
> Measured on the four saved Tahoe drives: **31 → 41 stops**, avg coverage 34% → **40%**, worst silence
> 17:56 → **14:24**, and the flagship corridor's worst silence 8:49 → **3:54**.
> Updates the premise of [scenic-filler-and-the-empty-stretch.md](scenic-filler-and-the-empty-stretch.md)
> §(b) — see §4. **§5 (the return leg) was a FINDING with nothing greenlit; it has since been ANSWERED
> — a loop now needs a rider-named way home and a retracing one is refused at the wire
> ([no-same-road-loops.md](no-same-road-loops.md), founder 2026-08-03). §5 stands as the measurement
> that made that call; its "whether the return leg should re-tell anything" question is what got
> retired, because a ring passes nothing twice.**
> ⚠ `driveMaxStops` now BINDS on two of the four drives; it bound on none before today.

## 0. The question

*"The drive planner isn't choosing enough stops."* It wasn't — and the cap everyone reaches for first
was innocent. What follows is measured against all four saved drives at their real frozen durations,
using the real `buildDrive`. Scripts are read-only and re-runnable from `packages/studio/.scratch`
(gitignored): `stop-funnel.ts`, `gap-blame.ts`, `reach-sweep.ts`, `cluster-orphan.ts`,
`glance-headroom.ts`, `stateline-why.ts`.

## 1. What was actually binding

| suspect | verdict |
| --- | --- |
| `driveMaxStops` (~1 stop / 4 min, cap 24) | **innocent.** Removing the cap entirely changed NOTHING on any of the four drives. |
| the 250 m anchored trigger reach | **looked like a thin tail — was actually a wrong premise.** 88% of anchored candidates already sit inside 250 m, so widening it bought only ~2 stops and I ranked it last. That measured the right number for the wrong reason: the filter should not have existed. See §6. |
| the glance fill's arity | **the biggest lever** — §2. |
| `DRIVE_MIN_GAP_SEC = 180` | **binding on half the drives** — 180 → 120 is worth +4 stops. |
| the 1 km co-located dedupe | drops 3–9 per drive, but the survivors are genuinely the same physical stop; the drops sit inside a min-gap window anyway. |

⚠ The reach filter's own comment said it "can only ever TIGHTEN the gate", which was true — but the
justification for tightening was not. That is §6, found by pulling on this thread afterwards.

## 2. The glance fill took ONE per window, however long the window

`drive-select.ts` step 4b filled the quiet between stops with short scenic call-outs, and took exactly
one per window. A 17-minute silence could therefore receive a single 20-second call-out.

Nothing about a window justified the cap. `maxStops` is what protects against a lecture, and glances
deliberately do not count against it — a 20-second glance in a 6-minute silence is not what that cap
was guarding. The real spacing guarantee is `GLANCE_EDGE_SEC` (45 s clear on each side, measured from
when the previous clip stops *playing*, not from its trigger), and that rule is **per glance**, so
applying it repeatedly is the same promise kept more often.

The fill is now greedy: each pick re-arms the cursor `GLANCE_EDGE_SEC` past its own end. It gained one
new rule it did not need at arity 1 — the co-located separation applied against **itself**, or two
call-outs 400 m apart would name neighbouring coves back to back.

| drive | reachable glances | used before | used now | stops |
| --- | --- | --- | --- | --- |
| South Lake Tahoe → Incline Village | 17 | 3 | 7 | 8 → 14 |
| Tahoe City → South Lake Tahoe | 18 | 6 | 8 | 14 → 17 |

⚠ **Every glance test in the suite used exactly ONE glance candidate**, which is why all of them
stayed green through the change. A cap that can only be observed with a second candidate is invisible
to a suite that never supplies one. Two tests now pin the arity and the self-separation.

## 3. The cluster orphan: SERVED is not the same question as REACHABLE

`notSupersededByServedCluster` retires a cluster's members in SQL the moment the fused telling clears
the **release gate**. Whether that fused clip can actually PLAY on a given route is **geometry**, and
`buildDrive` answers it one level later. When the two disagreed, the drive lost *both*.

Measured on the Stateline loop: **"Emerald Bay and Vikingsholm" (127 s) was refused for range** — its
centre sits 605 m off Highway 89, past its own 516 m capped floor — while **Vikingsholm's own released
81 s clip, 175 m off route, stayed retired behind it.** The drive that passes Emerald Bay said nothing
about Emerald Bay, inside a 17:56 gap.

The fix extends the docstring's own argument exactly one step: *a caller who is being withheld a
telling must not also lose that telling's members* — and neither must a **route that cannot reach
one**. `loadCorpusForRoute` now suppresses members of **reachable** clusters only.

⚠ It asks through `buildCandidatePlacer`, the SAME expression `buildDrive` admits on, extracted for
this purpose. Two copies of the reach test is how this broke: a placer that says "no" here and "yes"
there suppresses members for a clip that then gets dropped anyway. A test pins the two in agreement
across an admitted / band / wide-with-members / wide-without-members set.

⚠ The wide-group half of this was already fixed (a `tooWideForPoint` group is placed on its members
rather than refused) with a comment explaining precisely this orphaning risk. The **non-wide** cluster
that simply fails the ordinary reach test was missed — the same bug, one branch over. 219 members with
their own released audio sit behind 37 served clusters, so the exposure is general even though only
one of four drives hits it today.

## 4. What this updates in the June "empty stretch" call

[scenic-filler-and-the-empty-stretch.md](scenic-filler-and-the-empty-stretch.md) §(b) measured
*"real stops can't fill an empty stretch"* and it was right — **on the corpus it had.** That entry
says so itself: *"Every narration in the live corpus is a `story` — 458 of 458. The scenic tier has
never been generated, not once."* Its §(d) named the fix: 19 real places on the flagship route,
*"beaches, points, bays and peaks — the things a driver is LOOKING AT during the silence."*

The scenic tier has since been generated. This change is what lets it be USED. **Nothing here is
filler** — every clip added is a real, released, grounded telling that was already sitting on the
road unselected, which is the same "more of the real thing" the June call endorsed when it loosened
`minGapSec` 240 → 180. The floor moving 180 → 120 is that precedent continued, not reversed.

Still true, and untouched: **nothing in selection measures quiet.** `DRIVE_MIN_GAP_SEC` is a floor,
never a ceiling; no code path treats a long silence as a defect; the soundtrack means "silent" never
meant silence. The grounded *subject-is-the-emptiness* shape from that entry's §3 remains not
greenlit.

## 5. FINDING: a there-and-back is structurally silent on the way home

> **ANSWERED 2026-08-03** — this section was a finding with nothing greenlit; the founder call it
> produced is [no-same-road-loops.md](no-same-road-loops.md). The measurements below are why: a loop
> now carries a rider-named way home, and one that retraces past `LOOP_MAX_RETRACE` is refused at the
> wire. Read this for the evidence and that record for the decision.

The Stateline loop stayed at 7 stops and 16% coverage under **every** setting swept — floor, cap and
reach alike. It is not an empty corridor. Measured:

- the route **retraces itself for 96%** of its 27.1 miles (Stateline → Emerald Bay → Stateline);
- of 18 reachable candidates, **17 snap to the outbound half and 1 to the return half**;
- the SAME corpus over just the outbound half (26:48) yields 7 stops at **33% coverage** — the full
  loop yields the same 7 stops at **16%**;
- only **one** un-narrated place (Tallac Point) sits within the honesty bound of the whole route, so
  there is nothing to generate here.

The mechanism is `nearestOnRoute`: it returns the single closest point on the polyline, so a place
beside a road you drive twice gets exactly ONE along-route time. **A round trip is twice as long and
holds the same content.** The drive is not under-selected; it is told out and silent coming back.

⚠ The two sides already disagree about this, in the usual way. `trigger.ts` retires a passed stop and
*"re-arm[s] only when it's well out of range again (a later there-and-back)"* — the PLAYER anticipates
firing again on the return. `buildDrive` never places a second stop for it, so the re-arm is
unreachable in practice. That disagreement is now moot rather than fixed: a ring passes nothing twice,
so the shape the re-arm was written for can no longer be built.

Whether the return leg should re-tell anything was a **charm call, not a bug fix**, and it was open:
a repeat could read as a warm bookend or as the app running out of things to say. **It was answered by
removing the question** — a loop is a ring now, so there is no second pass to fill. The b-side
([tell-me-more-spec.md](../designs/tell-me-more-spec.md)) stays not scheduled, and its own measurement
(1 of 8 stops on the flagship drive carry leftover material) is why it was never the answer here.

## 6. The reach filter was answering a question about a pipeline we don't run

Added 2026-08-03, after §1 ranked this last. The ranking was right about the number and wrong about
the reason, which is a worse mistake than being wrong about the number.

`buildDrive`'s step 1 admitted a candidate only if the route came within
`min(OFF_ROUTE_MAX_M, effectiveRadiusM(triggerRadiusM, avgMps, leadSeconds))`. Its stated reason: the
trigger fires on the car's **distance to the stop**, floored at 250 m for a road-snapped anchor, so a
candidate in the 250–700 m band would be selected and then sit silent — *"Granlibakken (622 m
off-route) would have needed 116 mph."*

**That is not how a stop is served.** `manifestClips` ships `item.triggerLat/Lng` — the ROUTE-SNAPPED
point, not the POI. The player (`useDrive.ts`) and the sim (`runDrive`) then both call
`snapStopsToRoute`, which **replaces** the coordinates with the snapped position, keeping the original
only as `poiLat/poiLng`. `TriggerEngine` fires on the replaced pair. So the stop sits ON the polyline,
the car drives over it, and it fires at closest approach however far off-road the POI is.

**Verified three ways on the real engine before changing anything** (`.scratch/verify-snap-claim.ts`),
at 45 mph on an 11 km road, serving the real `ANCHORED_TRIGGER_RADIUS_M`:

| POI off-route | served snapped (what ships) | served raw, via `runDrive` | raw, `snapStopsToRoute` BYPASSED |
| --- | --- | --- | --- |
| 264 m (Spooner Lake) | fired @264 s | fired @264 s | **never fired** |
| 390 m (Edgewood) | fired @264 s | fired @264 s | **never fired** |
| 622 m (Granlibakken) | fired @264 s | fired @264 s | **never fired** |
| 900 m | fired @264 s | excluded off-route | **never fired** |

⚠ The middle column is NOT a control — `runDrive` snaps whatever it is given, so it cannot
discriminate. Only the last column, with the snap bypassed, reproduces the old arithmetic — and there
it is exactly right, which is almost certainly how the original "3 of 18 could not fire" was measured.
The filter was refusing content to prevent a failure that cannot occur, at a cost its own comment
recorded: *"the other had no other candidate in range and went from 8 stops to 6."*

**The fix is a deletion.** Admission is `OFF_ROUTE_MAX_M` and nothing else — the honesty bound the
project already chose for "is this place actually along the drive". `drive-select.ts` no longer imports
from `./trigger` at all, and that absence is load-bearing: the moment admission reaches for a trigger
constant it has started answering a different question.

**`triggerRadiusM` IS A LEAD-TIME KNOB, NOT AN ADMISSION KNOB.** That conflation was the bug. It still
governs how EARLY a stop fires and is served unchanged — including the cluster cap, which remains a
genuine lead-time concern (a district must not announce itself a kilometre out). What it must never
again decide is WHETHER a place is on the drive.

Measured across the four saved drives (gap 120, with §2 and §3 already in):

| | stops | avg coverage | worst silence |
| --- | --- | --- | --- |
| before | 3 · 14 · 17 · 7 = 41 | 36% | 15:10 |
| after | 3 · 13 · 17 · 8 = **41** | **40%** | **14:24** |

The stop count is flat — one drive trades a glance for a longer telling — but coverage rises on two
drives, the Stateline loop goes 7 → 8, and ~12 more candidates per set become eligible. ⚠ A
side-effect worth watching: `driveMaxStops` now BINDS on two of the four drives (it bound on none
before 2026-08-03), so the cap is the next thing to reason about, and it is spent greedily front-to-back.

⚠ **Two dead things this leaves behind, deliberately not removed.** The player's own
`offRouteM <= OFF_ROUTE_MAX_M` guard can never fire — the server ships pre-snapped coordinates, so
client-side `offRouteM` is ~0 for every stop, which also makes its `stop_skipped`/`off_route` trace
event unreachable. It is harmless defence-in-depth against a manifest that ships raw coords, and
`apps/mobile` is another agent's tree today. The comment above it ("the API ships raw coords, not
trigger points") is simply false and should be corrected when someone is next in that file.

⚠ **What this does NOT settle.** He will now sometimes talk about a place ~600 m away that the rider
may not be able to see. That is a TASTE question, not a correctness one, and no desk pass can answer
it — it is exactly what RISK-1's real drive is for.
