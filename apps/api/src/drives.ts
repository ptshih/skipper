// Create-a-Drive — a user-owned, on-demand A→B drive assembled from REUSED shared narrations.
//
//   POST /drives/propose          -> ANONYMOUS. Preview the route for a planned A→B + ONE taste clip
//                                    (cheap; no persist, no credit, no account)
//   POST /drives                  -> generate + persist the confirmed drive (requireAccount; spends a credit)
//   GET  /drives                  -> the caller's saved drives (requireAccount; one card each)
//   GET  /drives/:id              -> replay a saved drive's frozen manifest (requireAccount; content resolves LIVE)
//   POST /drives/:id/assets/sign  -> re-presigned clip URLs (requireAccount; offline refresh), keyed by seq
//   DELETE /drives/:id            -> soft-delete (requireAccount); CAP-NEUTRAL — a spent credit is never refunded
//
// ⚠ THE WALL IS PER-ROUTE, NOT ON THE MOUNT (D15/INV-15). `POST /propose` is the OPEN ANONYMOUS FRONT
// DOOR — it is the whole preview: the route a rider planned in conversation, its stop count, and ONE
// presigned clip drawn from that route's own release-filtered selection. Everything else in this module
// is owner-scoped and carries `requireAccount` on its own chain. Re-mounting the gate on
// `driveRoutes.use('*', …)` silently re-walls the preview and reads like an auth bug, not a routing one.
//
// A drive is "the region's tellings, pre-ordered for your route": the planner emits curated anchor IDS;
// the route is Google's (materializeRoute) and the SELECTION is deterministic (engine buildDrive over
// the shared narration corpus). Nothing here synthesizes audio — it picks + paces existing clips. The
// drive's STRUCTURE freezes into `drives.selection`; each narration's CONTENT resolves live via its
// subject, so a regenerated telling auto-improves a saved drive. Ownership lives on `drives.user_id`
// (a drive is user-owned, never shared content).

import { Hono, type Context } from 'hono'
import { and, asc, between, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { creditEntries, drives, narrations, places, pois, selectionSubject } from '@skipper/db/schema'
import type { DriveSelection, DriveSelectionItem, Polyline, RouteProvenance } from '@skipper/db/schema'
import { polylineBbox } from './drive-geometry'
import { materializeRoute, type Waypoint } from '@skipper/routing'
import {
  buildCandidatePlacer,
  buildDrive,
  candidateTriggerRadiusM,
  DRIVE_MIN_GAP_SEC,
  driveMaxStops,
  LOOP_MAX_RETRACE,
  OFF_ROUTE_MAX_M,
  retraceFraction,
  type DriveCandidate,
  type DriveStop,
  type LngLat,
  parseRegionBbox,
} from '@skipper/engine'
import { CLUSTER_VARIETY_KEY, loadClusterTellings, notSupersededByServedCluster, type ClusterTelling } from './clusters'
import {
  createDriveRequest,
  driveProposeRequest,
  type DriveClip,
  type DriveClipForm,
  type DriveList,
  type DriveManifest,
  type DrivePreviewClip,
  type DriveProposal,
  type SignedDriveAudio,
  isAdmin,
  varietyKey,
  type RegionAnchor,
} from '@skipper/shared'
import { ACCOUNT_REQUIRED, requireAccount, withFreshSession, withSession, type ApiEnv } from './entitlements'
import { creditSummary, driveConsumeEntry, ensureFreeGrant } from './credits'
import { SUPPORT_EMAIL } from './email'
import { DRIVE_CREATE_RATE, MAX_DRIVE_BODY_BYTES, MAX_PLAN_ANCHORS, readBoundedText } from './limits'
import { rateLimit } from './rate-limit'
import { withRetry } from './retry'
import { audioUnavailable, contentTypeForKey, presignGet } from './storage'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Where a rider who runs out of free drives is sent — the SAME const ./email puts in `reply_to`, not a
// second read of the same env var (it was exactly that until 2026-08-04). One home matters here
// because the two readers are halves of one conversation: this address is offered to a rider at the
// wall, and ./email is what makes a reply to it land somewhere a human reads.
// ⚠ Since 2026-07-31 it is the only route past the free-drive wall, so an unmonitored inbox turns a
// friendly top-up into a dead end.

// Drive credits live in the user-owned `credit_entries` LEDGER (see ./credits + the decision doc), NOT
// a count of drive rows. Every account is granted `FREE_DRIVE_CAP` credits once — but that amount is
// FROZEN into the grant row, so user-facing numbers read `granted` from the ledger, never the env
// constant (which only describes what the NEXT account will get). Each generated drive
// CONSUMES one (atomically, co-committed with the drive insert); a delete never refunds (no reverse is
// emitted). There is no uncapped tier — a comp is a large admin grant. Beyond the free allotment, a
// one-time credit pack is the planned unlock (Apple IAP / Google Play fast-follow).

// Drive pacing (DRIVE_MIN_GAP_SEC / driveMaxStops) is single-sourced in @skipper/engine so the
// API's selection matches the engine's.

/* --------------------------------- helpers -------------------------------- */

/** A clip's wire form. `narrations.form` is the wider storage enum; this narrows it to what a DRIVE
 *  can actually play, coercing anything else to `story` so a manifest always validates.
 *
 *  ⚠ `wave` came off `driveClipForm` in the 1.1 sweep and therefore off this switch. It was a
 *  free-roam passing call-out and roam is gone, so no drive can contain one — and the live corpus is
 *  458 rows, every one of them `story`. It still exists in the STORAGE enum (`narrationForm`, paired
 *  byte-for-byte with the pg type by `lint:enums`), so a stray row coerces to `story` here rather than
 *  failing to validate. That is the INV-7 direction: a form this build cannot render must degrade to
 *  something playable, never silently produce a clip the player has no treatment for. */
function toClipForm(form: string): DriveClipForm {
  switch (form) {
    case 'scenic':
    case 'break':
      return form
    default:
      return 'story' // story, plus the never-expected wave/bside
  }
}

/** A region's CURATED set of endpoint-eligible `places` (real, recognizable Google hubs — towns,
 *  marinas, lookouts — curated offline by `curate-places`), with coords RESOLVED + STORED at curation,
 *  so an endpoint is grounded by construction: no runtime Places call, no geocode hop. Region
 *  membership is point-in-bbox (geometry-first; `places` carries no region_id). `kind` is the humanized
 *  Google `primary_type`; `rank` floats the draft's most-asked-for subset to the top.
 *  (SUPERSEDES the interim POI-corpus join — see docs/designs/places-endpoints-spec.md.)
 *
 *  ⚠ THIS SET IS SERVER-SIDE ONLY. It IS the planner's allowlist (`plan-route.ts` is now the sole
 *  caller) and every row carries the anchor ID + exact coordinates — the one thing that can bill a
 *  Google Routes call (INV-1). The client-facing `GET /drives/anchors` that used to serve it verbatim
 *  was DELETED in 1.1 along with the tap-to-pick create form: the rider now names endpoints in
 *  CONVERSATION and the planner emits ids. Do not resurrect it: `requireAccount` IS a PER-ROUTE guard
 *  (the five owner routes below) and the mount carries only `withSession`, so a re-added `/anchors`
 *  would inherit NOTHING and become an anonymous dump of the whole curated allowlist WITH coordinates.
 *  What a rider may see is NAMES, and only a handful (see ./example-anchors). */
export async function loadRegionAnchors(bbox: string | null): Promise<RegionAnchor[]> {
  // ⚠ ONE parser, in @skipper/engine (1.1 sweep). There were four of these, agreeing only by luck —
  // and since a region IS a bbox and never a stored FK, two readers disagreeing about this one string
  // silently move places between regions. `between` below is inclusive, matching `pointInRegionBbox`.
  const box = parseRegionBbox(bbox)
  if (!box) return []
  const { swLng: lngMin, swLat: latMin, neLng: lngMax, neLat: latMax } = box
  const rows = await withRetry(
    () =>
      db
        .select({ id: places.id, name: places.name, lat: places.lat, lng: places.lng, primaryType: places.primaryType, rank: places.rank })
        .from(places)
        // ⚠ NO ROLE FILTER ANY MORE, and its absence IS the allowlist: `places` holds destinations and
        // nothing else since 2026-08-04, so membership is eligibility. INV-1 is unchanged in strength —
        // one fewer predicate to keep true, and pruning is a DELETE rather than a flag that never stuck.
        .where(and(between(places.lat, latMin, latMax), between(places.lng, lngMin, lngMax)))
        // ⚠ ORDER BY IS NOT COSMETIC HERE, AND IT IS NOT ABOUT THE PICKER.
        // From 1.1 this set IS the planner's allowlist, and it rides inside the CACHED system-prompt
        // prefix on EVERY rider turn. Postgres guarantees no row order without an ORDER BY, so an
        // unsorted list can come back permuted between requests — byte-different prefix, cache miss,
        // full-price re-read of the whole prefix, on a call that spends on every request forever.
        // A silent ~10x cost regression with nothing failing. Sort by a stable key.
        // ⚠ RANK LEADS, AND IT IS THE LIMIT BELOW THAT MAKES THAT LOAD-BEARING rather than cosmetic.
        // This ORDER BY has to agree with `byAnchorRank` (./anchor-format), which the planner re-sorts
        // by — because whichever rows this query DROPS are gone before that ranking is ever applied.
        // Ordering by name alone meant the cap kept the 200 alphabetically-first rows, so a top-ranked
        // place whose name sorts late would be deleted from the skipper's world *because of its
        // spelling*, silently inverting the one ranking curation controls. Below the cap this changes
        // nothing observable — the planner re-sorts the same SET either way, so the cached prefix is
        // byte-identical — which is exactly why it went unnoticed.
        // ⚠ NULLS LAST, and that is not a formality: `places.rank` is NULLABLE, so a hand-added row
        // carries no drafted rank and must not displace one the draft actually ranked.
        .orderBy(sql`${places.rank} ASC NULLS LAST`, asc(places.name), asc(places.id))
        // ⚠ And BOUND it. The set grows with every paid `curate-places` run, and an unbounded list
        // in a per-request prompt is an unbounded per-request bill. The cap is a ceiling, not a page
        // size — see MAX_PLAN_ANCHORS, whose "comfortable margin" is gone (26 → 109 in one day).
        // ⚠ CAP + 1, AND THE EXTRA ROW IS THE WHOLE POINT: it is how we learn that truncation happened
        // at all. Fetching exactly the cap makes a truncated region indistinguishable from one that fits
        // — and `buildRosterBlock`'s truncation warning, the only operator signal for this, then becomes
        // UNREACHABLE from production, because it is handed a list already trimmed to the cap. Ask for
        // one more than we will use, report it, and trim. (No silent caps — CLAUDE.md.)
        .limit(MAX_PLAN_ANCHORS + 1),
    { label: 'drive.anchors' },
  )
  if (rows.length > MAX_PLAN_ANCHORS) {
    // ⚠ COUNTS ONLY, NEVER NAMES — this is the same INV-13 discipline as the spend lines below, and a
    // place name here is a rider's destination. Single-line JSON so `evt` is a queryable field: the whole
    // failure this fixes was a condition nothing could count. The count is "at least", because the query
    // stops at cap + 1 rather than counting the region.
    console.warn(
      JSON.stringify({
        severity: 'WARNING',
        evt: 'anchor_roster_truncated',
        cap: MAX_PLAN_ANCHORS,
        at_least: rows.length,
      }),
    )
    rows.length = MAX_PLAN_ANCHORS
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    // Humanize the raw Google primaryType for the picker subtitle (e.g. 'scenic_spot' → 'scenic spot'); null when absent.
    kind: r.primaryType ? r.primaryType.replace(/_/g, ' ') : null,
    rank: r.rank,
  }))
}

