# A curated endpoint must be a place a car can reach

**Status:** ✅ **ADOPTED + BUILT 2026-08-04; AMENDED the same day** — the wire gate no longer refuses on
Google's warning alone, because one of the anchors this record called "genuinely restricted" turned out
to be drivable. See "AMENDED 2026-08-04" below, including the risk the amendment does NOT retire. Four parts, all live: `@skipper/routing` asks Routes for
`routes.warnings` and derives `restricted` (`hasRestrictedRoads`); `apps/api` refuses a restricted route
at BOTH billed sites (`POST /drives/propose`, `POST /drives`) before the corpus read and before the
ledger batch; `places.access_lat/lng` (migration `0044`) carries where a car is sent when the pin is not
drivable, set in the admin and read only by `routeWaypoints`;
`packages/studio/src/audit-endpoint-routability.ts` sweeps a region's curated endpoints, names the bad
ones and `--snap` proposes their access points. Tahoe is clean as of the same day: 108 anchors, 0
flagged. Extends [region-release-gate.md](region-release-gate.md) (what a rider may be offered) and sits
beside [no-same-road-loops.md](no-same-road-loops.md) — the other post-materialize refusal, and the one
whose ordering this record pins.

## What happened

A rider asked for a round trip from Carson City by way of Spooner Lake. The card came back
**143 MIN, 2 STORIES**, with "Make this drive" underneath it. Nothing errored, no test failed, and
every number on the card was correct.

The curated `Spooner Lake` endpoint was stored at **39.107603, -119.908998** — Google Places answers
with the FEATURE's location, and for a lake that is the water. The nearest thing Routes could snap it
to was the gated **NF-038** forest track on the far side of the ridge, so the route left Carson City
northward, crossed the Carson Range on fire road, and came down to the lake from the north:

| destination point | Google's best route |
| --- | --- |
| the stored pin `39.107603,-119.908998` | 1 hr 11 min, 19.0 mi **via NF-038**, *"This route has restricted usage or private roads"* |
| `Spooner Lake` as a named place | 19 min, 13.6 mi via US-50 W |
| Spooner Lake Visitor Center `39.1064976,-119.916473` | 19 min, 13.5 mi via US-50 W |

Two of those numbers, doubled, are the 143 on the card. The anchor was 800 m from a good pin and 52
minutes from a good answer. The **2 STORIES** was the same bug's shadow: most of those 143 minutes ran
through empty forest with no corpus anywhere near it.

## The rule

**An endpoint a rider can pick must be a place a car can drive to and stop.** A pin on a lake, a beach,
a summit or a park polygon is not one, however correct its coordinates are.

Enforced in three places, deliberately at three different distances from the rider:

1. **`@skipper/routing`** asks for `routes.warnings` and derives one boolean, `restricted`. There is no
   way to ASK for a drivable route — `routeModifiers` is exactly `avoidTolls` / `avoidHighways` /
   `avoidFerries` / `avoidIndoor` / `vehicleInfo` / `tollPasses`, with no avoid-unpaved and no
   avoid-private (checked against the Routes reference, 2026-08-04). The warning on the way back is the
   only signal that exists.
2. **`apps/api` refuses**, at both billed sites, with `restricted_route` (422). It fires BEFORE the
   corpus read and therefore before the ledger batch, so a refused route costs the Routes call that
   produced the evidence and never a rider's credit.
3. **`audit-endpoint-routability`** sweeps the curated set offline and prints NAMES.

## Why all three, and why the sweep is not redundant

The wire gate protects the rider, and it protects them by taking the drive away — one silent 422 at a
time. Its log line carries no place name and never will: a rider's destination is personal data
(INV-13), which is why `logRouteSpend` takes counts and magnitudes only. So the wire can tell an
operator that *something* is wrong and is structurally incapable of saying *which anchor*. The sweep
runs offline over the curated set, where there is no rider and no privacy question, and answers exactly
that.

## The gate is blunt, and that was a decision

The first Tahoe sweep probed all 111 endpoint-eligible anchors (one Routes call each, ~$0.56) and
flagged **9**:

