// POST /drives/plan — one turn of planning a drive by talking to the Skipper.
//
// ⚠ THIS IS THE OPEN ANONYMOUS FRONT DOOR, AND IT SPENDS ON EVERY REQUEST. No account, no `--apply`,
// no human in the loop, forever (INV-11). Its only guards are: the bounded body read, the transcript
// caps, an explicit model + max_tokens, the two stacked rate limiters at the mount, and the recorded
// tally. Every one of those numbers lives in ./limits — none is invented here, and weakening one is a
// cost regression rather than a UX tweak.
//
// ⚠ MOUNTED ABOVE `app.route('/drives', driveRoutes)` IN ./index.ts, and that is load-bearing. Hono
// matches in REGISTRATION ORDER, so below the mount this path is swallowed by driveRoutes' blanket
// `requireAccount` and every anonymous plan 401s — a failure that reads like an auth bug rather than a
// routing one. There is a test pinning a 200 with no session precisely because of that.
//
// ⚠ INV-13 — the transcript is transient rider content. Nothing here logs a body, a turn, the prompt,
// or a model error, and no vendor message is ever echoed to the rider. There is no `conversations`
// table and adding one is a founder decision.
//
// TWO TRANSPORTS, ONE TURN. `Accept: text/event-stream` gets the turn FRAMED — zero or more
// `event: say` deltas, then exactly ONE `event: turn` carrying the whole `DrivePlanResponse`. Anything
// else gets that same response as a single JSON body, byte-identical to what step 6 shipped. Both come
// out of the SAME `toResponse`, and keeping it that way is the only reason a JSON-level test remains
// proof of the framed payload's shape — do not grow a second response builder inside the callback. It
// is also what makes the operator-facing `plan_degraded` signal identical on both Accepts: what a rider
// asks for must never change what an operator can see.
//   • The TERMINAL frame is AUTHORITATIVE and its `say` may DIFFER from the concatenated deltas: a
//     refusal REPLACES the streamed text, a truncation APPENDS the retry line to it. The client
//     overwrites its buffer with the terminal `say` — it never appends.
//   • EOF with NO terminal frame means the turn failed (or the rider hung up). That is the client's
//     signal, and it is why nothing here writes an apology to a rider who has already left.
//   • Every REJECTION — the 413, both 400s, the cap wrap-up, the unknown region — stays JSON on BOTH
//     Accepts, so whether a client streams can never change whether its request is accepted.

import { Hono } from 'hono'
import { streamSSE, type SSEMessage } from 'hono/streaming'
import {
  drivePlanRequest,
  isDegenerateRoute,
  MAX_ROUTE_VIA,
  type DrivePlanResponse,
  type PlannedRoute,
} from '@skipper/shared'
import { readJsonBody } from './drives'
import type { ApiEnv } from './entitlements'
import { checkTranscript, MAX_PLAN_BODY_BYTES, PLAN_WRAP_UP_AFTER_MESSAGES } from './limits'
import { PlannerTurnError, runPlannerTurn, type PlannerModelArgs, type PlannerTurn } from './planner'
import { PLANNER_WRAP_UP_NOTICE } from './planner-prompt'
import { loadRegionRoster } from './roster-cache'

export const planRoutes = new Hono<ApiEnv>()

/** What the rider hears when the machinery fails. ⚠ IN PERSONA, ALWAYS — a rider mid-conversation with
 *  a character should never be handed a stack trace or a vendor name. Each of these maps a real
 *  outcome, and none of them leaks why. */
const VOICE = {
  /** Truncated / empty / aborted — the turn produced nothing usable but cost money. */
  retry: 'Lost my train of thought there, friend. Say that again?',
  /** The safety classifier declined. Never echo the explanation. */
  refused: "That one's outside my department. Where were we headed?",
  /** Upstream unreachable. */
  down: "Radio's out on my end. Give me a minute and try me again.",
  /** A region with no curated endpoints yet — a real state, not an error. */
  noRegion: "That's not my country yet, friend.",
  /** A route came back with NO line attached. Nothing failed and nothing is owed an apology — the card
   *  is about to appear — so this is a plain handover, not `retry`'s "say that again". ⚠ It must not
   *  announce the drawing either (the prompt bans narrating the mechanism), which is why it points at
   *  the drive without claiming to have just made it. */
  drawnWordless: 'There she is. Have a look and see what you think.',
  /** A loop with no way home. ⚠ NOT AN APOLOGY AND NOT `retry` — nothing failed and the rider said
   *  nothing wrong; the plan is genuinely short one piece. It asks the ONE question the skipper should
   *  have asked before drawing (see the loop beat in ./planner-prompt), which is why it REPLACES the
   *  model's line rather than following it: that line has already promised a drive that is about to
   *  not appear. */
  needReturnLeg: "I'll bring you back around, but not down the same road twice. Which way do you want to come home?",
} as const

