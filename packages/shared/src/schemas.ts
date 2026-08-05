import { z } from 'zod'
import { attributionSource, driveClipForm, platform } from './enums'

/** A single [lng, lat] pair (GeoJSON axis order). */
export const coordinate = z.tuple([z.number(), z.number()])
export type Coordinate = z.infer<typeof coordinate>

/** A frozen, precomputed route geometry. */
export const polyline = z.array(coordinate)
export type Polyline = z.infer<typeof polyline>

/** Which ASK a cold-open suggestion demonstrates. The app maps this to a glyph and to nothing else. */
export const plannerCopyShape = z.enum(['aToB', 'via', 'fromStart', 'toEnd', 'open'])

/**
 * One cold-open suggestion, FINISHED — `ask` is the exact sentence a tap sends, place names already
 * in it.
 *
 * ⚠ NO PLACEHOLDERS ON THE WIRE, and that is the point (founder, 2026-08-04). The first cut shipped
 * `{a}`/`{b}` templates for the app to fill, which split one job across two codebases: the server chose
 * the tokens, the app chose how many names to pour in. They disagreed on the first try — `toEnd` said
 * "Take me to {b}." against a one-name budget, and the app's leftover-brace guard DROPPED the row
 * rather than render a brace, so the chip silently vanished. Composing server-side deletes the seam
 * instead of guarding it: there is no budget to mismatch and no token left to leak onto a screen.
 */
export const plannerExample = z.object({
  shape: plannerCopyShape,
  title: z.string(),
  ask: z.string(),
})
export type PlannerExample = z.infer<typeof plannerExample>

/** A region — the minimal keying entity (a drive belongs to one). */
export const region = z.object({
  id: z.uuid(),
  slug: z.string(),
  displayName: z.string(),
  /** Can the skipper plan a drive here at all — i.e. does this region hold at least one curated
   *  endpoint-eligible place? A CAPABILITY, and the only field on this DTO that is one.
   *
   *  ⚠ IT EXISTS TO STOP THE CLIENT INFERRING THIS FROM `exampleAnchors` (2026-08-03). That field is
   *  decoration carrying `.catch([])` precisely so a malformed payload degrades quietly — so once the
   *  client began reading "empty" as "region not ready" and HIDING THE COMPOSER on it, a server-side
   *  glitch in a cosmetic field became indistinguishable from a genuinely uncurated region, and would
   *  have told a rider in a fully curated one that the skipper runs no roads there. Two questions, two
   *  fields; the degrade contract only makes sense on the cosmetic one.
   *
   *  ⚠ `.catch(true)` — FAIL OPEN, and the direction is the whole point. Absent or malformed must mean
   *  "assume plannable", because the failure this field guards against is a false NEGATIVE bricking the
   *  screen. It also makes deploy order safe in one direction only: a client that knows this field
   *  talking to a server that does not yet send it degrades to the old always-on behaviour rather than
   *  to a home screen with no composer. `.catch`, not `.default`, for the same reason the sibling below
   *  carries one — `.default` covers a MISSING key but still throws on a null or a wrong type, and any
   *  throw here is mobile's blocking "please update the app" wall on the critical path. */
  ready: z.boolean().catch(true),
  /** A few curated endpoint NAMES from this region — names only, no ids, no coordinates. Feeds the
   *  tappable example asks and the in-persona offline/outage copy, so rider-facing strings never
   *  hardcode a place name. It is DECORATION, never an input: the client must not turn one of these
   *  back into an endpoint — a request names an endpoint by ANCHOR ID and only the server holds the
   *  mapping (INV-1). Names are already public (the planner speaks them on turn one, anonymously); the
   *  id mapping is what stays server-side, because an id is the only thing that can bill a Routes call.
   *  ⚠ `.catch([])`, NOT `.default([])`. GET /regions is critical path (it supplies the regionId every
   *  POST /drives/plan carries) and the mobile client turns ANY DTO parse failure into a blocking
   *  "please update the app" wall (apps/mobile/src/lib/api.ts `parseDto`). `.default()` only covers a
   *  MISSING key — a null or a malformed element still throws, so one sloppy `?? null` in a handler
   *  would brick the whole home screen over a cosmetic field. `.catch()` degrades to "no examples",
   *  which every consumer already renders (a freshly-curated region has none).
   *  ⚠ No `.max()` here either: a count bound on a RESPONSE schema can only ever break deployed
   *  clients (and under `.catch` it would silently blank the field, worse). The count is server
   *  policy — apps/api/src/example-anchors.ts. */
  exampleAnchors: z.array(z.string()).catch([]),
  /** This region's cold-open suggestions, composed server-side and ready to render.
   *  ⚠ `.catch([])` — no suggestions is a SAFE state (the composer works without them) while a stale
   *  baked default is not, so this degrades to silence like everything else in this payload. */
  examples: z.array(plannerExample).catch([]),
  /** The same names those suggestions were built from: cleaned, deduped and rotated to this launch's
   *  window. ⚠ It exists so the COMPOSER PLACEHOLDER can name the same places as the chip inches above
   *  it without re-deriving the rotation client-side — two independent derivations of "which names is
   *  it this launch" is exactly how those two would drift apart.
   *  ⚠ Distinct from `exampleAnchors`, which stays RAW and unrotated: the degraded cards render that
   *  as a flat roster where order carries no meaning. */
  exampleNames: z.array(z.string()).catch([]),
})
export type Region = z.infer<typeof region>

