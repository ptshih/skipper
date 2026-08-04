# Drive endpoints + pitstops from a curated Places set — Build Spec

> **Status:** ✅ **BUILT AND RUN — the curated Tahoe set is LIVE in production.** Code built 2026-06-20/21
> (the `places` role markers + `featured`, migration 0033 **APPLIED**; the curated-endpoint repoint; the
> `regionAnchor.featured` DTO field; the mobile featured-first picker; the admin **`/places`** curation
> page), and **step 3's paid Tahoe curation run HAS HAPPENED** — measured live during 1.1 (2026-07-31):
> **32 curated places, 26 `endpoint_eligible`, 6 ineligible**, every one Tahoe-basin. Prod confirmed it
> on 2026-08-02, `GET /regions` serving Lake Tahoe's example anchors out of that set
> ([../guides/1-1-cutover-runbook.md](../guides/1-1-cutover-runbook.md)).
> 💸 **Do NOT re-run `curate-places` to "fix an empty allowlist" — it is not empty, and that run SPENDS.**
> A curation run is now only for a NEW region (and still needs an explicit founder go).
>
> ⚠ **THE DRAFT IS SCOPED BY THE BBOX, NOT THE REGION NAME (2026-08-03).** The draft prompt used to read
> "Stay strictly inside `<display_name>`" — and a model told *strictly inside Lake Tahoe* correctly
> excludes Truckee, Reno, Carson City and Virginia City, none of which are in the Tahoe Basin even though
> the lake-tahoe bbox reaches every one of them. `discover-pois` sweeps that BBOX, so the corpus grew
> released fused tellings for those towns while the allowlist stayed basin-only: **28 released fused
> tellings with no curated endpoint a rider could name as a start or end.** Both copies of the prompt
> (`packages/studio/src/curate-places.ts` + `apps/admin/server/places.ts` — byte-identical BY HAND, since
> the admin deliberately does not depend on `@skipper/studio` and the only shared packages ship into the
> mobile bundle) now scope on the region's BBOX CORNERS and demote the name to flavour. They must move
> together. ⚠ The "every one Tahoe-basin" measurement above is HISTORY on both counts — the rule changed,
> and a `Truckee` endpoint was added by hand on 2026-08-03. Trust the DB for live counts, never this line.
>
> ⚠ **FIRST BBOX-SCOPED RUN, MEASURED (2026-08-03): it fixed the NORTH and missed the EAST.** Target 100
> → 103 drafted → 96 resolved → **93 written**; 7 unpinnable (Autocomplete only BIASES to the bbox, so
> the Details-coords guard drops what lands outside). It reached the Donner corridor — Truckee, Donner
> Lake, Soda Springs, Norden, Sugar Bowl — but **no survivor landed east of lng −119.90**, so Reno,
> Carson City and Virginia City were still missed: the very towns holding the orphaned tellings.
> Cause: stating the bounds was not enough while the prompt still opened "a driving audio tour of
> `<display_name>`" — Truckee reads as Tahoe, Reno reads as somewhere else. The prompt was restructured
> so the BOX is given first as the area and the name appears once, explicitly labelled a NICKNAME.
> ⚠ **That second pass is UNMEASURED** — it needs another paid draft to confirm the east side fills in.
>
> ⚠ **SECOND, SEPARATE DEFECT FOUND IN THAT RUN — a silent WRONG resolve, now guarded.** Autocomplete is
> sent a HARD bbox restriction and the resolver takes the FIRST prediction with no check that it
> resembles the query — so a draft naming a place just OUTSIDE the box comes back as the nearest in-box
> NAME-ALIKE, routinely a residential street. Hope Valley (38.75) → **"Hope Court"**, Carson Pass (38.69)
> → **"Carson Court"**, both stored ENDPOINT-eligible: the planner could offer a rider a drive to a
> cul-de-sac. Worse than the 7 that failed to pin, because those were reported. Both rows deleted by hand
> 2026-08-03; `isAddressLike` (mirrored in `apps/admin/server/places.ts` + `packages/studio/src/pipeline/places.ts`)
> now refuses an address-typed resolve for the ENDPOINT role, breaks left permissive.
> ⚠ It tests Google's plural `types`, **never `primaryType`** — that obvious-looking rule is WRONG, since
> a locality has NO primaryType (31 of 98 rows, Truckee and South Lake Tahoe among them). Pinned by
> `apps/admin/server/places-guard.test.ts`; don't "simplify" it. ⚠ This defect is on the SOUTH edge and
> does NOT explain the missing east — that remains the name-anchoring diagnosis above.
> ⚠ **The draft COUNT was picker-era sizing too, and moved 30 → 100 (2026-08-03).** §Rationale below
> argues curated-over-autocomplete partly on "a short curated list is mostly *tapping*" and "curating
> ~30 places is trivial" — the CONCLUSION still holds, but that premise is gone: the tap-to-pick form
> was deleted in 1.1 and this set's only consumer is the planner's roster, which Opus reads whole from a
> cached prefix. Thumb-scrolling stopped binding; `MAX_PLAN_ANCHORS` (200) and model attention bind now,
> and every name missing is one more in-persona "don't know that one". The admin panel exposes the count
> (8–120) and the prompt's old "a short list beats an exhaustive directory" line went with it — it would
> have fought any high count. ⚠ The `--max-cost` estimate is no longer a flat constant either: it scales
> with the count and prices through `usageUsd`, because a bound computed from a different quantity than
> the one it bounds is exactly how this repo has under-counted spend before.
>
> ⚠ **The rider-facing half of §Runtime below is GONE: `GET /drives/anchors` was DELETED end to end in
> 1.1** ([drives-first-1-1.md](drives-first-1-1.md) D7 + its removal table), together with the
> tap-to-pick create form this spec was written to feed. Read every mention of that endpoint below as
> HISTORY. The curated set itself got *more* load-bearing, not less: it is now the **planner's
> allowlist** — `loadRegionAnchors` (`apps/api/src/drives.ts`), whose sole caller is the planner, plus a
> handful of NAMES on `GET /regions` (`exampleAnchors`). ⚠ **Do not resurrect the endpoint.**
> `requireAccount` is per-route and the `/drives` mount carries only `withSession`, so a re-added
> `/anchors` would inherit no guard and become an anonymous dump of the whole allowlist **with exact
> coordinates** — the one thing that can bill a Google Routes call.
>
> Design walked through + settled with the founder (2026-06-20): a
> **per-region CURATED set of Google Places** serves a drive's start / end / midpoint AND its
> break/pitstops; the picker offers ONLY that set (Q6 resolved → curated, not open autocomplete).
> Spike-validated (Places API (New) is enabled and returns clean Tahoe hubs — used at *curation* time, not
> runtime). SUPERSEDES the interim corpus-anchor picker (`loadRegionAnchors` over the POI corpus). Pairs
> with `../decisions/create-a-drive-architecture.md` and the `places` / `detours` tables.
>
> **Curate is INTERACTIVE (2026-06-21):** the admin `/places` "Curate" button is a synchronous two-step —
> `POST /admin/places/draft` makes ONE **Opus** call that names the region's hubs + pitstops (a few cents,
> writes nothing), the operator prunes the list in the dialog, then `POST /admin/places/curate` resolves
> only the keepers against Places + upserts them. This replaced the fire-and-forget `curate_places` Cloud
> Run job for the button (whose Preview and Apply were separate invocations, so the draft you reviewed
> wasn't the draft that got resolved). The `curate-places` studio CLI still exists for terminal/batch use
> (now also Opus-default).
>
> **Go-sequence — EXECUTED for Lake Tahoe; keep it as the recipe for the NEXT region:** open admin
> `/places` → **Curate** → Draft (Opus) → prune → Resolve & add (or `curate-places --apply` from the
> terminal) → review/promote → deploy.

## Why

A drive's **endpoints are not its narration content.** POIs (`pois` + `narrations`) are the *story*
layer — what plays *along* the route, deduped by Wikidata QID, often obscure (trailheads, springs).
The places a rider starts/ends at are **hubs**: towns, marinas, scenic lookouts — real-world locations
that mostly aren't POIs. The interim picker read the 459-POI corpus, which was noisy and let endpoints
land off any natural gateway.

**Google Places is the right "real-world location" layer**, and the schema already anticipates it: the
`places` table (`place_id`, `name`, `primary_type`, `lat`, `lng`) exists to anchor break `detours`.
Using it ALSO for endpoints means **one primitive — a Place — for start / end / midpoint AND
pitstops.** POIs/narrations stay the separate story layer (`loadCorpusForRoute` unchanged).

## Decision (Q6): curated, not open autocomplete

The picker is fed by a **per-region curated set** of ~20–40 Google Places, **not** live open-ended
autocomplete. Why curated won (walkthrough, 2026-06-20):

- **Charm over scale** (the doctrine): every option is an intentional, recognizable place; the curator
  guarantees routes between hubs traverse real stories (no empty drives).
- **Zero runtime Google cost + minimal ToS surface**: coords are resolved + stored ONCE at curation, so
  at runtime there is no autocomplete, no Place Details, no session tokens — just a stored list.
- **In-car friendly**: a short curated list is mostly *tapping*, not typing.
- **Less new code**: a stored short list + coords-based `propose` is *exactly* the picker flow already
  shipped — curated = "swap the source + add an offline curation step," vs. open autocomplete's whole
  new runtime (proxy + session tokens + live lookups).
- "Scales to new regions free" (open autocomplete's edge) only matters at M4+; for a one-region Tahoe
  launch, curating ~30 places is trivial.

**Trade accepted:** a rider can't start at an arbitrary address (their exact hotel). It's the long
tail, fine for a charm toy, and reversible — see Deferred.

## Spike validation (2026-06-20)

- **Places API (New) is enabled** on the project (`GOOGLE_MAPS_API_KEY`).
- Region-bounded `places:autocomplete` returns clean hubs: `"tahoe city"` → Tahoe City (`locality`);
  `"emerald bay"` → Emerald Bay State Park, the Lookout (`scenic_spot`); `"coffee"` → Coffeebar
  (`coffee_shop`) = pitstop candidates. → these are exactly the **curation-time** candidate sources.
- Place Details (`GET places/{id}`, field mask `id,location,types` = Essentials SKU) yields coords;
  `place_id` is **exempt from caching limits — storable indefinitely** per the Places policy.

## Curation (offline, one-time per region; paid, founder-gated)

Two surfaces, same primitive:

- **Admin `/places` → Curate (the primary path, INTERACTIVE):** `POST /admin/places/draft` makes ONE
  **Opus** forced-tool call that NAMES the region's hubs + pitstops (a few cents; **writes nothing, makes
  no Places calls**) → the operator prunes the drafted list in the dialog → `POST /admin/places/curate`
  resolves only the keepers via Places (autocomplete + details, bbox-bound) and upserts them. Reviewing
  the *exact* draft that gets resolved is the whole point of splitting the steps.
- **`curate-places` studio CLI (terminal/batch):** safe-by-default (preview unless `--apply`, per the
  ops-scripts SOP); drafts (Opus by default; `--model sonnet` to A/B) → resolves → upserts all in one
  shot. The reviewable middle step is the admin's; the CLI is the headless fallback.

Both: draft → resolve via Places → upsert into `places` (dedup by `place_id`) with a **role** tag
(endpoint-eligible / break-eligible / both); the operator then **reviews / prunes / promotes** in the
admin table. One-time per region, re-runnable to refresh (OR-merges roles). This is the only paid
Google/LLM spend, and it's offline.

## Data

- Reuse **`places`** (`place_id` canonical; `name`, `primary_type`, `lat`, `lng`) + a **role marker**
  (endpoint-eligible / break-eligible) — migration. A curated place belongs to a region by
  **point-in-bbox** (geometry-first; no `region_id` FK), consistent with `pois`.
- `place_id` stored indefinitely; `name`/coords are the stored snapshot (refreshed on re-curation); no
  volatile fields (hours/rating) baked — already CLAUDE.md's break-anchor rule.

## Runtime (mostly already built)

- ⚠ **HISTORY — `GET /drives/anchors?regionId=` no longer exists** (deleted in 1.1 with the picker; see
  the Status line). What it queried survives as `loadRegionAnchors`, server-side only: the curated
  **endpoint-eligible** `places` in the region bbox (REPLACES the POI-corpus query), read by the planner
  rather than served to a client.
- **`POST /drives/propose` / `POST /drives`** take the picked places' coords (**already stored — no
  runtime Google Details, no session tokens**); materialize the route (`[start, ...via, end]`) + count
  stories, exactly as today. Loop mode unchanged (start + midpoint; end = start).