/** Does this caller want the turn FRAMED, or the single JSON body 1.0 clients already read?
 *  ⚠ SUBSTRING, NOT EQUALITY — a client may legitimately send `text/event-stream, application/json`,
 *  and RN's fetch has historically appended `*​/*`. An ABSENT header takes the JSON path, which is what
 *  keeps every existing test and every already-shipped client byte-identical. hono's header lookup is
 *  case-insensitive. */
const wantsStream = (accept: string | undefined): boolean => (accept ?? '').includes('text/event-stream')

/** SSE comment heartbeat.
 *  ⚠ NOT a UX nicety. This route can legitimately put ZERO bytes on the wire for the whole thinking
 *  phase (`display: 'omitted'` in ./planner), and Bun's HTTP server closes a connection that has gone
 *  quiet — the real fix is SERVER_IDLE_TIMEOUT_SEC wired into ./index.ts, which this interval must stay
 *  comfortably inside; this is the belt to those braces and the only thing that also protects against a
 *  buffering intermediary we do not control.
 *  ⚠ A leading `:` is an SSE COMMENT — every parser drops it, so it is deliberately NOT a third event
 *  name the client has to enumerate, and it is not part of the frame contract. It is also why the client
 *  resets its idle timer on every CHUNK rather than on every frame. */
const SSE_HEARTBEAT_MS = 10_000

/** Why a tool call did not become a route. `loop_without_return` is NOT a malformed call — it is a
 *  complete, well-formed loop that has no way home, and it gets its own answer (see VOICE).
 *  `off_roster` is a well-formed call naming a place the model was never given. */
type RouteTranslation =
  | { ok: true; route: PlannedRoute }
  | { ok: false; reason: 'untranslatable' | 'loop_without_return' | 'off_roster' }

const UNTRANSLATABLE = { ok: false, reason: 'untranslatable' } as const
const OFF_ROSTER = { ok: false, reason: 'off_roster' } as const

/** The model's tool vocabulary → the wire shape. ⚠ THREE TRANSLATIONS, all load-bearing — see the
 *  `rawRoute` doc in ./planner. The one that bites: `round_trip` is NOT the wire's loop shape. Here it
 *  means "come back around"; on the wire a loop is `end === start` with the turnaround and then the
 *  return leg as the LAST TWO `via` midpoints, because `start === end` alone materializes as a
 *  degenerate zero-distance route.
 *
 *  ⚠ A LOOP CARRIES A RETURN LEG OR IT IS NOT DRAWN — the whole of the no-same-road rule at this
 *  layer. `start → far end → start` is the shape Google answers with the SAME ROAD TWICE: measured at
 *  94% retraced on the one saved loop, which is why 17 of its 18 reachable stops landed on the
 *  outbound half and the way home was silent (docs/decisions/no-same-road-loops.md). The rider names
 *  the way back, so the geography comes from them rather than from a model that has no coordinates
 *  (D9) and could only guess at which roads connect.
 *
 *  ⚠ IT RE-ASSERTS EVERY ID AGAINST THE ROSTER THIS TURN WAS GIVEN, and that is the reason it takes a
 *  second argument. The tool description tells the model to copy ids "exactly… never compose, correct, or
 *  infer one" — a rule that exists because the authors consider the opposite possible, and an id is the
 *  one field of the call nothing else here can sanity-check. Without this the route reaches the rider as a
 *  tappable card whose tap is a 400 from `hydrateAnchors` (./drives), which is a dead end wearing the
 *  clothes of a working drive.
 *
 *  ⚠ IT IS NOT INV-1's ENFORCEMENT AND MUST NEVER BE MISTAKEN FOR IT. INV-1 lives at the WIRE, in the
 *  QUERY (`resolveRouteAnchors` → `hydrateAnchors`, ./drives), and that is the check that stands between
 *  an anonymous request and a billed Routes call. This one is a UX guard in front of it, and it is
 *  strictly weaker for a reason worth knowing: the roster is memoized for up to `PLAN_ROSTER_MEMO_TTL_MS`
 *  (./roster-cache), so it can be stale — it catches a FABRICATED id but not a place an operator
 *  de-curated in the last minute. Do not "consolidate" the two; the stale one cannot be the guard, and
 *  the authoritative one cannot run before the rider taps.
 *
 *  Returns `untranslatable` on anything malformed — model output is untrusted, and a half-parsed route
 *  must read as "no route" rather than as a route to somewhere nobody asked for. */