/** GET /regions — the pickable regions (for the Create-a-Drive region selector). Anonymous. */
export const regionList = z.object({ regions: z.array(region) })

/**
 * GET /bootstrap — everything the cold open needs, in one round trip.
 *
 * ⚠ A SEPARATE ENDPOINT RATHER THAN FIELDS ON /regions, and the reason is caching. `/regions` is
 * memoized and identical for every rider; this payload is composed PER REQUEST, because the suggestions
 * are rotated to the caller's own launch counter. Folding a per-device answer into a shared cache is
 * how a cache quietly starts serving one rider another rider's screen.
 *
 * ⚠ THE TWO `*Say` LINES ARE THE SKIPPER'S OWN — seeded into the transcript with no model call and
 * re-sent to the model as sentences he already said. That makes them prompt surface: held in the app
 * they could contradict the planner prompt, and could only be corrected by an App Store release, which
 * is exactly what happened on 2026-08-04. Served, they deploy with the prompt that governs them.
 *
 * ⚠ EVERY FIELD DEGRADES TO SILENCE rather than to a baked default. A fallback string in the app is
 * what this deletes: it is the copy nobody remembers to update, and it fails by looking fine.
 */
export const bootstrap = z.object({
  regions: z.array(region),
  /** "Change it up" — the skipper inviting a revision. ⚠ SEEDED + on the wire. */
  adjustSay: z.string().catch(''),
  /** The beat when a route comes back with nothing to tell. ⚠ SEEDED + on the wire. */
  noStopsSay: z.string().catch(''),
})
export type Bootstrap = z.infer<typeof bootstrap>


/** Attribution snapshot frozen at generation time (keeps CC BY-SA / CC BY credit correct). */
export const attribution = z.object({
  source: attributionSource,
  sourceId: z.string(),
  title: z.string().optional(),
  url: z.url().optional(),
  license: z.string().optional(),
  retrievedAt: z.iso.datetime().optional(),
})
export type Attribution = z.infer<typeof attribution>

/**
 * A clip's frozen attribution: an ARRAY, one entry per source it drew on (Wikipedia +
 * Macrostrat, etc.). Stored as a jsonb array on `narrations` — there is no legacy
 * single-object shape to tolerate (zero-reuse, no users → clean array contract).
 *
 * ⚠ `.catch([])` for the SAME reason `region.exampleAnchors` carries one, and the stakes are higher
 * here: this rides the anonymous `/drives/propose` response, the mobile client turns
 * ANY DTO parse failure into a blocking "please update the app" wall (apps/mobile/src/lib/api.ts
 * `parseDto`), and the value is a FROZEN blob the studio pipeline wrote — nothing re-validates it on
 * the way out. So a fifth `attributionSource` value, a stamp that isn't strict ISO, or one malformed
 * `url` would kill an ALREADY-BILLED propose over an ⓘ button. `.catch()`, not `.default()`: a
 * default only covers a MISSING key, while a null or a bad element still throws. Every consumer
 * already renders the empty case (scenic/break clips ground on no sources at all).
 * ⚠ The cost, stated honestly: one bad element drops the WHOLE credit list for that clip, and
 * Wikipedia's CC BY-SA credit is legal rather than optional. It is still the better failure — a wall
 * presents no credit AND no clip AND no app — but it means a drift in what the pipeline freezes
 * shows up as silently missing credit, not as an error. The credit's real guard stays where it is
 * enforceable: the form-conditional CHECK on `narrations` (packages/db).
 * ⚠ RESPONSE-ONLY. Never reuse this to validate attribution on the way IN (a studio write, an admin
 * edit) — a `.catch` on a write silently discards exactly what the licence requires us to keep.
 */