/** A resolved endpoint (a picked anchor), as the server produced it. */
interface ResolvedEndpoint {
  name: string
  lat: number
  lng: number
  /** Where a car is actually sent, when this place's own pin is not somewhere a car can go. Null for
   *  almost every anchor. ⚠ READ BY `routeWaypoints` AND BY NOTHING ELSE — see the note there. */
  accessLat: number | null
  accessLng: number | null
}

/**
 * Turn the anchor IDS a request carries into real endpoints — the wire-level enforcement of INV-1.
 *
 * ⚠ THIS MUST RUN BEFORE ANY ROUTES CALL, and it is the only thing standing between an anonymous
 * request and a billed Google Routes call for arbitrary points. Requests used to carry
 * `{name, lat, lng}` straight into `materializeRoute`; an id cannot express an off-list point, and
 * every row is re-checked for `endpoint_eligible` HERE rather than trusted from whenever the client
 * last fetched the anchor list — a place can be de-curated between a rider's picker load and their tap.
 *
 * ⚠ Re-asserts eligibility in the QUERY, not after: a row that exists but is no longer eligible must be
 * indistinguishable from one that never existed, or the 400 becomes an oracle for the curated set.
 *
 * ⚠ Order is the caller's, not the database's. `inArray` returns rows in whatever order Postgres likes,
 * and these are ROUTE WAYPOINTS — reordering them silently produces a different (still billable) drive.
 *
 * Returns null when ANY id is unknown or ineligible; the caller 400s. Deliberately all-or-nothing: a
 * partial resolve would route a rider somewhere they did not ask to go.
 */
async function hydrateAnchors(ids: string[]): Promise<ResolvedEndpoint[] | null> {
  if (ids.length === 0) return []
  const unique = [...new Set(ids)]
  const rows = await withRetry(
    () =>
      db
        .select({
          id: places.id,
          name: places.name,
          lat: places.lat,
          lng: places.lng,
          accessLat: places.accessLat,
          accessLng: places.accessLng,
        })
        .from(places)
        // ⚠ THE WIRE ALLOWLIST (INV-1). It is now "this row exists in `places`" — the role flag it used
        // to also assert went away with the break role, because every row is a destination. A row that
        // was pruned is DELETED, so an unknown id and a de-curated one remain indistinguishable, which
        // is what keeps the 400 from being an oracle for the curated set.
        .where(inArray(places.id, unique)),
    { label: 'drive.hydrateAnchors' },
  )
  const byId = new Map(
    rows.map((r) => [
      r.id,
      { name: r.name, lat: r.lat, lng: r.lng, accessLat: r.accessLat, accessLng: r.accessLng },
    ]),
  )
  const out: ResolvedEndpoint[] = []
  for (const id of ids) {
    const hit = byId.get(id)
    if (!hit) return null // unknown OR de-curated — same answer either way (see above)
    out.push(hit)
  }
  return out
}

/**
 * Resolve a whole route's anchors — start, end, AND every via — in ONE all-or-nothing lookup.
 *
 * ⚠ THIS IS INV-1's ENFORCEMENT POINT, and it is a function rather than a pattern because the pattern
 * is what broke it. `via` was once typed as free coordinates while start/end were being hardened,
 * which satisfied "reject a non-anchor ENDPOINT" exactly while still shipping arbitrary billable
 * midpoints — guarding both ends of a route and leaving the middle open is not a partial guarantee, it
 * is none. Both billed callers used to spell the round trip out by hand ([start, ...via, end], then
 * `hydrated[0]!` / `hydrated[length-1]!` / `.slice(1,-1)`), so the next billed path could copy the
 * index arithmetic and lose the middle again. Here the guarantee is in the SIGNATURE: you cannot get a
 * `start` out of this without every `via` having passed the same allowlist check.
 *
 * Returns null when ANY id is unknown or ineligible; the caller 400s with `NOT_AN_ANCHOR`.
 */
async function resolveRouteAnchors(
  startId: string,
  endId: string,
  viaIds: string[] | undefined,
): Promise<{
  start: ResolvedEndpoint
  end: ResolvedEndpoint
  via: ResolvedEndpoint[]
  /** Total waypoints resolved (`via.length + 2`) — what `logRouteSpend` records as `anchors`. Returned
   *  rather than re-derived at each call site so the spend line cannot drift from what was billed. */
  count: number
} | null> {
  const hydrated = await hydrateAnchors([startId, ...(viaIds ?? []), endId])
  if (!hydrated) return null
  // Non-null by construction: `hydrateAnchors` preserves the caller's order and length, and the input
  // always carries at least the two endpoints.
  return {
    start: hydrated[0]!,
    end: hydrated[hydrated.length - 1]!,
    via: hydrated.slice(1, -1),
    count: hydrated.length,
  }
}

/** The 400 an off-list endpoint gets. ⚠ Says nothing about WHICH id failed or whether it exists —
 *  the response must not become a probe for the curated set. The rider-facing half is the planner's
 *  job (an in-persona "don't know that one"), never a geocode. */
const NOT_AN_ANCHOR = {
  error: 'unknown_anchor',
  message: "I don't know one of those spots. Pick one from the list and I'll plot it.",
} as const

/**
 * Build the ordered Routes waypoints for a drive: [start, ...via, end]. A LOOP is end===start with a
 * single `via` midpoint, so it materializes as a real out-and-back (start==end alone is a degenerate
 * zero-distance route). materializeRoute routes through the middle waypoints as Routes intermediates.
 *
 * ⚠ THIS IS THE ONE PLACE AN ACCESS POINT IS ALLOWED TO WIN, and keeping it that way is the entire
 * design. Google Places pins a FEATURE where the feature is — a lake on its water, a beach on its sand
 * — and Routes then snaps that to whatever it can reach, which for `Spooner Lake` was a gated forest
 * track 52 minutes the wrong way. The access point is the public turn-off a car can actually be sent
 * to; `places.access_lat/lng` holds it, null for almost everything.
 *
 * ⚠ EVERYTHING ELSE KEEPS THE REAL PIN — the map marker, `driveLabel`, `sameSpot`'s loop test,
 * `routeSigOf`, and the coordinates frozen into the saved drive. That split is the point: the rider
 * sees "Baldwin Beach" on the beach while their car is sent to the CA-89 turn-off 900 m short of it.
 * The rejected alternative was to overwrite lat/lng, which routes correctly and then draws a pin named
 * for a beach in the middle of a highway. If you find yourself reaching for `accessLat` anywhere but
 * here, you are rebuilding that. docs/decisions/undrivable-endpoint-anchors.md
 *
 * ⚠ BOTH OR NEITHER. The pair is written atomically at the admin boundary, so a half-set pair should be
 * impossible — but a lone latitude here would mean routing to a point that was never anywhere, so it
 * falls back to the pin rather than trusting half a coordinate.
 */
function routeWaypoints(start: ResolvedEndpoint, end: ResolvedEndpoint, via?: ResolvedEndpoint[]): Waypoint[] {
  return [start, ...(via ?? []), end].map((p) => ({
    label: p.name,
    lat: p.accessLat != null && p.accessLng != null ? p.accessLat : p.lat,
    lng: p.accessLat != null && p.accessLng != null ? p.accessLng : p.lng,
  }))
}

/** "These two endpoints are the same spot" — ~11 m, the tolerance that makes an out-and-back readable as
 *  a LOOP rather than as two distinct places. ONE home for the epsilon: the cost line below and the
 *  0-stop warning further down both key on it, and a loop is the shape most likely to bill a Routes call
 *  and yield nothing, so the two must never disagree about which drives were loops. */
const sameSpot = (a: ResolvedEndpoint, b: ResolvedEndpoint): boolean =>
  Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4

/**
 * A LOOP MUST NOT DRIVE THE SAME ROAD TWICE. The wire half of the no-same-road rule (founder,
 * 2026-08-03) — the planner half is the way-home beat in ./planner-prompt.
 *
 * ⚠ THE PROMPT CANNOT BE THE GUARD, and this is not belt-and-braces. The rider names the way home, but
 * whether that produces a RING is a fact about the road network that nobody in the conversation knows:
 * the model is given no coordinates at all (D9, `buildRosterBlock` in ./planner), and Google is free to
 * route the return leg straight back down the outbound road when that is shorter. So the only place
 * this can be decided is here, on the polyline that came back.
 *
 * WHY IT IS WORTH REFUSING A DRIVE OVER. Measured on the one saved loop: `Stateline → Emerald Bay →
 * Stateline` retraces itself for 94% of its 27 miles, and 17 of its 18 reachable stops snap to the
 * outbound half — `nearestOnRoute` returns ONE along-route position per place, so a road you drive
 * twice is told once and the way home is silent. The drive was never under-selected; it was out of
 * things to say. See docs/decisions/no-same-road-loops.md.
 *
 * ⚠ LOOPS ONLY, DELIBERATELY. A ONE-WAY drive that doubles back is doing so because the rider asked to
 * pass through somewhere on the way ("out to Incline, but go by Emerald Bay first") — that retrace is
 * the rider's own explicit request and refusing it would be overruling them. A loop is different in
 * kind: "bring me back around" is an ask for a ring, and nobody asked to see the same road twice.
 *
 * ⚠ AFTER THE BILL, NECESSARILY. The polyline IS the evidence, so the Routes call is already paid for
 * when this runs — which is exactly why the rejection is logged (`logRouteSpend` carries the fraction)
 * rather than being a silent 422. On the CREATE path it still lands well before the ledger batch, so a
 * refused loop never costs a rider a credit.
 */
function loopShapeOf(start: ResolvedEndpoint, end: ResolvedEndpoint, polyline: LngLat[]): LoopShape {
  const loop = sameSpot(start, end)
  const retrace = retraceFraction(polyline)
  return { loop, retrace, refuse: loop && retrace > LOOP_MAX_RETRACE }
}

