// The LIVE PLANNER's model call — the ONE place `apps/api` talks to Anthropic (1.1 step 6, D9/D10).
//
// The rider plans a drive by TALKING to the Skipper. This module owns exactly one turn of that
// conversation: transcript + the region's curated anchor list in, a rider-visible `say` plus (maybe)
// an unvalidated route object out. It resolves nothing else — no DB, no Routes call, no Zod, no HTTP.
//
// ⚠ WHY THE SDK IMPORT IS QUARANTINED HERE. This is the ONLY module in the plan path that imports
// `@anthropic-ai/sdk`, so a test can `mock.module('../src/planner', …)` and still exercise the REAL
// handler, the real caps and the real route ordering with no network and no spend. That property dies
// the moment a second module imports the SDK — or the moment this one constructs its client at import
// time (see `plannerClient` below). The anchor read is the other impure seam and stubs separately.
//
// ⚠ INV-13 — A TRANSCRIPT IS TRANSIENT RIDER CONTENT. Nothing in this file logs a request body, the
// prompt, the roster, `say`, thinking, or a tool input, and nothing throws an error carrying upstream
// text. The one thing that leaves here on the failure path is `PlannerTurnError`, whose message is a
// fixed string — precisely so that a caller which forgets to catch it still cannot leak a vendor error
// body into `index.ts`'s `console.error('[api] unhandled error', err)`.
//
// ⚠ INV-10 — THE PROMPT LIVES IN ./planner-prompt AND IS NOT THE NARRATION PROMPT. Never reach into
// `@skipper/studio`'s persona (fact sheets, "the card", stop kinds); never copy the deflection back the
// other way. Same voice, different job, separate review.

import Anthropic from '@anthropic-ai/sdk'
import { CLAUDE_MODELS, recordModelUsage, usageUsd, type UsageLike } from '@skipper/shared'
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

/** Thinking DEPTH. Deliberately paired with `PLANNER_MAX_TOKENS`, which bounds thinking PLUS visible
 *  output in ONE budget on this model (there is no separate thinking budget — `budget_tokens` is a 400).
 *  ⚠ Raising this without raising that cap is the failure limits.ts warns about: higher effort against a
 *  small ceiling returns HTTP 200 with stop_reason 'max_tokens' and no usable tool call. That cap was
 *  raised to 4_096 in the SAME change for exactly this reason; the two move together or not at all.
 *
 *  ⚠ 'low' → 'medium' BY AN EXPLICIT FOUNDER CALL, 2026-08-04, shipped WITHOUT the eval arm that was
 *  offered. Recorded rather than deleted because the argument this replaces was not wrong, only partial:
 *  the ROUTING job really is small (pick two endpoints off a printed list) and depth buys it nothing.
 *  What that reading missed is that routing is not the whole turn — the same call has to carry the
 *  persona, and 'low' is documented as the setting that strips preamble and terses output. The measured
 *  `route_wordless` shape (draw turns emitting 160 tokens of tool JSON and NO text block at all, against
 *  34-42 on turns that spoke) is that description at its limit, and the open stamping/repetition defect
 *  is the same family one turn on. Whether depth actually fixes it is UNMEASURED — see the note below.
 *
 *  ⚠ WHAT TO WATCH, since nothing was measured first. Three numbers, all already logged by
 *  `logPlanSpend`, no new instrumentation: `stop_reason` (any 'max_tokens' means the raised cap is still
 *  too tight — that is the regression this pairing exists to prevent), `thinking` (it was a true zero at
 *  'low'; a large jump is the latency cost landing), and `out`/`usd`. ⚠ The latency cost is NOT hidden by
 *  streaming: `display: 'omitted'` means the wire is silent for the whole thinking phase, so depth here
 *  is dead air in a chat bubble before the first token, which is the one thing this surface cannot spend
 *  freely. If it reads slow on device, that is the trade, and 'low' is one word away.
 *
 *  ⚠ WHOLE-RUN ONLY, NEVER PER-TURN. The resolved effort value is rendered into the prompt, so changing
 *  it between requests invalidates the cached prefix and re-bills the whole ~6.9k roster block at full
 *  rate on an anonymous path (TODO #9). That is why this is a module constant and why `effort?:` on
 *  PlannerModelArgs is an eval seam that passes ONE value for a whole run. */
