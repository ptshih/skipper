// The LIVE PLANNER's model call — the ONE place `apps/api` talks to a model (1.1 step 6, D9/D10),
// Gemini 3.8 Flash on Vertex AI since 2026-09-23 (founder call; the provider rationale, the auth and the
// `us` multi-region live on `VERTEX` in @skipper/shared, not here).
//
// The rider plans a drive by TALKING to the Skipper. This module owns exactly one turn of that
// conversation: transcript + the region's curated anchor list in, a rider-visible `say` plus (maybe)
// an unvalidated route object out. It resolves nothing else — no DB, no Routes call, no Zod, no HTTP.
//
// ⚠ WHY THE SDK IMPORT IS QUARANTINED HERE. This is the ONLY module in the plan path that imports
// `@google/genai`, so a test can `mock.module('../src/planner', …)` and still exercise the REAL
// handler, the real caps and the real route ordering with no network and no spend. That property dies
// the moment a second module imports the SDK — or the moment this one constructs its client at import
// time (see `plannerClient` below). The anchor read is the other impure seam and stubs separately.
//
// ⚠ INV-13 — A TRANSCRIPT IS TRANSIENT RIDER CONTENT. Nothing in this file logs a request body, the
// prompt, the roster, `say`, thinking, or a function call's args, and nothing throws an error carrying
// upstream text. The one thing that leaves here on the failure path is `PlannerTurnError`, whose message
// is a fixed string — precisely so that a caller which forgets to catch it still cannot leak a vendor
// error body into `index.ts`'s `console.error('[api] unhandled error', err)`. (The Gen AI SDK's
// `ApiError.message` IS the raw response body, JSON-stringified — the reason nothing below reads it.)
//
// ⚠ INV-10 — THE PROMPT LIVES IN ./planner-prompt AND IS NOT THE NARRATION PROMPT. Never reach into
// `@skipper/studio`'s persona (fact sheets, "the card", stop kinds); never copy the deflection back the
// other way. Same voice, different job, separate review.