export const attributionList = z.array(attribution).catch([])
/** The frozen-attribution array as a TYPE. Exported because API handlers that serve attribution
 *  need to annotate it, and the only previous way to name it was to reach through a DTO that
 *  happened to carry one — which made an unrelated DTO's
 *  removal a compile error in a handler that has nothing to do with it. */
export type AttributionList = z.infer<typeof attributionList>

// ⚠ `dataSource`/`sourcesResponse` and `GET /sources` were cut in the 1.1 sweep. The catalog was
// served so a new fact source could be credited "without an App Store release" — but the app had to
// ship a byte-identical bundled fallback anyway (a legal page must render offline), so the release it
// was avoiding was never actually avoided, and the CC BY-SA source list had TWO homes that could
// disagree. One home now: `apps/mobile/src/lib/licenses.ts`. ⚠ This is the CATALOG only — per-clip
// `attribution`, frozen on the narration row, is untouched and is what the licence actually requires.

/**
 * The per-platform app-version policy. The client reads its OWN version, compares against
 * `minimum`/`recommended`, and decides the update gate (see `gateFor` in ./version). The
 * authoritative copy lives in apps/api server code, so the floor is raised by a BACKEND
 * deploy — never an App Store release. `storeUrl` deep-links the right store.
 */
export const versionPolicy = z.object({
  platform,
  /** Below this (semver "x.y.z") the client is FORCED to update (blocking wall). */
  minimum: z.string(),
  /** Below this (but at/above `minimum`) the client is NUDGED (dismissible). */
  recommended: z.string(),
  /** App Store / Play Store deep link for this platform. */
  storeUrl: z.url(),
})
export type VersionPolicy = z.infer<typeof versionPolicy>

/** GET /version — the per-platform update policy (anonymous; env-free). */
export const versionResponse = z.object({ policies: z.array(versionPolicy) })

/* -------------------------------------------------------------------------- */
/*  API response DTOs (apps/api ⇄ clients). Lightweight, no internal columns.   */
/* -------------------------------------------------------------------------- */

/* ⚠ THE `sample` DTO AND ITS `Sample` TYPE WERE DELETED HERE (founder, 2026-08-05) with `GET /sample`,
 * the mobile screen that called it and the onboarding gate that showed it. The anonymous taste is now
 * the preview clip on `POST /drives/propose` (`drivePreviewClip`, above), which carries a real stop
 * from the rider's own planned route. docs/designs/onboarding-gate-reconsidered.md.
 *
 * ⚠ ITS ONE DESIGN NOTE IS WORTH KEEPING: that DTO deliberately carried NO GEOGRAPHY — "no map here,
 * just the clip" — which is the same restraint the `Region` DTO shows in withholding `bbox`. Any future
 * anonymous clip payload should stay that spare unless a reader genuinely needs more.
 */

/* -------------------------------------------------------------------------- */
/*  Create-a-Drive (V2) — a user-owned, on-demand A→B drive over reused narrations */
/* -------------------------------------------------------------------------- */

// A SERVER-RESOLVED endpoint: the name + exact coords looked up from a curated `places` row. Only ever
// travels outbound now — see `anchorId` below for why a request can no longer carry one.
// lat/lng stay bounded to valid WGS84 (which also excludes ±Infinity; z.number() already rejects NaN):
// cheap, and the shape is still parsed on the client.
const resolvedEndpoint = z.object({
  name: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})

