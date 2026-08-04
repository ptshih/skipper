// Break-stop anchors — Google Places API (New) "search along route".
//
// DEFERRED-FEATURE FEED — DO NOT delete as "dead": searchBreakStops (+ its BreakAnchor /
// BREAK_CATEGORIES / searchOneCategory helpers) and the spokenKind deriver have NO caller
// today because break audio (the `detours` table) is stubbed and nothing writes it yet
// (CLAUDE.md break-audio deferral). This is the planned feed for when detours un-defers.
// The CURATION half (resolveCuratedPlace / CuratedPlace / PlacesBbox / autocompletePlaceId /
// placeDetails) IS live via curate-places.ts.
//
// Only Text Search supports searchAlongRouteParameters, and it accepts ONLY the
// encoded polyline string. We request a MINIMAL, non-volatile field mask
// (id, name, location, type) — no hours/rating/price — so nothing volatile is
// ever baked onto a break stop (the invariant). The live spot details are
// fetched fresh at drive-load. includedType is singular, so we fan out one
// request per category and dedup by place id.
//
// Needs Places API (New) enabled on GOOGLE_MAPS_API_KEY (Routes enablement alone
// is not enough). Callers treat failures here as non-fatal — break stops are a
// nicety, not the core bet.
//
// Places API (New) is ENABLED on the project (verified 2026-06-07). If a request ever
// 403s with PERMISSION_DENIED, re-check that enablement first (Routes enablement alone
// is not enough).

import { fetchWithRetry } from './http'

const SEARCH_TEXT_URL = 'https://places.googleapis.com/v1/places:searchText'
const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete'
const PLACE_DETAILS_URL = 'https://places.googleapis.com/v1/places'
/** Per-attempt timeout (ms). Break-anchor search is a deferred feed with no caller yet (see header),
 *  but a HUNG call never throws — so a future caller's try/catch couldn't skip past it; only a finite
 *  timeout can. Small payloads. */
const REQUEST_TIMEOUT_MS = 15_000

// includedType (Table A) + a matching natural-language query, one request each.
const BREAK_CATEGORIES: { textQuery: string; includedType: string }[] = [
  { textQuery: 'restaurant', includedType: 'restaurant' },
  { textQuery: 'coffee', includedType: 'cafe' },
  { textQuery: 'gas station', includedType: 'gas_station' },
  { textQuery: 'rest area', includedType: 'rest_stop' },
]

/**
 * Read a Places response body, keeping the HTTP STATUS on every failure path.
 *
 * These helpers used to `await res.json()` BEFORE checking `res.ok` — and fetchWithRetry hands back
 * the final 5xx Response rather than throwing, while Google's edge answers gateway failures with
 * HTML. So a Places outage surfaced as `SyntaxError: Unexpected token '<'`, the `!res.ok` branch that
 * would have named the status never ran, and an operator reading a PAID `curate-places --apply` log
 * (the Anthropic draft call is already billed by the time we get here) could not tell a transient 503
 * from a disabled Places API or a bad key. Text-first + a guarded JSON.parse keeps the status.
 * (Same shape, same reason as `wiki<T>()` in wikipedia.ts.)
 */
async function placesJson<T extends { error?: { status: string; message: string } }>(
  endpoint: string,
  res: Response,
): Promise<T> {
  const body = await res.text()
  let json: T
  try {
    json = JSON.parse(body) as T
  } catch {
    throw new Error(`Places ${endpoint} HTTP ${res.status} (non-JSON body): ${body.slice(0, 160)}`)
  }
  // A literal `null`/scalar body parses fine; guard the shape before reading `.error` so a
  // misbehaving proxy surfaces as a clear message, not a raw TypeError outside the catch.
  if (json === null || typeof json !== 'object') {
    throw new Error(`Places ${endpoint} HTTP ${res.status} (non-object body): ${body.slice(0, 160)}`)
  }
  if (!res.ok || json.error) {
    const e = json.error
    throw new Error(
      `Places ${endpoint} ${res.status}: ${e ? `${e.status} — ${e.message}` : 'unknown error'}`,
    )
  }
  return json
}

interface PlaceResult {
  id: string
  displayName?: { text: string; languageCode?: string }
  location?: { latitude: number; longitude: number }
  primaryType?: string
  types?: string[]
}

/** A stable break-stop anchor — no volatile data. */
export interface BreakAnchor {
  placeId: string
  name: string
  lat: number
  lng: number
  primaryType?: string
}