import { isAbsolute, resolve } from 'node:path'
import {
  ApiError,
  FunctionCallingConfigMode,
  GoogleGenAI,
  ThinkingLevel,
  type Content,
  type FunctionCall,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from '@google/genai'
import {
  geminiUsage,
  LLM_MODELS,
  LLM_THINKING_LEVEL,
  recordModelUsage,
  usageUsd,
  VERTEX,
  type GeminiUsageMetadata,
  type UsageLike,
} from '@skipper/shared'
import { byAnchorRank, flatten } from './anchor-format'
import { MAX_PLAN_ANCHORS, PLANNER_MAX_TOKENS, PLANNER_TIMEOUT_MS } from './limits'
// ⚠ The tool comes from ./planner-prompt, not from here. Its name and every field description are prose
// the MODEL reads, so it is prompt surface and changes under the prompt's review (INV-10) — a second copy
// in this file would drift silently, since nothing fails when two tool descriptions disagree.
import { PLAN_ROUTE_TOOL, PLANNER_SYSTEM_PROMPT } from './planner-prompt'

/* -------------------------------------------------------------------------- */
/* Call knobs. The rider-facing CAPS live in ./limits (INV-12), and so does the */
/* wall clock (PLANNER_TIMEOUT_MS) now that a PROCESS-WIDE socket timeout has to */
/* clear it. What is left here only means something at this one call site.      */
/* -------------------------------------------------------------------------- */

/** Thinking DEPTH: the shared LLM_THINKING_LEVEL — HIGH, by the founder's rule (2026-09-23, "always run
 *  gemini on high"). History that still matters: 'low' → 'medium' was an explicit founder call on
 *  2026-08-04 (the `route_wordless` shape, see `effort` below), and medium → high came with the Gemini
 *  move. MEASURED at HIGH on the real 132-anchor Tahoe roster, 2026-09-23: 485–3,237 thinking tokens and
 *  6–21 s to the first word (MEDIUM was ~5–7 s) — the round-the-lake ask was the slow one.
 *  ⚠ The latency is NOT hidden by streaming: thoughts are never requested (`includeThoughts` stays off),
 *  so the wire is silent for the whole thinking phase — dead air in a chat bubble before the first
 *  token. That is the accepted trade. What bounds it is PLANNER_TIMEOUT_MS, and what bounds the spend
 *  is PLANNER_MAX_TOKENS — both in ./limits, which is why no cap lives here.
 *  ⚠ WHAT TO WATCH, all already logged by `logPlanSpend`: `stop_reason` (MAX_TOKENS would mean the cap is
 *  somehow too tight), `thinking`, and `out`/`usd`; a `failed` line with `err: timeout` is the latency
 *  tail reaching the wall clock. */
const PLANNER_THINKING = ThinkingLevel[LLM_THINKING_LEVEL]

/** The eval seam's vocabulary → Gemini 3's depth enum. Production never goes through this map. */
const THINKING_LEVEL = { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH } as const

/** ⚠ NOT studio's 6 attempts — that number is tuned for a batch run that has already spent money and
 *  can afford to wait. This is a rider staring at a chat box, and every attempt bills again. The SDK
 *  retries only a non-OK HTTP status, before any body is read, so this never re-runs a stream that had
 *  started — it covers connect-time 429/5xx only. */
const PLANNER_MAX_RETRIES = 1

/* -------------------------------------------------------------------------- */
/* Inputs + result. Plain data on both sides — no SDK type crosses this seam.   */
/* -------------------------------------------------------------------------- */

/** One line of the conversation, in DOMAIN roles.
 *  ⚠ Structural on purpose, not an import of `@skipper/shared`'s `PlannerMessage`: the vendor role
 *  mapping ('rider' -> user, 'skipper' -> assistant) happens HERE and nowhere else, and keeping the
 *  shape local means a wire-DTO edit can never silently hand this module a third role. A validated
 *  `PlannerMessage[]` from the wire is assignable to this as-is. */
export interface PlannerTurnInput {
  role: 'rider' | 'skipper'
  text: string
}

/** One curated endpoint, as the planner is allowed to know it.
 *  ⚠ NAME AND ID ONLY. `lat`/`lng` would hand the model a coordinate to emit (INV-1) and `kind`
 *  ("scenic spot", "marina") is a place FACT — D9 gives the planner none. `rank` is ORDERING, never a
 *  printed field.
 *  ⚠ THE LOADER NOW MATCHES THIS SHAPE RATHER THAN MERELY BEING ASSIGNABLE TO IT. `loadRegionAnchors`
 *  used to project the wider `RegionAnchor` wire DTO — coordinates and `kind` included — and this
 *  comment said the extra columns were "simply not read". True, and one refactor away from false: the
 *  per-region roster was memoized with them in it. Since 2026-08-04 it selects id/name/rank only, so
 *  what the model may not see is absent from the process rather than politely ignored. */
export interface PlannerAnchor {
  id: string
  name: string
  rank?: number | null
}

export interface PlannerModelArgs {
  /** The whole conversation so far, oldest first, ending with the rider's new line (D10 — stateless;
   *  the client holds the transcript and re-sends it). Already bounded + validated by the caller
   *  against ./limits; the checks in here are the vendor-contract ones only. */
  turns: PlannerTurnInput[]
  /** The region the skipper works, by display name. Rides in the CACHED prefix, so it must be the
   *  region's stored name, never anything derived per-request. */
  regionName: string
  /** The region's curated `endpoint_eligible` places — the planner's ENTIRE world besides the region
   *  name (D9). An empty list is a real state (an uncurated region) and produces a skipper who honestly
   *  has nowhere to go; it is not an error here. */
  anchors: PlannerAnchor[]
  /** Optional volatile nudge (D12's wrap-up: "this conversation is near its end"). ⚠ Rendered AFTER
   *  the cache breakpoint, which is the whole reason it is a separate field instead of prose spliced
   *  into the roster — anything volatile ahead of the breakpoint re-bills the entire prefix. */
  wrapUpNotice?: string
  /** Drives already drawn in this conversation — the model's missing memory (see `buildDrawnBlock`).
   *  Ids only; names are resolved here from `anchors`. Also rendered after the cache breakpoint,
   *  because it changes the moment a route is drawn. */
  drawn?: readonly { start: string; end: string; via?: string[] | null }[]
  /** Called per chunk as the rider-visible text streams, for a caller relaying its OWN SSE frames.
   *  ⚠ Never proxy the raw vendor stream — it carries thought signatures, function-call internals and
   *  usage. Deltas already emitted are NOT retracted if the turn later fails. */
  onSay?: (delta: string) => void
  /** The RIDER'S CONNECTION.
   *  ⚠ A SPEND CONTROL AT THE DOOR, AND ONLY THERE, ON THIS PROVIDER (INV-11). A rider who is already
   *  gone when the turn starts costs NOTHING — no call is opened (the first line of runPlannerTurn). Once
   *  the call is open, aborting stops OUR side (the socket, the SSE writes, the wait) but NOT the bill:
   *  the Gen AI SDK documents abort as "a client-only operation … will not cancel the request in the
   *  service. You will still be charged" (installed 2.24.0 typings). On Claude, closing the stream did
   *  stop generation; that part of the old guarantee did not survive the move, and at ~$0.01 a turn it
   *  was accepted rather than engineered around (docs/decisions/gemini-3-8-flash.md).
   *  ⚠ COMBINED WITH — never replacing — the PLANNER_TIMEOUT_MS wall clock. The two are told apart by
   *  asking this signal whether IT aborted: `AbortSignal.any` preserves each source's own reason, and
   *  the SDK aborts with a bare `controller.abort()`, so both surface as the same reason-less
   *  AbortError. Getting that wrong logs every rider who closes the app as a vendor outage. */
  signal?: AbortSignal
  /** An EXTRA volatile system block, rendered last. Omitted in production — there is no producer.
   *
   *  ⚠ IT EXISTS SO A QUESTION CAN BE MEASURED BEFORE IT IS BUILT, and it is the cheapest half of a
   *  decision that would otherwise cost a routing dependency. The open question is whether giving the
   *  planner spatial data (drive times between curated places) makes it plan better — and whether it
   *  then LEAKS those numbers to the rider, which the prompt forbids and which published work says
   *  suppression instructions only partly prevent. This seam lets the eval inject a HAND-WRITTEN table
   *  and answer both, with no matrix, no migration, no Routes call and no Google terms exposure.
   *  ⚠ It rides AFTER the cache breakpoint, like the wrap-up notice, so an experiment can never
   *  silently re-bill the cached prefix. If this ever gains a production producer, that is a founder
   *  decision about D9 and about Google's caching terms — not a refactor. */
  extraSystem?: string
  /** Reasoning depth override — an EVAL-ONLY measurement lever. Omitted in production, which always uses
   *  the shared LLM_THINKING_LEVEL (HIGH, founder rule).
   *
   *  ⚠ IT EXISTS FOR THE EVAL PANEL AND FOR ONE MEASURED QUESTION (apps/api/eval). On Claude, lower
   *  effort was documented as making the model proceed to action WITHOUT PREAMBLE and make fewer tool
   *  calls — and the first real replay (2026-08-03) measured exactly that shape: every `tool_use` turn emitted
   *  160 output tokens, the tool JSON alone, with NO text block, while every `end_turn` turn spoke
   *  normally in 34-42. That is the `route_wordless` defect, and on this path it also destroys the
   *  model's only record of what it drew (the route never returns to it — see ./planner-prompt).
   *  A seam, not a knob: changing the PRODUCTION value is a latency and cost decision that belongs to
   *  the founder, and ./limits warns that raising effort against a fixed `max_tokens` buys
   *  finish MAX_TOKENS — which the handler classifies as `truncated` and the rider hears as
   *  VOICE.retry. Measure with this, then decide there. Sent as Gemini's `thinkingLevel`. */
  effort?: 'low' | 'medium' | 'high'
  /** Test seam — the model client to call. Omitted in production, where the lazy module-level
   *  client is used instead.
   *  ⚠ It exists because the six-outcome classifier below is the entire reason this file exists, and
   *  without an injection point it is unreachable from a test: the classifier only runs AFTER a real
   *  network call. A module-private client would mean the one piece of logic that decides whether a
   *  rider's "yes" turns into a drive could never be exercised without spending money. Anything
   *  structurally compatible with `models.generateContentStream()` is enough — the tests pass a
   *  hand-rolled double, not a real SDK instance. */
  client?: PlannerClient
}

/** The one method this module calls, as a structural type — the seam `client` above fills. */
export interface PlannerClient {
  models: {
    generateContentStream(params: GenerateContentParameters): Promise<AsyncIterable<GenerateContentResponse>>
  }
}

/**
 * What the turn actually was. Derived from the FINISH REASON first, never from "is there a call".
 * (Gemini has no `tool_use` finish — a reply carrying a function call still finishes STOP, probed — so
 * the call's presence decides route-vs-say only AFTER the finish has ruled out every failure.)
 *
 * ⚠ THE WHOLE POINT OF THIS UNION. A truncated turn is HTTP 200 with a half-parsed tool call or none
 * at all — byte-identical, from the caller's side, to "the planner chose not to route this turn". One
 * of those is a normal chat beat and the other is a paid call that produced nothing; treating them the
 * same is how a rider says yes and watches nothing happen.
 */
export type PlannerOutcome =
  /** A normal conversational beat. `say` is set, no route. */
  | 'say'
  /** The rider said yes and the model drew it up. The ONLY outcome that may carry a route. */
  | 'route'
  /** Finish MAX_TOKENS — output was cut off. Any function call present is DISCARDED unread. */
  | 'truncated'
  /** A safety block — the prompt (`promptFeedback.blockReason`) or the reply (finish SAFETY,
   *  PROHIBITED_CONTENT, BLOCKLIST, SPII, RECITATION). ⚠ Never echo any explanation. */
  | 'refused'
  /** The stream ended with no finish reason, or with one that means the call itself went wrong
   *  (MALFORMED_FUNCTION_CALL, UNEXPECTED_TOOL_CALL, OTHER…). Nothing is trustworthy; the exact finish
   *  rides `stopReason` into the cost line, so the kind stays measurable. */
  | 'aborted'
  /** Ended cleanly but produced neither text nor a route. The caller owes the rider a line. */
  | 'empty'

export interface PlannerTurn {
  outcome: PlannerOutcome
  /** The rider-visible text, joined from the turn's text parts. May be non-empty even on a failed
   *  outcome (the model got a sentence out before it was cut off) — show it, then add the retry line. */
  say: string
  /**
   * The function call's args VERBATIM, or null. `unknown` on purpose: it is model output, and the type system is
   * the thing making the caller parse it.
   *
   * ⚠ THREE TRANSLATIONS THE CALLER OWES, and all three are load-bearing:
   *   1. The keys are the TOOL's (`start_anchor_id`, `end_anchor_id`, `via_anchor_ids`, `round_trip`,
   *      `target_minutes` — see ./planner-prompt), not the wire DTO's. The model reads one, the client
   *      reads the other; they are deliberately not the same names.
   *   2. `round_trip: true` is NOT `driveProposeRequest`'s loop shape. Here it means "come back around";
   *      there a loop is `end === start` with the turnaround as the LAST `via` midpoint. Map it:
   *      `{ start, end: start, via: [...(via ?? []), end] }` — which is also why the tool caps `via` at
   *      6 while the shared schema allows 8.
   *   3. Every id is re-asserted against the same allowlist this turn was given (`args.anchors`, as a
   *      Set), and the whole route is DROPPED — degrading to a `say` turn plus a `route_off_roster`
   *      signal — if any misses. ⚠ THAT IS A UX GUARD, NOT INV-1. INV-1 is enforced at the WIRE, in the
   *      QUERY (`resolveRouteAnchors` → `hydrateAnchors`, ./drives), and that is what stands between an
   *      anonymous request and a billed Routes call. This one is strictly weaker on purpose: the roster
   *      is memoized (`PLAN_ROSTER_MEMO_TTL_MS`), so it catches a FABRICATED id but not a place an
   *      operator de-curated a minute ago. Its whole job is that a rider is not handed a card whose tap
   *      is a 400. Do not consolidate them — the stale one cannot be the guard, and the authoritative
   *      one cannot run before the rider taps.
   */
  rawRoute: unknown
  /** The finish reason verbatim from the API, for logs and for a caller that wants to branch further. */
  stopReason: string | null
  /** The model version that actually served the turn (the vendor's echo — NOT the pricing key). */
  model: string
  /** Token counts for this call. Already recorded + priced here; returned so a caller can attribute. */
  usage: UsageLike
}

/**
 * The only error this module throws, and it carries NOTHING from upstream.
 *
 * ⚠ `message` is a fixed string and `reason` is a closed set precisely so that this is safe to log, safe
 * to bubble, and impossible to accidentally render. An `ApiError`'s `.message` is the raw response
 * body — which can quote the offending request field, i.e. rider text (INV-13) — and
 * `index.ts`'s catch-all logs whatever reaches it. So the vendor error stops here, always.
 */
export class PlannerTurnError extends Error {
  readonly code = 'planner_turn_failed' as const
  constructor(
    /** `bad_transcript` -> 400 (the caller sent a shape the vendor would reject); `not_configured` ->
     *  500 (ours to fix); `timeout` / `upstream` -> 503 (retryable). All four want an IN-PERSONA line.
     *  `client_gone` is the odd one out and wants NOTHING: the rider disconnected, so there is no
     *  response to write, no line to say, and nothing to log as an outage. It exists because at the type
     *  level a rider hanging up is indistinguishable from a vendor timeout — see plannerCancelled. */
    readonly reason: 'bad_transcript' | 'not_configured' | 'timeout' | 'upstream' | 'client_gone',
  ) {
    super('the live planner could not complete this turn')
    this.name = 'PlannerTurnError'
  }
}

/* -------------------------------------------------------------------------- */
/* The client — lazy, and that is not a style preference.                       */
/* -------------------------------------------------------------------------- */

let client: PlannerClient | null = null

/**
 * ⚠ NEVER CONSTRUCT AT MODULE SCOPE. `apps/api` must keep booting env-free: `GET /health` and
 * `/version` have no business needing Google credentials, and auth.ts is already the one hard
 * throw-at-load this app tolerates. The SDK also resolves credentials lazily (ADC: the metadata server on
 * Cloud Run, a key file locally), so a constructor at import time would be a latent probe on every boot.
 * ⚠ The project is read by the NAME `VERTEX.projectEnv`, the same name every other readiness check uses;
 * the SDK's own env fallback is not trusted, because a client with no project fails on the first rider
 * request with an SDK error instead of naming the variable an operator has to set.
 * ⚠ The Cloud Run service account needs `roles/aiplatform.user` — without it every turn is a 403, which
 * `plannerFailure` logs as `err: 'permission_denied'`.
 */
function plannerClient(): PlannerClient {
  if (client) return client
  const project = process.env[VERTEX.projectEnv]
  if (!project) {
    // Actionable server-side; the rider gets the in-persona outage line and never this text.
    console.error(`[planner] ${VERTEX.projectEnv} is not set — POST /drives/plan cannot run`)
    throw new PlannerTurnError('not_configured')
  }
  client = new GoogleGenAI({
    vertexai: true,
    project,
    location: VERTEX.location,
    googleAuthOptions: { keyFilename: credentialsPath() },
  })
  return client
}

/** GOOGLE_APPLICATION_CREDENTIALS resolved against the REPO ROOT when relative: `.env.development`
 *  names `./keys/…`, and `bun --filter @skipper/api dev` runs this app from apps/api, where that path
 *  does not exist. Unset in production (Cloud Run answers through the metadata server), so this returns
 *  undefined there and the SDK takes its default ADC. (apps/admin/server/jobs.ts found this first.) */
function credentialsPath(): string | undefined {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!path) return undefined
  return isAbsolute(path) ? path : resolve(import.meta.dir, '..', '..', '..', path)
}