| anchor | why |
| --- | --- |
| Spooner Lake | pin on the water; 66.9 km / 96 min probe |
| Glenbrook | private gated community |
| California Main Lodge Parking | Heavenly's private lot |
| Baldwin Beach, Kiva Beach, Pope Beach, Tallac Historic Site, Taylor Creek Visitor Center | gated USFS access roads off CA-89 |
| Hellman-Ehrman Mansion | inside Sugar Pine Point SP; vehicles stop at the lot |

Only Spooner is catastrophic — the other eight route in 3–18 minutes at ordinary speeds. It is
tempting to narrow the gate so it only refuses the catastrophic case, and **that was tried and
rejected**: every candidate discriminator is origin-dependent. Detour ratio separates cleanly from one
origin (1.5–2.5× for the eight, 6.5× for Spooner) and collapses from another — Carson City → Spooner →
Carson City by fire road is only 2.2×, because the outbound and return legs are both wrong in the same
way. Implied average speed separates the founder's actual drive (26 km/h) and fails on the sweep's own
Spooner probe (42 km/h, inflated by the highway portion). A gate tuned on one origin is a gate that
passes the same bad anchor asked for from somewhere else.

### AMENDED 2026-08-04 — one of the eight was a false positive, and the blunt gate is now corroborated

**The claim below that "the eight are genuinely restricted too" is FALSIFIED for at least one of them.**
`Taylor Creek Visitor Center` is drivable; that road is not restricted to the visitor centre (founder,
local knowledge). Two independent probe origins both returned the warning, so this was not a bad probe —
Google's warning is simply wrong there, which means the wire gate was refusing a real drive to a real
destination and doing it silently. A second founder call the same day settles the wider principle:
*private or not is not our decision — a rider might have access*, which removes the reading of "failing
closed" that treated a restricted road as equivalent to an unreachable one.

Measured side by side, the warning carries no information on its own:

| route | warning | detour | km/h | truth |
| --- | --- | --- | --- | --- |
| `Spooner Lake`, original lake-surface pin | restricted | **2.22x** | 26 | genuinely undrivable |
| `Lakeside Marina` | restricted | 1.71x | **16** | fine |
| `Lake Forest Campground` | restricted | 1.51x | 42 | fine |
| `Taylor Creek Visitor Center` (from S. Lake Tahoe) | restricted | 1.42x | 51 | fine |
| `Incline Beach` | restricted | 1.21x | 30 | fine |
| `Taylor Creek Visitor Center` (from Pope Beach) | restricted | 1.09x | 32 | fine |

So `apps/api` now refuses only when the warning is CORROBORATED by an absurd route:
`route.restricted && detour >= DETOUR_REFUSE_RATIO` (1.8x), where detour is routed distance over the
straight-line chain SUMMED LEG BY LEG (a round trip's start-to-end line is ~0, and dividing by it would
refuse every loop). ⚠ Note this also retires the speed idea recorded below as a candidate: `Lakeside
Marina` is legitimate at 16 km/h, *slower* than the true failure at 26, so any average-speed floor that
catches Spooner eats a real destination first.

⚠ **WHAT THIS AMENDMENT DOES NOT ANSWER, and it is the original argument's strongest point.** Detour
ratio IS origin-dependent, exactly as recorded below. The six rows above come from probe origins of the
sweep's choosing, and a rider picks their own start. The residual risk is a bad anchor that measures
under 1.8x from some origin nobody probed, which would now be ALLOWED where the blunt gate refused it —
and at `POST /drives` that costs a non-refundable credit, which is the specific harm the blunt gate was
chosen to prevent. The threshold rests on ONE true positive. That is why `route_spend` now logs `detour`
on every billed route: it is the corpus to re-derive the number from, and it should be re-derived before
anyone trusts 1.8 as more than a first cut. If a bad drive reaches a rider, the recorded fallback is to
restore the blunt gate at the credit-spending site and keep the corroborated one on the free preview.

### The original argument (SUPERSEDED IN PART — read the amendment above first)