// ⚠ THERE IS NO ANCHOR-LIST DTO HERE, and adding one back is an exposure rather than a convenience:
// a region's curated anchors carry exact coordinates, which is the one thing that can bill a Routes
// call (INV-1). The argument, and the guard that no longer covers such a route, are at
// `loadRegionAnchors` (apps/api/src/drives.ts). A rider may see NAMES only — `region.exampleAnchors`.

/**
 * An endpoint, as a REQUEST may name it: the id of a curated `places` row, never a coordinate.
 *
 * ⚠ THIS IS THE WHOLE OF "GROUNDED BY CONSTRUCTION" (INV-1), and it is enforced at the WIRE rather
 * than asked for in a prompt. Requests used to carry `{name, lat, lng}`, which flowed straight into a
 * BILLED Google Routes call — so once /propose opens to anonymous riders (D14/D15), that shape is an
 * unauthenticated endpoint that bills Routes for any two points on Earth. An id cannot express a point
 * that is not on the curated list; the server re-asserts `endpoint_eligible` per row and 400s BEFORE
 * any Routes call. An off-list ask gets the in-persona "don't know that one" — never a geocode.
 */
const anchorId = z.uuid()

/** The most intermediate waypoints a route may carry — the bound on the single billed Routes call.
 *
 *  ⚠ ONE HOME, because three places must agree and only one of them fails loudly. The wire schema
 *  rejects an over-long `via`, but `translateRoute` (apps/api/src/plan-route.ts) drops a route that
 *  exceeds it AFTER the round-trip append, and a mismatch there is silent: the rider asks, the model
 *  answers, and the route dies as a `route_untranslatable` line nobody is watching. The planner
 *  tool's own `maxItems` is deliberately LOWER than this and is not derived from it — that one is
 *  model-facing headroom for the round-trip append, not a cap. */
export const MAX_ROUTE_VIA = 8

/** Ordered intermediate waypoints between start and end — the route is materialized as
 *  [start, ...via, end]. A LOOP is `end === start` whose LAST TWO midpoints are the turnaround and
 *  then the way home (start==end alone is a degenerate zero-distance route). Both are appended
 *  server-side from the planner's call; the way home is what keeps a loop off the road it rode out on
 *  (`retraceFraction` refuses one that fails), and the client reads the far end at `via.at(-2)`.
 *  Capped to bound the single Routes call.
 *  ⚠ `via` GOES THROUGH THE ALLOWLIST TOO. It was `z.array(resolvedEndpoint)` while start/end were
 *  being hardened, which satisfied "reject a non-anchor ENDPOINT" exactly while still shipping 8
 *  arbitrary billable coordinates. Guarding both ends of a route and leaving the middle open is not a
 *  partial guarantee — it is none. */
const via = z.array(anchorId).max(MAX_ROUTE_VIA).optional()

/**
 * The one shape that is not a drive: start === end with nothing in between.
 *
 * ⚠ IT IS A ROUTE THAT BILLS TWICE AND ARRIVES NOWHERE. `[start, ...via, end]` with an empty `via` and
 * both ends the same materializes as a zero-distance polyline, which nothing downstream refuses:
 * `loopShapeOf` (apps/api/src/drives.ts) computes `retraceFraction` over it and scores 0 — the retrace
 * measure needs ~1.5 km of along-route distance before it can see a doubling-back at all — so the
 * no-same-road gate waves it through. `/drives/propose` then answers 200 with `estStopCount: 0`, and the
 * only guard that catches an empty drive lives on the CREATE path, which bills a SECOND Routes call
 * before its 422. The rider pays two vendor calls for a card that was never a drive.
 *
 * ⚠ `start === end` WITH A `via` IS LEGITIMATE AND MUST STAY SO — it is exactly how a loop is encoded
 * (see `via` above: the turnaround and the way home are the last two midpoints). So the predicate is the
 * EMPTY-via case only. Widening it to all `start === end` would refuse every round trip in the product.
 *
 * ⚠ ONE HOME, THREE READERS, deliberately not four. The two BILLED request schemas below refine on it,
 * and `toPlannedRoute` (apps/api/src/plan-route.ts) reads it so the planner never hands a rider a card
 * for one. `plannedRoute` itself is NOT refined: it also types the `drawn` array, whose documented rule
 * is that a bad entry is DROPPED rather than rejected — refining it there would turn one stale card in a
 * client's history into a 400 on a legitimate conversation turn.
 */