const PLANNER_EFFORT = 'medium' as const

/** ⚠ NOT studio's `maxRetries: 5` — that number is tuned for a batch run that has already spent money
 *  and can afford to wait. This is a rider staring at a chat box, and every attempt bills again. The SDK
 *  does not retry a stream mid-flight either, so this only ever covers connect-time 429/5xx. */
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
  /** Called per token as the rider-visible text streams, for a caller relaying its OWN SSE frames.
   *  ⚠ Never proxy the raw Anthropic stream — it carries thinking blocks, signatures and tool
   *  internals. Deltas already emitted are NOT retracted if the turn later fails. */
  onSay?: (delta: string) => void
  /** The RIDER'S CONNECTION.
   *  ⚠ THIS IS A SPEND CONTROL, NOT A TIDINESS ONE (INV-11). Without it a rider who backgrounds the app
   *  or hits back bills Opus to completion on a turn nobody will ever read — and the caps in ./limits
   *  cannot see that, because the request was legitimate when it arrived. The SDK bridges this into its
   *  own controller and closes the socket, which is what stops generation upstream.
   *  ⚠ COMBINED WITH — never replacing — the PLANNER_TIMEOUT_MS wall clock. The two are told apart by
   *  asking this signal whether IT aborted: `AbortSignal.any` preserves each source's own reason, and
   *  the SDK collapses both into an indistinguishable APIUserAbortError. Getting that wrong logs every
   *  rider who closes the app as a vendor outage. */
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
  /** Reasoning depth override. Omitted in production, which uses `PLANNER_EFFORT`.
   *
   *  ⚠ IT EXISTS FOR THE EVAL PANEL AND FOR ONE MEASURED QUESTION (apps/api/eval). Anthropic documents
   *  lower effort as making the model proceed to action WITHOUT PREAMBLE and make fewer tool calls —
   *  and the first real replay (2026-08-03) measured exactly that shape: every `tool_use` turn emitted
   *  160 output tokens, the tool JSON alone, with NO text block, while every `end_turn` turn spoke
   *  normally in 34-42. That is the `route_wordless` defect, and on this path it also destroys the
   *  model's only record of what it drew (the route never returns to it — see ./planner-prompt).
   *  A seam, not a knob: changing the PRODUCTION value is a latency and cost decision that belongs to
   *  the founder, and ./limits warns that raising effort against a fixed `max_tokens` buys
   *  `stop_reason: 'max_tokens'` — which the handler classifies as `truncated` and the rider hears as
   *  VOICE.retry. Measure with this, then decide there. */
  effort?: 'low' | 'medium' | 'high'
  /** Test seam — the Anthropic client to call. Omitted in production, where the lazy module-level
   *  client is used instead.
   *  ⚠ It exists because the six-outcome classifier below is the entire reason this file exists, and
   *  without an injection point it is unreachable from a test: the classifier only runs AFTER a real
   *  network call. A module-private client would mean the one piece of logic that decides whether a
   *  rider's "yes" turns into a drive could never be exercised without spending money. Anything
   *  structurally compatible with `messages.stream()` is enough — the tests pass a hand-rolled double,
   *  not a real SDK instance. */
  client?: Pick<Anthropic, 'messages'>
}

/**
 * What the turn actually was. Derived from `stop_reason` FIRST, never from "is there a tool block".
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
  /** stop_reason 'max_tokens' — output was cut off. Any tool block present is DISCARDED unread. */
  | 'truncated'
  /** stop_reason 'refusal' — the safety classifier declined. ⚠ Never echo the explanation. */
  | 'refused'
  /** Stream ended without a terminal stop_reason (aborted / paused). Nothing is trustworthy. */
  | 'aborted'
  /** Ended cleanly but produced neither text nor a route. The caller owes the rider a line. */
  | 'empty'