async function searchOneCategory(
  encodedPolyline: string,
  textQuery: string,
  includedType: string,
  apiKey: string,
): Promise<PlaceResult[]> {
  const res = await fetchWithRetry(
    SEARCH_TEXT_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        // Minimal non-volatile anchor fields (bills at Text Search Pro SKU).
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.location,places.primaryType,places.types',
      },
      body: JSON.stringify({
        textQuery,
        includedType,
        pageSize: 10, // 1–20; maxResultCount is deprecated
        searchAlongRouteParameters: { polyline: { encodedPolyline } },
      }),
    },
    { timeoutMs: REQUEST_TIMEOUT_MS },
  )
  const json = await placesJson<{
    error?: { code: number; status: string; message: string }
    places?: PlaceResult[]
  }>('searchText', res)
  return json.places ?? []
}

/** Find food/rest/gas anchors along the encoded route, merged + deduped by place id. */
export async function searchBreakStops(
  encodedPolyline: string,
  apiKey: string,
): Promise<BreakAnchor[]> {
  const byId = new Map<string, BreakAnchor>()
  for (const cat of BREAK_CATEGORIES) {
    let places: PlaceResult[]
    try {
      places = await searchOneCategory(encodedPolyline, cat.textQuery, cat.includedType, apiKey)
    } catch (e) {
      // Per-category isolation: one category 500ing past its retries must not discard the
      // anchors already collected from the categories that succeeded — break stops are a
      // nicety, and partial results beat zero.
      console.warn(
        `Places searchText "${cat.includedType}" failed (${(e as Error).message}) — skipping that category.`,
      )
      continue
    }
    for (const p of places) {
      if (byId.has(p.id) || !p.location || !p.displayName?.text) continue
      byId.set(p.id, {
        placeId: p.id,
        name: p.displayName.text,
        lat: p.location.latitude,
        lng: p.location.longitude,
        primaryType: p.primaryType,
      })
    }
  }
  return [...byId.values()]
}

/* -------------------------------------------------------------------------- */
/*  Curation-time resolution — name → a stored, coord-bearing curated Place      */
/* -------------------------------------------------------------------------- */
//
// The `curate-places` studio step resolves an LLM-drafted place NAME into a canonical Google
// Place ONCE, offline, and stores the result (place_id + name + coords + primaryType). At runtime
// the picker reads those stored rows with ZERO Places calls — so this whole module is curation-only.
// Two calls per name: Autocomplete (New) bbox-restricted → the best place_id, then Place Details
// (id,location,displayName,primaryType field mask) → canonical coords + name + type. The spike
// (2026-06-20) validated both against the Tahoe bbox.

/** A region bounding box as Places rectangle corners (the studio RegionBbox shape, kept local so
 *  this pure-HTTP module stays decoupled from the db-backed region resolver). */
export interface PlacesBbox {
  swLng: number
  swLat: number
  neLng: number
  neLat: number
}

/** A resolved, storable curated place — the `curate-places` upsert payload (no volatile fields). */
export interface CuratedPlace {
  placeId: string
  name: string
  lat: number
  lng: number
  primaryType?: string
  /** Google's full type list. NOT persisted (`places` stores only `primary_type`) — it exists to be
   *  read once at curation by `isAddressLike`, the only thing that can tell a town from a street. */
  types?: string[]
}

/** Best place_id for a query, restricted to the region bbox (so "tahoe city" can't resolve to a
 *  Tahoe City elsewhere). Returns null when Autocomplete yields no prediction. */
async function autocompletePlaceId(input: string, bbox: PlacesBbox, apiKey: string): Promise<string | null> {
  const res = await fetchWithRetry(
    AUTOCOMPLETE_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
      body: JSON.stringify({
        input,
        // Hard-restrict to the region rectangle (not just bias) — a curated set is region-scoped.
        locationRestriction: {
          rectangle: {
            low: { latitude: bbox.swLat, longitude: bbox.swLng },
            high: { latitude: bbox.neLat, longitude: bbox.neLng },
          },
        },
        includeQueryPredictions: false,
      }),
    },
    { timeoutMs: REQUEST_TIMEOUT_MS },
  )
  const json = await placesJson<{
    error?: { status: string; message: string }
    suggestions?: { placePrediction?: { placeId?: string } }[]
  }>('autocomplete', res)
  for (const s of json.suggestions ?? []) {
    if (s.placePrediction?.placeId) return s.placePrediction.placeId
  }
  return null
}

/** Canonical coords + name + primaryType for a place_id (Essentials/Pro field mask; `place_id` is
 *  storable indefinitely per the Places policy). Returns null if Details omits a location. */
async function placeDetails(placeId: string, apiKey: string): Promise<CuratedPlace | null> {
  const res = await fetchWithRetry(
    `${PLACE_DETAILS_URL}/${encodeURIComponent(placeId)}`,
    {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        // ⚠ `types` (PLURAL) is what tells an address apart from a place; `primaryType` cannot — it is
        // null for every locality, so a town and a residential street look identical through it. Google
        // bills `types` in the Essentials tier and `primaryType` in Pro, so adding it to a mask that
        // already asks for primaryType costs nothing. See isAddressLike.
        'X-Goog-FieldMask': 'id,location,displayName,primaryType,types',
      },
    },
    { timeoutMs: REQUEST_TIMEOUT_MS },
  )
  const json = await placesJson<{
    error?: { status: string; message: string }
    id?: string
    location?: { latitude: number; longitude: number }
    displayName?: { text: string }
    primaryType?: string
    types?: string[]
  }>('details', res)
  if (!json.id || !json.location || !json.displayName?.text) return null
  return {
    placeId: json.id,
    name: json.displayName.text,
    lat: json.location.latitude,
    lng: json.location.longitude,
    primaryType: json.primaryType,
    types: json.types,
  }
}

