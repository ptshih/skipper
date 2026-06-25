# Road-Snapped Speakable Anchors — Build Spec

> **Status (2026-06-25):** CLI ✅ BUILT, paid RUN founder-gated. `snap-speakable-anchors.ts` is built +
> preview-verified (848 Tahoe POIs lack an anchor → ~9 Roads requests ≈ $0.09). Fixes triage cluster
> **1a** from the 2026-06-25 founder dogfood drive (build 11): POIs whose centroid sits far from any
> drivable road never trigger, or trigger garbage. Paired with
> [trigger-precision-spec.md](trigger-precision-spec.md) (**1b**), which *consumes* the anchor this pass
> produces. The `--apply` run (Roads API + DB writes) awaits a founder go; Roads API must be enabled on
> the key.

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
`--apply`**). Preview makes NO Roads calls and NO writes (so nothing spends until `--apply` + a founder
go); it counts the eligible POIs and estimates the Roads cost:

```
bun packages/studio/src/snap-speakable-anchors.ts            # preview (no writes, no spend report)
bun packages/studio/src/snap-speakable-anchors.ts --apply    # snap + persist (paid: Roads API)
```

For each POI **without** an admin-set speakable anchor (null `speakable_lat/lng`):

1. **Snap the pin to the nearest drivable road** via Google **Roads API – Nearest Roads**
   (`roads.googleapis.com/v1/nearestRoads`, ≤100 points/call → batch the corpus). Returns the nearest
   road point as the candidate anchor. `GOOGLE_MAPS_API_KEY` is already wired for studio (Routes +
   Places); **Roads API may need enabling in the GCP console** — same class of gotcha as the Geocoding
   API being off for the West Shore tour.
2. **Validate** the candidate through the existing `checkSpeakableAnchor(pin, candidate, kind)`:
   - **Within `speakableAnchorMaxM(kind)`** → write `speakable_lat/lng`. This is now a road-relative
     trigger center for 1b.
   - **Farther than the bound** → the POI is genuinely **un-triggerable from any road.** Do NOT write a
     bogus anchor; **flag it** in the report (this directly answers feedback item #5). Leave the anchor
     null so 1b can treat it as "centroid-only, low confidence."
3. **Idempotent + non-destructive:** only fill nulls; never overwrite an admin-curated anchor (those are
   deliberate corrections). A `--force` flag re-snaps everything for a clean re-baseline.

## Why a dedicated pass — not discovery, not enrichment

- **Not enrichment.** `enrich-pois.ts` is **story-only**; un-enriched/scenic POIs are skipped. But roam
  triggers scenic POIs too, and off-road centroids skew scenic (lakes, vistas, resort grounds). Snapping
  in enrichment would leave the worst offenders uncorrected.
- **Not bolted onto discovery.** Discovery is the *free* Wikidata sweep; snapping needs a *paid* Roads
  call. A separate pass keeps discovery free + re-runnable, and — critically — **re-runs over the
  existing ~850-POI Tahoe corpus** without re-discovering. (If it ever belongs inline, it's a post-step
  of discovery, never of enrichment.)

## Scope / coverage

Snap **every triggerable POI** (story + scenic), since both fire in roam. The pass walks `pois` for a
region bbox (same selection shape as `audit-speakable.ts`).

## Open questions / caveats

- **Nearest road ≠ the right road.** Nearest Roads returns the closest way regardless of class — it could
  snap to a freeway you won't drive or a tiny service road. For roam (drive-anywhere) "nearest drivable
  road" is acceptable; flag a road-class filter as a later refinement if device testing shows bad snaps.
- **Flag mechanism for un-snappable POIs.** MVP = the pass report. If we want roam to actively suppress
  them, that's a small follow-up column (e.g. `pois.off_road`); not in this spec's MVP.
- **This fixes off-road centroids only** (#5, #7 Edgewood). It does NOT fix early/late firing for POIs
  that *are* near a road (#6 Harrah's, #8 Zephyr Cove) — those are radius/heading, handled in **1b**.

## Touchpoints

- New: `packages/studio/src/snap-speakable-anchors.ts` (+ a Roads-API helper, likely under
  `packages/studio/src/pipeline/`).
- Reuses: `checkSpeakableAnchor`/`speakableAnchorMaxM` (`@skipper/engine`), the `pois.speakable_lat/lng`
  slot, the `audit-speakable.ts` selection pattern.
- Admin Reference + ops-scripts SOP: add the new CLI as a paid, safe-by-default pass.