export interface PlannerTurn {
  outcome: PlannerOutcome
  /** The rider-visible text, joined from the turn's text blocks. May be non-empty even on a failed
   *  outcome (the model got a sentence out before it was cut off) — show it, then add the retry line. */
  say: string
  /**
   * The tool input VERBATIM, or null. `unknown` on purpose: it is model output, and the type system is
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
  /** Verbatim from the API, for logs and for a caller that wants to branch further. */
  stopReason: string | null
  /** The model that actually served the turn, for pricing. */
  model: string
  /** Token counts for this call. Already recorded + priced here; returned so a caller can attribute. */
  usage: UsageLike
}

/**
 * The only error this module throws, and it carries NOTHING from upstream.
 *
 * ⚠ `message` is a fixed string and `reason` is a closed set precisely so that this is safe to log, safe
 * to bubble, and impossible to accidentally render. An `Anthropic.APIError`'s `.error` is the raw
 * response body — which can quote the offending request field, i.e. rider text (INV-13) — and
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

let client: Anthropic | null = null

/**
 * ⚠ NEVER CONSTRUCT AT MODULE SCOPE. Two reasons, and the second is the real one:
 *  - `apps/api` must keep booting env-free. `GET /health` and `/version` have no business needing an
 *    Anthropic key, and auth.ts is already the one hard throw-at-load this app tolerates.
 *  - `new Anthropic()` with no key does not throw — it kicks off a credential-chain resolution that
 *    reads `~/.config/anthropic/`. At module scope that is a filesystem probe on import, and the first
 *    rider request fails with the SDK's generic "could not resolve authentication method" instead of
 *    naming the variable an operator has to set.
 * Passing `apiKey` explicitly short-circuits that chain, so no disk I/O ever happens in the request path.
 */
function plannerClient(): Anthropic {
  if (client) return client
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // Actionable server-side; the rider gets the in-persona outage line and never this text.
    console.error('[planner] ANTHROPIC_API_KEY is not set — POST /drives/plan cannot run')
    throw new PlannerTurnError('not_configured')
  }
  client = new Anthropic({ apiKey, maxRetries: PLANNER_MAX_RETRIES, timeout: PLANNER_TIMEOUT_MS })
  return client
}

/* -------------------------------------------------------------------------- */
/* Prompt assembly.                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The region + anchor list, as the second system block.
 *
 * ⚠ THIS IS THE CACHED PREFIX AND IT MUST BE BYTE-STABLE ACROSS TURNS. A permuted row order rewrites
 * the prefix, and a broken cache is INVISIBLE in the response body — it just quietly bills the whole
 * prompt at full price on every turn, forever, on an anonymous route (INV-11). `loadRegionAnchors`
 * sorts, but this sorts again anyway: the cost is microseconds and it makes the guarantee local instead
 * of dependent on a query three files away staying sorted.
 *
 * Exported for a test to assert the D9 shape — names and ids, no coordinates, no `kind` — without a
 * network call.
 */
