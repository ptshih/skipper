# Road-Snapped Speakable Anchors — Build Spec

> **Status (2026-09-09):** Built; Overpass and verified local OSM sources share one snapping algorithm.
> California/Nevada local extracts and Yosemite/Tahoe previews verified; see the
> [local OSM guide](../guides/local-osm-roads.md). No anchors were changed in that local-source verification.
>
> **Initial rollout (2026-06-25):** `snap-speakable-anchors.ts` snaps POI centroids to the nearest
> drivable road via **OSM/Overpass** (free, keyless) and ran on Tahoe → **750 speakable anchors, all within
> bounds**; ~99 left anchorless as genuine backcountry (Desolation Wilderness peaks/lakes). It first used
> Google Roads "Nearest Roads", but that API's snap threshold wrongly flagged **233/334** road-adjacent
> POIs "no road" (a casino 81 m from the highway, parks at 60 m) — OSM recovered them, free. Fixes triage
> cluster **1a**; consumed by [trigger-precision-spec.md](trigger-precision-spec.md) (**1b** step 1). No $
> gate (OSM is free) — `--apply` is the only gate.

## Origin

On the first real Tahoe roam drive, several feedback items pointed at one data defect:
- *"Edgewood is too far from road to trigger"* — the pin sits on the resort grounds / lagoons, not on
  Lake Tahoe Blvd.
- *"Flag any POIs that are not near a road because they won't trigger"* — the founder generalized the rule.

A POI's pin is its **centroid** (Wikidata/Wikipedia), which for areal or off-road features can be
hundreds of metres from the nearest drivable way. The trigger has to either inflate its radius to reach
the road (firing early/imprecisely — see 1b) or never fire at all.

## What already exists (don't rebuild it)

The "where to look" anchor is a **slot with a validator and an audit, but no automated producer**:

- **Data slot:** `pois.speakable_lat` / `pois.speakable_lng` — nullable `doublePrecision`
  ([`packages/db/src/schema.ts:267-268`](../../packages/db/src/schema.ts)). A corrected vantage that
  overrides the pin.
- **Validator:** `checkSpeakableAnchor` / `speakableAnchorMaxM`
  ([`packages/engine/src/geo.ts:194-217`](../../packages/engine/src/geo.ts)) — an anchor must sit within
  `1.5 × radiusForKind(kind)` of the pin (a typo/hallucination guard).
- **Audit + write boundary:** [`packages/studio/src/audit-speakable.ts`](../../packages/studio/src/audit-speakable.ts)
  (read-only) and `POST /admin/pois/:id/corrections kind:'speakable'` (same bound at the write boundary).
- **The gap:** the slot is **hand-curated only.** `discover-pois.ts:176-177` literally leaves it untouched
  ("admin-set… the sweep leaves it untouched"). Nobody hand-corrected Edgewood, so it slipped.

So this spec adds **one missing piece — an automated producer — to a slot that already has a consumer,
a validator, and an audit.**

## The change: a `snap-speakable-anchors` corpus pass — ✅ BUILT 2026-06-25

A safe-by-default studio CLI (`packages/studio/src/snap-speakable-anchors.ts`), sibling to
`audit-speakable.ts`, following the [ops-scripts SOP](../guides/ops-scripts-sop.md) (**preview unless
`--apply`**). Since OSM is free, preview does the full fetch + snap and reports what WOULD be written vs
flagged; only `--apply` writes:

```
bun packages/studio/src/snap-speakable-anchors.ts            # preview (fetch + snap, NO writes)
bun packages/studio/src/snap-speakable-anchors.ts --apply    # also persist
```

The pass fetches **all drivable roads in the region bbox once** (OSM/Overpass `way[highway]`, tiled into a
5×5 grid with a client-side timeout + retry — the per-POI request storm wedged on Overpass throttling),
indexes the segments in a coarse spatial grid, and snaps every POI **locally**. For each POI without an
admin-set anchor (null `speakable_lat/lng`):

1. **Nearest road point** = closest point on the nearest drivable segment (projected, sub-segment accurate).
2. **Validate** through `checkSpeakableAnchor(pin, candidate, kind)`:
   - **Within `speakableAnchorMaxM(kind)`** → write `speakable_lat/lng` (a road-relative trigger center for 1b).
   - **Beyond the bound** (or no road indexed nearby) → genuinely **un-triggerable from any road.** Don't
     write a bogus anchor; **flag it** (feedback item #5). Leave the anchor null.
3. **Idempotent + non-destructive:** only fill nulls; never overwrite an admin-curated anchor. A `--force`
   flag re-snaps everything for a clean re-baseline (and DOES overwrite admin corrections).

**Why OSM, not Google Roads (the first cut):** Roads "Nearest Roads" has a snap threshold far tighter than
our trigger bound — it flagged 233/334 road-adjacent Tahoe POIs "no road" (a casino 81 m from the highway).
A diagnostic over OSM found their roads instantly. OSM is free, keyless, needs no API enablement, and
yields the exact nearest road point. (Google Roads also billed + needed a console enable — the Geocoding gotcha.)

## Why a dedicated pass — not discovery, not enrichment

- **Not enrichment.** `enrich-pois.ts` is **story-only**; un-enriched/scenic POIs are skipped. But
  scenic POIs trigger too, and off-road centroids skew scenic (lakes, vistas, resort grounds). Snapping
  in enrichment would leave the worst offenders uncorrected.
- **Not bolted onto discovery.** A separate pass **re-runs over the existing ~850-POI Tahoe corpus**
  without re-discovering — exactly what let it backfill anchors after the corpus already existed.

## Scope / coverage

Snap **every triggerable POI** (story + scenic), since both kinds fire. The pass walks `pois` for a
region bbox (same selection shape as `audit-speakable.ts`).

## Open questions / caveats

- **Nearest road ≠ the right road.** We snap to the closest drivable way regardless of class — it could be
  a freeway you won't drive. Excluding `service` (driveways/parking) already removes the worst noise; a
  road-class preference is a later refinement if a device drive shows bad snaps.
- **Flag mechanism for the ~99 un-snappable.** MVP = the pass report (they stay anchorless → fall back to
  the centroid in 1b). If we want selection to actively suppress them, that's a small follow-up column
  (e.g. `pois.off_road`); many are arguably not stop candidates at all (Desolation Wilderness — no road
  for miles).
- **This fixes off-road centroids only** (#5, #7 Edgewood). It does NOT fix early/late firing for POIs
  that *are* near a road (#6 Harrah's, #8 Zephyr Cove) — those are radius/heading, handled in **1b**.

## Touchpoints

- `packages/studio/src/snap-speakable-anchors.ts` (OSM/Overpass tiled fetch + local nearest-segment snap, all inline).
- Reuses: `checkSpeakableAnchor`/`speakableAnchorMaxM` (`@skipper/engine`), the `pois.speakable_lat/lng`
  slot, the `audit-speakable.ts` selection pattern.
- No new env or billing (OSM is keyless + free); no admin Reference change (it's a CLI, not a console page).
