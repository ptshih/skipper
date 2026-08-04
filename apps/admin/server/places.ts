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
  /** Google's full type list. NOT persisted (`places` stores only `primary_type`) — it exists to be
   *  read once at curation by `isAddressLike`, which is the only thing that can tell a town from a
   *  street. See that function for why `primaryType` cannot do this job. */
  types?: string[]
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
    // ⚠ `types` (PLURAL) is what tells an address apart from a place; `primaryType` cannot — it is null
    // for every locality, so a town and a residential street look identical through it (measured: 31 of
    // 98 curated rows have a null primaryType, Truckee and South Lake Tahoe among them). Google bills
    // `types` in the Essentials tier and `primaryType` in Pro, so adding it to a mask that already asks
    // for primaryType costs nothing. See isAddressLike.
    headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'id,location,displayName,primaryType,types' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const json = (await res.json()) as {
    error?: { status: string; message: string }
    id?: string
    location?: { latitude: number; longitude: number }
    displayName?: { text: string }
    primaryType?: string
    types?: string[]
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
 * `locationRestriction` rectangle and takes the FIRST prediction, with nothing checking that the result
 * resembles the query. So when the draft model names a place just OUTSIDE the box, Autocomplete cannot
 * return it and instead returns the nearest in-box name-alike — which is routinely a residential street.
 * Details then confirms it IS in the box, so every existing check passes and it lands in `places` as a
 * curated endpoint. Measured on the first bbox-scoped run (2026-08-03): Hope Valley (38.75, below the
 * box) became "Hope Court" in Truckee and Carson Pass (38.69) became "Carson Court" — both stored
 * ENDPOINT-eligible, meaning the planner could offer a rider a drive to a cul-de-sac. That is worse than
 * the drafts that fail to pin at all, because those are reported and these were not.
 *
 * ⚠ TEST ON `types`, NEVER ON `primaryType` — the obvious-looking "reject a null primaryType" rule is
 * WRONG and would gut the set: Google returns no primaryType for a locality, so Truckee, Tahoe City,
 * South Lake Tahoe, Incline Village, Kings Beach, Stateline and Glenbrook would all be rejected. A town
 * carries `types: ['locality', 'political']`; a street carries `route` / `street_address`.
 */
export function isAddressLike(types: string[] | undefined): boolean {
  return (types ?? []).some((t) => ADDRESS_TYPES.has(t))
}

/** Types whose whole identity is "somewhere you leave the car" rather than somewhere you go.
 *  ⚠ VERIFIED against the live API, 2026-08-04 — `California Main Lodge Parking` came back as
 *  `["parking_lot","parking","transportation_service","service","point_of_interest","establishment"]`.
 *  The two parking types are the precise ones; the rest of that list is shared with real destinations
 *  (`Heavenly Mountain Scenic Gondola` is `["tourist_attraction","point_of_interest","establishment"]`)
 *  and matching on them would gut the set. */
const PARKING_TYPES = new Set(['parking_lot', 'parking', 'parking_garage'])

/**
 * True when a resolve came back as a CAR PARK rather than the place it serves.
 *
 * ⚠ WHY A SECOND GUARD RATHER THAN A BETTER PROMPT — no draft can prevent this, because the draft was
 * RIGHT. Asked for `Heavenly Mountain Resort` (a legitimate, top-ranked destination), the bbox-restricted
 * Autocomplete returns `California Main Lodge Parking`: the resort's own parking structure. Details then
 * confirms it is in the box and it lands as a curated endpoint at rank 2, so the planner would offer a
 * rider a drive that ENDS in a ski resort's parking garage. Same shape as `isAddressLike` — a silent
 * wrong answer, not a failed one — and the same fix: check what came back, not what was asked for.
 *
 * ⚠ It also poisoned the routability sweep, because a rank-2 row is a probe ORIGIN: every route measured
 * FROM the car park read "restricted usage or private roads", so the sweep flagged South Lake Tahoe and
 * Stateline as undrivable and proposed an access point 25 km from Downtown.
 *
 * ⚠ Mirrored in the sibling copy (apps/admin/server/places.ts / packages/studio/src/pipeline/places.ts)
 * — the two must move together, like the draft prompt and the resolver they sit beside.
 */
export function isParkingLike(types: string[] | undefined): boolean {
  return (types ?? []).some((t) => PARKING_TYPES.has(t))
}

/** Types whose purpose is a TRANSACTION or a TRANSFER rather than a visit.
 *  ⚠ TWO FAMILIES, ONE IDEA, and the idea is what keeps this list from growing into a shredder: a place
 *  you go to in order to DO BUSINESS (a contractor, an agency, a bank) and a place you go to in order to
 *  LEAVE (a bus stop, a transit platform). Neither is somewhere a rider asks to be driven for its own
 *  sake, which is the only question this set answers.
 *  ⚠ WHAT IS DELIBERATELY ABSENT MATTERS MORE THAN WHAT IS HERE. `lodging`, `hotel`, `resort_hotel`,
 *  `inn`, restaurants, museums, campgrounds and golf courses are all EXCLUDED on purpose — Camp
 *  Richardson, Edgewood Tahoe and Sunnyside Restaurant & Lodge are real, top-of-mind Tahoe destinations,
 *  and a rule broad enough to catch a motel would take them with it. The two junk rows those families
 *  contain (`Paradise Tahoe`, `The Y`) are an OPERATOR's prune, not a guard's call. Every type added here
 *  must be one that could never, under any phrasing, be a place someone wants to drive to. */
const BUSINESS_TYPES = new Set([
  // Trades + professional services. Observed live: `Sierra Rainbow Painting Inc` [painter] landed as a
  // curated destination at rank 10 in the 2026-08-04 deep run — a painting contractor in the planner's
  // allowlist, offerable to a rider as somewhere to drive.
  'painter', 'plumber', 'electrician', 'roofing_contractor', 'general_contractor', 'moving_company',
  'storage', 'real_estate_agency', 'insurance_agency', 'lawyer', 'accounting', 'dentist', 'doctor',
  'veterinary_care', 'coworking_space', 'corporate_office',
  // Vehicle + money errands.
  'car_repair', 'car_dealer', 'car_wash', 'bank', 'atm',
  // Transit — but ONLY the unambiguous kind. Same shape as isParkingLike: somewhere you get OUT of the
  // car, not somewhere you arrive. Observed live: `The Y`, a real South Lake Tahoe junction, resolved to
  // its bus stop.
  // ⚠ `transit_station` and `train_station` are DELIBERATELY EXCLUDED. places-guard.test.ts already
  // treats a transit fixture as an ordinary admissible establishment, and it is right to: a depot can be
  // the landmark itself (Truckee's is). Catching `bus_stop` is enough for the observed failure, because
  // Google tags a stop with both — so the narrow type does the work without taking depots with it.
  'bus_stop', 'taxi_stand',
])

/**
 * True when a resolve came back as a BUSINESS or a transit stop rather than a destination.
 *
 * ⚠ THE THIRD GUARD OF THE SAME SHAPE, and it exists because the first deep draft made the failure
 * visible at scale. `isAddressLike` catches a street, `isParkingLike` catches a car park; both are cases
 * where the draft was RIGHT and the resolve substituted. This one catches a different cause: a draft that
 * was WRONG, or right about a name that a local business also happens to carry. Drafting deeper means
 * reaching further down the model's confidence, and the tail is where "Serene Lakes" (a real place) comes
 * back as "Serene Lakes Realty".
 *
 * ⚠ PRUNING WITHOUT THIS IS TEMPORARY. Deleting the rows fixes today's allowlist and the next
 * `curate-places` run puts them straight back, which is why the prune and this guard belong together.
 *
 * ⚠ Mirrored in the sibling copy (apps/admin/server/places.ts / packages/studio/src/pipeline/places.ts)
 * — the two must move together, like the draft prompt and the resolver they sit beside.
 */
export function isBusinessLike(types: string[] | undefined): boolean {
  return (types ?? []).some((t) => BUSINESS_TYPES.has(t))
}

/** Words that carry no identity — dropped before comparing a drafted name to what came back. Kept
 *  deliberately SHORT: every word removed here is one fewer chance for two names to agree, and an
 *  over-eager list turns this guard into a shredder. */
const NAME_NOISE = new Set(['the', 'and', 'of', 'at', 'in', 'on', 'a', 'an', 'california', 'nevada', 'ca', 'nv', 'usa', 'united', 'states', 'site'])

const nameTokens = (s: string): Set<string> =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((t) => t.length > 2 && !NAME_NOISE.has(t)),
  )