export function buildRosterBlock(regionName: string, anchors: PlannerAnchor[]): string {
  // ⚠ The comparator is SHARED (./anchor-format) and codepoint-based on purpose — locale/ICU
  // differences between processes would make the cached prefix differ between Cloud Run instances for
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
 * OUR 400 before we spend, not as a vendor 400 after we do. A leading assistant turn is rejected by the
 * API outright, and a TRAILING one is read as an assistant PREFILL, which this model rejects with a 400.
 * Both would surface to the rider as a mysterious outage on a message they typed innocently.
 */
function toModelMessages(turns: PlannerTurnInput[]): Anthropic.MessageParam[] {
  const kept = turns.filter((t) => t.text.trim().length > 0)
  const first = kept[0]
  const last = kept[kept.length - 1]
  if (!first || !last || first.role !== 'rider' || last.role !== 'rider') {
    throw new PlannerTurnError('bad_transcript')
  }
  return kept.map((t, i) => {
    const role = t.role === 'rider' ? ('user' as const) : ('assistant' as const)
    // ⚠ A SECOND cache breakpoint, on the LAST turn only, and it is not a micro-optimisation.
    // The transcript is CLIENT-HELD and re-sent whole every turn (D10), and render order is
    // tools → system → messages — so without this the entire growing conversation sits OUTSIDE the
    // cached prefix and is re-billed at full input rate on turn after turn, on an anonymous path that
    // spends forever. Breakpointing the tail means turn N+1 reads turns 1..N at 0.1x instead.
    // The trade is a 1.25x write on the tail against a 0.1x read of everything before it — worth it
    // from the second turn on, and this conversation is bounded at MAX_PLAN_MESSAGES anyway.
    if (i !== kept.length - 1) return { role, content: t.text }
    return { role, content: [{ type: 'text' as const, text: t.text, cache_control: { type: 'ephemeral' as const } }] }
  })
}

/* -------------------------------------------------------------------------- */
/* The call.                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Run ONE planner turn.
 *
 * ⚠ THIS SPENDS ON EVERY RIDER REQUEST, forever, anonymously, with no `--apply` and no human in the
 * loop (INV-11). Its only guards are the explicit model + `max_tokens` below, the caller's bounded body
 * and rate limiters (./limits), and the tally recorded here. Weakening any of them is a cost
 * regression, not a UX tweak.
 */
export async function runPlannerTurn(args: PlannerModelArgs): Promise<PlannerTurn> {
  // The cheapest saving available on this path: the rider may already be gone (they hung up while the
  // region + anchor read was in flight). Spend nothing at all rather than spending and discarding.
  if (args.signal?.aborted) throw new PlannerTurnError('client_gone')

  const messages = toModelMessages(args.turns)
  // ⚠ The injected client wins when present (tests); production omits it and pays the lazy
  // construction below, which is what keeps ANTHROPIC_API_KEY off the module-load path.
  const anthropic = args.client ?? plannerClient()

  // Three system blocks, breakpoint on the SECOND. Render order is tools -> system -> messages, so a
  // breakpoint there caches the tool definition AND the persona AND the region's roster as one prefix
  // — one entry per region, comfortably over this model's 512-token cache minimum. Block three is the
  // volatile slot and must stay after it.
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: PLANNER_SYSTEM_PROMPT },
    {
      type: 'text',
      text: buildRosterBlock(args.regionName, args.anchors),
      cache_control: { type: 'ephemeral' },
    },
  ]
  // ⚠ BEFORE the wrap-up notice, so the LAST thing the model reads on a long conversation is still
  // "bow out" rather than a list of drives — the wrap-up is the instruction that has to win at the
  // recency edge.
  const drawnBlock = args.drawn?.length ? buildDrawnBlock(args.drawn, args.anchors) : null
  if (drawnBlock) system.push({ type: 'text', text: drawnBlock })
  if (args.wrapUpNotice) system.push({ type: 'text', text: args.wrapUpNotice })
  // Experiment-only, and last so it can never sit between the prefix and its breakpoint.
  if (args.extraSystem) system.push({ type: 'text', text: args.extraSystem })

  // ⚠ BOTH LOCALS STAY REFERENCED for the life of the call, deliberately. A composite AbortSignal whose
  // only strong reference lives inside the SDK has been GC-collectable in some runtimes; holding the
  // sources here makes the question moot. `deadline` is the hard wall clock (./limits); `args.signal` is
  // the rider hanging up. `AbortSignal.any` preserves whichever fired, which is what lets the catch
  // below tell a cancellation from a timeout.
  const deadline = AbortSignal.timeout(PLANNER_TIMEOUT_MS)
  const signal = args.signal ? AbortSignal.any([args.signal, deadline]) : deadline

  const stream = anthropic.messages.stream(
    {
      // ⚠ From the constant, never a bare string, and never the `opus` key — that one is the studio
      // pipeline's model and repointing it changes what a fail-closed eval gate is calibrated against.
      model: CLAUDE_MODELS.planner,
      // ⚠ Bounds THINKING PLUS visible output in ONE budget. Too low does not raise — see PLANNER_EFFORT.
      max_tokens: PLANNER_MAX_TOKENS,
      // ⚠ INV-8: THINKING STAYS ON. With it disabled this model can write a tool call into VISIBLE TEXT
      // instead of a tool_use block — the turn succeeds, no error is raised, the route never reaches the
      // map — and can leak <thinking> tags into rider-facing prose. For a planner whose entire contract
      // is emitting a structured route, that is a silent wrong answer. `display: 'omitted'` is stated
      // rather than assumed: the SDK's own docstring claims a 'summarized' default that is stale here,
      // and rider-facing text must never carry reasoning.
      thinking: { type: 'adaptive', display: 'omitted' },
      output_config: { effort: args.effort ?? PLANNER_EFFORT },
      system,
      tools: [PLAN_ROUTE_TOOL],
      // AUTO, not forced — the reasoning lives on PLAN_ROUTE_TOOL in ./planner-prompt. In one line: a
      // forced tool would pressure the model to fill route fields on a turn where the rider named no
      // place. `disable_parallel_tool_use` so "the route" is unambiguously at most one block.
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
      // Text-only history: the transcript carries no tool_use blocks, so there is no tool_result
      // obligation to satisfy and nothing to replay. The model's own prose already restates the route
      // it proposed, which is the only context the next turn needs.
      messages,
    },
    // The client `timeout` above is per ATTEMPT and is itself retried; this is the hard wall clock, now
    // fused with the rider's own connection.
    { signal },
  )

  // Text streams natively, token by token. The ROUTE is deliberately held back until the stream has
  // ended and stop_reason is known — a partial route is not a route.
  // ⚠ Guarded, and the guard is the point. This listener runs SYNCHRONOUSLY inside the SDK's emit
  // loop, so a caller whose handler throws — an SSE write to a connection the rider just closed, which
  // is the ordinary case, not an edge one — surfaces that rejection out of finalMessage() below. It
  // would be classified as an upstream failure and logged as a vendor outage, and the turn we already
  // paid for would be thrown away. Swallowing is consistent with deltas being unretractable anyway.
  if (args.onSay) {
    const onSay = args.onSay
    stream.on('text', (delta) => {
      try {
        onSay(delta)
      } catch {
        // The rider is gone or the sink is broken; neither is the model's fault and neither is
        // recoverable here. The full text still arrives on `message` below.
      }
    })
  }

  let message: Anthropic.Message
  try {
    message = await stream.finalMessage()
  } catch (err) {
    // ⚠ ORDER MATTERS, AND IT IS NOT COSMETIC. An APIUserAbortError is what the SDK raises for BOTH a
    // rider disconnect and our own wall clock, and plannerFailure classifies it as 'timeout' — so
    // without this branch every rider who closes the app is recorded as a vendor outage, which is
    // precisely the signal an operator would page on. The rider's OWN signal is the only thing that
    // tells them apart.
    if (args.signal?.aborted) throw plannerCancelled(stream)
    throw plannerFailure(err, stream)
  }

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
  // ⚠ Keyed on the model we ASKED for, never on `message.model`. The API is not contractually bound to
  // echo the alias back — it may resolve to a longer id — and MODEL_PRICING is keyed on the alias, so
  // pricing the echo would silently tally $0 under a second, unpriced key. That is exactly the failure
  // @skipper/shared's spend.ts warns about, and the drift guard CANNOT catch it: the guard validates
  // the requested ids, so it stays green while the runtime key drifts. Every other call site in the
  // repo records against the requested constant; this one matches. The echo is still worth having as
  // the served-by signal, so the line below carries BOTH — under two different names, `model` (the
  // pricing key) and `served_by` (what answered). One field for both is how they get conflated again.
  recordModelUsage(CLAUDE_MODELS.planner, message.usage)
  logPlanSpend({
    outcome: 'served',
    usage: message.usage,
    servedBy: message.model,
    stopReason: message.stop_reason,
    anchors: args.anchors.length,
    requestId: stream.request_id,
  })

  // ⚠ Index content by TYPE, never by position: block 0 can be a thinking block, or absent entirely.
  const say = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')

  const base = {
    say,
    rawRoute: null,
    stopReason: message.stop_reason,
    model: message.model,
    usage: message.usage,
  }

  switch (message.stop_reason) {
    case 'tool_use': {
      const call = message.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === PLAN_ROUTE_TOOL.name,
      )
      // A 'tool_use' stop with no matching block should not happen; if it ever does, it is not a route.
      if (!call) return { ...base, outcome: say ? 'say' : 'empty' }
      // ⚠ THE LINE MAY ARRIVE INSIDE THE CALL, and on this model it essentially always does — a draw
      // turn emits the tool JSON and no text block at all (measured 2026-08-03; see PLAN_ROUTE_TOOL's
      // note). A real text block still WINS when one exists, so a model that speaks both ways loses
      // nothing and the `say`-first ordering never overrides prose the rider already saw streaming.
      // Guarded rather than cast: `input` is model output, so a non-string `say` must read as absent
      // and fall through to the handler's backstop instead of putting `[object Object]` on screen.
      const spoken = (call.input as { say?: unknown })?.say
      const fromTool = typeof spoken === 'string' ? spoken.trim() : ''
      return { ...base, say: say || fromTool, outcome: 'route', rawRoute: call.input }
    }

    // ⚠ THE SILENT FAILURE, AND WHY IT IS BRANCHED BEFORE THE TOOL LOOKUP. A truncated turn can carry a
    // tool_use block whose `input` is a partially-parsed object that Zod may well accept — an incomplete
    // route the rider would tap straight into a bad drive. Discard it unread; keep whatever text arrived.
    case 'max_tokens':
      return { ...base, outcome: 'truncated' }

    // The classifier declined. `stop_details.explanation` exists and is NEVER echoed (INV-13).
    case 'refusal':
      return { ...base, outcome: 'refused' }

    case 'end_turn':
    case 'stop_sequence':
      return { ...base, outcome: say ? 'say' : 'empty' }

    // 'pause_turn' is unreachable without server tools, and a null stop_reason means the stream ended
    // without one. Both mean "nothing here is trustworthy" — free to handle, expensive to assume away.
    default:
      return { ...base, outcome: 'aborted' }
  }
}

