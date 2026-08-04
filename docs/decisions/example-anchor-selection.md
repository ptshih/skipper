# Example anchors: `featured` gates the pool, geometry orders it, the client rotates

**Status:** ✅ **ADOPTED + BUILT 2026-08-03 (founder call).** `apps/api/src/example-anchors.ts`
(`spreadAnchors`, `MIN_ANCHOR_SEPARATION_M`, `EXAMPLE_ANCHORS_PER_REGION` 6 → 8) and
`apps/mobile/src/lib/planner-examples.ts` (`rotateNames`, `EXAMPLE_NAMES_PER_COLD_OPEN`), with the
launch counter persisted on `region-cache.ts`. Supersedes the "product hazard with no code fix" note
that used to sit on `byRank`. Related: [geometry-first-regions.md](geometry-first-regions.md) (a
region is a bbox), [region-corpus-discovery.md](region-corpus-discovery.md).

⚠ **Read alongside [what-is-a-drive-endpoint.md](../designs/what-is-a-drive-endpoint.md)** (IDEA, same
day, different author) — the two are orthogonal and it is worth knowing which is which. That entry asks
what should be **IN** the curated set; this one decides which of the eligible get **SHOWN**. Its
observation that "`featured` is already doing the destination job" is the same judgement this record
leans on for the pool gate — and note its aside that the chips "look fine today" was written before the
Carson City report: they drew from `featured` by SORT ACCIDENT (featured floated to the top and only
six published), where they now draw from it by CONSTRUCTION. If that entry ever narrows
`endpoint_eligible`, this selection needs no change — the pool gate is already the narrower set.

## What triggered it

The cold open's three suggestion rows all named Carson City — the A→B ask, its seeded reply, the loop
ask, its reply, and the composer placeholder. Nothing had changed in the client or the API. A
`curate-places --apply` run had added `Carson City` as a **featured** endpoint, and the published list
was ordered `featured DESC, name ASC (codepoint), id ASC` with the client taking slots 0 and 1. "C"
sorts before the incumbent "Eagle Falls", so one curation run silently rewrote the app's
highest-intent tap.

## The part that was worse than the complaint

Measured while diagnosing it: the pair the old rule produced **before** that run was
`Eagle Falls → Emerald Bay State Park`. Those two are **600 metres apart**. The chip read "Eagle Falls
to Emerald Bay State Park, the scenic way" — the app was offering a six-hundred-metre drive, and had
been for as long as the feature existed. Nothing failed, because nothing was measuring distance.

So the defect was never "Carson City won"; it was that **no step in the selection had any notion of
what makes a good example drive.** Alphabetical order is not an editorial judgement, and it was the
only judgement in the chain.

## The rule

1. **`featured` decides POOL MEMBERSHIP and nothing else.** It no longer orders anything a rider
   reads. Flagging a place for the picker and putting it in the shop window are different judgements;
   conflating them is what let a curation run pick the copy.
2. **Geometry orders the pool** — greedy farthest-point (k-center), seeded from the two most distant
   members, capped at `EXAMPLE_ANCHORS_PER_REGION`.
3. **A separation floor (`MIN_ANCHOR_SEPARATION_M`, 8 km) binds by publishing FEWER names, never
   worse ones.** Greedy max-min is monotonically non-increasing, so the last pick's score *is* the
   minimum pairwise separation of the whole set — which makes the guarantee hold for **every** pair,
   not just neighbours.
4. **The client rotates** a three-name window per cold open, at a stride of three, persisted as a
   launch counter.

## Why the pool still needs a curator, measured

The obvious "stop using `featured` at all" was tried against live data and **rejected on its output**.
Spread maximises distance, so it seeks the **corners of the bbox** — and a region's corners hold its
most marginal places. Run over all 109 Tahoe endpoint-eligible rows it returns:

> Sierra-at-Tahoe Resort, Sparks, Soda Springs, Nevada State Railroad Museum, Homewood, Stampede
> Reservoir, Gardnerville, Tahoe Meadows Ophir Creek Trailhead

**Zero of eight featured.** Distances excellent, names unusable. Over the featured 16 it returns Eagle
Falls, Virginia City, Truckee, Lake Tahoe – Nevada State Park, Genoa, Tahoe City, Carson City, South
Lake Tahoe — every pair 12–57 km apart, and Carson City demoted to 2 appearances in 8 instead of
permanent.

**Spread and quality are anti-correlated.** Geometry decides the shape of the set; the curator still
decides who is eligible for it. ⚠ `featured` falls back to the whole contained set when a region has
nothing flagged — `anchor-format.ts`'s "featured ORDERS, it never FILTERS" rule was protecting a real
case, and a bare `.filter(featured)` would hand the next region curated an empty list.

## Why the rotation lives on the client and the geometry does not

The client is given **names only — no ids, no coordinates** (INV-1: an anchor id is the one thing that
can bill a Google Routes call, so it never rides an anonymous list route). It therefore **cannot tell a
600 m pair from a 44 km one** and must not pretend to. Pure client-side rotation — the cheap fix —
would have made Carson City rarer while rolling the Eagle Falls pair roughly 1 launch in 15.

That constraint is the whole architecture of this change: **every geographic judgement is server-side,
and the client only chooses which slice of an already-safe ordering is on screen.** The returned order
is consequently load-bearing — a post-sort applied to it (alphabetical, by featured, anything) would
silently void the guarantee while every test still passed.

⚠ The chips **hold still within a session**, unlike the composer placeholder beside them. They are
tappable, and a row that re-labels itself under a thumb sends a sentence the rider did not choose. The
counter is read once at mount and advanced on write.

## Deliberately not done

- **A dedicated `example_eligible` flag.** It is the clean long-term separation and it stays available
  — but it is a migration, an admin column and a curation pass to buy a divergence that does not exist
  yet. Today's featured set *is* the set we would flag. Revisit when a place should be featured in the
  picker but kept out of the shop window.
- **Usage-derived selection** (most-picked float up). Still deferred, as in
  [places-endpoints-spec.md](../designs/places-endpoints-spec.md).
- **Rotating the degraded/offline card's roster.** It renders every name as a flat list where order
  carries no meaning; rotating it would only make the same card look different each launch.