function toPlannedRoute(raw: unknown, allowed: ReadonlySet<string>): RouteTranslation {
  if (typeof raw !== 'object' || raw === null) return UNTRANSLATABLE
  const r = raw as Record<string, unknown>
  const start = typeof r.start_anchor_id === 'string' ? r.start_anchor_id : null
  const end = typeof r.end_anchor_id === 'string' ? r.end_anchor_id : null
  if (!start || !end) return UNTRANSLATABLE
  const via = Array.isArray(r.via_anchor_ids) ? r.via_anchor_ids.filter((v): v is string => typeof v === 'string') : []
  const minutes = typeof r.target_minutes === 'number' && Number.isFinite(r.target_minutes) ? Math.round(r.target_minutes) : null
  const back = typeof r.return_anchor_id === 'string' ? r.return_anchor_id : null

  // ⚠ BEFORE THE ROUND-TRIP SHAPE CHECKS, DELIBERATELY. An id that is not on the roster does not name a
  // place, so every question below it ("is this loop's way home the same as its far end?") is a question
  // about nothing — and answering one of those instead would hand the rider the wrong follow-up (the
  // way-home question for a route whose problem is a place that does not exist).
  // `back` is included: it is an anchor id like any other, and it is the newest of these fields.
  if ([start, end, ...via, ...(back ? [back] : [])].some((id) => !allowed.has(id))) return OFF_ROSTER

  // The round-trip mapping. A loop ends where it started and needs a real far end to turn around at,
  // so the model's `end` becomes a midpoint and `start` becomes both ends — then the rider's way home
  // rides after it, which is what makes the drive a ring instead of an out-and-back.
  const roundTrip = r.round_trip === true
  if (roundTrip && !back) return { ok: false, reason: 'loop_without_return' }
  // Two ways to name a way home that is not one, both describing the same out-and-back with a
  // redundant waypoint Google collapses on sight: coming home BY the turnaround (`start → X → X →
  // start`), or BY the start itself (`start → X → start → start`). Treated as the missing answer they
  // are, so the rider is asked rather than sold a retrace — and asked BEFORE a Routes call, which is
  // the one thing the wire gate downstream cannot do.
  if (roundTrip && (back === end || back === start)) return { ok: false, reason: 'loop_without_return' }
  const wire: PlannedRoute = roundTrip
    ? { start, end: start, via: [...via, end, back!], ...(minutes != null ? { targetMinutes: minutes } : {}) }
    : { start, end, ...(via.length ? { via } : {}), ...(minutes != null ? { targetMinutes: minutes } : {}) }

  // ⚠ The wire caps `via` to bound the single billed Routes call. A round trip appends TWO, so a
  // model that filled `via` to the brim would push it over — drop the route rather than ship a request
  // the next endpoint will reject anyway.
  if ((wire.via?.length ?? 0) > MAX_ROUTE_VIA) return UNTRANSLATABLE
  // ⚠ The zero-distance shape: `start === end` with nothing in between. STRUCTURALLY UNREACHABLE through
  // the round-trip branch above (it always appends two midpoints), so this only ever catches a ONE-WAY
  // call whose two ends are the same id — which the schemas now refuse at the wire, meaning without this
  // line the rider gets a card and the refusal arrives on the tap. `isDegenerateRoute` is that same
  // shared predicate (@skipper/shared), read rather than re-expressed so the two can never disagree.
  if (isDegenerateRoute(wire)) return UNTRANSLATABLE
  return { ok: true, route: wire }
}

/** Why a paid turn produced nothing the rider can use. A CLOSED SET OF LITERALS CHOSEN IN THIS FILE —
 *  see the INV-13 note on `noteDegraded`. */