So the gate refuses on the warning alone, and **the eight are genuinely restricted too** — each has a
gate, a fee station or a private road on its final approach. They are not false positives. Failing
closed costs a rider an in-persona "pick another spot" on a recoverable turn; failing open costs them a
non-refundable credit on a drive to a locked gate. Given the credit is non-refundable
([credit-ledger.md](credit-ledger.md)), the blunt gate is the right side to err on — and every refusal
it causes is removable, one row at a time, by the access point below. That is what makes a blunt gate
affordable: it is strict, and there is a cheap per-place answer to each thing it catches.

## The access point — the durable fix (BUILT 2026-08-04)

Correcting the pin was the wrong shape, and measurement is what showed it. Two things came out of the
first sweep:

**Re-pinning does not work for most of them.** Kiva Beach has a real, free, dedicated Google parking
lot 200 m from its pin; routing to that lot returns the *identical* warning on the *identical* route,
because the restriction is the access road you drive either way. There is no coordinate at the place
that clears it. So the earlier reading here — "imprecise pins that should point at the public lot" —
was wrong, and is corrected rather than quietly dropped.

**Overwriting `lat`/`lng` is dishonest even when it works.** It routes correctly and then draws a pin
named for a beach in the middle of a highway, mis-titles the drive, and mis-saves the rider's own
record of where they went.

So `places` gained **`access_lat` / `access_lng`** (migration `0044`), nullable, the same contract
`pois.speakable_lat/lng` already has:

- **One reader.** `routeWaypoints` (`apps/api/src/drives.ts`) — the Google Routes request and nothing
  else. The map marker, `driveLabel`, `sameSpot`'s loop test, `routeSigOf` and the `drives.start_lat` /
  `end_lat` frozen into a saved drive all keep the real pin. A rider sees Baldwin Beach on the beach
  while their car is sent to the CA-89 turn-off 900 m short of it.
- **Operator-owned.** Deliberately absent from BOTH upserts (`curate-places` and the admin's
  manual-add), which is the whole mechanism — those two overwrite `lat`/`lng` last-write-wins, and that
  is exactly why the correction had to leave `lat`/`lng`. Both sites carry a comment saying so; nothing
  fails if someone adds them, the drives just quietly go wrong again.
- **Bounded.** `checkAccessPoint` (`@skipper/engine`, 2 km) at the admin write, 422 past it. Not
  kind-aware, unlike `speakableAnchorMaxM`: a vantage must sit INSIDE the feature, whereas an access
  point sits deliberately outside it, on the nearest public road — a fact about the road network, not
  about how big the lake is. The bound is set from the measured corrections (126 m to ~900 m), so it
  clears the worst real case by more than double while still failing a different-place substitution.
- **Proposed, not guessed.** `audit-endpoint-routability --snap` binary-searches each restricted route
  for the furthest point along it a car can still be sent to, and prints the coordinate with how far
  short of the pin it falls. It writes nothing; a human reads the distance and signs it off.
- **Measured by the same rule it is written under.** The sweep probes `routedPoint`, which mirrors
  `routeWaypoints`. Two copies of one rule, and they fail in opposite useless directions if they drift:
  probe the pin and every corrected anchor re-flags forever; probe the access point while the API
  ignores it and a gated road passes.

**Result:** all 8 remaining anchors were given access points on 2026-08-04 except California Main Lodge
Parking, whose endpoint role was dropped instead — it is Heavenly's private parking structure and 500 m
short of it is a spot on a road, not a place anyone names. Spooner Lake's pin was returned to the lake
with the visitor centre as its access point. The verification sweep is **108 anchors, 0 flagged, exit
0**, from 9 flagged at the start.

## What still needs watching

`endpoint_eligible` is OR-merged, so a re-curation can restore the role on a place an operator pruned
(California Main Lodge Parking is the live example). The access point itself now survives a
re-curation, but the PIN does not — and a moved pin with a stale access point is a new way to be
wrong. **Re-run `audit-endpoint-routability` after any `curate-places` run**; it is the standing guard
and its exit code is meaningful now that it measures the routed point.
