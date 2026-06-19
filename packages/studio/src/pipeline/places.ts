// Break-stop anchors — Google Places API (New) "search along route".
//
// Only Text Search supports searchAlongRouteParameters, and it accepts ONLY the
// encoded polyline string. We request a MINIMAL, non-volatile field mask
// (id, name, location, type) — no hours/rating/price — so nothing volatile is
// ever baked onto a break stop (the invariant). The live spot details are
// fetched fresh at tour-load. includedType is singular, so we fan out one
// request per category and dedup by place id.
//
// Needs Places API (New) enabled on GOOGLE_MAPS_API_KEY (Routes enablement alone
// is not enough). Callers treat failures here as non-fatal — break stops are a
// nicety, not the core bet.
//
// Places API (New) is ENABLED on the project (verified 2026-06-07). If a request ever
// 403s with PERMISSION_DENIED, re-check that enablement first (Routes enablement alone
// is not enough); generate.ts catches the error and skips break stops in the meantime.

import { fetchWithRetry } from './http'

const SEARCH_TEXT_URL = 'https://places.googleapis.com/v1/places:searchText'
/** Per-attempt timeout (ms). Break-anchor search is non-fatal, but a HUNG call never throws —
 *  so generate.ts's try/catch can't skip past it; only a finite timeout can. Small payloads. */
const REQUEST_TIMEOUT_MS = 15_000

// includedType (Table A) + a matching natural-language query, one request each.
const BREAK_CATEGORIES: { textQuery: string; includedType: string }[] = [
  { textQuery: 'restaurant', includedType: 'restaurant' },
  { textQuery: 'coffee', includedType: 'cafe' },
  { textQuery: 'gas station', includedType: 'gas_station' },
  { textQuery: 'rest area', includedType: 'rest_stop' },
]

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
  const json = (await res.json()) as {
    error?: { code: number; status: string; message: string }
    places?: PlaceResult[]
  }
  if (!res.ok || json.error) {
    const e = json.error
    throw new Error(
      `Places searchText ${res.status}: ${e ? `${e.status} — ${e.message}` : 'unknown error'}`,
    )
  }
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