/* -------------------------------------------------------------------------- */
/* Prompt assembly.                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The region + anchor list, as the second system-instruction part.
 *
 * ⚠ THIS IS THE STABLE PREFIX AND IT MUST BE BYTE-STABLE ACROSS TURNS. Gemini's implicit cache matches
 * on an identical request PREFIX; a permuted row order rewrites it, and a broken cache is INVISIBLE in
 * the response body — it just quietly bills the whole prompt at full price on every turn, forever, on an
 * anonymous route (INV-11). (Implicit caching is best-effort: on 2026-09-23 the SECOND real Tahoe turn
 * read 4,038 of its ~11.4k prompt tokens from cache, while synthetic probes never hit — so nothing depends
 * on it, but a prefix that CAN'T match guarantees it never will.) `loadRegionAnchors`
 * sorts, but this sorts again anyway: the cost is microseconds and it makes the guarantee local instead
 * of dependent on a query three files away staying sorted.
 *
 * Exported for a test to assert the D9 shape — names and ids, no coordinates, no `kind` — without a
 * network call.
 */
export function buildRosterBlock(regionName: string, anchors: PlannerAnchor[]): string {
  // ⚠ The comparator is SHARED (./anchor-format) and codepoint-based on purpose — locale/ICU
  // differences between processes would make the stable prefix differ between Cloud Run instances for
  // the same region. Read its doc before touching it; the expensive half of that rule is this one.
  const printable = [...anchors].sort(byAnchorRank)

  if (printable.length > MAX_PLAN_ANCHORS) {
    // ⚠ NOT REACHABLE FROM PRODUCTION, AND THAT IS NOW BY DESIGN RATHER THAN BY ACCIDENT.
    // `loadRegionAnchors` (./drives) selects `MAX_PLAN_ANCHORS + 1`, emits the `anchor_roster_truncated`
    // line and trims — so a roster arriving here is already at or under the cap. THAT is the operator
    // signal; this is the belt to it, kept for direct callers (tests, and any future producer that does
    // not go through the loader). It used to be the ONLY signal, which was the defect: the loader trimmed
    // to EXACTLY the cap, so this branch could never fire and a region that had outgrown the planner's
    // world was indistinguishable from one that fit.
    // Log the count, never the names.
    console.warn(`[planner] anchor list truncated to ${MAX_PLAN_ANCHORS} of ${printable.length}`)
    printable.length = MAX_PLAN_ANCHORS
  }

  // ⚠ Collapse whitespace in curated names. This block is a SYSTEM block, which the model reads as
  // authoritative; a name carrying a newline would forge an extra roster row — an off-list place the
  // planner believes it can send a rider to.
  const rows = printable.map((a) => `${flatten(a.name)}  |  ${a.id}`).join('\n')

  return [
    '== The country you work ==',
    '',
    `${flatten(regionName)}.`,
    '',
    '== The places you can start or end a drive at ==',
    '',
    // ⚠ THE SECOND SENTENCE IS A GUARD, NOT A COURTESY. `byAnchorRank` puts low-`rank` rows first and
    // then sorts alphabetically, and D9 gives the model no coordinates at all — so a model handed a
    // ranked list with no explanation of the ranking will read list POSITION as proximity ("these two
    // are next to each other") or as quality ("the top one is the good one") and route on it. ~20
    // tokens inside the cached prefix closes both readings.
    'This is the whole list, the ones folks ask for most at the top and the rest in no particular ' +
      'order. Where a name sits on this list says nothing about where the place sits on the map. ' +
      'Name first, then the id you copy when you draw a route up.',
    '',
    rows,
  ].join('\n')
}

