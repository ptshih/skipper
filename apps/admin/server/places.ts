// Google Places (New) resolution for the admin's MANUAL place-add (the /places curation surface).
//
// Mirrors packages/studio/src/pipeline/places.ts `resolveCuratedPlace` (the bulk curate CLI's
// resolver), kept self-contained here so the admin server doesn't pull in the whole @skipper/studio
// graph for one helper — the admin already talks to Google directly (jobs.ts, bbox-lookup). Two calls
// per name: Autocomplete (New), bbox-restricted, for the best place_id, then Place Details
// (id,location,displayName,primaryType) for canonical coords + name + type. ONE-TIME, at curation: the
// resolved row is stored, so the runtime picker makes zero live Places calls. Needs Places API (New)
// enabled on GOOGLE_MAPS_API_KEY (Routes enablement alone is not enough).

import Anthropic from '@anthropic-ai/sdk'
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

/* -------------------------------------------------------------------------- */
/*  Curate DRAFT — the cheap, reviewable LLM step (no Places calls, no writes)   */
/* -------------------------------------------------------------------------- */
// The /places "Curate" button drafts the region's curated set in TWO steps so the operator reviews the
// LLM's picks BEFORE paying to resolve them: (1) this draft call — one forced-tool Anthropic call that
// NAMES recognizable places (a few cents, writes nothing); the operator prunes the list; then (2) the
// curate-resolve route resolves only the keepers against Google Places + upserts. This mirrors
// packages/studio/src/curate-places.ts (DRAFT_TOOL + the system prompt are kept textually identical) —
// duplicated, not imported, so the admin server doesn't pull in the whole @skipper/studio graph (same
// reason resolvePlaceInBbox above mirrors that CLI's resolver). Keep the two in sync when either moves.

/** One LLM-drafted candidate place — a name + a precise Places search query + its role + featured flag.
 *  The model NAMES places it knows; Google Places is what RESOLVES them to coords (never the model). */
export interface PlaceDraft {
  name: string
  query: string
  role: 'endpoint' | 'break' | 'both'
  featured: boolean
  rationale?: string
}

const DRAFT_TOOL: Anthropic.Tool = {
  name: 'draft_curated_places',
  description:
    'Return the curated set of real, recognizable places for this region: drive START/END/MIDPOINT hubs and good break pitstops.',
  input_schema: {
    type: 'object',
    properties: {
      places: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The place name a rider would recognize (e.g. "Tahoe City").' },
            query: {
              type: 'string',
              description:
                'A precise Google Places search string that uniquely pins THIS place — include the locality/state when the bare name is ambiguous (e.g. "Emerald Bay State Park, California").',
            },
            role: {
              type: 'string',
              enum: ['endpoint', 'break', 'both'],
              description:
                'endpoint = a place a rider would START or END a drive at (town, marina, scenic lookout, trailhead gateway). break = a pitstop along the way (coffee, gas, rest area, viewpoint pull-off). both = a hub that is also a natural pitstop.',
            },
            featured: {
              type: 'boolean',
              description: 'true for the handful of most iconic, popular start points — floated to the top of the picker.',
            },
            rationale: { type: 'string', description: 'One short phrase on why this place earns a spot.' },
          },
          required: ['name', 'query', 'role', 'featured'],
        },
      },
    },
    required: ['places'],
  },
}

/**
 * The draft prompt.
 *
 * ⚠ SCOPE IS THE BBOX, NEVER THE DISPLAY NAME — that is why this takes a `BboxCorners` at all.
 * It used to read "Stay strictly inside ${regionName}", and a model told "strictly inside Lake Tahoe"
 * correctly excludes Truckee, Reno, Carson City and Virginia City: none of them are in the Tahoe Basin.
 * But the lake-tahoe bbox reaches every one of them, `discover-pois` swept them, and 28 released fused
 * tellings sat out there with no curated endpoint a rider could name to drive to one — finished audio
 * nobody could route to. The name is prose and is routinely NARROWER than the geometry; a region IS a
 * bbox (geometry-first regions), so the bounds do the scoping and the name is demoted to flavour.
 *
 * ⚠ The "never a latitude or longitude" clause is load-bearing now that coordinates appear in this
 * prompt at all. The model's job is still to NAME places; `resolvePlaceInBbox` is what turns a name
 * into a canonical pin, and a drafted coordinate would route around that resolve entirely.
 *
 * ⚠ DUPLICATED ON PURPOSE: packages/studio/src/curate-places.ts carries a byte-identical copy — this
 * server deliberately does not pull in the @skipper/studio graph (see this file's header). The two must
 * move TOGETHER — there is no shared home for it, since @skipper/shared and @skipper/engine both ship
 * into the mobile bundle and this is operator-only prose.
 */
