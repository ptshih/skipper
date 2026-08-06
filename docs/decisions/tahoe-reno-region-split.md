# Lake Tahoe tightens; Reno & Carson City becomes its own region

**Status:** ✅ **APPLIED TO PROD 2026-08-06 (founder go).** `lake-tahoe`'s bbox narrowed to the basin +
Truckee + Donner + the US-50 approach; Reno, Sparks, Carson City, Virginia City, Genoa, Minden,
Gardnerville and Dayton moved to a new `reno-carson` region over the SAME corpus. No schema change, no
migration, no regeneration, no re-spend — both boxes are `regions.bbox` strings and the split ran through
the admin routes (`PATCH /admin/regions/lake-tahoe` → `POST /admin/regions` → `POST
/admin/regions/reno-carson/release`, which returned `releasedClips: 0` exactly as predicted: every clip in
the box was already released, so the release was a pure latch flip). `GET /regions` now serves both,
`ready: true`, Tahoe's example anchors reading Donner Pass / Echo Summit / Spooner Lake / Heavenly and
Reno's reading Reno / Carson City / Virginia City / Genoa. Amends the Tahoe-specific
illustration in the `curate-places` draft prompt (see §6); leaves
[geometry-first-regions.md](geometry-first-regions.md) and [region-release-gate.md](region-release-gate.md)
unamended — this is an ordinary use of both.

## 1. The decision

`lake-tahoe` was one box, `-120.40,38.80,-119.55,39.65` — 0.85° square, released 2026-06-20. It reached
Reno and Carson City, and that was deliberate (§6). The founder changed their mind: **"Lake Tahoe" should
mean Lake Tahoe.** A rider who picks it should not be offered a drive to a Nevada state capital 30 km over
the ridge, and a drive that starts in Reno should not be labelled with a lake it never sees.

| | slug | bbox (`lng_min,lat_min,lng_max,lat_max`) |
|---|---|---|
| **Lake Tahoe** | `lake-tahoe` | `-120.40,38.80,-119.85,39.40` |
| **Reno & Carson City** | `reno-carson` | `-119.85,38.80,-119.45,39.65` |

**Only the east and north edges of `lake-tahoe` move.** The west (`-120.40`) and south (`38.80`) edges
stay exactly where they were, and that is load-bearing rather than laziness: a first cut at `-120.32`
missed **Donner Pass by ~900 m** and took Sugar Bowl, Soda Springs, Norden, Boreal and Royal Gorge with
it, while a `38.83` south edge cut Echo Summit, Twin Bridges, Phillips and Sierra-at-Tahoe — the entire
US-50 western approach. Reno and Carson City are EAST. Nothing about the problem was western or southern,
so nothing western or southern should move.

## 2. Why a SPLIT and not a SHRINK

Shrinking alone would have stranded **436 released clips — 424 minutes of finished, paid audio** — behind
endpoints no rider could name. Regions are geometry-first: no `region_id` FK exists on `pois`, `places`,
`narrations` or `drives`, so a region is nothing but a box, and a second box costs one `INSERT`.

The corpus is picked up by point-in-bbox with **zero re-spend, zero deletion and zero regeneration**:

- The 444 POIs and 436 clips east of `-119.85` already carry their own `released_at` stamps, so they stay
  live the instant the new region is released. Release is monotonic and per-clip; moving a boundary does
  not un-release anything.
- The 36 curated `places` out there are already curated — Reno, Sparks, Carson City, Virginia City, Genoa,
  Minden, Gardnerville, Dayton, Gold Hill, Silver City, Sutro, the Nevada State Railroad Museum. They
  become `reno-carson`'s planner allowlist by geometry alone. **`curate-places` does not need to run**,
  which is the whole point — that CLI spends.