/**
 * The drives already on the rider's screen, as the model's missing memory.
 *
 * ⚠ THIS IS THE FIX FOR THE DEFECT CLASS THAT CAUSED MOST OF THIS SURFACE'S BUGS. The transcript is
 * text-only — `toWire` carries role + text and drops the route — so the model cannot see that it ever
 * called the tool, and its entire evidence of having drawn is its own sentence. That is why it
 * answered "What do I call you?" with "Consider it drawn", why it re-emitted identical routes on
 * "sweet", and why judging "is this a DIFFERENT drive?" was guesswork. Now it is told.
 *
 * ⚠ NAMES ARE RESOLVED HERE, FROM THE ROSTER — the caller sends ids only. That is what keeps rider
 * text out of a system block, which is the one place injected prose would be read as authoritative.
 * An id not on this region's allowlist is DROPPED silently: this is CONTEXT, not a routing
 * instruction, so a stale or forged entry must degrade to "he remembers one fewer drive" and never to
 * an error or a fabricated place name.
 *
 * ⚠ It says nothing about round trips. `PlannedRoute` encodes a loop as `end === start` with the
 * turnaround as the last midpoint, and re-deriving that shape here would put a second copy of the
 * translation rule (./plan-route owns it) somewhere nobody would think to keep in sync. Naming the
 * places in order is enough for the model to recognise its own drive.
 *
 * Exported for tests. Returns null when there is nothing to say, so the caller can omit the block
 * rather than send an empty one.
 */
