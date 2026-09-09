# Local OSM roads for corpus preparation

**Status:** Built and exercised with California/Nevada for Yosemite and Tahoe on 2026-09-09.
Local preparation and snapping previews are free. No corpus anchors were changed in that verification.

Public Overpass servers are useful for small queries but failed repeatedly during Yosemite preparation.
The local path downloads a dated Geofabrik extract once, then prepares small region road files with
Osmium. Both paths use the same road classes, spatial index, through-road preference and anchor bounds.
This is road geometry for narration triggers, not certification of vehicle access or a closure feed.

## Prepare a region

Install `osmium-tool` (macOS: `brew install osmium-tool`). Bun and curl are also required. These are
operator-machine tools; no mobile dependency or new Cloud Run job is introduced.

```sh
# Preview: resolves source coverage and prints the proposed local output. No large download.
bunx dotenvx run -f .env.development --quiet -- bun packages/studio/src/prepare-local-roads.ts \
  --region lake-tahoe --sources us/california,us/nevada

# Build the local road file. --apply here writes LOCAL files only, never DB/R2 or paid APIs.
bunx dotenvx run -f .env.development --quiet -- bun packages/studio/src/prepare-local-roads.ts \
  --region lake-tahoe --sources us/california,us/nevada --apply

# Inspect candidate anchors; existing anchors are skipped unless --force is explicitly supplied.
bunx dotenvx run -f .env.development --quiet -- bun packages/studio/src/snap-speakable-anchors.ts \
  --region lake-tahoe --roads-file packages/studio/.scratch/osm/lake-tahoe.roads.json \
  --report packages/studio/.scratch/osm/tahoe-anchor-preview.json
```

Use `--region yosemite-national-park` for Yosemite. The default cache is
`packages/studio/.scratch/osm` (gitignored); `--cache-dir` changes it and `--output` overrides the region
road-file path. Source IDs come from the [Geofabrik catalog](https://download.geofabrik.de/index-v1.json).
For another state, pass its catalog ID, such as `us/utah`; no code change is needed. Select every source
required to cover the region. Tahoe requires California **and** Nevada: California alone is rejected.
The padded union of all region boxes must be covered by the source polygons, including interior gaps.

The snapping CLI's separate `--apply` writes anchors to the shared production database. Review its
report first. Preparing a local file or previewing Tahoe does not authorize a new Tahoe anchor run.
For Yosemite, the existing first-free-batch authorization covers suitable selective anchors; known
classification and geography issues still need inspection before applying them. Never force-resnap
operator corrections as part of a refresh.

## Reuse and refresh

The source cache records immutable dated URLs, provider MD5, SHA-256, snapshot timestamp and source
polygons. Partial downloads resume; checksum failure stops preparation. Cached files are verified
before reuse. Fully cached preparation makes no Geofabrik or Overpass requests; it still reads the
region's current geometry from the database. `--refresh` explicitly resolves the latest sources again.
Refresh all selected sources together: differing snapshot timestamps are rejected.
Per-source locks prevent two regions from writing the same resumable download. A concurrent writer
gets a clear busy error and can retry after the first finishes. A hard-killed process can leave a
`sources/<source-id>.lock` directory; remove that lock only after verifying no preparation is active.

Each source is cropped against the buffered union of region boxes using `complete_ways`, preserving
nodes at region edges. Road filtering preserves references; `osmium check-refs` and export's stop-on-error
mode reject broken geometry. State overlaps are deduplicated only when way ID/version, tags and complete
coordinates match. Conflicting duplicates stop the run; no “newest wins” guess crosses a state boundary.

The resulting road JSON contains source provenance, date, region geometry and normalized roads. It is
written atomically after validation. Snapping rejects wrong-region files, expanded/uncovered geometry,
mixed snapshots, malformed coordinates and duplicate roads. It records the road file's SHA-256 in its
preview report and never falls back to Overpass when a specified local file is invalid. A road file can
be copied independently of the much larger source cache.

Keep road artifacts private to operator storage unless their redistribution requirements are handled:
data is © OpenStreetMap contributors, provided under ODbL, distributed by Geofabrik. Source pages and
dated URLs stay in the manifest. Road/vehicle restrictions must still be checked through the normal
desk and routing review before publishing a region.

## Verification record

Both state files had snapshot time `2026-09-08T20:21:01Z` and passed provider checksums. California was
1,327,375,661 bytes; Nevada was 123,016,499 bytes. The Yosemite road file contained 3,655 unique ways;
the Tahoe file contained 5,763 ways after deduplication (4,370 California + 1,465 Nevada input ways).
All referenced road nodes were present. Yosemite's preview proposed 397 anchors and left 566 beyond
bounds. Tahoe's preview considered only its 209 unanchored POIs, proposing 62 and leaving 147 beyond
bounds. Neither preview changed anchors. These are geometric proposals, not editorial or access approval.

Tests cover cross-state and buffered coverage, holes, disjoint boxes, wrong/expanded region geometry,
mixed snapshots, conflicting duplicates, invalid coordinates and byte-level provenance. Existing
Overpass failure tests remain in place.

References: [Osmium extract](https://docs.osmcode.org/osmium/latest/osmium-extract.html),
[export](https://docs.osmcode.org/osmium/latest/osmium-export.html),
[check-refs](https://docs.osmcode.org/osmium/latest/osmium-check-refs.html),
[Geofabrik downloads](https://download.geofabrik.de/), and
[polygon-clipping](https://github.com/mfogel/polygon-clipping). Context7 was consulted for Osmium;
polygon-clipping had no matching Context7 package, so its upstream documentation was used.
