# Google Places for drive endpoints (and pitstops) — Build Spec

> **Status:** build-ready spec (2026-06-20), UNBUILT. Design walked through + settled with the founder
> (2026-06-20) — see Decisions below; one fork stays open (curated set vs. open autocomplete) to settle
> before building. Validated by a live spike: Places API (New) is enabled on the project, and
> region-bounded autocomplete returns clean Tahoe hubs + pitstops. This
> SUPERSEDES the interim corpus-anchor picker (`loadRegionAnchors` / `GET /drives/anchors` /
> `regionAnchor` DTOs, shipped 2026-06-20 in `feat: pick drive endpoints from real anchors` +
> `loop mode`) — that step proved the picker UX + grounding and is retired when this lands. Pairs with
> `../decisions/create-a-drive-architecture.md` (the create flow) and the `places` / `detours` tables.

## Why

A drive's **endpoints are not its narration content.** POIs (`pois` + `narrations`) are the *story*
layer — what plays *along* the route, deduped by Wikidata QID, often obscure (trailheads, springs).
The places a rider actually starts/ends are **hubs**: towns, marinas, scenic lookouts, the Tahoe City
"Y" — real-world locations that mostly aren't (and shouldn't be) POIs. Conflating them (the interim
picker read the 459-POI corpus) made a noisy list and let endpoints land off any natural gateway.

**Google Places is the right "real-world location" layer**, and the schema already anticipates it: the
`places` table (`place_id` canonical identity, `name`, `primary_type`, `lat`, `lng`) exists today to
anchor break `detours`. Using it ALSO for endpoints means **one primitive — a Place — for start / end
/ midpoint AND pitstops.** Breaks need Places regardless (a coffee/gas/viewpoint stop *is* a Place,
fetched fresh), so this build is dual-purpose, not throwaway. POIs/narrations stay the separate story
layer (`loadCorpusForRoute` unchanged).

## Validated by spike (2026-06-20)

- **Enabled.** `POST https://places.googleapis.com/v1/places:autocomplete` with the project's
  `GOOGLE_MAPS_API_KEY` returns live results (no "API not enabled" error).
- **Region-bound, clean results.** `locationRestriction.rectangle` = the region bbox →
  `"tahoe city"` → Tahoe City (`locality`), Tahoe City Marina; `"kings beach"` → Kings Beach
  (`locality`); `"emerald bay"` → Emerald Bay State Park, the Lookout (`scenic_spot`).
- **Pitstops, same call.** `"coffee"` → Coffeebar (`coffee_shop`, `cafe`) — break candidates from the
  identical endpoint + response shape.
- **Shapes.** Autocomplete returns `suggestions[].placePrediction { placeId, structuredFormat.mainText
  (name), secondaryText, types }` — but **no coordinates.** Place Details (New)
  `GET places/{placeId}` with `X-Goog-FieldMask` returns `location` (**Essentials** SKU);
  `displayName`/`primaryType` are **Pro**. → fetch `id,location,types` (Essentials, cheap) for coords;
  take the name from autocomplete's `mainText`.
- **Session tokens** group the autocomplete keystrokes + the one Details call into a single billable
  session.
- **ToS** (`places/web-service/policies`): the **place ID is exempt from caching limits — store it
  indefinitely**; other fields fall under the limited caching exception. This is exactly CLAUDE.md's
  break-anchor rule already: store `place_id` + a minimal non-volatile name/coords snapshot, bake no
  volatile data (hours/rating), refresh fresh at use.

## Approach — server-owned Places

The mobile client never calls Google directly. The API proxies, holding the key, the session token,
and ToS-compliant persistence.

### API

- **`GET /drives/autocomplete?q=&regionId=&sessionToken=`** (account-gated, rate-limited): bbox-bound
  `places:autocomplete` for the region → `{ predictions: [{ placeId, primary, secondary, types }] }`.
  Optionally bias endpoints toward hub types via `includedPrimaryTypes`.
- **`POST /drives/propose` / `POST /drives`** take place references, not raw coords:
  `{ start: { placeId }, end: { placeId }, via: [{ placeId }], sessionToken, idempotencyKey? }`. The
  server resolves each `placeId` → Place Details (`id,location,types`) → coords, **upserts the
  `places` row** (dedup by `place_id`) with the minimal snapshot, then materializes the route
  (`[start, ...via, end]`, unchanged). The `sessionToken` closes the billing session on the Details
  calls. Coords are server-authoritative (ToS-clean: the server fetches; the proposal echoes the
  resolved endpoints for the confirm screen, as today).
- Everything downstream (route, `buildDrive` selection, manifest, credit consume) is unchanged.

### Data

- Reuse **`places`** (`place_id` canonical; `name`, `primary_type`, `lat`, `lng`). place_id stored
  indefinitely; name/coords are the minimal snapshot. A drive freezes its endpoint coords in the route
  provenance it already stores; whether to also FK the `places` rows is an open question (below).
- Breaks (deferred) ride the same rails: autocomplete by category near the route → `places` →
  `detours`.