export function buildDrawnBlock(
  drawn: readonly { start: string; end: string; via?: string[] | null }[],
  anchors: readonly PlannerAnchor[],
): string | null {
  const byId = new Map(anchors.map((a) => [a.id, a.name]))
  const lines: string[] = []
  for (const r of drawn) {
    const stops = [r.start, ...(r.via ?? []), r.end].map((id) => byId.get(id))
    // One unknown id makes the whole drive unnameable — skip it rather than print a gap the model
    // would have to interpret.
    if (stops.some((n) => !n)) continue
    lines.push(`${flatten(stops.join(' to '))}.`)
  }
  if (lines.length === 0) return null
  // ⚠ IT RESTATES A RULE THE PROMPT ALREADY TEACHES, AND THAT DUPLICATION IS DELIBERATE — MEASURED,
  // NOT ASSUMED. `== Once it is drawn ==` says the same thing in the cached prefix, so on the usual
  // "one rule, one home" reasoning these two sentences are drift and were removed on 2026-08-04.
  // Four replays later they came back: with the rule stated ONLY in the prompt, the re-emit defect
  // reappeared at 0,1,1,0 across 4 runs (200 turns) against 0,0 across 2 runs with it here.
  //
  // ⚠ SO DO NOT "CLEAN THIS UP". A prompt is not a module: the model reads by salience and recency,
  // not by resolution, and a rule sitting next to the data it governs is doing work that the same
  // rule 3,000 cached tokens earlier does not. Code-quality doctrine loses to the measurement here.
  // The evidence is weak (2 occurrences in 200 turns vs 0 in 100 — not a distinguishable rate) and it
  // is kept anyway, because the duplication costs a few tokens while the defect is the one the founder
  // reported. Re-run `bun apps/api/eval/run.ts --apply --no-judge` before touching it.
  return [
    '== Drives already on their screen ==',
    '',
    'You drew these for these folks, earlier in this conversation. They can see them right now, so',
    'you do not draw one of these again, and you do not announce one as though you just made it.',
    '',
    ...lines,
  ].join('\n')
}

/**
 * Domain roles -> vendor roles, with the two vendor-contract checks that belong at this seam.
 *
 * ⚠ THE TRANSCRIPT IS CALLER-CONTROLLED (D10), skipper turns included — so a forged shape must fail as
 * OUR 400 before we spend, not as a vendor 400 after we do. A leading model turn is not a conversation,
 * and a TRAILING one is a PREFILL, which Gemini 3.8 rejects outright ("history payloads cannot end with
 * a model role turn"). Both would surface to the rider as a mysterious outage on a message they typed
 * innocently.
 *
 * Text-only history: the transcript carries no function calls, so there is no functionResponse to owe
 * and no thought signature to replay — Gemini enforces signatures on function-call parts only. The
 * model's own prose already restates the route it proposed, which is the only context the next turn
 * needs.
 */
function toModelContents(turns: PlannerTurnInput[]): Content[] {
  const kept = turns.filter((t) => t.text.trim().length > 0)
  const first = kept[0]
  const last = kept[kept.length - 1]
  if (!first || !last || first.role !== 'rider' || last.role !== 'rider') {
    throw new PlannerTurnError('bad_transcript')
  }
  return kept.map((t) => ({ role: t.role === 'rider' ? 'user' : 'model', parts: [{ text: t.text }] }))
}

/* -------------------------------------------------------------------------- */
/* The call.                                                                    */
/* -------------------------------------------------------------------------- */

/** What the stream has delivered so far — everything the classifier, the salvage path and the cost line
 *  read, and nothing that would drag an SDK instance across a test seam. */
interface StreamState {
  text: string
  /** Every function call in arrival order. Gemini has no `disable_parallel_tool_use`; the classifier
   *  takes the FIRST `plan_route`, so "the route" is still unambiguously at most one. */
  calls: FunctionCall[]
  finish?: string
  /** The latest metadata that carried token counts. ⚠ Gemini reports usage on the FINAL chunk only
   *  (probed: earlier chunks carry just `trafficType`), so a stream that dies early has none to salvage. */
  usage?: GeminiUsageMetadata
  servedBy?: string
  responseId?: string
  blockReason?: string
}

/**
 * Run ONE planner turn.
 *
 * ⚠ THIS SPENDS ON EVERY RIDER REQUEST, forever, anonymously, with no `--apply` and no human in the
 * loop (INV-11). Its only guards are the explicit model + `maxOutputTokens` below, the caller's bounded
 * body and rate limiters (./limits), and the tally recorded here. Weakening any of them is a cost
 * regression, not a UX tweak.
 */