// ⚠ `route_wordless` is the odd one out and belongs here anyway: the rider DOES get something usable
// (their drive), so it is not a failed turn — but the skipper said nothing, the prompt asked him to
// speak on every turn, and a rise in this counts as the prompt slipping rather than an outage. That is
// exactly the "SPIKE means a prompt problem" signal the note below describes.
type DegradedReason =
  | 'truncated'
  | 'aborted'
  | 'empty'
  | 'refused'
  | 'route_untranslatable'
  | 'route_wordless'
  /** The model asked for a loop and named no way home. A PROMPT signal, not an outage: the turn cost
   *  money, the rider got a question instead of a drive, and a rise here means the loop beat in
   *  ./planner-prompt has stopped landing. */
  | 'loop_without_return'
  /** The model serialized a TOOL CALL into rider-visible prose instead of emitting a tool_use block —
   *  INV-8's documented failure mode. Observed on the live model 2026-08-03 during an eval replay. */
  | 'say_leaked_tool_call'
  /** The model named an anchor id that is not on the roster it was given — it composed one instead of
   *  copying it (see `toPlannedRoute`). A PROMPT/MODEL signal, never an outage. ⚠ Deliberately DISTINCT
   *  from `route_untranslatable`: that one is a malformed CALL, this one is a perfectly well-formed call
   *  about a place that does not exist. Only the second says the tool's "copy ids exactly, never compose
   *  one" instruction has stopped landing, so collapsing them would hide the one defect that INV-1 is
   *  downstream of. */
  | 'route_off_roster'
  /** ⚠ THE TWO BELOW ARE THE ONLY ONES THAT ARE OURS TO FIX RATHER THAN THE MODEL'S, and they are here
   *  because without them they are INVISIBLE. Both are thrown by ./planner BEFORE a stream exists, so
   *  `logPlanSpend` never runs and no `plan_spend` line is emitted either — while the rider still gets
   *  HTTP 200 and an in-persona line, so `/health` and every 5xx alert stay green with the product
   *  broken. That is the exact condition this event was created to make countable.
   *
   *  `not_configured` is a MISSING ANTHROPIC_API_KEY on the deployed service: every rider on the
   *  instance hears VOICE.down, forever, and the only other trace is one unstructured `console.error`
   *  that lands in Cloud Logging's `textPayload` where no log-based metric can read it. A non-zero count
   *  of this is a deploy fault, not traffic.
   *
   *  `bad_transcript` is a caller sending a shape the vendor would reject (a leading or trailing skipper
   *  turn, or nothing but whitespace). ⚠ NOT reachable from the shipped client, which trims and blocks
   *  empty sends — so this counts forged or broken callers, and a rise in it after a client release is
   *  the signal that the release broke transcript assembly.
   *
   *  ⚠ The other three `PlannerTurnError` reasons stay OFF this list on purpose: `timeout` and `upstream`
   *  are already logged by ./planner as a structured `plan_spend` with `outcome: 'failed'`, and
   *  `client_gone` is a rider closing the app, which is not a degradation at all. Adding either would
   *  double-count a failure or page on healthy traffic. */
  | 'not_configured'
  | 'bad_transcript'

/**
 * Did the model write a tool call into the prose instead of calling the tool?
 *
 * ⚠ THIS IS INV-8's FAILURE MODE, AND IT IS NOT HYPOTHETICAL — it was observed on the live model on
 * 2026-08-03 during an eval replay, on a turn that should have drawn: `say` came back as
 * `<invoke name="plan_route"><parameter name="say">…` and the route was never emitted. The turn
 * succeeds, no error is raised, nothing upstream can tell — and the rider reads raw XML in a chat
 * bubble from a character who is supposed to be a man at a car window.
 *
 * ⚠ The right response is to SUPPRESS, never to salvage. Parsing the leaked text back into a route
 * would mean reconstructing a billed request from prose the model was told not to write, and the ids
 * inside it are exactly as untrusted as any other model output — which is why INV-1 re-asserts them at
 * the wire. The rider gets the retry line and says it again; that costs one turn and cannot go wrong.
 *
 * Matched on the block shape rather than the tool name, since a leak can name any tool, and kept
 * deliberately narrow so ordinary prose about a drive can never trip it.
 *
 * ⚠ THE NAMESPACE PREFIX IS NOT OPTIONAL TO MATCH, AND LEAVING IT OUT WAS A HOLE. The first cut listed
 * the bare names only (`<invoke`, `<parameter`), which is the form the 2026-08-03 leak happened to take
 * — but the tag family these models emit is routinely namespace-qualified (`<ns:invoke`), and a
 * prefixed tag matched NOTHING: the guard passed the markup straight through to the rider's bubble.
 * Verified by probe before widening. The `<` is still REQUIRED, which is what keeps ordinary prose safe
 * ("we'll pass the parameter road" and "the Invoke overlook" both stay clean) — the prefix is matched as
 * an optional `word:` and never as bare words.
 *
 * ⚠ Still narrow ON PURPOSE, and one shape is knowingly out of scope: a tool call the model writes as
 * JSON prose (`{"name":"plan_route",…}`) is not matched, because every pattern loose enough to catch it
 * also catches a rider being shown a legitimate object. That case degrades to `route_untranslatable`
 * (no tool_use block ⇒ no route), which is the correct outcome — ugly prose, but never a wrong drive.
 */
const LEAKED_TOOL_CALL = /<\/?(?:[a-z][\w.-]*:)?(?:invoke|function_calls|parameter)\b/i