export const isDegenerateRoute = (r: { start: string; end: string; via?: readonly string[] | null }): boolean =>
  r.start === r.end && (r.via?.length ?? 0) === 0

/** The message both billed request schemas reject with. ⚠ Not rider-facing — both handlers answer their
 *  own in-persona line; this is what a developer sees in a parse failure. */
const DEGENERATE_ROUTE_MSG = 'a route from a place back to itself needs somewhere in between'

/** POST /drives/propose — preview the route for a picked START→END (+ optional via midpoints) before
 *  spending a credit. The endpoints arrive as curated `places` ids the PLANNER resolved in
 *  conversation and `hydrateAnchors` re-checks against the allowlist, so we just materialize the route
 *  + count stories. Persists nothing, no credit — the confirm interstitial.
 *  ⚠ Refined against `isDegenerateRoute` so the zero-distance shape is refused BEFORE the billed Routes
 *  call, rather than after two of them. */
export const driveProposeRequest = z
  .object({
    start: anchorId,
    end: anchorId,
    via,
  })
  .refine((r) => !isDegenerateRoute(r), { message: DEGENERATE_ROUTE_MSG })
export type DriveProposeRequest = z.infer<typeof driveProposeRequest>

/** The anonymous rider's ONE taste of the product (D14): a single presigned clip drawn from THIS
 *  proposal's own selection, chosen server-side.
 *
 *  ⚠ IT IS AN OBJECT, NOT AN ARRAY, AND THAT IS THE GUARANTEE (INV-5). "Exactly one clip" is not a
 *  server-side length check a later edit can relax — it is the SHAPE. Turning this into a list is a
 *  wire break someone has to argue for, not a parameter a caller can raise. And the request carries no
 *  selector at all (`driveProposeRequest` above is start/end/via — no `seq`, `index`, `count` or
 *  `offset` anywhere), so the ONLY lever a caller has over which clip they receive is the ROUTE. That
 *  makes corpus enumeration cost one billed Google Routes call per clip, at the propose rate limit
 *  (`apps/api/src/limits.ts`), and still only ever yields the FIRST stop of each route.
 *
 *  ⚠ DELIBERATELY NOT `driveClip`. Reusing it would put `subjectId`, `lat`/`lng`, `triggerRadiusM`,
 *  `alongSec` and `seq` on an ANONYMOUS wire — exact trigger geometry for a corpus POI, plus a stable
 *  corpus key a stranger could correlate across routes — and would leave `z.array(driveClip)` one
 *  character away. A preview needs a name, a URL and a credit. Nothing else.
 *
 *  `attribution` is NOT decoration: Wikipedia is CC BY-SA, so any surface that presents the adapted
 *  work owes credit, and since 2026-08-05 this is the ONLY anonymous clip surface there is — the
 *  deleted `sample` DTO carried `attribution` for exactly the same reason, so the obligation did not
 *  shrink with it, it concentrated here. */
export const drivePreviewClip = z.object({
  /** The place this clip is about — the card's label. Safe on an anonymous wire: the clip says the
   *  name out loud, so withholding the string protects nothing. */
  name: z.string(),
  /** Presigned R2 GET, short TTL (packages/storage owns the number). Private object; the URL expires.
   *  ⚠ Same presign, same TTL as an owner clip — the RELEASE FILTER on the build corpus, not the TTL,
   *  is what makes this safe to serve anonymously (INV-5). */
  url: z.url(),
  contentType: z.string(),
  durationMs: z.number().int().nullish(),
  attribution: attributionList.optional(),
})
export type DrivePreviewClip = z.infer<typeof drivePreviewClip>

/** The proposed route to CONFIRM before generating: the SERVER-resolved endpoints (name + coords, for
 *  display) alongside the ids that produced them, plus the route preview.
 *  ⚠ Both halves are here on purpose. The resolved shape is what the rider sees; the ids are what the
 *  create call must re-send, and echoing them means the client never has to reconstruct an endpoint
 *  from a display string — the failure mode that made free-text endpoints tempting in the first place. */