export async function runPlannerTurn(args: PlannerModelArgs): Promise<PlannerTurn> {
  // The cheapest saving available on this path: the rider may already be gone (they hung up while the
  // region + anchor read was in flight). Spend nothing at all rather than spending and discarding.
  if (args.signal?.aborted) throw new PlannerTurnError('client_gone')

  const contents = toModelContents(args.turns)
  // ⚠ The injected client wins when present (tests); production omits it and pays the lazy
  // construction below, which is what keeps Google credentials off the module-load path.
  const model = args.client ?? plannerClient()

  // The system instruction as ordered PARTS: the static prompt, then the region's roster — the stable
  // prefix, one per region — then the volatile slots, which must stay after it. ⚠ There is no cache
  // breakpoint to place on Gemini (implicit caching matches a common prefix on its own, with a 4,096-
  // token minimum on Gemini 3); what survives from the Claude design is the ORDER, which is what lets a
  // prefix match at all.
  const system: { text: string }[] = [{ text: PLANNER_SYSTEM_PROMPT }, { text: buildRosterBlock(args.regionName, args.anchors) }]
  // ⚠ BEFORE the wrap-up notice, so the LAST thing the model reads on a long conversation is still
  // "bow out" rather than a list of drives — the wrap-up is the instruction that has to win at the
  // recency edge.
  const drawnBlock = args.drawn?.length ? buildDrawnBlock(args.drawn, args.anchors) : null
  if (drawnBlock) system.push({ text: drawnBlock })
  if (args.wrapUpNotice) system.push({ text: args.wrapUpNotice })
  // Experiment-only, and last so it can never sit inside the stable prefix.
  if (args.extraSystem) system.push({ text: args.extraSystem })

  // ⚠ BOTH LOCALS STAY REFERENCED for the life of the call, deliberately. A composite AbortSignal whose
  // only strong reference lives inside the SDK has been GC-collectable in some runtimes; holding the
  // sources here makes the question moot. `deadline` is the hard wall clock (./limits); `args.signal` is
  // the rider hanging up. `AbortSignal.any` preserves whichever fired, which is what lets the catch
  // below tell a cancellation from a timeout.
  const deadline = AbortSignal.timeout(PLANNER_TIMEOUT_MS)
  const signal = args.signal ? AbortSignal.any([args.signal, deadline]) : deadline

  const params: GenerateContentParameters = {
    // ⚠ From the constant, never a bare string, and never the `quality` key — that one is the studio
    // pipeline's model and repointing it changes what a fail-closed eval gate is calibrated against.
    model: LLM_MODELS.planner,
    contents,
    config: {
      systemInstruction: { parts: system },
      // ⚠ Bounds THINKING PLUS visible output in ONE budget. Too low does not raise — see ./limits.
      maxOutputTokens: PLANNER_MAX_TOKENS,
      // ⚠ INV-8: THINKING STAYS ON — structurally now: Gemini 3.8 has no "off" (LOW is the floor, and
      // MINIMAL is a 400). The Claude-era failure it guards against — a tool call written into VISIBLE
      // TEXT, the turn succeeding with no route — is what `includeThoughts` staying unset and the
      // LEAKED_TOOL_CALL guard downstream (./plan-route) still cover. Thoughts are never requested, so
      // rider-facing text can never carry reasoning.
      thinkingConfig: { thinkingLevel: args.effort ? THINKING_LEVEL[args.effort] : PLANNER_THINKING },
      tools: [
        {
          functionDeclarations: [
            {
              name: PLAN_ROUTE_TOOL.name,
              description: PLAN_ROUTE_TOOL.description,
              parametersJsonSchema: PLAN_ROUTE_TOOL.parameters,
            },
          ],
        },
      ],
      // VALIDATED, not ANY: the model may answer in prose OR call the function — the reasoning lives on
      // PLAN_ROUTE_TOOL in ./planner-prompt; in one line, a forced call would pressure the model to fill
      // route fields on a turn where the rider named no place. VALIDATED rather than AUTO because it
      // ENFORCES the schema and, on Gemini 3, the required fields — `say` included, which is the field
      // the wordless-draw fix depends on.
      toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.VALIDATED } },
      abortSignal: signal,
      // The per-ATTEMPT timeout, and retries on a non-OK status only (see PLANNER_MAX_RETRIES). `signal`
      // above is the hard wall clock over the whole call, fused with the rider's own connection.
      httpOptions: { timeout: PLANNER_TIMEOUT_MS, retryOptions: { attempts: PLANNER_MAX_RETRIES + 1 } },
    },
  }

  const state: StreamState = { text: '', calls: [] }
  try {
    const stream = await model.models.generateContentStream(params)
    for await (const chunk of stream) absorb(state, chunk, args.onSay)
  } catch (err) {
    // ⚠ ORDER MATTERS, AND IT IS NOT COSMETIC. The SDK raises the same reason-less AbortError for BOTH a
    // rider disconnect and our own wall clock, and plannerFailure classifies it as 'timeout' — so
    // without this branch every rider who closes the app is recorded as a vendor outage, which is
    // precisely the signal an operator would page on. The rider's OWN signal is the only thing that
    // tells them apart.
    if (args.signal?.aborted) throw plannerCancelled(state)
    throw plannerFailure(err, state)
  }

  const usage = geminiUsage(state.usage)
  // ⚠ THE COST LINE BELOW IS THE GUARD ON THIS SPEND — `recordModelUsage` IS NOT. Read that the other
  // way round and you will trust a number nobody can see: INV-11 names a recorded token tally among its
  // guards and this call IS that tally, but @skipper/shared's tally is a PROCESS-GLOBAL Map with NO
  // reader anywhere in `apps/api` — `llmSpentUsd`/`llmSpendLines` are read only by the studio CLIs,
  // where one process is one run that prints and exits. Here the process is an autoscaled Cloud Run
  // instance created and recycled at will, so no readout is possible, and one would MISLEAD if it were:
  // an unknown fraction of the fleet's real spend, presented as the number. What actually makes this
  // spend visible is the per-call `plan_spend` line — it leaves the instance, aggregates across the
  // fleet in Cloud Logging, and is what a budget alert can be built on. The call stays because it is
  // free, bounded in entries (keyed by model — only the counters grow), and correct for any future
  // in-process reader; it is simply not the thing standing between a rider and an unbounded bill.
  //
  // ⚠ Keyed on the model we ASKED for, never on the echoed `modelVersion`. The API is not contractually
  // bound to echo the id back verbatim, and MODEL_PRICING is keyed on the id we send, so pricing the
  // echo could silently tally $0 under a second, unpriced key — and the drift guard CANNOT catch it,
  // because it validates the requested ids. The echo is still worth having as the served-by signal, so
  // the line carries BOTH, under two names: `model` (the pricing key) and `served_by` (what answered).
  recordModelUsage(LLM_MODELS.planner, usage)
  logPlanSpend({
    outcome: 'served',
    // A finished stream that never reported counts is logged as unreported, not as a free turn.
    usage: state.usage ? usage : null,
    thinking: state.usage?.thoughtsTokenCount ?? 0,
    servedBy: state.servedBy,
    stopReason: state.finish ?? state.blockReason ?? null,
    anchors: args.anchors.length,
    requestId: state.responseId,
  })

  const base = {
    say: state.text,
    rawRoute: null,
    stopReason: state.finish ?? null,
    model: state.servedBy ?? LLM_MODELS.planner,
    usage,
  }

  // A prompt the safety system blocked before generating has NO candidate — only a block reason.
  if (state.blockReason) return { ...base, outcome: 'refused' }

  switch (state.finish) {
    case 'STOP': {
      const call = state.calls.find((c) => c.name === PLAN_ROUTE_TOOL.name)
      // A call under any other name is not a route (the classifier matches identity, not shape).
      if (!call) return { ...base, outcome: state.text ? 'say' : 'empty' }
      // ⚠ THE LINE MAY ARRIVE INSIDE THE CALL, and on a draw turn it essentially always does — the model
      // emits the call and no text part at all (measured on Claude 2026-08-03, and the 2026-09-23 Gemini
      // probe did the same; see PLAN_ROUTE_TOOL's note). A real text part still WINS when one exists, so
      // a model that speaks both ways loses nothing and the `say`-first ordering never overrides prose
      // the rider already saw streaming. Guarded rather than cast: `args` is model output, so a
      // non-string `say` must read as absent and fall through to the handler's backstop instead of
      // putting `[object Object]` on screen.
      const spoken = (call.args as { say?: unknown } | undefined)?.say
      const fromTool = typeof spoken === 'string' ? spoken.trim() : ''
      return { ...base, say: state.text || fromTool, outcome: 'route', rawRoute: call.args ?? null }
    }

    // ⚠ THE SILENT FAILURE, AND WHY IT IS BRANCHED BEFORE THE CALL LOOKUP. A truncated turn can carry a
    // call whose args Zod may well accept — an incomplete route the rider would tap straight into a bad
    // drive. Discard it unread; keep whatever text arrived.
    case 'MAX_TOKENS':
      return { ...base, outcome: 'truncated' }

    // The safety system declined. Any detail it carries is NEVER echoed (INV-13).
    case 'SAFETY':
    case 'PROHIBITED_CONTENT':
    case 'BLOCKLIST':
    case 'SPII':
    case 'RECITATION':
      return { ...base, outcome: 'refused' }

    // No finish at all (the stream ended without one), or a finish that means the call itself went wrong
    // — MALFORMED_FUNCTION_CALL is Gemini's structured version of the leak ./tool-call-leak guards
    // against in prose. Both mean "nothing here is trustworthy" — free to handle, expensive to assume away.
    default:
      return { ...base, outcome: 'aborted' }
  }
}