/**
 * True when what Google returned bears NO relation to what was asked for.
 *
 * ⚠ THE GENERAL CASE THE TYPE GUARDS ONLY COVER CORNERS OF. `isAddressLike` catches a street and
 * `isParkingLike` catches a car park, but both are lists of shapes we happened to get burned by. The
 * underlying defect is broader and has now shipped FIVE times: `Reno` came back as **"Downtown"** and
 * was stored under that name, so the planner held Reno in its roster under a word no rider would ever
 * say. `Heavenly Mountain Resort` came back as `California Main Lodge Parking`. Neither shares a single
 * meaningful word with what was asked for, and no type list would have caught the first.
 *
 * ⚠ A KNOWN AND ACCEPTED FALSE POSITIVE: a legitimate RENAME. `Squaw Valley` resolves to
 * `Palisades Tahoe` — correct, the resort was renamed in 2021 — and this guard drops it, because the
 * two names genuinely share nothing. That is the honest cost. It is dropped LOUDLY with both names in
 * the skip line, so an operator can add it back through the manual route, which is the same trade the
 * address guard already makes.
 *
 * ⚠ Compared on TOKENS, not on substring or edit distance. `Truckee, California` → `Truckee` and
 * `Echo Summit` → `Site of Echo Summit (California Historical Landmark No. 1048)` must both survive:
 * one is a subset, the other a superset, and neither is close by any string metric.
 *
 * ⚠ Mirrored in the sibling copy (apps/admin/server/places.ts / packages/studio/src/pipeline/places.ts)
 * — the two must move together, like the draft prompt and the resolver they sit beside.
 */