export const driveProposal = z.object({
  start: resolvedEndpoint,
  end: resolvedEndpoint,
  startId: anchorId,
  endId: anchorId,
  /** The via ANCHOR IDS as sent; `viaResolved` carries the same midpoints for display. */
  via,
  viaResolved: z.array(resolvedEndpoint).max(MAX_ROUTE_VIA).optional(),
  polyline,
  distanceMeters: z.number().int(),
  durationSeconds: z.number().int(),
  routeSig: z.string(),
  /** Rough # of narratable places along the route (for the confirm screen). */
  estStopCount: z.number().int().nullish(),
  /** ONE clip from this route, or null — the rider's taste BEFORE the wall (D14/INV-5).
   *  ⚠ NULL IS A NORMAL OUTCOME, not an error: a 0-stop route has no clip (see `estStopCount`), and a
   *  presign failure degrades to null rather than 503ing an otherwise-valid free preview. The client
   *  must render the card without it.
   *  `.nullish()` so the two absences stay distinguishable: the handler ALWAYS emits the key, so `null`
   *  means "this server, no clip" while `undefined` means "an older server that has no such field". */
  previewClip: drivePreviewClip.nullish(),
})
export type DriveProposal = z.infer<typeof driveProposal>

/* -------------------------------------------------------------------------- */
/*  The PLANNER — planning a drive by talking to the Skipper (1.1)              */
/* -------------------------------------------------------------------------- */

/** One line of the conversation. `skipper` is the assistant side; the client keeps BOTH and re-sends
 *  the whole transcript each turn (D10 — the server is stateless and there is NO `conversations`
 *  table; a transcript is transient rider content that `purgeUserData` must never have to chase). */
export const plannerTurn = z.object({
  role: z.enum(['rider', 'skipper']),
  text: z.string(),
})
export type PlannerTurn = z.infer<typeof plannerTurn>

/** The route the planner proposes once the rider says yes — already translated out of the model's own
 *  tool vocabulary into the shape `POST /drives/propose` takes, so the client re-sends it verbatim and
 *  never reconstructs an endpoint from a display string.
 *  ⚠ DEFINED BEFORE `drivePlanRequest` because that request now carries an array of these; a schema
 *  referenced before its `const` is initialised is a TDZ throw at import, not a type error. */
export const plannedRoute = z.object({
  start: anchorId,
  end: anchorId,
  via,
  /** Rough drive length the rider asked for, in minutes. Advisory — the route is materialized from the
   *  endpoints, and Google decides the real duration. */
  targetMinutes: z.number().int().positive().nullish(),
})
export type PlannedRoute = z.infer<typeof plannedRoute>

/** Parse-level ceiling on the drives-already-drawn context. A real conversation carries one or two
 *  cards; this only has to stop an unbounded array reaching the prompt assembler. ⚠ A SHAPE bound, so
 *  it lives here with the other shape bounds — the caps that price model tokens live in
 *  `apps/api/src/limits.ts` and cannot be imported from this package. */
export const MAX_PLAN_DRAWN = 8

/** POST /drives/plan — one conversational turn. Anonymous-capable (D14/D15).
 *
 *  ⚠ THE BOUNDS THAT MATTER ARE NOT ALL HERE, on purpose. The per-message and total-character caps
 *  live in `apps/api/src/limits.ts` because they price MODEL TOKENS, and @skipper/shared cannot import
 *  apps/api — while apps/mobile DOES import this file, so a cap value written here would ship into the
 *  app bundle and, worse, become a second home to drift from. What stays here is the SHAPE (this is a
 *  transcript of role/text pairs); what the handler enforces is the SIZE. The `.max()` below is a
 *  parse-level sanity bound only — the true message cap is MAX_PLAN_MESSAGES, enforced server-side. */