/** The in-flight half of a stream that died: everything the salvage + logging paths below need, and
 *  nothing that would drag an SDK type across a test seam (the hand-rolled doubles in planner.test.ts
 *  satisfy this shape by writing two fields). */
interface FailedStream {
  /** The SDK's in-flight snapshot. `usage.input_tokens` and the cache counters arrive whole on
   *  `message_start`; `output_tokens` accumulates per `message_delta`. Undefined before the first event. */
  currentMessage?: Anthropic.Message
  request_id?: string | null
}

/** Salvage whatever this dead call already billed, so the cost line and the tally both see it.
 *
 * ⚠ THE SPEND ALREADY HAPPENED. `finalMessage()` rejected, so the normal recording at the bottom of
 * runPlannerTurn never runs — without this, every cancelled or timed-out turn is money that shows up
 * nowhere. What makes that matter is the `plan_spend` LINE rather than the process tally (which has no
 * reader in `apps/api` — see runPlannerTurn): a spend figure obtained by summing an event that silently
 * omits its own failures under-reports, and an under-reporting guard is worse than no guard because it
 * reads as reassurance.
 * ⚠ It CANNOT double-count: `finalMessage()` either resolves (the normal recording) or rejects (this
 * one), never both, and the SDK clears the snapshot when it ends the request.
 */