### Mobile

- The FROM / TO / MIDPOINT pickers become **debounced autocomplete searches** (one `sessionToken` per
  search, regenerated on selection): type → `GET /drives/autocomplete` → tap a prediction → hold
  `{ placeId, name }`. propose sends the placeIds + the session token. Loop mode is unchanged (start +
  midpoint placeIds; end = start).
- **Featured quick-picks:** above the search, ~5 hand-picked hubs per region as tap-to-pick shortcuts
  (in-car-friendly; less typing), with open search as the fallthrough. (Later: usage-derived from the
  most-picked `places`.)

### Billing / cost

One create-a-drive search ≈ **one Autocomplete session** (keystrokes + 1 Details), priced at the
**Essentials** SKU because we request only `location,types`. Bounded by session tokens + a client
debounce + a rate-limited proxy. (vs. the interim list, which was free at runtime — accepted: Places
is dual-purpose and the per-search cost is normal maps-app traffic.)

## Supersedes

- `loadRegionAnchors`, `GET /drives/anchors`, and the `regionAnchor` / `regionAnchorList` DTOs (the
  interim corpus-anchor picker). Retire once autocomplete lands. `loadCorpusForRoute` (the narration
  corpus, the story layer) is **unchanged**.

## Decisions (settled in the 2026-06-20 walkthrough)

1. **Server-owned Places** — the app never calls Google directly; the API proxies (key + session token
   + persistence server-side). [Approach.]
2. **Resolve-at-propose** — Place Details (placeId → coords) runs once in `propose`, closing the billing
   session; `create` reuses the proposal's coords (no second lookup). [Approach.]
3. **Save endpoints as `places` rows** (upsert by `place_id`; place_id stored indefinitely + a minimal
   name/coords snapshot) AND freeze the coords in the drive's route provenance. Endpoints + breaks share
   the one `places` table.
4. **Endpoint search stays wide open** — no `includedPrimaryTypes` filter; Google already ranks the
   obvious hub first. Breaks LATER filter toward amenity types (coffee/gas/viewpoint).
5. **Keep the region bbox** as the search bound (Reno/Truckee fringe is acceptable; the no-stories guard
   catches dead routes). Breaks search near the route, not the region.
6. **Featured quick-picks** — ~5 hand-picked hubs per region as tap-to-pick shortcuts (in-car-friendly),
   open search as the fallthrough. (Later: usage-derived.)
7. **Off-content routes: block-and-nudge** — the existing "no stories along that route" confirm guard
   stands (no credit spent); a "suggest a better route" nicety is deferred.

## Still open — revisit before build

- **Curated set vs. open autocomplete (founder, 2026-06-20).** Instead of live open-ended autocomplete,
  PRE-CURATE a set of popular places per region — ones that serve as good START / END / MIDPOINT *and*
  BREAK/PITSTOP anchors — store them, and constrain the picker to ONLY those. This would collapse much
  of the above: endpoints become pre-stored `places` rows (already decided in #3), no live search to
  type-bias or bbox-bound (#4/#5 moot), the curated set IS the featured list (#6 becomes the whole
  list), and there's **no runtime autocomplete cost at all**. Trade-off: per-region curation effort +
  bounded coverage (a rider can't pick an arbitrary address) vs. zero-curation + infinite coverage.
  Middle path (and the natural bridge): the featured quick-picks in #6 ARE a small curated set —
  open-autocomplete ships with curation already half-present, and going full-curated just means growing
  that set and dropping the open fallthrough. **DECISION DEFERRED** — settle before building the picker.

## Build steps

1. **Places client** (`@skipper/places`, mirroring `@skipper/routing`): `autocomplete(input, bbox,
   sessionToken, includedPrimaryTypes?)` + `placeDetails(placeId, sessionToken)` →
   `{ placeId, name, lat, lng, primaryType? }`. Request shapes per the spike above.
2. **API:** `GET /drives/autocomplete` proxy (gated + rate-limited, mirroring the propose limiter).
3. **shared:** propose/create request DTOs → `{ placeId }` refs + `sessionToken` (keep
   `resolvedEndpoint` for the resolved coords the proposal echoes back).
4. **API:** propose/create resolve placeIds → Details → upsert `places` → materialize route.
5. **mobile:** debounced autocomplete picker (replaces the static list) + session-token handling.
6. **Retire** `GET /drives/anchors` + `loadRegionAnchors` + the anchor DTOs; flip the
   `create-a-drive-architecture.md` addendum.
7. **Verify** (below).

## Verification (the gate)

- A real create: search `"tahoe city"` → `"emerald bay"` → confirm route → make the drive; confirm one
  `places` upsert per endpoint, and one billing session per search (session token threaded).
- Loop: `"tahoe city"` + midpoint `"emerald bay"` → a real round trip (not zero-distance).
- Cost: confirm only Essentials fields (`id,location,types`) are requested in Details.
- ToS: only `place_id` is stored long-term as the durable key; name/coords are a refreshable snapshot;
  no volatile fields baked.