/** Fold one streamed chunk into the turn. Text streams to the rider as it lands; everything else waits
 *  for the end — a partial route is not a route. */
function absorb(state: StreamState, chunk: GenerateContentResponse, onSay: PlannerModelArgs['onSay']): void {
  if (chunk.modelVersion) state.servedBy = chunk.modelVersion
  if (chunk.responseId) state.responseId = chunk.responseId
  if (chunk.promptFeedback?.blockReason) state.blockReason = String(chunk.promptFeedback.blockReason)
  // Only metadata that carries counts replaces what we hold — earlier chunks carry `trafficType` alone.
  if (chunk.usageMetadata?.promptTokenCount !== undefined) state.usage = chunk.usageMetadata
  const candidate = chunk.candidates?.[0]
  for (const part of candidate?.content?.parts ?? []) {
    // Thoughts are never requested, so none should arrive; one that did must still never reach a rider.
    if (part.thought) continue
    if (part.functionCall) state.calls.push(part.functionCall)
    if (typeof part.text === 'string' && part.text.length > 0) {
      state.text += part.text
      // ⚠ Guarded, and the guard is the point. A caller whose handler throws — an SSE write to a
      // connection the rider just closed, which is the ordinary case, not an edge one — would otherwise
      // surface out of the stream loop, be classified as an upstream failure and logged as a vendor
      // outage, and the turn we already paid for would be thrown away. Swallowing is consistent with
      // deltas being unretractable anyway.
      if (onSay) {
        try {
          onSay(part.text)
        } catch {
          // The rider is gone or the sink is broken; neither is the model's fault and neither is
          // recoverable here. The full text is still accumulated above.
        }
      }
    }
  }
  if (candidate?.finishReason) state.finish = String(candidate.finishReason)
}

/** Salvage whatever this dead call already reported, so the cost line and the tally both see it.
 *
 * ⚠ THE SPEND HAS ALREADY HAPPENED — on Gemini, all of it: an aborted call still runs to completion
 * and bills in the service (see `signal` above). The stream died, so the normal recording in runPlannerTurn
 * never runs — without this, every cancelled or timed-out turn that DID report usage is money that
 * shows up nowhere. ⚠ And on Gemini that is the rare case: usage arrives on the FINAL chunk only, so a
 * turn cut off mid-stream has no counts to salvage at all. The line then says so (`usage_reported:
 * false`) instead of letting zeros read as "free" — a spend figure summed over an event that silently
 * omits its own failures under-reports, and an under-reporting guard is worse than no guard because it
 * reads as reassurance.
 * ⚠ It CANNOT double-count: the stream either finished (the normal recording) or threw (this one).
 */
function salvageUsage(state: StreamState): UsageLike | null {
  if (!state.usage) return null
  const usage = geminiUsage(state.usage)
  recordModelUsage(LLM_MODELS.planner, usage)
  return usage
}

/* -------------------------------------------------------------------------- */
/* The cost line — ONE structured event per model call (1.7(b)).                */
/* -------------------------------------------------------------------------- */

interface PlanSpendInput {
  /** WHY this call ended, as a closed enum — the field that replaces three differently-worded human
   *  lines. Total spend over a window is now a SUM over one `evt`, filtered or not by this. */
  outcome: 'served' | 'cancelled' | 'failed'
  /** null when the call reported no usage — it died before its final chunk. Still logged, as zeros
   *  with `usage_reported: false`: a sum over this event must be able to count every turn, and "no
   *  line", "no spend" and "spend we could not see" must stay three different observations. */
  usage: UsageLike | null
  /** How much of `usage.output_tokens` was thinking. */
  thinking?: number
  /** The vendor's echo — what actually served the turn. NEVER the pricing key; see runPlannerTurn. */
  servedBy?: string
  stopReason?: string | null
  anchors?: number
  requestId?: string | null
  /** Failure path only. A closed error class (ours), never a vendor message. */
  err?: string
  /** Failure path only. HTTP status, absent when the failure never got one. */
  status?: number
}

/**
 * Emit the turn's cost as ONE LINE of serialized JSON.
 *
 * ⚠ THE SINGLE LINE AND THE `evt` FIELD ARE THE WHOLE POINT, AND NEITHER IS COSMETIC. Cloud Run drops a
 * plain text line into a LogEntry's `textPayload`, which cannot be queried by field and cannot back a
 * metric; a single line of serialized JSON is parsed into `jsonPayload`, where `jsonPayload.usd` is a
 * numeric field a log-based DISTRIBUTION metric reads with no extractor regex at all. A JSON object
 * split across lines is NOT reassembled — each line becomes its own plain-text entry. Sources, so the
 * next agent re-checks them rather than trusting this comment:
 *   https://docs.cloud.google.com/run/docs/logging — "a single line of serialized JSON … is picked up
 *     and parsed by Cloud Logging and is placed into jsonPayload"
 *   https://docs.cloud.google.com/logging/docs/structured-logging — the reserved keys lifted OUT of
 *     jsonPayload onto the LogEntry: `severity`, `message`, `httpRequest`, `logging.googleapis.com/*`
 *     and the time fields
 *   https://docs.cloud.google.com/logging/docs/logs-based-metrics/distribution-metrics — an
 *     already-numeric field needs no regular expression, only its name
 *
 * ⚠ NO FIELD IS NAMED `message`. It is one of those reserved keys, so a `message` key would be lifted
 * out of `jsonPayload` entirely — the field an operator reaches for first is the one that vanishes.
 * `severity` is reserved for the same reason, which is precisely why setting it works.
 *
 * ⚠ INV-13 — EVERY FIELD HERE IS A COUNT, AN ID, OR A CLOSED ENUM, and there is deliberately no field
 * that CAN hold prose: `outcome` is ours from a three-value set, `stop_reason` is a vendor enum, `err`
 * is ours, `model`/`served_by` are model ids, `req` is a response id, and the rest are numbers. The
 * transcript, the roster, `say`, thinking and the call args have nowhere to land even by accident. The
 * single-line guarantee is `JSON.stringify`'s, not ours — it escapes any newline inside a string field.
 */