function salvageUsage(stream: FailedStream): LoggedUsage | null {
  const usage = stream.currentMessage?.usage
  if (!usage) return null
  recordModelUsage(CLAUDE_MODELS.planner, usage)
  return usage
}

/* -------------------------------------------------------------------------- */
/* The cost line — ONE structured event per model call (1.7(b)).                */
/* -------------------------------------------------------------------------- */

/** What the cost line reads: `UsageLike` (everything MODEL_PRICING needs) plus the SDK's breakdown of
 *  how much of `output_tokens` was thinking. Aliased so the served path and both salvage paths provably
 *  build the SAME line from the same shape. */
type LoggedUsage = Anthropic.Message['usage']

interface PlanSpendInput {
  /** WHY this call ended, as a closed enum — the field that replaces three differently-worded human
   *  lines. Total spend over a window is now a SUM over one `evt`, filtered or not by this. */
  outcome: 'served' | 'cancelled' | 'failed'
  /** null when the call died before `message_start` and genuinely billed nothing. Still logged, as
   *  zeros: a sum over this event must be able to count every turn, or "no line" and "no spend" become
   *  the same observation. */
  usage: LoggedUsage | null
  /** The vendor's echo — what actually served the turn. NEVER the pricing key; see runPlannerTurn. */
  servedBy?: string
  stopReason?: string | null
  anchors?: number
  requestId?: string | null
  /** Failure path only. A closed vendor error type (or our own 'timeout'), never a vendor message. */
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
 * that CAN hold prose: `outcome` is ours from a three-value set, `stop_reason`/`err` are vendor enums,
 * `model`/`served_by` are model ids, `req` is a request id, and the rest are numbers. The transcript,
 * the roster, `say`, thinking and the tool input have nowhere to land even by accident. The single-line
 * guarantee is `JSON.stringify`'s, not ours — it escapes any newline inside a string field.
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
    /** The PRICING key — the alias we asked for, the key MODEL_PRICING and the tally are both keyed on. */
    model: CLAUDE_MODELS.planner,
    served_by: i.servedBy,
    stop_reason: i.stopReason ?? undefined,
    err: i.err,
    status: i.status,
    anchors: i.anchors,
    in: i.usage?.input_tokens ?? 0,
    // `cache_read: 0` across a conversation is the tell that the cached prefix broke — the single most
    // expensive silent regression on this path, and the reason this field is here at all.
    cache_read: i.usage?.cache_read_input_tokens ?? 0,
    cache_write: i.usage?.cache_creation_input_tokens ?? 0,
    out: i.usage?.output_tokens ?? 0,
    thinking: i.usage?.output_tokens_details?.thinking_tokens ?? 0,
    // ⚠ A JSON NUMBER, never a formatted `$0.00018` string: the distribution metric reads a numeric
    // field directly, while a currency-prefixed string forces an extractor regex that starts silently
    // matching nothing the day someone tidies the prefix. Rounded only to keep float tails out of the
    // logs — six places is far finer than one turn can cost.
    usd: i.usage ? Math.round(usageUsd(CLAUDE_MODELS.planner, i.usage) * 1e6) / 1e6 : 0,
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
function plannerCancelled(stream: FailedStream): PlannerTurnError {
  logPlanSpend({
    outcome: 'cancelled',
    usage: salvageUsage(stream),
    requestId: stream.request_id,
  })
  return new PlannerTurnError('client_gone')
}

/**
 * Classify a vendor failure into something safe to carry, and log the safe half of it.
 *
 * ⚠ The raw error never leaves this function. Status, error type and request id are ours to log; the
 * body is not (`APIError.error` is the response JSON, which can quote the offending field).
 */
function plannerFailure(err: unknown, stream: FailedStream): PlannerTurnError {
  if (err instanceof PlannerTurnError) return err

  const timedOut =
    err instanceof Anthropic.APIUserAbortError || err instanceof Anthropic.APIConnectionTimeoutError
  const status = err instanceof Anthropic.APIError ? err.status : undefined
  const type = err instanceof Anthropic.APIError ? err.type : null
  // ⚠ `requestID` on an APIError, `request_id` on a MessageStream — two spellings of one id, and a typo
  // silently logs `undefined`.
  const id = (err instanceof Anthropic.APIError ? err.requestID : null) ?? stream.request_id
  // A turn that dies after `message_start` was billed for everything it generated. Same salvage as the
  // cancellation path — the two differ only in `outcome`, which is the point of there being one event.
  const usage = salvageUsage(stream)

  // ⚠ `err` is `APIError.type` — a closed vendor error TYPE ('rate_limit_error', 'overloaded_error'),
  // not `APIError.message` and not `.error`, either of which can quote the offending request field and
  // therefore rider text (INV-13). This is the only branch where an upstream-derived string reaches a
  // log at all, which is why it names the field it reads.
  logPlanSpend({
    outcome: 'failed',
    usage,
    err: timedOut ? 'timeout' : (type ?? 'unknown'),
    status,
    requestId: id,
  })
  return new PlannerTurnError(timedOut ? 'timeout' : 'upstream')
}
