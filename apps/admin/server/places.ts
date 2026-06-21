// Google Places (New) resolution for the admin's MANUAL place-add (the /places curation surface).
//
// Mirrors packages/studio/src/pipeline/places.ts `resolveCuratedPlace` (the bulk curate CLI's
// resolver), kept self-contained here so the admin server doesn't pull in the whole @skipper/studio
// graph for one helper — the admin already talks to Google directly (jobs.ts, bbox-lookup). Two calls
// per name: Autocomplete (New), bbox-restricted, for the best place_id, then Place Details
// (id,location,displayName,primaryType) for canonical coords + name + type. ONE-TIME, at curation: the
// resolved row is stored, so the runtime picker makes zero live Places calls. Needs Places API (New)
// enabled on GOOGLE_MAPS_API_KEY (Routes enablement alone is not enough).

import type { BboxCorners } from './bbox'

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete'
const PLACE_DETAILS_URL = 'https://places.googleapis.com/v1/places'
const TIMEOUT_MS = 15_000

/** A resolved, storable curated place — the manual-add payload (no volatile fields). */
export interface ResolvedPlace {
  placeId: string
  name: string
  lat: number
  lng: number
  primaryType?: string
}

async function autocompletePlaceId(input: string, bbox: BboxCorners, apiKey: string): Promise<string | null> {
  const res = await fetch(AUTOCOMPLETE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
    body: JSON.stringify({
      input,
      // Hard-restrict to the region rectangle (a curated set is region-scoped), not just bias.
      locationRestriction: {
        rectangle: {
          low: { latitude: bbox.swLat, longitude: bbox.swLng },
          high: { latitude: bbox.neLat, longitude: bbox.neLng },
        },
      },
      includeQueryPredictions: false,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const json = (await res.json()) as {
    error?: { status: string; message: string }
    suggestions?: { placePrediction?: { placeId?: string } }[]
  }
  if (!res.ok || json.error) {
    const e = json.error
    throw new Error(`Places autocomplete ${res.status}: ${e ? `${e.status} — ${e.message}` : 'unknown error'}`)
  }
  for (const s of json.suggestions ?? []) {
    if (s.placePrediction?.placeId) return s.placePrediction.placeId
  }
  return null
}

async function placeDetails(placeId: string, apiKey: string): Promise<ResolvedPlace | null> {
  const res = await fetch(`${PLACE_DETAILS_URL}/${encodeURIComponent(placeId)}`, {
    method: 'GET',
    headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'id,location,displayName,primaryType' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const json = (await res.json()) as {
    error?: { status: string; message: string }
    id?: string
    location?: { latitude: number; longitude: number }
    displayName?: { text: string }
    primaryType?: string
  }
  if (!res.ok || json.error) {
    const e = json.error
    throw new Error(`Places details ${res.status}: ${e ? `${e.status} — ${e.message}` : 'unknown error'}`)
  }
  if (!json.id || !json.location || !json.displayName?.text) return null
  return {
    placeId: json.id,
    name: json.displayName.text,
    lat: json.location.latitude,
    lng: json.location.longitude,
    primaryType: json.primaryType,
  }
}

/** Resolve a typed place NAME to a storable place within the region bbox, or null if it can't be
 *  pinned in-region (no prediction, missing details, or — a Details-coords guard — the canonical
 *  point lands outside the bbox even though Autocomplete biased toward it). Throws on a Places API
 *  error (the route maps it to 502). */
export async function resolvePlaceInBbox(
  query: string,
  bbox: BboxCorners,
  apiKey: string,
): Promise<ResolvedPlace | null> {
  const placeId = await autocompletePlaceId(query, bbox, apiKey)
  if (!placeId) return null
  const place = await placeDetails(placeId, apiKey)
  if (!place) return null
  const inBbox =
    place.lat >= bbox.swLat && place.lat <= bbox.neLat && place.lng >= bbox.swLng && place.lng <= bbox.neLng
  return inBbox ? place : null
}