function logPlanSpend(i: PlanSpendInput): void {
  const failed = i.outcome === 'failed'
  const line = {
    // ⚠ EXPLICIT, AND ON THE FAILURE LINE IT IS LOAD-BEARING. This field is the only DOCUMENTED way to
    // set severity: Cloud Logging lifts `severity` out of `jsonPayload` onto the LogEntry, so it wins
    // outright. The stream a line is written to (stderr => ERROR) is only a FALLBACK for lines carrying
    // no severity, and it is not stated on Cloud Run's own logging page — it is agent behaviour
    // documented for GKE/Functions. So: do not rely on the stream alone (it is undocumented here), and
    // do not drop this field on the assumption the stream covers it (it is then the only signal, and a
    // JSON line without it silently DEMOTES the one entry an operator pages on to a healthy turn's
    // severity). Belt AND braces, deliberately — see the `console.error` at the bottom of this function,
    // and ./rate-limit.ts, which states the same rule from the other side.
    // Derived from `outcome` in exactly one place so the two can never disagree: a rider hanging up is
    // INFO because it is not an outage (see plannerCancelled).
    severity: failed ? 'ERROR' : 'INFO',
    evt: 'plan_spend',
    outcome: i.outcome,
    /** The PRICING key — the id we asked for, the key MODEL_PRICING and the tally are both keyed on. */
    model: LLM_MODELS.planner,
    served_by: i.servedBy,
    stop_reason: i.stopReason ?? undefined,
    err: i.err,
    status: i.status,
    anchors: i.anchors,
    // False only when the call died before reporting — its zeros then mean "unknown", not "free".
    usage_reported: i.usage !== null,
    in: i.usage?.input_tokens ?? 0,
    // `cache_read: 0` across a conversation means the implicit cache is not matching. It is best-effort
    // (a real second Tahoe turn read 4,038 cached tokens on 2026-09-23), so an occasional zero is normal;
    // a region that NEVER shows a read is one whose prefix is broken or under the 4,096-token minimum.
    cache_read: i.usage?.cache_read_input_tokens ?? 0,
    cache_write: i.usage?.cache_creation_input_tokens ?? 0,
    out: i.usage?.output_tokens ?? 0,
    thinking: i.thinking ?? 0,
    // ⚠ A JSON NUMBER, never a formatted `$0.00018` string: the distribution metric reads a numeric
    // field directly, while a currency-prefixed string forces an extractor regex that starts silently
    // matching nothing the day someone tidies the prefix. Rounded only to keep float tails out of the
    // logs — six places is far finer than one turn can cost.
    usd: i.usage ? Math.round(usageUsd(LLM_MODELS.planner, i.usage) * 1e6) / 1e6 : 0,
    req: i.requestId ?? undefined,
  }
  // ⚠ STILL console.error ON FAILURE. `severity` is what Cloud Logging reads, but stderr is what every
  // local `bun run dev` session, container log tail and test spy reads — demoting the stream would hide
  // the failure everywhere the JSON is not being parsed.
  if (failed) console.error(JSON.stringify(line))
  else console.info(JSON.stringify(line))
}

/**
 * The rider hung up. Salvage the spend and log it as what it is.
 *
 * ⚠ NEVER `outcome: 'failed'` HERE, AND NEVER `severity: 'ERROR'`. An operator alerts on the failure
 * bucket; a rider closing the app is not an outage, and a cancellation filed as a failure is how a
 * perfectly healthy service looks like it is on fire the day the app gets popular. Under the old
 * human-formatted lines this was a rule about the WORD "failed"; the rule did not change, only where it
 * is written down — it is now the `outcome` enum plus the severity `logPlanSpend` derives from it.
 * ⚠ It still emits when nothing was billed. Same `evt`, zeros, so summing the event counts the turn.
 */
function plannerCancelled(state: StreamState): PlannerTurnError {
  const usage = salvageUsage(state)
  logPlanSpend({
    outcome: 'cancelled',
    usage,
    thinking: state.usage?.thoughtsTokenCount ?? 0,
    requestId: state.responseId,
  })
  return new PlannerTurnError('client_gone')
}

/** An HTTP status as a closed class — ours, so no vendor text can ride it into a log. */
function errorClass(status: number): string {
  if (status === 429) return 'rate_limited'
  if (status === 401) return 'unauthenticated'
  if (status === 403) return 'permission_denied'
  if (status === 404) return 'not_found'
  if (status >= 500) return 'server_error'
  return 'invalid_request'
}

/**
 * Classify a vendor failure into something safe to carry, and log the safe half of it.
 *
 * ⚠ The raw error never leaves this function. Status and our own class are ours to log; the message is
 * not (`ApiError.message` is the JSON response body, which can quote the offending request field).
 */
function plannerFailure(err: unknown, state: StreamState): PlannerTurnError {
  if (err instanceof PlannerTurnError) return err

  // The SDK aborts the fetch with a bare `controller.abort()` — for its own per-attempt timeout AND for
  // our deadline — so both arrive as a reason-less AbortError (a TimeoutError if the runtime surfaces the
  // deadline's own reason). The rider's signal was already ruled out by the caller.
  const name = err instanceof Error ? err.name : ''
  const timedOut = name === 'AbortError' || name === 'TimeoutError'
  const status = err instanceof ApiError ? err.status : undefined
  // A turn that reported usage before dying was billed for it. Same salvage as the cancellation path —
  // the two differ only in `outcome`, which is the point of there being one event.
  const usage = salvageUsage(state)

  logPlanSpend({
    outcome: 'failed',
    usage,
    thinking: state.usage?.thoughtsTokenCount ?? 0,
    err: timedOut ? 'timeout' : status !== undefined ? errorClass(status) : 'unknown',
    status,
    requestId: state.responseId,
  })
  return new PlannerTurnError(timedOut ? 'timeout' : 'upstream')
}