⚠ **The new region must be RELEASED in the same operation, and that is not optional.** Those 436 clips and
36 endpoints are reachable by riders *today* through the Tahoe roster. Narrowing `lake-tahoe` without
releasing `reno-carson` removes them from the product — a regression dressed as a cleanup. ⚠ The release
is **IRREVERSIBLE** (`region-release-gate.md`): the bbox edits can be undone by editing a string, the
release latch never can.

## 3. Disjoint boxes, and what that costs

The boxes are **disjoint** (founder, 2026-08-06), chosen over an overlapping pair with the cost stated up
front. Overlap is fully supported — `regionForPoint` breaks ties most-specific-wins, deterministically —
and would have kept cross-region drives alive. Disjoint was preferred for a clean mental model: every
endpoint belongs to exactly one region and nothing appears twice.

⚠ **The known cost: `South Lake Tahoe → Virginia City` and `Tahoe City → Reno` stop being plannable.** A
drive resolves its anchors from ONE region's roster (`loadRegionRoster(regionId)` in `plan-route.ts`), so
a route whose endpoints straddle the seam has no roster that holds both. This is a real capability that
existed before this change and does not after it. It was accepted knowingly, not overlooked.

⚠ `pointInRegionBbox` is INCLUSIVE on all four edges, so the seam longitude `-119.85` is in BOTH boxes.
This is a measure-zero case with a deterministic answer (`regionForPoint` picks the smaller box), and the
inclusivity is itself deliberate — it is what makes the admin's region POI count and the API's `between`
anchor query agree. Not worth an exclusive edge; worth knowing about.

## 4. The dormant corner — ✅ RESOLVED 2026-08-06 by multi-bbox

⚠ **THIS SECTION IS HISTORY.** The corner below is no longer dormant: `reno-carson` is now TWO boxes
(`-119.85,38.80,-119.45,39.65;-120.40,39.40,-119.85,39.65`) and has claimed all of it — 56 clips and 4
endpoints, verified live. Regions may be several rectangles; see
[multi-bbox-regions.md](multi-bbox-regions.md). The reasoning below is kept because it is the argument
that produced that feature, and because the REJECTED alternative in it is still rejected.



Reno is northeast and Truckee is northwest, so the current box minus the Tahoe box is an **L**, and two
disjoint rectangles cannot tile an L. The corner — `lat 39.40–39.65 × lng -120.40 to -119.85`, the I-80
corridor and the reservoirs north of Truckee — belongs to neither region:

**56 clips (34 min), 90 POIs, 4 curated endpoints** (Boca Reservoir, Stampede Reservoir, Verdi, Mogul).
The content is overwhelmingly minor — numbered canyons and ravines (`Canyon Two`, `Canyon Twentyfour`,
`India Ravine`) — with Peavine Peak, Crystal Peak, Boomtown Reno and Sagehen Creek Field Station as the
named exceptions.

**Dormant is not deleted.** The rows stay in `pois` and `narrations`, keep their `released_at`, and keep
their audio in R2. What they lose is routability (no endpoint sits in the corner, so no drive can be
planned to one) and a region label. A third region later picks the whole corner up for free — it is one
more `INSERT`.

⚠ The alternative — raising Tahoe's north edge to `39.65` for a single vertical cut at `-119.85`, which
tiles the box with zero orphans — was **REJECTED**, and the reason is the same one that motivated the
whole change: **25 of those 56 clips are Reno's western fringe** (Peavine Peak, Poeville, Mogul,
Boomtown Reno, River Inn, Lawtons Hot Springs, the Reno Nevada Temple). Filing them under "Lake Tahoe"
would reintroduce the exact defect being fixed, at the exact moment of fixing it.

## 5. What the split does NOT do

⚠ **It does not change which clips a drive picks up.** `loadCorpusForRoute` scans the **route's** bbox
(`polylineBbox(polyline)` + an off-route pad), never the region's. A region bbox governs which endpoints
a rider can NAME, the discovery/enrich/generate CLI scope, the release sweep, the planner's anchor roster
and the drive's derived label — not selection. A drive that happens to pass a dormant POI still plays it.