/** What both billed paths learn about a materialized route's shape, in ONE pass.
 *
 *  ⚠ ONE EXPRESSION, COUNTED / LOGGED / ACTED ON — the repeated bug class in this codebase is two
 *  copies of "the same" predicate drifting apart (`prune-corpus --restore` counted on one and UPDATEd
 *  on another). `refuse` is the decision, `retrace` is what gets logged, and both come out of the same
 *  call so the cost line can never describe a route the gate judged differently. */
interface LoopShape {
  /** start ≈ end — the rider asked to come back around. */
  loop: boolean
  /** Share of the route driven twice, 0–1. Recorded on the spend line whether or not it refuses. */
  retrace: number
  /** A loop that drives the same road twice. THE decision — never re-derive it from the two above. */
  refuse: boolean
}

/** What a rider hears when Google can find no drivable line between two real, curated places. ⚠ A
 *  const like its three siblings below, and for the same reason they are: BOTH billed paths answer
 *  with it (`/propose` and `POST /`), and a create stricter — or merely differently worded — than the
 *  preview sells a rider a drive and then refuses it at the till. */
const NO_ROUTE = {
  error: 'no_route',
  message: "Couldn't find a drivable route between those points.",
} as const

/** What a rider hears when their loop turns out to be an out-and-back. ⚠ It names the ONE thing they
 *  can change — the way home — because a dead end they cannot route around is a real answer too, and
 *  the planner's own way-home beat is what turns this into the next question. */
const SAME_ROAD_LOOP = {
  error: 'loop_retraces',
  message:
    "That way home puts you back on the road you rode out on. Pick a different way round, or take it straight through.",
} as const

/** What a rider hears when Google's only way to their spot is a gated track. ⚠ It points at the SPOT,
 *  not at the way round, because that is the thing they can actually change — see the ordering note
 *  where this fires. */
const RESTRICTED_ROUTE = {
  error: 'restricted_route',
  message:
    "The only way in there is a gated forest track — not a road I'd send you down. Pick another spot and I'll plot it.",
} as const

/**
 * A drive's title: every waypoint it was routed through, in order — `Stateline → Emerald Bay State
 * Park → Stateline` for a round trip.
 *
 * ⚠ IT TAKES THE WAYPOINTS, NOT THE ENDPOINTS, AND THAT IS THE WHOLE POINT. A round trip is
 * `end === start` with the turnaround as the LAST `via` (see routeWaypoints), so a title built from
 * start+end alone collapses to "Stateline → Stateline" — it drops the one name the rider would
 * recognise their drive by, the one they actually asked for ("down to Emerald Bay and back"), while
 * the map beside it draws the whole loop. Naming the chain also cannot disagree with the route about
 * which places are on it or in what order, because it IS the array materializeRoute froze into
 * `drives.routeProvenance` — which is also what makes an existing row's title recomputable from what
 * is already stored.
 *
 * A degenerate loop (start == end, nothing to turn around at) honestly reads "Stateline → Stateline";
 * that route carries no stops and is rejected before it can be persisted, so no such title is saved.
 * Length is bounded by the wire's `via` cap, so at most a handful of names — long for a drive that
 * really does pass through that many places, and the drives list wraps rather than truncating.
 */
export const driveLabel = (waypoints: readonly Waypoint[]): string =>
  waypoints.map((w) => w.label).join(' → ')

/** The READ-side counterpart: a stored drive's display title, from the frozen `label` or — for rows
 *  written before that column existed — rebuilt from its endpoint names.
 *
 *  ⚠ ONE HOME, because the two readers are the LIST CARD and the REPLAY MANIFEST: the same drive on
 *  two screens, and a rider who sees it named one thing in their list and another when they open it
 *  reads that as two drives. ⚠ The fallback collapses to start→end and CANNOT do better — those old
 *  rows froze no waypoint chain, so the turnaround name `driveLabel` above exists to preserve is not
 *  recoverable for them. That is a property of the data, not a shortcut to tidy up. */
const storedDriveLabel = (d: {
  label: string | null
  startName: string | null
  endName: string | null
}): string => d.label ?? `${d.startName ?? 'Start'} → ${d.endName ?? 'End'}`

/**
 * ONE structured cost line per BILLED Google Routes call — the Routes half of INV-11's spend visibility
 * (the model half is the planner's `[planner]` usage line).
 *
 * ⚠ CALL IT THE INSTANT `materializeRoute` RESOLVES. That resolve IS the bill; everything downstream —
 * the corpus read, the selection, the ledger batch — can throw, and a cost line placed after them would
 * lose exactly the requests that spent money and produced nothing. Until this existed, the ONLY
 * `console.*` on either billed path was the failure branch, so a healthy Routes bill was invisible: no
 * count, no marker, nothing for a Cloud Logging log-based metric or a budget alert to key on. Single-line
 * JSON so `evt` is a queryable field rather than a substring.
 *
 * ⚠ ONE `evt` for BOTH sites, told apart by `path`. Propose and create bill the SAME vendor call, so
 * "how many Routes calls did we buy" must be one counter with a label — not two names an operator has to
 * remember to add together.
 *
 * ⚠ THE ARGUMENT TYPE IS THE PRIVACY GUARD (INV-13). It takes counts, one enum and two magnitudes — no
 * endpoint, no coordinate, no id — so this function is structurally incapable of emitting a place NAME
 * or a WHERE, and a future field can only be added by widening a type someone has to read this comment
 * to touch. Specifically NOT here: anchor names/coords (they are the rider's destination), the request
 * body, and any drive/user id — a drive id sits beside `drives.user_id`, which makes the log joinable to
 * a person, the same leak the client's `sanitizeScreenPath` already had to close. No region field
 * either: a drive stores no region and this file never resolves one (geometry-first — see
 * docs/decisions/geometry-first-regions.md), so "region" here could only be invented from coordinates.
 */
function logRouteSpend(spend: {
  /** Which billed site. A literal from this file, two values. */
  path: 'propose' | 'create'
  /** Waypoints in the billed request (start + via + end). Routes prices per request and the intermediate
   *  count is what selects the SKU, so this IS the cost driver. */
  anchors: number
  /** How many of those were intermediates — the shape signal an operator reads when a bill moves. */
  via: number
  /** start ≈ end (`sameSpot`): the shape most likely to bill and return nothing. */
  loop: boolean
  /** The route's own magnitude. A length and a duration, never a position. */
  meters: number
  seconds: number
  /** Share of the route driven twice, 0–1 (`retraceFraction`). A MAGNITUDE, like meters — a ratio of
   *  a route to itself names no place and cannot be inverted into one. It is here so the no-same-road
   *  gate is countable: a refusal still bills a Routes call, so "how many loops did we pay for and
   *  then refuse" is a real operating question, and this is the only field that can answer it. */
  retrace: number
  /** Google warned the route uses restricted / private / unpaved roads (`hasRestrictedRoads`). Here for
   *  the same reason as `retrace`: the refusal happens AFTER the bill, so this is the only field that
   *  can answer "how many Routes calls did we pay for and then throw away". A BOOLEAN about the route,
   *  naming no place — an operator watching this rise is watching a curated anchor go bad, which is the
   *  signal `audit-endpoint-routability` exists to chase down by name (it can; this line may not). */
  restricted: boolean
}): void {
  console.info(
    JSON.stringify({
      // Same shape as the sibling `plan_spend` line, so ONE alert policy covers both halves of INV-11's
      // spend. Why the field exists at all (Cloud Logging lifts it off a structured stdout payload) is
      // written down once, in ./planner's log-spend helper — don't restate it here.
      severity: 'INFO',
      evt: 'route_spend',
      vendor: 'google-routes-v2',
      path: spend.path,
      anchors: spend.anchors,
      via: spend.via,
      loop: spend.loop,
      // Integers: the float only ever reaches the wire rounded, and a metric filter on a fixed-point
      // number is not worth the noise.
      meters: Math.round(spend.meters),
      seconds: Math.round(spend.seconds),
      // Two decimals: the gate reads in whole percent, and a full float here is noise in a metric.
      retrace: Math.round(spend.retrace * 100) / 100,
      restricted: spend.restricted,
    }),
  )
}

/** Quantize a coordinate to ~110 m for the route signature. */
const qz = (n: number): string => n.toFixed(3)

/** Shape-aware route signature (the demand + future cache-warming key; instrumentation only in v2).
 *  Quantized endpoints + a coarse polyline fingerprint, so two routes that share endpoints but differ
 *  in shape (e.g. a loop vs. a there-and-back) don't collide. No region prefix — a drive stores no
 *  region; its extent IS its bbox/endpoints. */
function routeSigOf(start: ResolvedEndpoint, end: ResolvedEndpoint, polyline: Polyline): string {
  const a = `${qz(start.lat)},${qz(start.lng)}`
  const b = `${qz(end.lat)},${qz(end.lng)}`
  return `${a}->${b}|${polyline.length}`
}

/** A narration corpus row mapped for both candidate selection and manifest assembly. */
interface NarrationRow {
  narrationId: string
  /** The corpus map key, and what a frozen selection item names: `pois.id` for a place telling,
   *  `poi_clusters.id` for a FUSED one. Mirrors the `narrations_subject_xor` CHECK one level up —
   *  a telling is about exactly one subject, so exactly one id identifies it. */
  subjectId: string
  subjectKind: 'poi' | 'cluster'
  /** NULL for a fused telling. ⚠ Do NOT substitute the cluster id here: pointing `poi_id` at one
   *  member of a group was the design that got replaced, precisely because it makes a false statement
   *  every downstream reader inherits (see the `poiClusters` schema comment). */
  poiId: string | null
  form: string
  key: string
  durationMs: number
  attribution: DriveClip['attribution']
  revisedAt: Date | null
  name: string
  kind: string | null
  lat: number
  lng: number
  /** True when lat/lng is a road-snapped speakable anchor (not the raw centroid) — tightens the
   *  trigger floor at manifest time (`triggerRadiusForKind`). Set once in `rowsToCorpus`. */
  anchored: boolean
  /** Coarse variety bucket (@skipper/shared `varietyKey`) — `kind` when it exists, else derived from
   *  the Wikidata types. Keeps the selector from narrating four houses in a row. */
  varietyKey: string | null
  /** An EXPLICIT trigger floor, set only for a fused telling — a cluster has no `kind`, so the radius
   *  vocabulary can't answer and the geometry supplies it (`clusterTrigger`). Undefined for a poi,
   *  which keeps deriving from kind/anchored exactly as before. Read through
   *  `candidateTriggerRadiusM` so selection and the manifest can never disagree. */
  triggerRadiusM?: number
  /** True when this fused telling's group is too spread out for any single point to represent it.
   *  Carried here for ONE reason: `buildDrive` must be able to SEE that, so it can place the group on
   *  its members instead of its centre — a drive's selection is frozen at create, and a wide group
   *  frozen as a mis-placed point is permanent for that rider. ⚠ Dropping it at the mapper below
   *  silently re-admits the group as a capped 600 m point at its off-road centre — which is exactly
   *  what this code path did until 2026-07-30.
   *  ⚠ Keyed on the GEOMETRY, never on the presence of a served hull: the hull was one answer to this
   *  condition and it WENT with roam (see the `area` tombstone in ./clusters), and a branch that keys
   *  on an answer flips the moment that answer is deleted. */
  tooWideForPoint?: boolean
  /** A fused telling's member anchors — what a WIDE group is placed on (buildDrive takes the earliest
   *  one the route can reach). ⚠ Required alongside `tooWideForPoint`: a wide candidate that arrives
   *  without members is REFUSED, so dropping this at the mapper turns downtown Reno silent rather than
   *  mis-placed. Undefined for a poi. */
  memberPoints?: { lat: number; lng: number }[]
}