function draftSystem(regionName: string, bbox: BboxCorners, targetN: number): string {
  return `You are curating the set of real-world PLACES a rider can pick to start, end, or break a self-guided driving audio tour of ${regionName}, narrated by a charming Jungle-Cruise-style skipper.

Optimize for CHARM, not coverage: every place must be intentional, recognizable, and a real place a visitor would actually name. A short list of beloved hubs beats an exhaustive directory.

Draft roughly ${targetN} places:
- ENDPOINT hubs (most of the list): towns and villages, marinas and boat launches, famous scenic lookouts and state-park gateways, major trailheads — the kind of place someone says "let's drive from ___ to ___".
- BREAK pitstops (a handful): well-known coffee spots, gas stations at natural stopping points, rest areas, and viewpoint pull-offs along the main routes.
- Mark role="both" for a hub that is also a natural pitstop.
- Mark featured=true for ONLY the few most iconic, popular start points (think 4–8).

Stay inside this region's BOUNDS — southwest corner ${bbox.swLat}, ${bbox.swLng} to northeast corner ${bbox.neLat}, ${bbox.neLng} (decimal degrees). The BOUNDS are the region. "${regionName}" is only what riders call this area, and that name is usually narrower than the box: include every recognizable town, hub and lookout inside those corners, including ones a visitor would file under a neighboring name. If it is in the box, it is in scope.

For each place give a precise Google Places \`query\` that uniquely identifies it (add the town/state when the name alone is ambiguous), so it resolves to the right pin. Do NOT invent coordinates — name the place, never a latitude or longitude; resolution happens separately.`
}

/** Draft a region's curated candidates with one forced-tool Anthropic call. Spends a few cents and
 *  writes nothing — the reviewable preview. Throws on a missing key / no tool call (the route maps it
 *  to 502). `model` is the caller's choice (the admin defaults to Opus, the house judgment tier). */
export async function draftCuratedPlaces(
  regionName: string,
  bbox: BboxCorners,
  opts: { targetN: number; model: string },
): Promise<PlaceDraft[]> {
  // ⚠ EXPLICIT TIMEOUT + LOW maxRetries, and this is a rule, not a preference. A bare `new Anthropic()`
  // takes the SDK defaults — verified in the installed 0.112.1 client: `DEFAULT_TIMEOUT = 600000`
  // (10 minutes) and `maxRetries ?? 2`. That is up to THREE Opus turns and thirty minutes behind one
  // operator click, inside a service whose own request budget is 300s — so two of those turns would
  // bill after the browser has already been 504'd, with nobody to deliver the answer to. CLAUDE.md says
  // it directly for a model call in a request path: "Low maxRetries (0-1) + an explicit timeout inside
  // the Cloud Run budget — do NOT copy studio's maxRetries: 5, tuned for a batch run that already spent."
  // 90s x 2 attempts stays inside this server's 240s idleTimeout as well as Cloud Run's 300s.
  const client = new Anthropic({ maxRetries: 1, timeout: 90_000 })
  const res = await client.messages.create({
    model: opts.model,
    max_tokens: 4_000,
    system: draftSystem(regionName, bbox, opts.targetN),
    tools: [DRAFT_TOOL],
    tool_choice: { type: 'tool', name: DRAFT_TOOL.name },
    messages: [{ role: 'user', content: `Draft the curated places for ${regionName}.` }],
  })
  const toolUse = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!toolUse) throw new Error('the draft model returned no tool call')
  const out = toolUse.input as { places?: PlaceDraft[] }
  return (out.places ?? []).filter((p) => p && p.name && p.query && p.role)
}