Measured against the live DB, 2026-08-06:

| | Lake Tahoe | Reno & Carson City | dormant |
|---|---|---|---|
| live clips (all released) | 274 (13 fused) | 436 (24 fused) | 56 (0 fused) |
| audio | 244 min | 424 min | 34 min |
| POIs | 454 | 444 | 90 |
| curated endpoints | 132 | 36 | 4 |

Of the 9 saved drives, 8 label `lake-tahoe` and 1 labels `reno-carson`. **None loses its label.**

## 6. ⚠ A NEW REGION SILENTLY RENDERS FEWER COLD-OPEN ROWS

Found on the first launch after the split, and it will bite the next region too (Yosemite is drafted
and will hit it): **`reno-carson` came up with three suggestion rows where `lake-tahoe` has five.**
Nothing failed and nothing logged — the cold open just looked thinner.

The mechanism is a budget, not a bug. `composeRegionCopy` spends names from ONE cursor
(`NAME_COST`: `aToB` 2, `via` 3, `fromStart` 1, `toEnd` 1, `open` 0), and **a shape it cannot afford is
SKIPPED, not terminal** — by design, so a thin region degrades instead of collapsing. Five rows
therefore need **seven names**, and the region published five: only 6 of its 36 curated endpoints sat
at `rank <= EXAMPLE_ANCHOR_MAX_RANK` (3), and `spreadAnchors`' `MIN_ANCHOR_SEPARATION_M` (8 km) floor
dropped one of those, Minden and Gardnerville sitting ~5 km apart.

**Fixed by promoting `Dayton` and `Washoe Lake State Park` from rank 4 → 3** (admin
`PATCH /admin/places/:id`, free, no spend, no regeneration) → 7 names, 5 rows. ⚠ The promotion is
DURABLE: the `curate-places` upsert merges rank with `LEAST(...)`, so a later curation run can only
improve a rank, never demote a hand-promoted one back.

⚠ **The separation floor is a HARD floor, so a promotion can buy nothing.** Greedy max-min is
monotonically non-increasing, so the last pick's score IS the whole set's minimum pairwise separation,
and `spreadAnchors` breaks rather than degrading. Measured: promoting `Gold Hill` — a better *name*
than either place actually promoted — changes the published set by **zero**, because it sits inside
8 km of Virginia City. Do not pick these by charm alone; simulate against `pickExampleAnchors` +
`composeRegionCopy` (both pure and env-free precisely so this is testable without booting `index.ts`).

**So the rule for the next region: a region needs ~7 endpoints at rank ≤ 3 that are MUTUALLY ≥ 8 km
apart before its cold open reads full.** Curating 36 places is not enough, and the count that matters
is post-spread, not the row count in `places`.

## 7. What this supersedes

The `curate-places` draft prompt (`packages/studio/src/curate-places.ts`, byte-identical copy in
`apps/admin/server/places.ts`) carries a ⚠ note built on a Tahoe-specific measurement: the 2026-08-03
bbox-scoped run reached north into Donner but not east, leaving 28 released fused tellings around Reno,
Carson City and Virginia City with **no curated endpoint a rider could route to** — finished audio nobody
could reach. The fix then was to stop letting the region NAME scope the curation, since the name is prose
and routinely narrower than the geometry.

**That argument survives this decision and the prompt does not change.** "The box is the area, the name is
a nickname" is still exactly right for any region — and `reno-carson` is now a box whose nickname is
narrower than its contents in precisely the same way (Virginia City and Genoa are not Reno). What changes
is only the illustration: `lake-tahoe`'s box no longer reaches Reno, because the orphaned-endpoint problem
that justified reaching is now solved the other way — by giving those places a region of their own, with
the endpoints they already have. The prompt's ⚠ note is amended to say so and to point here.