/**
 * ONE structured line when a paid turn produced nothing the rider can use.
 *
 * WHY IT EXISTS: every plan call spends (INV-11) and every outcome below still answers HTTP 200, so a
 * 5xx alert stays green while the product is broken. This line is the only thing a log-based metric can
 * count. It pairs with the per-call cost line ./planner emits — one says what the turn COST, this one
 * says the rider got nothing for it.
 *
 * ⚠ ONE LINE OF SERIALIZED JSON, and `logPlanSpend` in ./planner documents why (with the Cloud Logging
 * sources) — a plain text line lands in `textPayload`, which no metric can query by field. Same reason,
 * stated once. This line deliberately does NOT set the reserved `severity` key that one does: none of
 * these is an outage, and a metric matches on `evt` rather than on severity.
 *
 * ⚠ THE ADVERSARIAL REVIEW'S LITERAL CONDITION WAS EVALUATED AND REJECTED — do not "fix" it back to it.
 * 1.7(b) says emit when `stop_reason !== 'tool_use'`, which is wrong in BOTH directions:
 *   - It fires on the ORDINARY HEALTHY BEAT. In ./planner's switch, `end_turn` with text is outcome
 *     'say' — most of a 3-8 exchange conversation. The metric would count normal traffic, and a signal
 *     that fires on success is noise from its first day.
 *   - It MISSES a real degradation: stop_reason IS 'tool_use' and `toPlannedRoute` still returns null
 *     (malformed ids, or `via` over the wire's cap). The vendor scored that turn a success, the rider
 *     hears VOICE.retry, and no route ever reaches the map — the exact "paid call produced nothing"
 *     case the control is for.
 * The honest predicate is the OUTCOME, not the stop reason. 'refused' rides its own reason because a
 * classifier decline is a different operational fact from a broken turn — nothing to page on, while a
 * SPIKE in it is a prompt problem rather than an outage.
 *
 * ⚠ INV-13. The payload is `evt` + `reason` and nothing else, and both are string literals written in
 * this file — there is no path by which a body, a turn, the prompt, the roster, `say`, thinking or a
 * tool input can reach it. Anything derived from the turn would break that proof; add a field only if
 * you can make the same claim about it.
 * ⚠ warn, not error, and the stream is what a local `bun run dev` and a container tail actually read.
 * The two THROW paths below deliberately emit nothing here — ./planner has already logged a vendor
 * failure, and a rider hanging up is not a degradation at all.
 * ⚠ CANNOT THROW, which is load-bearing on the SSE path — see the streamSSE note below. Stringifying an
 * object of two string literals has no cycle, no BigInt and no toJSON to run.
 */
function noteDegraded(reason: DegradedReason): void {
  console.warn(JSON.stringify({ evt: 'plan_degraded', reason }))
}

/**
 * The THROW path's half of `plan_degraded`, and it deliberately covers only TWO of the five
 * `PlannerTurnError` reasons.
 *
 * WHY IT EXISTS. `logPlanSpend` (./planner) can only run once a stream exists, so the two reasons thrown
 * BEFORE the model call — a missing API key and a malformed transcript — produced no structured line
 * anywhere, while the rider still got HTTP 200 and an in-persona apology. A misconfigured deploy was
 * therefore invisible to every log-based metric AND to `/health`, which is the precise "5xx alert stays
 * green while the product is broken" condition this event was created for.
 *
 * ⚠ IT IS NOT A CATCH-ALL, AND WIDENING IT DOUBLE-COUNTS. `timeout` and `upstream` are ALREADY a
 * structured `plan_spend` line with `outcome: 'failed'` (./planner), and `client_gone` is a rider closing
 * the app — not a degradation at all, and the one reason that must never reach an operator's dashboard as
 * one. Those three are handled where they happen; only these two had no home.
 *
 * ⚠ INV-13. It reads `err.reason` and NOTHING else — a closed five-value set declared on our own error
 * class, never `err.message` and never a vendor field. The error object itself may carry a prompt or a
 * vendor body; this function is structurally unable to reach it.
 * ⚠ CANNOT THROW, which is load-bearing on the SSE path (see the streamSSE note): an `instanceof` test
 * and two literal comparisons have nothing in them that can.
 * ⚠ Called from BOTH transports, which is what keeps "a rider's Accept header cannot change what an
 * operator sees" true — the same reason there is only one response builder.
 */
function noteThrownDegradation(err: unknown): void {
  if (!(err instanceof PlannerTurnError)) return
  // Identity, not a translation table: both literals are members of DegradedReason under the same names,
  // so a new PlannerTurnError reason fails to compile here rather than being silently dropped.
  if (err.reason === 'not_configured' || err.reason === 'bad_transcript') noteDegraded(err.reason)
}