- **Breaks** (deferred) ride the same set: curated break-eligible `places` near the route → `detours`.

## Mobile (largely done)

The FROM / TO / MIDPOINT pickers + search + **featured quick-picks** + loop mode are already built;
they read a stored anchor list and send coords. **Repoint them at the curated `places` endpoint.** The
featured quick-picks become the *popular subset* floated to the top of the (short) curated list; the
rest is searchable inline.

## Cost / ToS

- **Runtime:** zero Google Places calls (coords stored) — only the existing Routes call per
  propose/create.
- **Curation:** one founder-gated paid pass per region (LLM draft + Places resolve), offline.
- **ToS:** `place_id` stored indefinitely (exempt); `name`/coords a refreshable snapshot; no volatile
  baked.

## Supersedes

- The interim corpus-anchor picker (`loadRegionAnchors` over the POI corpus, `GET /drives/anchors`,
  `regionAnchor` DTOs) — repointed to the curated set.
- The open-autocomplete *runtime* (proxy / session tokens / live Details) is **not built** — curated
  needs none. `loadCorpusForRoute` (the story layer) is unchanged.

## Deferred (revisit only if bounded coverage bites)

- **Hybrid open-autocomplete fallthrough** — a "search somewhere else" escape hatch to live Places for
  arbitrary addresses (the full Places runtime in the prior draft of this spec; git history has it).
- **"Start from my current GPS location."**
- **Usage-derived featured picks** (most-picked curated places float up).

## Build steps

1. **Schema:** add a role/curated marker to `places` (migration).
2. **Curation step:** the interactive admin `/places` Curate flow (`POST /admin/places/draft` Opus draft →
   operator prunes → `POST /admin/places/curate` Places resolve → upsert role-tagged `places`) + the
   `curate-places` studio CLI for terminal/batch. Paid; founder-gated.
3. **Curate Lake Tahoe's set** (founder-gated run) + prune in admin.
4. **API:** repoint `GET /drives/anchors` to curated endpoint-eligible places in-bbox; `propose`/`create`
   read the stored coords (retire the open-autocomplete/Details/session design from the prior draft).
5. **Mobile:** point the picker at the curated endpoint; featured quick-picks = the popular subset.
   (Picker UI already built.)
6. **Verify** (below).

## Verification (the gate)

- Curate Tahoe → admin shows ~20–40 role-tagged places → prune to the good set.
- Create: pick two curated hubs → confirm route → make the drive. Loop: a hub + a midpoint → a real
  round trip.
- Confirm **zero runtime Places calls** (coords come from stored rows; only Routes fires).
- Breaks (later): curated break-eligible places near a route → `detours`.