export function nameDisagrees(drafted: string, resolved: string): boolean {
  const a = nameTokens(drafted)
  const b = nameTokens(resolved)
  // ⚠ Fails OPEN when either side has nothing comparable left. A name made entirely of noise words is
  // not evidence of a substitution, and refusing it would drop rows for having short names.
  if (a.size === 0 || b.size === 0) return false
  for (const t of a) if (b.has(t)) return false
  return true
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
  rank: number
  rationale?: string
}

const DRAFT_TOOL: Anthropic.Tool = {
  name: 'draft_curated_places',
  description:
    'Return the curated set of real, recognizable DESTINATIONS for this region — places a drive can start at or finish at.',
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
            rank: {
              type: 'integer',
              description:
                'How likely a visitor is to NAME this place out loud, 1 being the most. Ties are fine. A low rank is not a criticism — it means real, but less asked-for.',
            },
            rationale: { type: 'string', description: 'One short phrase on why this place earns a spot.' },
          },
          required: ['name', 'query', 'rank'],
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
 * ⚠ THE NAME ANCHORS HARDER THAN IT LOOKS — MEASURED, not theorised. The first bbox-scoped run
 * (2026-08-03, target 100 → 103 drafted, 93 written) reached NORTH into the Donner corridor (Truckee,
 * Donner Lake, Soda Springs, Norden, Sugar Bowl) but NOT EAST: no survivor landed past lng -119.90,
 * so Reno (-119.81), Carson City (-119.77) and Virginia City (-119.65) were all still missed — the
 * exact towns holding the orphaned fused tellings. Stating the bounds was not enough while the opening
 * line still read "a driving audio tour of ${regionName}": Truckee reads as Tahoe, Reno reads as
 * somewhere else. Hence the current shape — the region name is NEVER the subject of the tour, it
 * appears once, explicitly labelled a NICKNAME, after the box has already been given as the area.
 * If you reintroduce the name as the tour's subject, expect the east side to empty out again.
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
  return `You are curating the set of real-world PLACES a rider can pick to start, end, or break a self-guided driving audio tour, narrated by a charming Jungle-Cruise-style skipper.

== The area you are curating ==

The tour area is a BOX on the map: southwest corner ${bbox.swLat}, ${bbox.swLng} to northeast corner ${bbox.neLat}, ${bbox.neLng} (decimal degrees). The box is the area — all of it, and nothing beyond it.

Riders call this area "${regionName}". That is a NICKNAME, not a boundary. A box this size routinely covers ground nobody would file under that name: a neighboring city, the next valley over, a mountain pass, another state line. Those places are in scope exactly as much as the ones the nickname obviously covers, and they are the ones most often left out. Work the WHOLE box, corner to corner — if your list only contains what the nickname brings to mind, you have missed most of the area.

A place just OUTSIDE the box is the one thing that cannot be used at all, so never spend a slot on one. Check each name against the four corners above before you include it: a town south of the southern edge, or west of the western edge, is a wasted slot however good it is. If you cannot place somewhere on the map with confidence, leave it out and name something you can — a near-miss is worse than an omission here.

⚠ WORK THE BOX CORNER BY CORNER, AND NAME THE CITIES AND TOWNS IN EACH ONE FIRST. A box this size usually spans more than one state, and the settlements on the far side are the ones that get missed — not because they are marginal, but because they are not what the nickname brings to mind. A state capital, a county seat, an old mining town or a small city inside these corners belongs on this list ahead of any lake or lookout. If your finished list has no towns from some corner of the box, you have not worked that corner: go back and name them.

== What to draft ==

Draft roughly ${targetN} places. Every one is somewhere a driver could START a drive or FINISH one. There is no other category here -- no pitstops, no coffee stops, no gas stations, no rest areas.

TWO tests, and a place needs BOTH.

FIRST: would somebody actually SAY it? "Let's drive from ___ to ___." Towns, villages and cities count -- a city's downtown, a historic district or a main street is a destination exactly as much as a lake is -- and so do the famous beaches, state-park gateways, marinas, ski resorts, mountain passes and lookouts a visitor names by heart. If the box holds a city, a county seat or an old mining town, it belongs here. This is not about whether a place is scenic or outdoorsy; it is about whether its name is on a visitor's lips.

SECOND: can a car actually stop there, with the drive over? This rules out the famous things you reach on foot or by boat, however recognizable -- an island, a summit with no road, a mansion a mile down a trail, a beach you scramble down to. A mountain PASS, or a summit the ROAD ITSELF crosses, is the opposite case and belongs here: the highway goes over the top and you can pull over. Name the place a car arrives AT -- the town, the park, the marina, the pass -- never the thing you walk to from it.

== Ranking ==

Rank every place by how likely a visitor is to name it out loud, 1 being the most. The first handful should be what anyone who has been here would say without thinking. Ties are fine. A low rank is not a criticism -- it means real, but less asked-for.

Optimize for CHARM: every place intentional, recognizable, a real place a visitor would actually name -- never a gazetteer of everything with a signpost. Length is not the virtue here. Never pad to reach the number: if the box honestly holds fewer good ones, return fewer.

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
  // ⚠ STREAMED, and the reason is `max_tokens`, not progress reporting — nothing consumes the deltas.
  // A NON-streaming request cannot safely ask for much more than ~16k output tokens: the SDK's own HTTP
  // timeout is what bites, not the model, so the old ceiling here was an artifact of HOW the call was
  // made rather than anything about drafting places. Streaming lifts that, so the ceiling below is now
  // the model's to give.
  // ⚠ WHAT STREAMING DOES NOT BUY IS TIME. The model is no cheaper and no faster; the bytes merely
  // arrive incrementally. The explicit 90s client timeout above is still the real bound on this route,
  // and MAX_DRAFT_TARGET is still pinned by that clock — see the note beside it.
  // ⚠ Keep the explicit timeout. The TS SDK silently scales its DEFAULT timeout up (to as much as an
  // hour) for a large `max_tokens`; an unset timeout plus the ceiling below would park a request far
  // past the point anyone is waiting for it, billing to completion with nobody to answer.
  const stream = client.messages.stream({
    model: opts.model,
    // Headroom, deliberately generous: the largest draft the route's clamp allows is 120 places (each a
    // name + Places query + rationale), which fit inside the old 16k. A ceiling is not a charge — only
    // tokens actually emitted are billed — so the cost of headroom is zero, while too little truncates
    // the list and burns the whole call. Opus tops out far above this; 64k is simply well clear.
    max_tokens: 64_000,
    system: draftSystem(regionName, bbox, opts.targetN),
    tools: [DRAFT_TOOL],
    tool_choice: { type: 'tool', name: DRAFT_TOOL.name },
    messages: [{ role: 'user', content: `Draft the curated places for ${regionName}.` }],
  })
  // The assembled Message — same shape the non-streaming call returned, so every check below is
  // unchanged. (`finalMessage()` also surfaces stream errors, so there is no separate error path.)
  const res = await stream.finalMessage()
  // ⚠ CHECK THIS BEFORE READING THE TOOL BLOCK. The entire candidate list is ONE tool call, so a
  // max_tokens stop leaves a half-written JSON list that the SDK still surfaces as a `tool_use` block —
  // HTTP 200, no error, and a SHORTER list than asked for, which is indistinguishable from the model
  // simply being selective. The operator would then prune and PAY to resolve a truncated set believing
  // it was the whole draft. Surfaces as the route's 502 with this message.
  if (res.stop_reason === 'max_tokens') {
    throw new Error(
      `the draft was TRUNCATED at max_tokens (asked for ~${opts.targetN} places) — the list is incomplete, ` +
        `so nothing here is safe to resolve. Re-run the draft; if it truncates again, MAX_DRAFT_TARGET is too ` +
        `high for this region and has to come down in code (there is no longer a count to lower from the console).`,
    )
  }
  const toolUse = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!toolUse) throw new Error('the draft model returned no tool call')
  const out = toolUse.input as { places?: PlaceDraft[] }
  return (out.places ?? []).filter((p) => p && p.name && p.query && typeof p.rank === 'number')
}