declare const releaseFiltered: unique symbol
/** A corpus loaded through the RELEASE-FILTERED BUILD path (`loadCorpusForRoute`), nominally distinct
 *  from the plain Map `loadCorpusBySubjectIds` returns.
 *
 *  ⚠ INV-5's whole failure mode is that the two maps are STRUCTURALLY IDENTICAL: swap them under the
 *  anonymous preview and a stranger gets a downloadable URL to UNRELEASED work, with the same response
 *  shape, the same status, the same duration — nothing fails, no test distinguishes them. This brand
 *  makes that swap a COMPILE ERROR. It is ASSERTED EXACTLY ONCE, at the loader that owns the filter;
 *  casting to it anywhere else is the only way to reintroduce the bug. (A branded map stays assignable
 *  to a plain `Map<string, NarrationRow>`, so the owner/replay paths need no change.) */
export type BuildCorpus = Map<string, NarrationRow> & { readonly [releaseFiltered]: true }

/** The shared corpus projection + poi join. BOTH loaders (route-bbox and explicit-poiId) select these
 *  exact columns, so the NarrationRow shape lives in ONE place and can't drift between the two read
 *  paths. A fresh builder per call (the appended single-use `.where()` differs by path). */
const narrationCorpusSelect = () =>
  db
    .select({
      narrationId: narrations.id,
      // `pois.id`, not `narrations.poi_id`: identical under the innerJoin below, but NOT NULL, so a
      // CLUSTER telling (poi_id null — see the narrations schema) can never enter the drive corpus
      // keyed by a null. The join already excludes them; selecting the poi's own id makes the TYPE
      // say so instead of relying on a runtime coincidence.
      poiId: pois.id,
      form: narrations.form,
      key: narrations.audioUrl,
      durationMs: narrations.audioDurationMs,
      attribution: narrations.attribution,
      revisedAt: narrations.updatedAt,
      name: pois.name,
      kind: pois.kind,
      lat: pois.lat,
      lng: pois.lng,
      // Road-snapped trigger anchor (snap-speakable-anchors): when present, NarrationRow.lat/lng carries
      // it instead of the centroid, so a road-adjacent POI places + triggers off the ROAD point (1b
      // step 1). Null for off-road POIs → falls back to the pin, today's behavior.
      speakableLat: pois.speakableLat,
      speakableLng: pois.speakableLng,
      // Wikidata P31 labels — the VARIETY bucket for the built world, where `kind` is null by design.
      wikidataTypes: pois.wikidataTypes,
    })
    .from(narrations)
    .innerJoin(pois, eq(pois.id, narrations.poiId))

/** Map corpus rows to NarrationRow by subjectId (the buildDrive ⇄ narration join key), preferring the
 *  road-snapped anchor over the centroid. Shared by both loaders. */
function rowsToCorpus(rows: Awaited<ReturnType<typeof narrationCorpusSelect>>): Map<string, NarrationRow> {
  const map = new Map<string, NarrationRow>()
  for (const r of rows) {
    map.set(r.poiId, {
      narrationId: r.narrationId,
      subjectId: r.poiId,
      subjectKind: 'poi',
      poiId: r.poiId,
      form: r.form,
      key: r.key,
      durationMs: r.durationMs,
      attribution: (r.attribution ?? undefined) as DriveClip['attribution'],
      revisedAt: r.revisedAt,
      name: r.name,
      kind: r.kind,
      lat: r.speakableLat ?? r.lat,
      lng: r.speakableLng ?? r.lng,
      anchored: r.speakableLat != null && r.speakableLng != null,
      varietyKey: varietyKey(r.kind, r.wikidataTypes),
    })
  }
  return map
}

/** The same mapping for the OTHER subject kind. A fused telling has no `kind` (so no kind-derived
 *  radius) and no single anchor — its geometry is derived from the members it names, in ./clusters —
 *  so it arrives with its trigger point and floor already resolved. */
function clusterRowsToCorpus(rows: ClusterTelling[], into: Map<string, NarrationRow>): Map<string, NarrationRow> {
  for (const r of rows) {
    into.set(r.clusterId, {
      narrationId: r.narrationId,
      subjectId: r.clusterId,
      subjectKind: 'cluster',
      poiId: null,
      form: r.form,
      key: r.key,
      durationMs: r.durationMs,
      attribution: (r.attribution ?? undefined) as DriveClip['attribution'],
      revisedAt: r.revisedAt,
      name: r.name,
      kind: null,
      lat: r.lat,
      lng: r.lng,
      // The derived point is NOT a road-snapped anchor (it can sit off-road by design — see
      // `clusterTrigger`), so this stays false and the explicit radius below does the work instead.
      anchored: false,
      varietyKey: CLUSTER_VARIETY_KEY,
      triggerRadiusM: r.triggerRadiusM,
      // Carried so buildDrive can route it down the MEMBER placement rule — see
      // NarrationRow.tooWideForPoint and the admission loop in @skipper/engine's drive-select. A wide
      // group must not be frozen into a drive as its off-road centre.
      tooWideForPoint: r.tooWideForPoint,
      memberPoints: r.memberPoints,
    })
  }
  return into
}

/** Load every narration whose POI falls within the route's bounding box (padded by the off-route
 *  ceiling) — the candidate set buildDrive snaps + paces. A few hundred rows per region, so a bbox
 *  prefilter beats PostGIS. Keyed by poiId (the buildDrive ⇄ narration join).
 *
 *  Release gate (region-release-gate): by default only RELEASED clips (released_at NOT NULL) are
 *  eligible, so a non-admin's drive can never pick up a staged clip. `includeStaged` (an admin) lifts
 *  the filter. The build-time filter is sufficient — drives are owner-only and release is monotonic, so
 *  a built drive's clips stay valid forever; the drive-load resolve path needs no further filter. */

async function loadCorpusForRoute(
  polyline: Polyline,
  durationSeconds: number,
  includeStaged = false,
): Promise<BuildCorpus> {
  const { minLat, minLng, maxLat, maxLng } = polylineBbox(polyline)
  const midLat = (minLat + maxLat) / 2
  const padM = OFF_ROUTE_MAX_M + 200
  const padLat = padM / 111_320
  const cos = Math.cos((midLat * Math.PI) / 180)
  const padLng = padM / (111_320 * (Math.abs(cos) > 1e-6 ? Math.abs(cos) : 1e-6))

  // ⚠ Fused tellings FIRST — which ones we serve is what decides which members to suppress (see
  // notSupersededByServedCluster).
  // ⚠ Loads EVERY fused telling, including the ones too wide for a point. The refusal lives ONE level
  // down, in buildDrive's second admission rule, which knows the route geometry. Withholding here too
  // would double-gate — and worse, it would suppress those groups' MEMBERS with nothing replacing
  // them (see notSupersededByServedCluster). One rule, in the place that can judge it.
  const clusters = await withRetry(
    () => loadClusterTellings({ includeStaged }),
    { label: 'drive.clusterCorpus' },
  )

  // …and SERVED is not the same question as REACHABLE. `notSupersededByServedCluster` retires a
  // cluster's members the moment the fused telling clears the release gate, but whether that clip can
  // actually PLAY on THIS route is geometry, and when the two disagreed the drive lost both. Measured
  // 2026-08-03 on the Stateline→Stateline loop: "Emerald Bay and Vikingsholm" was refused for range
  // (centre 605 m off Highway 89, past its own 516 m floor) while Vikingsholm's own released 81 s clip
  // — 175 m off route — stayed retired behind it, inside a 17:56 silence on the drive that passes
  // Emerald Bay. The docstring's own argument extends exactly one step: a caller who is being withheld
  // a telling must not also lose its members, and neither must a ROUTE that cannot reach one.
  //
  // ⚠ Asked through `buildCandidatePlacer` — the SAME expression buildDrive admits on, not a second
  // copy of the reach test. Two copies is how this broke in the first place; a placer that says "no"
  // here and "yes" there would suppress members for a clip that then gets dropped anyway.
  const place = buildCandidatePlacer(polyline, durationSeconds)
  const clusterRows = clusterRowsToCorpus(clusters, new Map())
  const reachableClusterIds = clusters
    .filter((c) => place(candidateOf(clusterRows.get(c.clusterId)!)) !== null)
    .map((c) => c.clusterId)

  const rows = await withRetry(
    () =>
      narrationCorpusSelect().where(
        and(
          between(pois.lat, minLat - padLat, maxLat + padLat),
          between(pois.lng, minLng - padLng, maxLng + padLng),
          includeStaged ? undefined : isNotNull(narrations.releasedAt),
          // Legibility gate: a poi carrying an `excluded_reason` exists but cannot be TOLD as a stop
          // (today: numbered highways, whose coordinate is an arbitrary point on a line you're on for
          // twenty minutes). Filtered at BUILD only — see loadCorpusByPoiIds for why the replay path
          // deliberately does not. `prune-corpus.ts` sets it; the reason string says which rule fired.
          isNull(pois.excludedReason),
          // A clustered member stops being a drive candidate once its cluster has a fused telling
          // this caller can see AND this route can reach (spec §4.2 + the reachability note above).
          // BUILD path only — `loadCorpusBySubjectIds` deliberately does not re-adjudicate a frozen
          // drive's stops, exactly as with `excluded_reason`.
          notSupersededByServedCluster(reachableClusterIds),
        ),
      ),
    { label: 'drive.corpus' },
  )
  // ⚠ THE ONE PLACE THE BRAND IS ASSERTED — this function is what applies the release filter (the
  // `isNotNull(narrations.releasedAt)` above and the same predicate inside loadClusterTellings), so it
  // is the only function entitled to claim it. See BuildCorpus.
  return clusterRowsToCorpus(clusters, rowsToCorpus(rows)) as BuildCorpus
}