/** Map a planner outcome to what the rider hears. ⚠ Derived from the OUTCOME, never from "is there a
 *  route" — a truncated turn and a normal chat beat are byte-identical from the caller's side, and
 *  treating them the same is how a rider says yes and watches nothing happen.
 *
 *  ⚠ DELIBERATELY NOT PURE. The `plan_degraded` emit lives HERE because this is the ONE function both
 *  transports funnel through, which is what makes "a rider's Accept header cannot change what an
 *  operator sees" true by CONSTRUCTION rather than by convention. An emit at either call site instead
 *  would be a second thing to keep in sync — the same reason there is only one response builder. */
function toResponse(turn: PlannerTurn, allowed: ReadonlySet<string>): DrivePlanResponse {
  // ⚠ FIRST, BEFORE ANY BRANCH, because it can happen on ANY of them and the consequence is identical:
  // raw markup in the rider's chat bubble. See LEAKED_TOOL_CALL. The route (if any) is kept — it came
  // from a real tool_use block and is unaffected — but the prose is replaced wholesale rather than
  // sanitized, since a half-stripped tag is still not something this character would say.
  if (turn.say && LEAKED_TOOL_CALL.test(turn.say)) {
    noteDegraded('say_leaked_tool_call')
    return { say: VOICE.retry, done: false }
  }

  switch (turn.outcome) {
    case 'route': {
      const translated = toPlannedRoute(turn.rawRoute, allowed)
      // A loop with no way home is the one "no route" outcome that is not a failure — the plan is one
      // answer short, so the rider gets that question instead of an apology, and the model's own line
      // is REPLACED because it has already promised a drive that is not coming. Kept ahead of the
      // untranslatable branch so it can never be reported as a broken turn.
      if (!translated.ok && translated.reason === 'loop_without_return') {
        noteDegraded('loop_without_return')
        return { say: VOICE.needReturnLeg, done: false }
      }
      // A route we cannot use is not a route. The rider still hears what the skipper said; they simply
      // are not handed a drive to confirm — which is why this, uniquely, is a degradation the vendor's own
      // stop_reason calls a success.
      // ⚠ TWO REASONS, ONE RIDER-FACING BRANCH, and the asymmetry IS the design: an off-roster id and a
      // malformed call are the same thing to the RIDER (no card, the skipper's own line stands) and very
      // different things to an OPERATOR (a model composing ids vs. a broken call shape). So they split on
      // the log and share the response. Never collapse the two reasons to save a line.
      if (!translated.ok) {
        noteDegraded(translated.reason === 'off_roster' ? 'route_off_roster' : 'route_untranslatable')
        // ⚠ `retry` asks them to say it again, which is right here and WRONG on the branch below — see
        // VOICE.drawnWordless. The model's own line is kept when it produced one: it may be a perfectly
        // good sentence that simply came with an unusable call.
        return { say: turn.say || VOICE.retry, done: false }
      }
      // ⚠ THIS BACKSTOPS AN EMPTY `say`, and it is now the LAST resort rather than the only one. The
      // prompt's "say a line every single turn" was measured not to work at all on a draw turn — the
      // model emits the tool JSON and no text block, on every draw, under either prompt (2026-08-03). So
      // `say` became a REQUIRED field on PLAN_ROUTE_TOOL and ./planner unwraps it; read that note before
      // touching this. Reaching this line now means the model returned a route with neither a text block
      // NOR a `say` in the call, which is a schema violation rather than the ordinary case it used to be
      // — so a rise in `route_wordless` is now a much sharper signal.
      //
      // That used to be survivable by accident: the empty bubble arrived WITH a card, so the turn still
      // looked like something happened. It stopped being survivable when the client began refusing to
      // redraw a route it already has — the card is correctly suppressed, and a blank `say` then makes
      // the whole turn render as nothing at all. The rider types, and the screen does not move.
      if (!turn.say) noteDegraded('route_wordless')
      return { say: turn.say || VOICE.drawnWordless, route: translated.route, done: false }
    }
    case 'say':
      return { say: turn.say, done: false }
    case 'refused':
      noteDegraded('refused')
      return { say: VOICE.refused, done: false }
    case 'truncated':
    case 'aborted':
    case 'empty':
      // The outcome IS the reason here, and passing it through keeps the enum honest: if PlannerOutcome
      // ever grows a case, this switch stops being exhaustive and the compiler says so.
      noteDegraded(turn.outcome)
      // ⚠ `say` may be non-empty even here — the model got a sentence out before it was cut off. Show
      // it, then add the retry line, rather than throwing away words the rider already saw streaming.
      return { say: turn.say ? `${turn.say} ${VOICE.retry}` : VOICE.retry, done: false }
  }
}