export const drivePlanRequest = z.object({
  /** Oldest first, ending with the rider's newest line. */
  turns: z.array(plannerTurn).min(1).max(100),
  /** Which region's skipper is being talked to. The anchor roster is resolved SERVER-side from this —
   *  the client never sends the allowlist, and could not be trusted with it if it did (INV-1). */
  regionId: z.uuid(),
  /**
   * The drives ALREADY DRAWN in this conversation, oldest first — the model's missing memory.
   *
   * ⚠ WHY THIS EXISTS. The transcript is text-only: `toWire` carries role + text and DROPS the route,
   * so the model cannot see that it ever called the tool. Its whole evidence of having drawn is its
   * own sentence about it — which is the single fact behind most of this surface's defects, from
   * answering "what do I call you?" with "Consider it drawn" to re-emitting an identical route on
   * "sweet". The server renders these back as a short volatile system block so the character KNOWS
   * what is already on the rider's screen.
   *
   * ⚠ IDS ONLY, AND THAT IS THE SECURITY SHAPE, not a convenience. Every field of `plannedRoute` is a
   * curated anchor id or an integer — there is no free-text field — and the server looks the NAMES up
   * from the roster it already loaded. So nothing a caller types can reach a system block, which is
   * the one place injected text would be read as authoritative. An id that is not on the region's
   * allowlist is DROPPED rather than rejected: this is context, not a routing instruction, and a
   * bad entry must never turn a legitimate conversation into an error.
   *
   * ⚠ It is CONTEXT, never a source of truth for what gets built. A caller lying here can only make
   * the skipper believe he drew something he did not; INV-1 still re-asserts every id at the wire on
   * the next real draw, and no billed call is made from this field.
   */
  drawn: z.array(plannedRoute).max(MAX_PLAN_DRAWN).optional(),
})
export type DrivePlanRequest = z.infer<typeof drivePlanRequest>

/** What a planner turn hands back.
 *
 *  ⚠ `say` IS THE ONLY THING THE RIDER EVER SEES. Everything else on this object is machine-read. The
 *  model's reasoning, its tool call, and any vendor error are never echoed (INV-13). */
export const drivePlanResponse = z.object({
  say: z.string(),
  /** Present ONLY when the rider confirmed and the planner drew it up. Its absence is the normal case,
   *  not a failure — most turns are conversation. */
  route: plannedRoute.nullish(),
  /** True when the skipper has bowed out (D12) and the client should stop offering a reply box. Kept
   *  separate from `route` because a conversation can end WITHOUT a drive, and that is a real outcome
   *  rather than an error. */
  done: z.boolean().default(false),
})
export type DrivePlanResponse = z.infer<typeof drivePlanResponse>

/** POST /drives — generate + persist the confirmed drive (consumes a credit; account-gated). */
export const createDriveRequest = z
  .object({
    start: anchorId,
    end: anchorId,
    via,
    /** Client-minted v4 UUID, STABLE across retries of one logical create. The server uses it AS the
     *  drive id, so a lost-ACK network retry hits the existing drive PK + the `drive:<id>` consume
     *  idempotency key and no-ops — exactly-once create + charge of a non-refundable credit. Optional:
     *  an older client omits it → the server mints the id → no cross-request dedupe (today's behavior). */
    idempotencyKey: z.uuid().optional(),
  })
  // ⚠ Same guard as `/propose`, and it is NOT redundant with it: a client may call create directly, and
  // this path bills a Routes call AND reaches the credit ledger. Refusing at parse is the only place the
  // rejection is free. See `isDegenerateRoute`.
  .refine((r) => !isDegenerateRoute(r), { message: DEGENERATE_ROUTE_MSG })
export type CreateDriveRequest = z.infer<typeof createDriveRequest>

/** One played clip in a drive: a place narration, with its presigned clip — the player's single clip
 *  shape. (V2: the placeless framing/asides were deleted; see docs/decisions/geometry-first-regions.md.) */
