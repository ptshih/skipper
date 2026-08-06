# A region may be SEVERAL boxes

**Status:** ✅ **BUILT + APPLIED TO PROD 2026-08-06 (founder).** `regions.bbox` may now hold several
boxes separated by `;`; membership is "inside ANY box". No migration — the column is still `text`, a
one-box value parses exactly as before, and every stored region kept working untouched. `reno-carson`
is live as two boxes and has claimed the I-80 corner (56 clips, 4 endpoints) that belonged to no region.
Extends [geometry-first-regions.md](geometry-first-regions.md) (a region is still geometry, just not one
rectangle) and completes [tahoe-reno-region-split.md](tahoe-reno-region-split.md) §4.

## 1. Why

Splitting Tahoe from Reno left an **L-shaped** problem. `reno-carson` owns the I-80 corridor north-west
of Reno — Verdi, Mogul, Boca and Stampede reservoirs — but that corner lies **west of Reno's own western
edge**, tucked above Truckee. One rectangle cannot describe an L:

- Widening Reno's box west to reach the corner makes it **swallow `lake-tahoe` entirely** (Reno's
  latitude span already covers Tahoe's).
- Leaving it out orphans the corner in no region at all, which is what shipped on 2026-08-06 morning.

Overlap was considered and rejected, and the reason is specific rather than aesthetic: **region labels
tolerate overlap but the planner ROSTER does not.** `regionForPoint` resolves a contested point by
most-specific-wins, so labels stay correct under overlap. `loadRegionAnchors` has no such rule — it is a
flat bbox query, and the set it returns IS the planner's allowlist (INV-1). A widened Reno box would
therefore hand Reno every Tahoe endpoint, so a rider who picked "Reno & Carson City" could name Emerald
Bay. That is the exact legibility defect the split existed to remove.

## 2. The shape

`regions.bbox` is one box, or several separated by `;`:

```
-119.85,38.80,-119.45,39.65;-120.40,39.40,-119.85,39.65
```

⚠ **SAME COLUMN, NO MIGRATION, and that was the point.** A new column would have meant `db:generate`
(which prompts on renames and needs a real TTY) or `db:push` (which DROPS to match the schema) against a
database that is also production. A region is still "a string describing an extent"; the one-box form is
byte-unchanged. The cost of a wrong schema change here is measured in released clips; the cost of a
longer string is zero.

## 3. The readers

| | |
|---|---|
| `parseRegionBboxes` | `@skipper/engine` — the column reader. One box → a one-element list. |
| `pointInAnyRegionBbox` | containment, inclusive on every edge of every box |
| `containingRegionBboxArea` | specificity for most-specific-wins |
| `formatRegionBboxes` | the inverse, kept beside the parser |
| `inAnyBbox` | `@skipper/db/bbox` — the SQL twin, an OR of per-box ANDs |

⚠ **`parseRegionBbox` (SINGULAR) now REFUSES a multi-box string**, and that is the safety property of
the whole change rather than pedantry. Any call site that was never converted reads `null` and therefore
matches **nothing** — loud, local, free to spot. Had it returned the first box instead, a missed caller
would silently scope itself to *part* of a region: a release that publishes half a region, or a paid
sweep that bills half of one, with a green run to show for it. That is precisely the shape
[no-default-region.md](no-default-region.md) records already costing money once.

⚠ **ALL-OR-NOTHING**: one malformed box voids the whole list. A partial parse would silently SHRINK a
region, which reads as a smaller region rather than as an error.

⚠ **AN EMPTY LIST MATCHES NOTHING, NEVER EVERYTHING.** `inAnyBbox([])` emits literal `false`. drizzle
folds an empty `and()` away and leaves a query UNFILTERED, so the guard is explicit and tested — an
unfiltered region scope is how a paid run bills the wrong corpus and a release publishes rows nobody
authorised.

## 4. Three places where hull ≠ boxes

Some outward APIs take exactly one rectangle. The rule is **restrict with the hull, judge with the
boxes** — the hull of a multi-box region also covers the GAP between its boxes, and that gap is a
disjoint neighbour's ground.

- **Google Places** (`resolvePlaceInBboxes`, `resolveCuratedPlaceInBboxes`): the hull bounds the
  autocomplete (a superset can only return extra candidates); containment is then tested against the
  real boxes. Curated places ARE the allowlist, so a place resolved out of the gap would let a rider
  name their neighbour's endpoint.
- **`discover-pois`**: grids **each box** into its own 5×7 cells rather than gridding the hull. The qid
  dedupe already absorbs overlap where boxes touch; the CLI is free, so per-box costs only WDQS calls.
- **`snap-speakable-anchors`**: tiles each box into ONE shared road index. Roads merge deliberately — a
  POI near an edge must still snap to a road in the neighbouring box. The index is a spatial lookup, not
  a membership test, so a superset of *roads* is harmless where a superset of *POIs* would not be.

## 5. Specificity is the CONTAINING box, never the total

`containingRegionBboxArea` returns the area of the **smallest box that contains the point**, not the
region's summed area. Summing would let a region become *less specific* — and lose a label it should
win — merely by annexing a far-away corner it also covers. Concretely: adding the I-80 corner to
`reno-carson` would enlarge its total, and downtown Reno could then lose to a broader enclosing region.
The question is about the point, so only the box the point is in may answer it. Pinned by a test.

## 6. ⚠ Boxes that share an edge are NOT strictly disjoint

`pointInRegionBbox` is inclusive on all four edges — deliberately, so the admin's poi-count and the
API's `between` query give the same answer and two screens cannot disagree about one poi. A consequence:
**a coordinate lying exactly on a shared edge belongs to both regions.**

Measured on the live corpus: exactly **2 of 767 clips** — `Genoa, Nevada` and `Genoa Historic District`,
both stored at `(39, -119.85)` — sit on the `-119.85` seam and resolve into both regions. **0 of 172
curated endpoints do**, so the planner roster and the allowlist are untouched, and drive labels are
unaffected (a label tests the drive's START, which is always a curated place).

⚠ Those two coordinates are rounded to two decimals; the curated `places` row for the same town carries
`39.0040567, -119.8472149`, which is ~400 m away and cleanly inside `reno-carson`. So the collision is a
**data-precision artifact, not a boundary error** — worth fixing at the POI, not at the geometry. It is
NOT fixed here: moving a released clip's coordinate moves where it triggers for riders.

Do not "fix" the seam by making an edge exclusive. Inclusive edges are load-bearing, and a half-open
boundary would leave a point on the line in NEITHER region, which is strictly worse than in both.

## 7. Cap

`MAX_REGION_BBOXES = 8` (`apps/admin/server/bbox.ts`), validated at the write boundary alongside the
per-box span and corner-order checks, and the error message NAMES which box failed. Every box is another
disjunct in queries that run on anonymous per-request paths (the roster, the example anchors, every app
launch), so a region hand-edited into hundreds of boxes would turn an indexed lookup into a scan on the
routes least able to afford it. A fat-finger catch, not a design ceiling.
