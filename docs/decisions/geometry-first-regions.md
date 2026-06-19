# Geometry-first regions (a region is a bbox, never a foreign key)

**Status:** ✅ **ADOPTED 2026-06-19.** Drive slice BUILT (migration `0017`: `drives` drops `region_id`,
adds the route bbox; `drive_demand` drops `region_id`). Asides-deletion slice BUILT (migration `0019`
drops the `asides` table + the intro/outro player framing). Corpus-CLI slice BUILT:
`discover`/`enrich`/`generate-narrations` take `--region <slug>`, resolved to the region's discovery bbox
via `studio/src/pipeline/region.ts` (point-in-bbox selection); `--bbox` is gone as a user input and the
admin sends the region slug. Supersedes the abandoned plan to stamp a `region_id` on `pois`.

## The rule

A **region is a bounding box** (geometry), not an identity a row points at. Membership is **derived by
geometry at query time**, never stored as a foreign key on anything that has its own coordinates:

- **A POI's region = point-in-bbox.** `pois` carries NO `region_id`. "POIs in region X" =
  `lat/lng BETWEEN X.bbox`. The corpus CLIs (`discover`/`enrich`/`generate-narrations`) take
  `--region <slug>` and resolve it to that bbox internally — bbox is never a user-facing input.
- **A DRIVE's region = bbox-intersect.** `drives` carries NO `region_id`. A drive stores its own route
  **bbox** (`bbox_min/max_lat/lng`), derived from the frozen polyline at create time; a drive's
  region(s) are derived by intersecting that bbox with `regions`. The bbox is also the spatial prefilter
  for "POIs along this route."
- **No `region_id` FK exists in the schema.** `drive_demand.region_id` is dropped too (its `route_sig`
  already encodes location). The previously-debated `asides.region_id` is mooted by deleting the
  `asides` concept entirely (see below).

**The test:** is the region a *derived spatial fact* (→ query by geometry, never store) or an *authored
identity fact* (→ an FK would be fine)? In Skipper everything with a region is spatial, so nothing stores
a region FK.

## Why not stamp `region_id` (the research)

A multi-agent research pass (OSM, Google/Nominatim reverse-geocoders, Who's On First, Wikidata P131,
PostGIS/ArcGIS spatial joins; plus a repo-grounded analysis and an adversarial red-team) converged:

1. **Every planet-scale system models "which region contains this point" as derived / one-to-many**, not
   a single FK. OSM explicitly warns consumers *not* to assume a feature has one parent; geocoders return
   a multi-level hierarchy; gazetteers go multi-valued for non-administrative ("the Bay Area") regions.
2. **A stamped `region_id` would have been a discovery-order lie.** Discovery sweeps one region's bbox at
   a time and `pois` dedupes on `(source, source_id)`, so the first corridor POI between two regions
   (e.g. Tahoe↔Yosemite on CA-89/US-395 — on the roadmap) would freeze "whichever swept first." A
   `NOT NULL` would force a confident answer at the one moment the system has none.
3. **Materializing a spatial join onto the row is a known staleness trap**: editing a region's bbox
   silently desyncs every stamped row. Point-in-bbox at query time is always correct; at Skipper's scale
   (hundreds of POIs, a handful of regions) it's also cheap, so there's no performance case for the FK.
4. The **stale-proof exception is a drive's own bbox** — its source (the polyline) is *frozen* at create,
   so the cache can never drift. That's why storing the drive bbox is safe where stamping a POI region
   is not.

## Consequence: cross-region drives are unblocked

Because drive POI-selection is by **route geometry, not a region filter** (`drive-select` snaps the
corpus to the polyline; reads are region-blind), a route spanning two regions naturally pulls narrations
from both corpora + the corridor. Single-region drives were a self-imposed limit; geometry-first removes
the technical barrier. The remaining design work is the **per-region host (M4) hand-off** mid-drive — a
charm opportunity ("I'll hand you to my colleague up the road"), not plumbing. `/drives/propose` still
takes a `regionId` as a *transient* geocoding-bias input (to disambiguate free-text place names before
any route exists) — but it is never stored; the created drive keeps only its bbox.

## Asides deleted (the only placeless content)

`asides` (intro/outro brackets + clock-anchored beats) were the one content type with NO coordinates, so
they were the only thing that ever wanted a region FK. They are **deleted from v2** (return in v3 with
guided tours). Their place — the drive's between-story texture — is taken by the already-defined PLACED
forms `break` (pitstops: food/coffee/gas, named from a Places anchor) and `scenic` (overlooks), which
have real coords and so fit geometry-first for free. They're drive-only by nature (not in the
Wikipedia-story roam corpus). **BUILT 2026-06-19 (migration `0019`):** dropped the `asides` table, the
`asideKind` enum, the `intro`/`outro`/`aside` `driveClipForm` members + the `DriveSelectionItem` aside
variant, AND the now-dormant intro/outro player framing (the `INTRO_SEQ`/`OUTRO_SEQ` sentinels,
`frameKindForSeq`, `activeFrame`, `frameTitle`, the preview-timeline frames) — it never fired in v2.

## Tripwire (when to revisit)

Stop and reconsider the moment **a second region's bbox overlaps or nests another** (e.g. a broad "Sierra
Nevada" containing "Lake Tahoe"), OR **any read path adds `WHERE region_id = ?`**. At that point the
multi-region break lands on `narrations.UNIQUE(poi_id)` vs per-region hosts — fix it by putting region
on the **narration** (`UNIQUE(poi_id, region_id)`), NEVER by stamping a region on `pois` or adding a
`poi_regions` junction.
