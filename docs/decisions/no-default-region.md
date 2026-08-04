# No default region — every corpus run names the region it is for

**Status:** ✅ **ADOPTED 2026-08-03 (founder call).** BUILT in the same change: `DEFAULT_REGION_SLUG`
and `TAHOE_RENO_BBOX` are deleted from `packages/studio/src/config.ts`; `requireRegionKey`
(`packages/studio/src/pipeline/region.ts`) is the one expression that owns the rule; all twelve
region-scoped studio CLIs and `apps/admin/server/jobs.ts` refuse a region-less run. Extends
[geometry-first-regions.md](geometry-first-regions.md) (a region is a bbox) and
[region-corpus-discovery.md](region-corpus-discovery.md) (the sweep that fills it).

## The rule

**A corpus run must name its region. There is no default, and no fallback sweep area.**

- `--region` is REQUIRED by every region-scoped studio CLI. The single exemption is a run selected by
  an explicit id list (`--include-ids`): it already names its rows, spans no single region, and locks
  on its SELECTION instead.
- A region with **no discovery bbox** is a hard error in `discover-pois`, exactly as it already was in
  `enrich-pois` / `generate-narrations` (`requireRegionBbox`). There is no built-in area to fall back to.
- The admin console mirrors both: `POST /admin/jobs` returns **400 `region is required`** rather than
  opening a `studio_jobs` row and triggering a Cloud Run job the CLI would only reject on the far side.

## Why

Until this change every CLI read `flags.value('region') ?? DEFAULT_REGION_SLUG`, and `apps/admin`
carried a **second hardcoded copy** of that same `'lake-tahoe'` literal — it does not depend on
`@skipper/studio`, so the two were held in agreement by nothing but a comment. That is the drift shape
CLAUDE.md's "count, authorise, and ACT from ONE expression" exists to prevent.

While Lake Tahoe was the only region the default was harmless. It stopped being harmless the moment a
second region row existed, because the failure it produces is **a paid run that bills the wrong corpus
and settles green**:

- `enrich-pois --apply` typed for another region enriches Tahoe's POIs, reports a successful run, and
  the operator's actual region is untouched. Same for `generate-narrations` (model + TTS + R2),
  `curate-places`, `classify-treatments` and `audit-corpus` (which would also file its `eval_run`
  under the wrong region).
- `discover-pois` was worse than a wrong charge: it swept the built-in Tahoe corridor. Since a POI's
  region is **point-in-bbox and never a stored FK**, none of the rows it wrote would even land in the
  region the operator named — a sweep that "succeeded" and produced nothing for its target.

This is the same class as the failures CLAUDE.md already records under "a run that did nothing must
not settle GREEN". A default region is, at the call site, **indistinguishable from a region the
operator chose** — which is precisely why it cannot stay.

Failing costs one retyped flag. Guessing costs real GCP credits against the wrong corpus.

## What this does NOT change

- **Rider-facing region resolution is untouched.** `GET /regions`, the mobile region picker
  (`pickRegionId`), the planner's per-region roster cache and `GET /sample` were already
  region-agnostic; none of them ever read the studio default.
- **The App Store / marketing copy stays Tahoe-pinned on purpose.** That is gated on Yosemite actually
  serving — see the "When YOSEMITE ships" checklist in `TODO.md`, including the explicit rule not to
  pre-announce a region before it serves (Guideline 2.3.7).
- `audit-loudness` keeps its optional `--region`: omitting it there means "ALL shipped narrations",
  which is a real scope, not a guess at one.

## Don't reintroduce

Neither constant. If a run feels like it needs a default region, the thing it actually needs is for
the caller to say which region it means — the admin console already has a region selector on every
surface that dispatches one.