const candidateOf = (r: NarrationRow): DriveCandidate => ({
  poiId: r.subjectId,
  audioKey: r.key,
  audioDurationMs: r.durationMs,
  lat: r.lat,
  lng: r.lng,
  kind: r.kind,
  name: r.name,
  // Load-bearing for selection, not cosmetic: an anchored stop triggers off the TIGHT 250 m floor, so
  // buildDrive needs it to know how close the car must actually get before this stop can play.
  anchored: r.anchored,
  varietyKey: r.varietyKey,
  // Only a cluster sets this; a poi leaves it undefined and keeps deriving from kind/anchored.
  ...(r.triggerRadiusM != null ? { triggerRadiusM: r.triggerRadiusM } : {}),
  // A SCENIC telling is a GLANCE — a ~20 s call-out naming a place you are passing, not a stop. It is
  // selected in buildDrive's separate fill pass over the quiet BETWEEN stops, because it cannot win a
  // pacing window against a telling: `better()` ranks on clip length, and measured on the live corpus,
  // 30 eligible scenic candidates added to a real drive selected ZERO of them.
  // ⚠ Derived from the FORM rather than carried as a second field — the form is what the generator
  // wrote and what `toClipForm` serves, so a glance cannot disagree with what the rider is told it is.
  ...(r.form === 'scenic' ? { glance: true } : {}),
  // Set only for a group too wide for a point. buildDrive places these on the earliest MEMBER the
  // route reaches rather than snapping the enclosing-circle centre — see the second admission rule.
  // ⚠ The two travel TOGETHER: the flag without the points is a refusal (fail-closed), so a mapper
  // that carries one and drops the other silences the group instead of mis-placing it. Both are
  // spread here from the same row for that reason.
  ...(r.tooWideForPoint ? { tooWideForPoint: true } : {}),
  ...(r.memberPoints ? { memberPoints: r.memberPoints.map((p) => [p.lng, p.lat] as LngLat) } : {}),
})

/** Resolve a frozen `selection` into presigned, playable driveClips (narration content LIVE via the
 *  corpus). Throws if presigning fails (the caller maps it to 503). Every selection item is a place
 *  narration in v2 (asides — the placeless framing — were deleted; see geometry-first-regions.md). */
function manifestClips(selection: DriveSelection, corpusById: Map<string, NarrationRow>): DriveClip[] {
  const clips: DriveClip[] = []
  for (const item of selection) {
    const n = corpusById.get(selectionSubject(item)?.id ?? '')
    if (!n) continue // the poi/cluster/narration was deleted since freeze — drop the stale stop
    clips.push({
      seq: item.seq,
      form: toClipForm(n.form),
      // Null for a fused telling. The wire field is already `nullish()` and nothing on the client
      // reads it (identity there is `seq`), so a fused clip simply omits it rather than claiming to
      // be about one of the places it names.
      poiId: n.poiId,
      // The honest identity (INV-16): a fused telling has a null `poiId` by design, so a client keying
      // an offline store on that field cannot tell a cluster clip apart from a broken one.
      subjectId: n.subjectId,
      subjectKind: n.subjectKind,
      name: n.name,
      lat: item.triggerLat,
      lng: item.triggerLng,
      triggerRadiusM: candidateTriggerRadiusM(n),
      approachHeadingDeg: item.approachHeadingDeg,
      alongSec: item.alongSec,
      durationMs: n.durationMs,
      url: presignGet(n.key),
      contentType: contentTypeForKey(n.key),
      ...(n.attribution ? { attribution: n.attribution } : {}),
      ...(n.revisedAt ? { revisedAt: n.revisedAt.toISOString() } : {}),
    })
  }
  return clips
}

/** THE anonymous rider's ONE taste of the product (D14/INV-5): a single presigned clip drawn from THIS
 *  proposal's own selection.
 *
 *  ⚠ WHICH MAP IS PASSED IN MATTERS MORE THAN WHICH STOP IS PICKED. `corpus` must be the one
 *  `loadCorpusForRoute` produced (release-filtered unless the caller is an admin) — which is why the
 *  parameter is `BuildCorpus` and not a plain Map. `corpusForSelection`/`loadCorpusBySubjectIds`
 *  deliberately apply NO release filter and pass `includeStaged: true`: correct for resolving a frozen
 *  selection a rider paid a non-refundable credit for, and catastrophic here — presigning from that map
 *  hands a stranger a downloadable URL to UNRELEASED work, and the response is byte-shaped identically,
 *  so nothing fails. The brand is what makes that swap red.
 *
 *  ⚠ THE FIRST STOP, NOT THE LONGEST. seq 0 is the drive's opening beat, so the taste is exactly what
 *  plays first if the rider buys it — preview and product can never disagree, and the preview
 *  manufactures the anticipate beat instead of spending it. Ranking by clip length would override
 *  buildDrive's own judgement, where duration is only the LAST tiebreak inside a gap window.
 *
 *  ⚠ Same presign, same TTL as an owner clip — no anonymous variant. The RELEASE FILTER, not the TTL,
 *  is what makes this safe to serve anonymously; the TTL has one home (packages/storage, per INV-12),
 *  and a short URL would strand a rider who pauses mid-conversation, since the re-sign route is an owner
 *  route they cannot reach.
 *
 *  ⚠ NULL, NEVER A THROW. An empty selection (a real 200 with estStopCount 0) and a presign failure both
 *  degrade to "no taste" — the route, distance and stop count are all still true and the wall is
 *  downstream, so a 503 here would take down a free preview over a missing clip. Contrast POST /drives
 *  (audioUnavailable), where the credit is already spent and a 200 would strand the rider. */
export function previewClipFor(stops: readonly DriveStop[], corpus: BuildCorpus): DrivePreviewClip | null {
  for (const s of stops) {
    const n = corpus.get(s.poiId)
    if (!n) continue // subject vanished between load and select — impossible today, cheap to survive
    try {
      return {
        name: n.name,
        url: presignGet(n.key),
        contentType: contentTypeForKey(n.key),
        durationMs: n.durationMs,
        // Not decoration: Wikipedia is CC BY-SA and this is the most-seen anonymous surface, so the
        // credit rides with the clip exactly as it does on GET /sample.
        ...(n.attribution ? { attribution: n.attribution } : {}),
      }
    } catch (e) {
      // ⚠ Not audioUnavailable(). A presign failure is an R2-config fault, not per-key, so retrying the
      // next stop would just fail identically. Log (no body, no key — INV-13) and degrade.
      console.error('[api] drive propose preview presign failed (non-fatal)', e)
      return null
    }
  }
  return null
}

/* --------------------------------- routes --------------------------------- */

export const driveRoutes = new Hono<ApiEnv>()

// Session only — every route below reads c.get('session')/c.get('tier').
// ⚠ DO NOT RE-ADD requireAccount HERE. The account wall is PER-ROUTE (the five owner routes below,
// D15/INV-15); a blanket gate on this mount silently re-walls `POST /propose` — the entire anonymous
// preview, the open front door — and it fails as a 401 that reads like an auth bug rather than a
// routing one. The gate list is pinned by the route-table guard in test/drive-access.test.ts.
driveRoutes.use('*', withSession)

/**
 * POST /drives/propose — preview the route for a planned START→END before spending a credit.
 * Both endpoints are CURATED ANCHOR IDS the planner emitted, re-asserted here against
 * `endpoint_eligible` before any billed Routes call (INV-1), so this just materializes the route,
 * counts narratable stops, and picks ONE clip to play. Persists nothing, no credit.
 * (No LLM/geocoding: endpoints are grounded by construction.)
 *
 * ⚠ ANONYMOUS ON PURPOSE — NO `requireAccount` (D14/D15). This is the open front door: the rider hears
 * the skipper on their OWN route before the wall, which lands one step later at `POST /drives`. It
 * writes nothing (no ledger touch, no drive row), so INV-4 is satisfied by construction rather than by
 * a check — an anonymous user id is never in scope here at all.
 * ⚠ It also spends on EVERY call, anonymously, forever: a billed Google Routes call plus a corpus read.
 * Its only guard is PROPOSE_RATE (./limits, INV-12) — weakening that is a cost regression, not a UX tweak.
 */
driveRoutes.post('/propose', async (c) => {
  const parsed = await readJsonBody(
    c,
    driveProposeRequest,
    'start and end must be curated anchor ids.',
    MAX_DRIVE_BODY_BYTES,
  )
  if (!parsed.ok) return parsed.res
  const { start: startId, end: endId, via: viaIds } = parsed.data

  // ⚠ BEFORE the Routes call — this is the billed boundary (INV-1). start, end AND every via.
  const anchors = await resolveRouteAnchors(startId, endId, viaIds)
  if (!anchors) return c.json(NOT_AN_ANCHOR, 400)
  const { start: startEp, end: endEp, via, count: anchorCount } = anchors

  let route
  try {
    route = await materializeRoute(routeWaypoints(startEp, endEp, via))
  } catch (e) {
    console.error('[api] drive propose route failed', e)
    return c.json(NO_ROUTE, 422)
  }
  // The bill just landed — record it HERE, before the (throwable, unbilled) selection below. See
  // logRouteSpend for why this line exists and what may never ride on it.
  const shape = loopShapeOf(startEp, endEp, route.polyline)
  logRouteSpend({
    path: 'propose',
    anchors: anchorCount,
    via: via.length,
    loop: shape.loop,
    meters: route.distanceMeters,
    seconds: route.durationSeconds,
    retrace: shape.retrace,
    restricted: route.restricted,
  })

  // ⚠ RESTRICTED BEFORE RETRACE, AND THE ORDER IS THE WHOLE POINT OF PUTTING THEM TOGETHER. An
  // undrivable anchor produces BOTH conditions at once — Carson City → the Spooner Lake pin went out
  // and back up the same forest track, so it is a 100% retrace as well — and the loop message would
  // then tell the rider to "pick a different way round", which cannot help: there is no way round, the
  // SPOT is the problem. The more fundamental refusal has to speak first or the advice is wrong.
  if (route.restricted) return c.json(RESTRICTED_ROUTE, 422)

  // A loop that drives the same road twice is not a loop (`loopShapeOf`). Refused HERE, on the
  // preview, so the rider meets it on the FREE path rather than after a credit — and so the card they
  // are offered is never one the create path would go on to reject.
  if (shape.refuse) return c.json(SAME_ROAD_LOOP, 422)

  // Accurate est. stop count: run the real selection (pure, free) so the confirm screen matches.
  // An admin previews over staged clips too, so the proposed count matches what they'll build.
  // ⚠ `isAdmin(session)`, never `tier`/a literal — it is the SOLE staged bypass (INV-5), and an
  // anonymous session can never obtain it because `role` lives on a real account row.
  const { corpus, stops } = await selectStopsForRoute(route, isAdmin(c.get('session')))

  // Echo the ids AND the resolved midpoints: the ids are what POST /drives must re-send, the resolved
  // shapes are what the confirm screen renders (and what marks a loop as a round trip).
  return c.json({
    start: startEp,
    end: endEp,
    startId,
    endId,
    ...(viaIds && viaIds.length ? { via: viaIds, viaResolved: via } : {}),
    polyline: route.polyline,
    distanceMeters: Math.round(route.distanceMeters),
    durationSeconds: Math.round(route.durationSeconds),
    routeSig: routeSigOf(startEp, endEp, route.polyline),
    estStopCount: stops.length,
    // The taste (D14). From `corpus` — the RELEASE-FILTERED build corpus this same call produced
    // (INV-5), which is what the `BuildCorpus` parameter type enforces. Always emitted so `null` means
    // "no clip on this route" and an ABSENT key means an older server.
    previewClip: previewClipFor(stops, corpus),
  } satisfies DriveProposal)
})