/** Google's address-component types — a resolve that comes back as one of these is a STREET, not a place.
 *  Exact strings from the Places "address types and address component types" table. */
const ADDRESS_TYPES = new Set(['street_address', 'route', 'premise', 'subpremise', 'intersection', 'plus_code', 'postal_code'])

/**
 * True when a resolve is an ADDRESS rather than somewhere a rider could be sent.
 *
 * ⚠ WHY THIS EXISTS — a silent wrong answer, not a failed one. `autocompletePlaceId` sends a HARD
 * bbox restriction and takes the FIRST prediction, with nothing checking that the result resembles the
 * query. So when the draft model names a place just OUTSIDE the box, Autocomplete cannot return it and
 * instead returns the nearest in-box name-alike — routinely a residential street. Details then confirms
 * it IS in the box, so every existing check passes and it lands in `places` as a curated endpoint.
 * Measured on the first bbox-scoped run (2026-08-03): Hope Valley (38.75, below the box) became "Hope
 * Court" in Truckee and Carson Pass (38.69) became "Carson Court" — both stored ENDPOINT-eligible,
 * meaning the planner could offer a rider a drive to a cul-de-sac. Worse than a draft that fails to pin,
 * because that one is reported and this one was not.
 *
 * ⚠ TEST ON `types`, NEVER ON `primaryType` — the obvious-looking "reject a null primaryType" rule is
 * WRONG and would gut the set: Google returns no primaryType for a locality, so Truckee, Tahoe City,
 * South Lake Tahoe, Incline Village, Kings Beach, Stateline and Glenbrook would all be rejected. A town
 * carries `types: ['locality', 'political']`; a street carries `route` / `street_address`.
 *
 * ⚠ Mirrored in apps/admin/server/places.ts (that server does not depend on @skipper/studio) — the two
 * must move together, like the draft prompt and the resolver they sit beside.
 */
export function isAddressLike(types: string[] | undefined): boolean {
  return (types ?? []).some((t) => ADDRESS_TYPES.has(t))
}

/** Resolve an LLM-drafted place NAME to a stored CuratedPlace within the region bbox, or null if it
 *  can't be pinned in-region (no prediction, missing details, or — a Details-coords guard — the
 *  canonical point lands OUTSIDE the bbox even though Autocomplete biased toward it). Non-fatal:
 *  the caller logs + drops an unresolved draft. */
export async function resolveCuratedPlace(
  query: string,
  bbox: PlacesBbox,
  apiKey: string,
): Promise<CuratedPlace | null> {
  const placeId = await autocompletePlaceId(query, bbox, apiKey)
  if (!placeId) return null
  const place = await placeDetails(placeId, apiKey)
  if (!place) return null
  const inBbox =
    place.lat >= bbox.swLat && place.lat <= bbox.neLat && place.lng >= bbox.swLng && place.lng <= bbox.neLng
  return inBbox ? place : null
}

/**
 * Normalize a raw Google `primaryType` into a SAFE, plainly-spoken category for break
 * narration. `includedType` filters which places RETURN, not their `primaryType`, so a
 * `restaurant` search can hand back `seafood_restaurant` / `fine_dining_restaurant` —
 * which encode the menu + tier, the exact things a break clip may NOT assert — or a
 * snake_case / non-eatery enum (`point_of_interest`, `rv_park`, `liquor_store`) that
 * reads poorly through TTS and baits an invented friendlier category. Collapse cuisine/
 * tier to a neutral kind; return null for anything we can't safely generalize (the
 * Skipper then just names the spot, no kind).
 */
export function spokenKind(primaryType?: string | null): string | null {
  if (!primaryType) return null
  const t = primaryType.toLowerCase()
  if (t === 'cafe' || t === 'coffee_shop' || t === 'bakery') return 'café'
  if (t === 'gas_station') return 'gas station'
  if (t === 'rest_stop' || t === 'rest_area' || t === 'parking') return 'rest stop'
  if (
    t === 'restaurant' ||
    t.endsWith('_restaurant') ||
    t === 'diner' ||
    t === 'meal_takeaway' ||
    t === 'meal_delivery' ||
    t === 'food'
  )
    return 'restaurant'
  return null // bar/pub, lodging, point_of_interest, rv_park, liquor_store, … → no spoken kind
}
