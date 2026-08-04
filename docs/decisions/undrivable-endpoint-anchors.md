# A curated endpoint must be a place a car can reach

**Status:** ✅ **ADOPTED + BUILT 2026-08-04.** Three parts, all live: `@skipper/routing` asks Routes for
`routes.warnings` and derives `restricted` (`hasRestrictedRoads`); `apps/api` refuses a restricted route
at BOTH billed sites (`POST /drives/propose`, `POST /drives`) before the corpus read and before the
ledger batch; `packages/studio/src/audit-endpoint-routability.ts` sweeps a region's curated endpoints
and names the bad ones. Extends [region-release-gate.md](region-release-gate.md) (what a rider may be
offered) and sits beside [no-same-road-loops.md](no-same-road-loops.md) — the other post-materialize
refusal, and the one whose ordering this record pins.

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

So the gate refuses on the warning alone, and **the eight are genuinely restricted too** — each has a
gate, a fee station or a private road on its final approach. They are not false positives; they are
imprecise pins that should point at the public lot rather than at the feature. Failing closed costs a
rider an in-persona "pick another spot" on a recoverable turn; failing open costs them a
non-refundable credit on a drive to a locked gate. Given the credit is non-refundable
([credit-ledger.md](credit-ledger.md)), the blunt gate is the right side to err on — and every refusal
it causes is removable by re-pinning one row.

## The fragility that remains, and what covers it

`curate-places` upserts `lat`/`lng` **last-write-wins** on `place_id`, and `endpoint_eligible` is
OR-merged (a role, once curated, is never cleared by a later run). So a corrected pin is restored to
the bad one by the next curation of that region, and clearing the role does not stick either. Spooner
was corrected by hand on 2026-08-04; that correction is **not** durable on its own.

What makes it survivable is that neither backstop depends on the pin staying fixed: the wire refuses
the restricted route whenever it reappears, and the sweep names it again. **Re-run
`audit-endpoint-routability` after any `curate-places` run** — the CLI's own summary says so.

A durable fix would be an operator-owned routable point that curation does not write — the shape
`pois.speakable_lat/lng` already has (admin-owned, never sweep-set). That is a schema change and is NOT
built; it is the obvious next step if hand-corrections start getting reverted in practice.