// Per-IP cap on the CREATE path — it fires a Google Routes call + consumes a credit + writes a row,
// the same spend profile /propose is rate-limited for (index.ts). Applied as route-level middleware so
// it scopes to EXACTLY POST / (the list GET, detail GET, re-sign POST, and delete under /drives stay
// uncapped — they're cheap reads or idempotent). Same per-instance in-memory first-cut as ./rate-limit.
const createDriveLimiter = rateLimit(DRIVE_CREATE_RATE)

/**
 * POST /drives — generate + persist the confirmed drive. THIS IS THE WALL: `requireAccount` on this
 * route's own chain (D15/INV-15). Spends a credit from the ledger; materializes the route, runs the
 * deterministic selection over the shared narration corpus, freezes the STRUCTURE into
 * `drives.selection`, bumps demand, and returns the playable manifest. Mints no audio (reuses existing
 * clips), so it spends only Routes + a DB write.
 *
 * ⚠ `requireAccount` BEFORE `createDriveLimiter`, deliberately: the gate is pure in-memory, the limiter
 * MUTATES a per-IP bucket — so gate-first means an anonymous flood can never burn a real rider's
 * shared-IP token, and the cheap check runs first.
 */
// ⚠ `withFreshSession` LAST of the three, and the order is the whole design. It must not go first:
// `requireAccount` is a pure in-memory check and the reason it leads (above) is that an anonymous
// flood must never cost anything — putting an auth-DB read ahead of it hands that flood a query per
// request. So the cheap gate and the limiter run on the CACHED session, and only a caller who cleared
// both pays for a fresh one. The deleted-account case is then caught by the tier-keyed backstop inside
// the handler, which reads the session this middleware just replaced. See ./entitlements.
driveRoutes.post('/', requireAccount, createDriveLimiter, withFreshSession, async (c) => {
  // NOT THE WALL ANY MORE — `requireAccount` above 401s before this line runs. This is (a) the
  // narrowing that turns `string | undefined` into the `string` the ledger needs and (b)
  // defense-in-depth if a future edit ever moves or drops that gate.
  // ⚠ KEYED ON TIER, NOT ON ID PRESENCE. `!session?.user.id` worked only while an anonymous caller had
  // no session at all; after the anonymous mint (D16) EVERY rider carries one and an anonymous user HAS
  // an id, so an id-presence check is `false` forever and backstops nothing — that is INV-15's whole
  // point. Keying on the same `tier` the gate keys on means the backstop and the wall cannot disagree.
  // ⚠ It must stay BEFORE ensureFreeGrant. An anonymous user id that reached the ledger would write a
  // grant against a row better-auth HARD-DELETES at link — no FK, no cascade, no purgeUserData (INV-4)
  // — stranding a row forever in an append-only ledger with no second copy.
  const userId = ownerId(c)
  if (!userId) return c.json(ACCOUNT_REQUIRED, 401)

  const parsed = await readJsonBody(
    c,
    createDriveRequest,
    'start and end must be curated anchor ids.',
    MAX_DRIVE_BODY_BYTES,
  )
  if (!parsed.ok) return parsed.res
  const { start: startId, end: endId, via: viaIds, idempotencyKey } = parsed.data

  // The drive id is the client's idempotencyKey when supplied (a v4 UUID, stable across retries),
  // else server-minted. Using it AS the id makes a lost-ACK network retry hit the existing PK + the
  // `drive:<id>` consume key (in the co-committed batch below) and no-op — exactly-once create + charge.
  const id = idempotencyKey ?? crypto.randomUUID()

  // `drives.id` is a GLOBAL primary key and the id IS the client's idempotencyKey, so ONE by-id lookup
  // disambiguates three cases before any spend:
  //   • exists & ours & live  → idempotent replay: return the saved manifest WITHOUT re-running Routes,
  //     re-charging, or hitting the credit gate. (Else a lost-ACK retry on the user's LAST credit would
  //     403 `drive_limit_reached` though their drive already committed.)
  //   • exists but NOT ours   → 409 conflict: a create would spend a Routes call and then no-op both
  //     batch inserts (PK + consume-key conflicts), handing this caller a 200 for a drive they can
  //     never load. Reject before spending. (Narrow: needs guessing another user's v4 UUID.)
  //   • absent | ours+deleted → fall through to a normal create (a soft-deleted id re-creates; the
  //     original charge already stood — delete never refunds).
  if (idempotencyKey) {
    const existing = (
      await withRetry(() => db.select().from(drives).where(eq(drives.id, id)).limit(1), { label: 'drive.idLookup' })
    )[0]
    if (existing && existing.userId !== userId) {
      return c.json({ error: 'conflict', message: 'That drive id is already in use. Use a fresh idempotency key.' }, 409)
    }
    if (existing && !existing.deletedAt) {
      try {
        return c.json(await manifestForStoredDrive(existing))
      } catch (e) {
        return audioUnavailable(c, 'drive create idempotent-replay', e)
      }
    }
  }

  // Credit gate — EVERY account spends from the user-owned ledger (there is no uncapped tier; a comp is
  // a large admin grant). The balance is SUM(grants − consumes), NOT a count of drive rows — a delete
  // never refunds because no `reverse` is emitted, so there's no tombstone-counting hack to maintain.
  // `ensureFreeGrant` lazily materializes the one-time allotment on first touch. This is a pre-check
  // (cheap; avoids the route/LLM work for a user with no credits); the consume is co-committed below.
  await ensureFreeGrant(userId)
  const { remaining, granted } = await creditSummary(userId)
  if (remaining < 1) {
    // ⚠ `granted`, NOT the FREE_DRIVE_CAP env constant. A grant's amount is FROZEN when written
    // (credits.ts), so the env value is what the NEXT account will get, not what this one got. They
    // diverge the moment they ever differ — and an admin comp is exactly that: `POST
    // /admin/users/:id/credits` grants up to 1000, so a comped rider who spends 510 was being told
    // "you've used all 10 of your free drives" while the admin console correctly showed 510. GET
    // /drives already reports `granted`; this path disagreeing with it was the bug.
    // ⚠ This string is the ONLY thing that tells a rider the top-up path exists — the client renders
    // the server message verbatim. Founder call 2026-07-31: the allotment stays small and the wall is a
    // CONVERSATION, not a paywall — anyone who runs out emails and gets more, free, until there is
    // actually something to sell. So the address is load-bearing copy, not a courtesy sign-off.
    // ⚠ Do NOT promise a credit pack here. It used to say "a credit pack to make more is coming soon",
    // which is a commitment to ship a purchase flow; nothing sells today and 2.0 may price differently.
    return c.json(
      {
        error: 'drive_limit_reached',
        message: `That's all ${granted} of your free drives, and you've been busy. Email ${SUPPORT_EMAIL} and we'll top you up, free.`,
        cap: granted,
        supportEmail: SUPPORT_EMAIL,
      },
      403,
    )
  }

  // ⚠ BEFORE the Routes call — the same billed boundary /propose guards (INV-1). Deliberately placed
  // HERE rather than at parse time: the idempotent-replay path above returns without routing, and it
  // is the hot path for a lost-ACK retry, so it should not pay for a lookup it does not need. A rider
  // who reached this line has already passed the credit gate, so an off-list id costs them nothing.
  const anchors = await resolveRouteAnchors(startId, endId, viaIds)
  if (!anchors) return c.json(NOT_AN_ANCHOR, 400)
  const { start, end, via, count: anchorCount } = anchors

  let route
  try {
    route = await materializeRoute(routeWaypoints(start, end, via))
  } catch (e) {
    console.error('[api] drive create route failed', e)
    return c.json(NO_ROUTE, 422)
  }
  // Create bills its OWN Routes call (it does not reuse the proposal — nothing is persisted at
  // /propose), so it gets its own line, distinguished by `path`. Placed before the selection for the
  // same reason as /propose: below this point a corpus read, a 0-stop rejection or the ledger batch can
  // all end the request, and the Routes call is paid for either way.
  const shape = loopShapeOf(start, end, route.polyline)
  logRouteSpend({
    path: 'create',
    anchors: anchorCount,
    via: via.length,
    loop: shape.loop,
    meters: route.distanceMeters,
    seconds: route.durationSeconds,
    retrace: shape.retrace,
    restricted: route.restricted,
  })

  // ⚠ BOTH GATES AS /propose, IN THE SAME ORDER, and neither is redundant: a client can reach this
  // route without ever calling /propose, and this is the path that spends. Placed BEFORE the selection
  // and the ledger batch, so a refused route costs a Routes call (already billed above) and never a
  // rider's credit. The restricted-first ordering is argued at the /propose copy.
  if (route.restricted) return c.json(RESTRICTED_ROUTE, 422)
  if (shape.refuse) return c.json(SAME_ROAD_LOOP, 422)

  // Release gate: an admin builds over staged clips too; everyone else gets released-only. The frozen
  // selection then references whatever was eligible at build time (monotonic → stays valid). (region-release-gate)
  const { corpus, stops } = await selectStopsForRoute(route, isAdmin(c.get('session')))

  // GUARD: an empty selection must NOT persist. buildDrive returns [] when nothing rides the route
  // (sparse corpus, everything off-route, or a degenerate/zero-length route — the likeliest cause
  // being a LOOP whose start≈end collapsed to a near-zero route). A saved 0-stop drive is unplayable
  // AND burns a LIFETIME credit (the row counts toward the cap and is never refunded), so reject with
  // a 422 BEFORE the insert + demand bump. The loop-aware log keeps that root cause visible for the
  // verification pass instead of masking it behind the generic message (runbook Finding 1/2).
  if (stops.length === 0) {
    console.warn(
      `[api] drive create produced 0 stops — rejecting before persist (${start.name} → ${end.name}, ` +
        `loopish=${shape.loop}, candidates=${corpus.size}, durationSec=${Math.round(route.durationSeconds)})`,
    )
    return c.json(
      {
        error: 'no_stories',
        message:
          "The skipper couldn't find any stories along that route. Try different start and end points, or a longer drive.",
      },
      422,
    )
  }

  // Freeze the structure: a narration selection item per stop (content resolves live via its subject).
  // ⚠ `DriveStop.poiId` is the engine's opaque candidate id, which is the SUBJECT id here — a poi's
  // for a place telling, a cluster's for a fused one. Both ids are written so a stale-shaped row can
  // never be produced by this path.
  const selection: DriveSelection = stops.map((s): DriveSelectionItem => {
    const n = corpus.get(s.poiId)!
    return {
      kind: 'narration',
      seq: s.seq,
      subjectId: n.subjectId,
      subjectKind: n.subjectKind,
      ...(n.poiId ? { poiId: n.poiId } : {}),
      narrationId: n.narrationId,
      alongSec: s.alongSec,
      triggerLat: s.triggerLat,
      triggerLng: s.triggerLng,
      approachHeadingDeg: s.approachHeadingDeg,
    }
  })

  const routeSig = routeSigOf(start, end, route.polyline)
  const bbox = polylineBbox(route.polyline)
  const label = driveLabel(route.provenance.waypoints)
  const provenance: RouteProvenance = {
    source: 'google-routes-v2',
    waypoints: route.provenance.waypoints,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    materializedAt: route.provenance.materializedAt,
  }

  const driveValues: typeof drives.$inferInsert = {
    id,
    userId,
    label,
    startName: start.name,
    startLat: start.lat,
    startLng: start.lng,
    endName: end.name,
    endLat: end.lat,
    endLng: end.lng,
    polyline: route.polyline,
    bboxMinLat: bbox.minLat,
    bboxMinLng: bbox.minLng,
    bboxMaxLat: bbox.maxLat,
    bboxMaxLng: bbox.maxLng,
    distanceMeters: Math.round(route.distanceMeters),
    durationSeconds: Math.round(route.durationSeconds),
    routeProvenance: provenance,
    routeSig,
    selection,
  }
  // Charge the credit ATOMICALLY with the drive insert (db.batch co-commits on neon-http) so we can
  // never half-commit a charge-without-drive or a drive-without-charge. Both inserts are ON CONFLICT
  // DO NOTHING (idempotency_key for the consume, the PK for the drive), so a retry that reuses the same
  // (now client-stable) id cleanly no-ops instead of erroring on the unique violation — the consume is
  // keyed on the drive id, so a drive charges exactly one credit even under retry. Every account
  // consumes (no uncapped tier).
  //
  // ⚠ KNOWN residual TOCTOU (not closed here): the balance pre-check (above) and this consume are two
  // separate neon-http round-trips, and the consume keys are DISTINCT per drive id — so N genuinely-
  // concurrent creates with DISTINCT idempotency keys can all pass a `remaining===1` pre-check and all
  // commit a −1, driving the balance to 1−N (and a delete never refunds). A client-stable id only
  // dedupes RETRIES of the SAME create, not distinct ones. The create rate-limit (createDriveLimiter,
  // 15/60s per IP) now bounds the blast radius; fully closing it needs DB-level per-user serialization
  // (an advisory lock + a conditional INSERT…SELECT WHERE balance>=1 inside this batch), deferred until
  // there's a DB-backed test harness to verify money-path SQL (today's credit tests are pure-surface).
  await withRetry(
    () =>
      db.batch([
        db
          .insert(creditEntries)
          .values(driveConsumeEntry(userId, id))
          .onConflictDoNothing({ target: creditEntries.idempotencyKey }),
        db.insert(drives).values(driveValues).onConflictDoNothing({ target: drives.id }),
      ]),
    { label: 'drive.insert' },
  )

  // ⚠ `drive_demand` was bumped here until the 1.1 sweep (D25). It was instrumentation for a
  // cache-warming / authored-tour graduation job that never shipped and is deferred behind a real
  // route-concentration histogram — so it was a non-idempotent write on the credit-spending path,
  // paying a DB round-trip on every create, feeding nothing. PostHog is the demand instrument now.

  const manifest: DriveManifest = {
    driveId: id,
    label,
    polyline: route.polyline,
    distanceMeters: Math.round(route.distanceMeters),
    durationSeconds: Math.round(route.durationSeconds),
    clips: [],
  }
  try {
    manifest.clips = manifestClips(selection, corpus)
  } catch (e) {
    // ⚠ The drive IS saved and the credit already charged, so this must stay the retryable 503 every
    // sibling presign site answers with, NEVER a 200 the client reads as success. The create screen
    // reuses its idempotencyKey on retry → the idempotent replay re-presigns the saved drive once R2
    // settles (no double charge); GET /drives/:id recovers it too.
    return audioUnavailable(c, 'drive create', e)
  }
  return c.json(manifest)
})