export const driveClip = z.object({
  /** ≥0, in route order. */
  seq: z.number().int(),
  form: driveClipForm,
  /** ⚠ Null for a FUSED cluster telling, by design — it is not about any one poi. Kept for
   *  compatibility with readers that key on it; `subjectId` below is the honest identity. */
  poiId: z.uuid().nullish(),
  /** The narration's SUBJECT — a poi id or a `poi_clusters` id, disambiguated by `subjectKind`.
   *  ⚠ This is what the offline store keys on (INV-6/INV-16): server-side subject identity always
   *  existed but was never projected, so the client could not tell a fused telling apart from a
   *  missing one. Do NOT key a store on `poiId` (null for fused) or on `seq` (a position in ONE
   *  drive — the same telling has a different seq in every drive that includes it). */
  subjectId: z.uuid().nullish(),
  subjectKind: z.enum(['poi', 'cluster']).nullish(),
  name: z.string().nullish(),
  /** Trigger point (the narration snapped to THIS route). */
  lat: z.number().nullish(),
  lng: z.number().nullish(),
  triggerRadiusM: z.number().int().nullish(),
  approachHeadingDeg: z.number().int().nullish(),
  /** Along-route time (s) — ordering + clock-anchored placement. */
  alongSec: z.number(),
  durationMs: z.number().int().nullish(),
  /** Presigned clip URL (short TTL); null for a silent rest beat. */
  url: z.url().nullish(),
  /** The clip's MIME type, derived server-side from the R2 key's extension. The format is DATA, not
   *  an assumption: the player stays format-agnostic and the offline download writes the extension
   *  this names instead of hardcoding one. */
  contentType: z.string().nullish(),
  attribution: attributionList.optional(),
  /** Offline-staleness token — the narration's `updatedAt`, propagated to flag a stale offline clip. */
  revisedAt: z.iso.datetime().nullish(),
})
export type DriveClip = z.infer<typeof driveClip>

/** POST /drives result / GET /drives/:id — the playable drive: route + ordered clips. */
export const driveManifest = z.object({
  /** Null for an unsaved/ephemeral manifest; set once persisted + owned. */
  driveId: z.uuid().nullable(),
  label: z.string(),
  polyline,
  distanceMeters: z.number().int().nullish(),
  durationSeconds: z.number().int().nullish(),
  clips: z.array(driveClip),
})
export type DriveManifest = z.infer<typeof driveManifest>

/** GET /drives — one card per saved drive (the caller's own; no geometry). */
/** The region a saved drive belongs to, for grouping/filtering MY DRIVES.
 *
 *  ⚠ DERIVED SERVER-SIDE PER REQUEST, never a stored column — `drives` has no `region_id` and must not
 *  grow one (`docs/decisions/geometry-first-regions.md`). The server resolves it by testing the drive's
 *  frozen START point against each released region's bbox; see `apps/api/src/region-geo.ts`.
 *
 *  ⚠ Carries `displayName` rather than leaving the client to look one up from its cached region list.
 *  That list is a CACHE and can be stale or absent (a cold install, a dead zone), and a drive rendering
 *  as "Lake Tahoe" on one launch and as a bare id on the next is worse than either. One answer, from
 *  the side that already knows it. */
export const driveRegion = z.object({
  id: z.uuid(),
  slug: z.string(),
  displayName: z.string(),
})
export type DriveRegion = z.infer<typeof driveRegion>

export const driveSummary = z.object({
  driveId: z.uuid(),
  label: z.string(),
  startName: z.string().nullish(),
  endName: z.string().nullish(),
  distanceMeters: z.number().int().nullish(),
  durationSeconds: z.number().int().nullish(),
  clipCount: z.number().int(),
  createdAt: z.iso.datetime(),
  /** ⚠ NULL IS A REAL ANSWER, not just an older server: a drive whose start sits outside every
   *  RELEASED region's bbox genuinely has no region. Both cases must render the drive — never hide a
   *  row because it failed to label, or a bbox edit silently eats part of a rider's library. */
  region: driveRegion.nullish(),
})
export type DriveSummary = z.infer<typeof driveSummary>
/** Free-tier credit balance from the user-owned ledger — for a proactive "N free drives left" hint. */
export const driveCredits = z.object({
  /** Spendable balance right now (clamped ≥ 0). */
  remaining: z.number().int(),
  /** Lifetime credits granted — for "N of <cap> left" framing. */
  cap: z.number().int(),
})

export const driveList = z.object({
  drives: z.array(driveSummary),
  /** Credit balance. `null`/absent = an older server without the field (today's handler always emits
   *  it) — the client renders the "N free drives left" hint only when present, so an absent balance
   *  degrades to hidden rather than to "unlimited". There is no uncapped tier to mean: premium is
   *  bought as CREDITS, so the ledger is always the answer (docs/decisions/cut-tiers.md). */
  credits: driveCredits.nullish(),
})
export type DriveList = z.infer<typeof driveList>