planRoutes.post('/', async (c) => {
  const read = await readJsonBody(
    c,
    drivePlanRequest,
    'turns[] and regionId are required.',
    MAX_PLAN_BODY_BYTES,
    'That is a lot of talking. Start a fresh one?',
  )
  if (!read.ok) return read.res

  // ⚠ The caps are enforced HERE, not in the Zod schema: they price MODEL TOKENS, so their home is
  // ./limits, and @skipper/shared cannot import apps/api. Failing in persona rather than with a bare
  // 400 — a rider who has been chatting with a character should not suddenly meet a validator.
  const capFailure = checkTranscript(read.data.turns)
  if (capFailure) {
    return c.json({ say: "We have been at this a while. Let's start fresh and I'll get you rolling.", done: true }, 200)
  }

  // ⚠ MEMOIZED (./roster-cache), and it replaces TWO SEQUENTIAL DB round-trips that used to run in
  // front of every rider message — the region read, then the anchor read that needs its bbox. What
  // they fetch is identical for every rider in a region and changes only when an operator releases one
  // or runs `curate-places`. It also keeps the roster stable across the turns of one conversation,
  // which matters because the roster rides inside the CACHED prompt prefix: a mid-conversation change
  // would re-bill the whole prefix at full price with nothing failing.
  const roster = await loadRegionRoster(read.data.regionId)
  if (!roster) return c.json({ say: VOICE.noRegion, done: true } satisfies DrivePlanResponse, 200)

  const args: PlannerModelArgs = {
    turns: read.data.turns,
    regionName: roster.name,
    anchors: roster.anchors,
    // ⚠ THE MODEL'S MISSING MEMORY. The transcript is text-only, so without this the skipper cannot
    // see that he ever drew anything and has to infer it from his own prose — the defect class behind
    // "Consider it drawn" in answer to "what do I call you?", and behind re-emitting an identical
    // route on "sweet". Ids in, names resolved from the roster (./planner `buildDrawnBlock`), so
    // nothing a caller types reaches a system block. ⚠ Spread, so the key is ABSENT on the first turn
    // rather than an empty array that would render an empty block.
    ...(read.data.drawn?.length ? { drawn: read.data.drawn } : {}),
    // D12 — the in-persona wrap-up, and THIS IS THE PRODUCER. It has three halves and they only work
    // together: the THRESHOLD in ./limits, this line, the volatile system block in ./planner, and the
    // `== Wrapping up ==` section of ./planner-prompt that the notice's opening phrase is the trigger
    // for. ⚠ It shipped without this line — the field was typed and consumed with nothing on earth
    // setting it, so D12 was prose describing behaviour the server could not produce, and every test
    // around it stayed green because a `?:` field that is always absent is never wrong.
    //
    // ⚠ UX, NOT THE GUARD. `checkTranscript` above is the guard (INV-3) and answers with a hard stop;
    // this exists so a rider never reaches it. Do not merge the two — a cap cannot be charming, and
    // prose cannot enforce a cap.
    //
    // ⚠ SPREAD, so the key is ABSENT rather than `undefined` on a normal turn. ./planner branches on
    // truthiness so either would work today, but an absent key cannot be accidentally rendered as an
    // empty third system block, which would cost the cache breakpoint's benefit for nothing.
    ...(read.data.turns.length > PLAN_WRAP_UP_AFTER_MESSAGES ? { wrapUpNotice: PLANNER_WRAP_UP_NOTICE } : {}),
    // ⚠ The rider's connection, threaded all the way to the model call. This ONE line is the whole
    // cancellation feature: without it, a rider who backgrounds the app bills Opus to completion on a
    // turn nobody will read (INV-11). It is also exactly the kind of line a refactor drops silently,
    // which is why there is a test asserting the planner received a live signal.
    signal: c.req.raw.signal,
  }

  // ⚠ THE SAME LIST THE MODEL WAS GIVEN, AS A SET — built from `roster.anchors` and nothing else, so
  // "re-assert against the allowlist THIS TURN was given" is true by construction rather than by two
  // reads of the same table hopefully agreeing. Built once per request, not per id, and deliberately
  // AFTER `args` so it can never drift from `args.anchors`. See `toPlannedRoute`.
  const allowed: ReadonlySet<string> = new Set(roster.anchors.map((a) => a.id))

  // ⚠ THE ONLY BRANCH IN THIS HANDLER, AND IT IS DELIBERATELY THE LAST THING IN IT. Every rejection
  // above — the 413, both 400s, the cap wrap-up, the unknown region — answers with the SAME JSON on
  // both Accepts, so "does this client stream?" can never change whether a request is accepted or what
  // it costs. The client already needs a not-SSE branch for 413/400/429; reusing it for the two
  // in-persona 200s costs it nothing and costs us one fewer response shape to keep in sync. It is also
  // what lets an older Cloud Run revision answer a streaming request during a rollout without breaking
  // the rider — the JSON path never went away.
  if (!wantsStream(c.req.header('accept'))) {
    try {
      return c.json(toResponse(await runPlannerTurn(args), allowed) satisfies DrivePlanResponse)
    } catch (err) {
      // ⚠ STILL SWALLOWED. The caught value may carry a prompt, a transcript fragment, or a vendor
      // message, none of which may reach the rider OR the log (INV-13) — so it is never logged, never
      // rethrown and never echoed. `noteThrownDegradation` reads ONLY its `reason` (a closed set on our
      // own error class) and only for the two reasons ./planner cannot log itself; read that note before
      // widening it. Everything else safe to log, the planner module has already logged.
      noteThrownDegradation(err)
      return c.json({ say: VOICE.down, done: false } satisfies DrivePlanResponse, 200)
    }
  }

  // No `compress()` middleware exists in ./index.ts, so the only remaining buffering risk on the way to
  // the rider is an intermediary. This is the conventional opt-out; hono sets Cache-Control itself.
  c.header('X-Accel-Buffering', 'no')

  // ⚠ NO `onError` ARGUMENT, EVER, AND THE CALLBACK MUST NOT THROW. hono runs this callback DETACHED,
  // so ./index.ts's app.onError catch-all can never see a throw from inside it. hono's own handler then
  // either console.error()s the raw value — for an Anthropic.APIError that is the response body, which
  // can quote the offending request field, i.e. rider text — or, if an onError IS passed, writes
  // `event: error / data: <message>` straight to the rider. Both are INV-13 violations, and neither is
  // in the frame contract. Total internal try/catch is the only safe shape here.
  return streamSSE(c, async (sse) => {
    // ⚠ ONE SERIALIZED WRITE CHAIN. `onSay` fires SYNCHRONOUSLY inside the SDK's emit loop while
    // writeSSE is async, so a delta cannot be awaited at its call site; chaining is what guarantees the
    // frames reach the wire in the order the model produced them. It is also the one place a write
    // rejection is swallowed — a dead socket is an ordinary outcome here, not an error.
    let chain: Promise<void> = Promise.resolve()
    const push = (m: SSEMessage | string): Promise<void> => {
      // ⚠ `await`ed rather than returned: `write` resolves to the stream while `writeSSE` resolves to
      // void, and a ternary between the two gives TS a union of promises it will not thread through
      // `.then`. Awaiting flattens both to void, which is all this chain cares about anyway.
      chain = chain
        .then(async () => {
          if (typeof m === 'string') await sse.write(m)
          else await sse.writeSSE(m)
        })
        .catch(() => {})
      return chain
    }

    const beat = setInterval(() => void push(': keep-alive\n\n'), SSE_HEARTBEAT_MS)
    let terminated = false
    /** Exactly one `turn` frame ever leaves here, and it is the last thing on the wire. The client
     *  treats it as AUTHORITATIVE and REPLACES its accumulated deltas with its `say` — which is not
     *  pedantry: a refusal replaces the streamed text entirely and a truncation appends the retry line
     *  to it (see toResponse above). EOF with no `turn` frame means the turn failed. */
    const terminate = (r: DrivePlanResponse): Promise<void> => {
      if (terminated) return chain
      terminated = true
      return push({ event: 'turn', data: JSON.stringify(r) })
    }

    try {
      const turn = await runPlannerTurn({
        ...args,
        // ⚠ JSON, NOT THE BARE STRING. JSON.stringify escapes every control character below U+0020, so
        // a delta containing a newline can never become a second `data:` line — the one way this frame
        // format could be parsed ambiguously, and the reason the payload is an object at all. Do not
        // "simplify" this to `data: ${delta}`.
        onSay: (delta) => void push({ event: 'say', data: JSON.stringify({ delta }) }),
      })
      await terminate(toResponse(turn, allowed) satisfies DrivePlanResponse)
    } catch (err) {
      // The rider hung up. There is no socket to write to and nothing to apologise for; leaving WITHOUT
      // a terminal frame is CORRECT, and the client's own EOF-without-`turn` rule covers it.
      if (err instanceof PlannerTurnError && err.reason === 'client_gone') return
      // ⚠ The SAME call the JSON path makes, so an operator's view of a broken deploy does not depend on
      // whether the rider's client happened to ask for SSE. It cannot throw — see its own note; a throw
      // here would escape hono's detached runner entirely.
      noteThrownDegradation(err)
      await terminate({ say: VOICE.down, done: false } satisfies DrivePlanResponse)
    } finally {
      clearInterval(beat)
      // Flush before hono's detached runner closes the stream — otherwise the terminal frame can lose
      // the race with close() and the rider gets a clean EOF that reads as a failed turn.
      await chain
    }
  })
})