/** GET /drives — the caller's saved drives, newest first (no geometry; one card each). Owner route:
 *  `requireAccount` on its own chain (D15/INV-15) — and load-bearing beyond the read, because this
 *  route WRITES (`ensureFreeGrant` below materializes the free allotment).
 *  ⚠ AND THAT WRITE IS WHY IT CARRIES `withFreshSession`. It looks like a pure read, so it is the easy
 *  one to "optimise" back onto the cached session — but a cached session for a DELETED account would
 *  insert a free-allotment row against a user id that no longer exists. This is the LIKELIER of the two
 *  exposed routes, not the lesser: the home screen hits it on every launch. See ./entitlements. */
driveRoutes.get('/', requireAccount, withFreshSession, async (c) => {
  // Backstop, not the wall — and TIER-keyed for the same reason as POST / above: after the anonymous
  // mint an id-presence check is permanently false, and this route reaches the ledger (INV-4/INV-15).
  const userId = ownerId(c)
  // ⚠ The SAME body as the wall and as POST /'s backstop. This site used to omit `message` entirely,
  // and the client renders that field verbatim — so the one wall answered in two voices.
  if (!userId) return c.json(ACCOUNT_REQUIRED, 401)
  // ⚠ The list and the ledger read share NO data, and this route is hit on every app focus — so they
  // go together rather than one after the other. The PAIR inside stays ordered: `ensureFreeGrant`
  // materializes the allotment so a brand-new user reads the full balance even before their first
  // drive, which only works if it lands before the summing read. neon-http is stateless (one HTTP
  // round trip per statement), so what this actually saves is a whole RTT of rider-visible latency.
  // The grant is an idempotent upsert, so it is harmless if the list half rejects first.
  const [rows, { remaining, granted }] = await Promise.all([
    withRetry(
      () =>
        db
          .select({
            driveId: drives.id,
            label: drives.label,
            startName: drives.startName,
            endName: drives.endName,
            distanceMeters: drives.distanceMeters,
            durationSeconds: drives.durationSeconds,
            // Count clips in SQL rather than hauling the full selection jsonb back just to .length it
            // (selection is jsonb NOT NULL, so no null-handling needed).
            clipCount: sql<number>`jsonb_array_length(${drives.selection})`,
            createdAt: drives.createdAt,
          })
          .from(drives)
          .where(and(eq(drives.userId, userId), isNull(drives.deletedAt)))
          .orderBy(desc(drives.createdAt)),
      { label: 'drive.list' },
    ),
    ensureFreeGrant(userId).then(() => creditSummary(userId)),
  ])
  // Proactive "N drives left" hint, from the user-owned credit LEDGER (every account has a balance).
  // `remaining` is the spendable balance and `cap` the lifetime granted (for "N of M" framing).
  // `remaining` is clamped at 0 so a future refund clawback can't surface negative.
  const credits = { remaining: Math.max(0, remaining), cap: granted }
  return c.json({
    drives: rows.map((r) => ({
      driveId: r.driveId,
      label: storedDriveLabel(r),
      startName: r.startName,
      endName: r.endName,
      distanceMeters: r.distanceMeters,
      durationSeconds: r.durationSeconds,
      clipCount: r.clipCount,
      createdAt: r.createdAt.toISOString(),
    })),
    credits,
  } satisfies DriveList)
})

/** The predicate EVERY owner-scoped drive query is keyed on: this id, this owner, not soft-deleted.
 *
 *  ⚠ ONE EXPRESSION, and it is the same rule `ownedRef` below follows for the same reason — three
 *  queries (the full load, the lean selection load, and the DELETE) must agree about what "the
 *  caller's live drive" means, and the failure of disagreeing is SILENT: drop `isNull(deletedAt)` from
 *  one of them and a deleted drive quietly becomes loadable again, or scope one by id alone and it
 *  serves another user's row. Counting, authorising and acting from one expression is house doctrine
 *  precisely because the second copy is the one that drifts. */
const ownedDriveWhere = (id: string, userId: string) =>
  and(eq(drives.id, id), eq(drives.userId, userId), isNull(drives.deletedAt))

/** Owner-scoped drive load by EXPLICIT id — the shared core of loadOwnedDrive (URL param) and the
 *  POST /drives idempotent replay (body idempotencyKey). null on miss-or-not-yours-or-deleted, so we
 *  never reveal another user's drive and a soft-deleted drive reads as gone. */
async function loadOwnedDriveById(userId: string, id: string) {
  const rows = await withRetry(
    () => db.select().from(drives).where(ownedDriveWhere(id, userId)).limit(1),
    { label: 'drive.load' },
  )
  return rows[0] ?? null
}

/** Read a JSON body and validate it, or hand back the 4xx the caller should return.
 *
 *  All three write routes did this by hand, which meant the "Invalid JSON body." wording lived in
 *  three places while the per-route shape message lived in each. Only the rider-facing strings
 *  actually differ, so only those are parameters.
 *
 *  ⚠ `maxBytes` is REQUIRED and undefaulted on purpose — a new caller has to state what it is willing
 *  to carry. This function's first act used to be `await c.req.json()`, which buffers an unbounded body
 *  into memory before anything can object: one unauthenticated request could carry a megabyte into the
 *  paid paths (INV-3). The bound is measured on the real stream and Content-Length is never consulted;
 *  see ./limits for why that distinction is the whole guarantee.
 *
 *  ⚠ EXPORTED because the planner route is the third caller and the most expensive one to get wrong —
 *  it is the anonymous model path. A copy of this ladder is a copy of an INV-3 spend guard, and the
 *  one that gets missed by the next hardening is whichever one lives furthest from this comment. */
export async function readJsonBody<T>(
  c: Context,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  shapeMessage: string,
  maxBytes: number,
  /** Rider-facing 413 copy. Defaulted because only the planner speaks in persona here. */
  tooLargeMessage = 'That request is too large. Try trimming it down.',
): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  const read = await readBoundedText(c.req.raw, maxBytes)
  // 413 — "Content Too Large" (RFC 9110 §15.5.14; "Payload Too Large" is the retired RFC 7231 name).
  // ⚠ Nothing is logged here, not even a truncation: this path is anonymously triggerable, so a log
  // line would be a free log-spam amplifier, and the body itself is rider content (INV-13).
  if (!read.ok) {
    return {
      ok: false,
      res: c.json({ error: 'payload_too_large', message: tooLargeMessage }, 413),
    }
  }
  let body: unknown
  try {
    // NOT c.req.json() — readBoundedText already consumed the stream, and hono only caches bodies read
    // through its own accessors, so calling it here throws. An absent body arrives as '' and fails into
    // the same 400 as before.
    body = JSON.parse(read.text)
  } catch {
    return { ok: false, res: c.json({ error: 'bad_request', message: 'Invalid JSON body.' }, 400) }
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return { ok: false, res: c.json({ error: 'bad_request', message: shapeMessage }, 400) }
  return { ok: true, data: parsed.data }
}

/** Load the corpus along a frozen route and run the deterministic selection over it.
 *
 *  Shared by POST /drives/propose and POST /drives so the count the rider is shown on the confirm
 *  screen is produced by the SAME call that builds the drive they pay for. Two copies of this is how a
 *  preview starts promising a different number of stops than it delivers.
 *
 *  `admin` widens the corpus to staged clips as well as released ones (region-release-gate). */
async function selectStopsForRoute(route: { polyline: LngLat[]; durationSeconds: number }, admin: boolean) {
  const corpus = await loadCorpusForRoute(route.polyline, route.durationSeconds, admin)
  const stops = buildDrive({
    polyline: route.polyline,
    totalSec: route.durationSeconds,
    candidates: [...corpus.values()].map(candidateOf),
    minGapSec: DRIVE_MIN_GAP_SEC,
    maxStops: driveMaxStops(route.durationSeconds),
  })
  // The corpus rides along: POST /drives reads it again to shape the persisted selection and to log
  // the candidate count, so returning only the stops would just make the caller re-load it.
  return { corpus, stops }
}

/** The narration rows a stored drive's frozen selection points at, keyed by subject id.
 *
 *  ⚠ Via `selectionSubject`, which absorbs the pre-fused item shape AND resolves the subject kind — a
 *  fused telling is named by its `cluster_id`, not a member's `poi_id`. Reaching into the item for a
 *  poi id directly is the mistake that made `narrations.poi_id → 3rd Street Flats` for a clip about
 *  downtown Reno. One definition, shared by the replay manifest and the offline re-sign. */
async function corpusForSelection(selection: DriveSelectionItem[]): Promise<Map<string, NarrationRow>> {
  const subjectIds = selection
    .filter((i) => i.kind === 'narration')
    .map((i) => selectionSubject(i)?.id)
    .filter((id): id is string => Boolean(id))
  return subjectIds.length ? await loadCorpusBySubjectIds(subjectIds) : new Map<string, NarrationRow>()
}

/** Build a replay manifest from a STORED drive row: frozen structure + LIVE narration content (a
 *  regenerated telling auto-improves it), freshly presigned. Throws if presign fails — the caller maps
 *  that to a 503. Shared by GET /:id and the POST /drives idempotent replay. */
async function manifestForStoredDrive(drive: NonNullable<Awaited<ReturnType<typeof loadOwnedDriveById>>>): Promise<DriveManifest> {
  const corpus = await corpusForSelection(drive.selection ?? [])
  return {
    driveId: drive.id,
    label: storedDriveLabel(drive),
    polyline: drive.polyline,
    distanceMeters: drive.distanceMeters,
    durationSeconds: drive.durationSeconds,
    clips: manifestClips(drive.selection ?? [], corpus),
  }
}

/** The owner id a scoped query may be keyed on, or undefined.
 *
 *  ⚠ TIER, NOT ID PRESENCE (INV-15). After the anonymous mint (D16) every rider carries a session and
 *  an anonymous user HAS an id, so `session?.user.id` alone is never falsy and stops narrowing anything.
 *  This is the same predicate `requireAccount` keys on, so the gate and the queries beneath it cannot
 *  disagree — and no query is ever scoped by an id better-auth is about to hard-delete (INV-4). */
const ownerId = (c: Context<ApiEnv>): string | undefined =>
  c.get('tier') === 'free' ? c.get('session')?.user.id : undefined

/** The `(driveId, userId)` pair every owner-scoped query is keyed on, or null when either half is
 *  missing/malformed.
 *
 *  ⚠ ONE PLACE, because all three owner routes must agree and the failure of disagreeing is silent.
 *  The UUID guard is not cosmetic: without it a `:id` like `not-a-uuid` reaches Postgres as a uuid
 *  comparison and comes back a DRIVER ERROR (500), not the 404 an unowned id is supposed to read as —
 *  so a fourth owner route added without it regresses 404→500 and leaks that the id was malformed
 *  rather than simply not the caller's. Callers keep their own miss handling (a loader returns null, a
 *  route 404s) because that part legitimately differs. */
function ownedRef(c: Context<ApiEnv>): { id: string; userId: string } | null {
  const id = c.req.param('id')
  const userId = ownerId(c)
  if (!id || !UUID_RE.test(id) || !userId) return null
  return { id, userId }
}

/** Load a LIVE drive the caller OWNS (404 on miss-or-not-yours-or-deleted — never reveal another
 *  user's drive, and a soft-deleted drive reads as gone). */
async function loadOwnedDrive(c: Context<ApiEnv>) {
  const ref = ownedRef(c)
  if (!ref) return null
  return loadOwnedDriveById(ref.userId, ref.id)
}

/** Lean owner-scoped loader — only { id, selection }, for paths that re-presign but need no geometry
 *  (POST /:id/assets/sign). Same ownership scoping as loadOwnedDrive (id + userId + not-deleted +
 *  UUID guard); 404 on any miss. */
async function loadOwnedSelection(c: Context<ApiEnv>) {
  const ref = ownedRef(c)
  if (!ref) return null
  const { id, userId } = ref
  const rows = await withRetry(
    () =>
      db
        .select({ id: drives.id, selection: drives.selection })
        .from(drives)
        .where(ownedDriveWhere(id, userId))
        .limit(1),
    { label: 'drive.loadSelection' },
  )
  return rows[0] ?? null
}

/** GET /drives/:id — replay a saved drive: frozen STRUCTURE + LIVE narration content (a regenerated
 *  telling auto-improves it). Re-presigns every clip.
 *
 *  ⚠ Owner route — `requireAccount` first on its own chain (D15/INV-15). It is what keeps
 *  `corpusForSelection`'s deliberately UNFILTERED (staged-inclusive) read owner-scoped: that loader is
 *  safe ONLY behind this gate (INV-5). */
driveRoutes.get('/:id', requireAccount, async (c) => {
  const drive = await loadOwnedDrive(c)
  if (!drive) return c.json({ error: 'not_found' }, 404)
  try {
    return c.json(await manifestForStoredDrive(drive))
  } catch (e) {
    return audioUnavailable(c, 'drive replay', e)
  }
})

/** POST /drives/:id/assets/sign — re-presigned clip URLs (offline refresh), keyed by seq. Owner route:
 *  `requireAccount` first (D15/INV-15) — it re-presigns from the staged-inclusive replay corpus, so the
 *  gate is what makes that read safe (INV-5). */
driveRoutes.post('/:id/assets/sign', requireAccount, async (c) => {
  const drive = await loadOwnedSelection(c)
  if (!drive) return c.json({ error: 'not_found' }, 404)
  const corpus = await corpusForSelection(drive.selection ?? [])
  try {
    const clips = manifestClips(drive.selection ?? [], corpus).map((cl) => ({
      seq: cl.seq,
      url: cl.url!,
      contentType: cl.contentType!,
      durationMs: cl.durationMs,
    }))
    return c.json({ clips } satisfies SignedDriveAudio)
  } catch (e) {
    return audioUnavailable(c, 'drive sign', e)
  }
})

/**
 * DELETE /drives/:id — remove a drive from the caller's list. SOFT-delete (sets deleted_at): the row
 * stays so it keeps counting toward the lifetime free-drive credit — deleting NEVER refunds a credit
 * (one is spent at generation). Owner-scoped + idempotent: 404 if it isn't yours or is already gone.
 * The shared narration audio is untouched — a drive only references it, never owns it.
 * Owner route: `requireAccount` first on its own chain (D15/INV-15).
 */
driveRoutes.delete('/:id', requireAccount, async (c) => {
  // 404, not 401 — deliberate here (see loadOwnedDrive): an unowned id must read as gone. Tier-keyed
  // like the other owner loaders so no query is ever scoped by an anonymous id (INV-4/INV-15).
  const ref = ownedRef(c)
  if (!ref) return c.json({ error: 'not_found' }, 404)
  const { id, userId } = ref
  const deleted = await withRetry(
    () =>
      db
        .update(drives)
        .set({ deletedAt: new Date() })
        .where(ownedDriveWhere(id, userId))
        .returning({ id: drives.id }),
    { label: 'drive.delete' },
  )
  if (deleted.length === 0) return c.json({ error: 'not_found' }, 404)
  return c.json({ ok: true })
})

/** Load narration corpus rows by an explicit poiId set (the GET-replay path — no route bbox).
 *
 *  ⚠ Deliberately NO `excluded_reason` filter, unlike the build path. Exclusion is NOT monotonic the
 *  way the release gate is: releasing only ever ADDS eligibility, so filtering at build is sufficient,
 *  whereas excluding REMOVES it. Applying it here would silently shrink a drive the rider already paid
 *  a credit for — every stop that later got pruned would vanish from a saved drive, and the credit is
 *  never refunded. A drive's selection is frozen at build; this path resolves that frozen set's CONTENT
 *  and must not re-adjudicate which stops belong. New drives get the clean corpus; old drives keep
 *  what they bought.
 *
 *  ⚠ AND NO RELEASE FILTER EITHER — which is safe ONLY because every caller is owner-scoped behind
 *  `requireAccount`. That qualifier became load-bearing the day `POST /propose` opened to anonymous
 *  callers (INV-5): this map is structurally identical to the build corpus, so handing it to the
 *  preview picker would publish STAGED work to a stranger with nothing failing. It deliberately does
 *  NOT return `BuildCorpus`; that brand is the compile error standing in the way. */
async function loadCorpusBySubjectIds(subjectIds: string[]): Promise<Map<string, NarrationRow>> {
  // A frozen selection names subjects of both kinds, and the id spaces are disjoint uuids — so both
  // queries run against the same list and each matches only its own. `includeStaged: true` on the
  // cluster side mirrors the poi side's deliberate absence of a release filter (see above): this path
  // resolves a frozen set's CONTENT and must not re-adjudicate eligibility.
  const [rows, clusters] = await Promise.all([
    withRetry(() => narrationCorpusSelect().where(inArray(narrations.poiId, subjectIds)), {
      label: 'drive.corpusByIds',
    }),
    // `includeStaged: true` because this path resolves a
    // FROZEN selection's content and must never re-adjudicate what belongs in it. A capability
    // withhold here would silently shrink a drive the rider paid a non-refundable credit for —
    // and would do it differently on different devices, since capability is per-request.
    withRetry(() => loadClusterTellings({ includeStaged: true, clusterIds: subjectIds }), {
      label: 'drive.clusterCorpusByIds',
    }),
  ])
  return clusterRowsToCorpus(clusters, rowsToCorpus(rows))
}
