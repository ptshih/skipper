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
import { MAX_PLAN_ANCHORS, PLANNER_MAX_TOKENS } from './limits'
// ⚠ The tool comes from ./planner-prompt, not from here. Its name and every field description are prose
// the MODEL reads, so it is prompt surface and changes under the prompt's review (INV-10) — a second copy
// in this file would drift silently, since nothing fails when two tool descriptions disagree.
import { PLAN_ROUTE_TOOL, PLANNER_SYSTEM_PROMPT } from './planner-prompt'

/* -------------------------------------------------------------------------- */
/* Call knobs. The rider-facing CAPS live in ./limits (INV-12) — these are the  */
/* transport/depth settings that only mean something at this one call site.     */
/* -------------------------------------------------------------------------- */

/** Thinking DEPTH. Deliberately paired with `PLANNER_MAX_TOKENS`, which bounds thinking PLUS visible
 *  output in ONE budget on this model (there is no separate thinking budget — `budget_tokens` is a 400).
 *  ⚠ Raising this without raising that cap is the failure limits.ts warns about: higher effort against a
 *  small ceiling returns HTTP 200 with stop_reason 'max_tokens' and no usable tool call. The planner's
 *  job is small — pick two endpoints off a printed list — so depth buys latency, not quality. */
const PLANNER_EFFORT = 'low' as const

/** Per-ATTEMPT socket timeout. ⚠ It is NOT a wall clock: the SDK retries timeouts, so the worst case is
 *  roughly this x (maxRetries + 1) plus backoff. The AbortSignal on the request is the hard bound, and
 *  both sit inside Cloud Run's default request timeout (cloudbuild.yaml passes no --timeout). */
const PLANNER_TIMEOUT_MS = 45_000

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
 *  ("scenic spot", "marina") is a place FACT — D9 gives the planner none. `featured` is ORDERING, never
 *  a printed field. A `RegionAnchor` row is assignable here; the extra columns are simply not read. */
export interface PlannerAnchor {
  id: string
  name: string
  featured?: boolean
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
  /** Called per token as the rider-visible text streams, for a caller relaying its OWN SSE frames.
   *  ⚠ Never proxy the raw Anthropic stream — it carries thinking blocks, signatures and tool
   *  internals. Deltas already emitted are NOT retracted if the turn later fails. */
  onSay?: (delta: string) => void
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
   *   3. Every id is re-asserted against the same allowlist this turn was given, and the whole route is
   *      DROPPED (degrading to a `say` turn) if any misses — never a route the rider taps into a 400.
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
     *  500 (ours to fix); `timeout` / `upstream` -> 503 (retryable). All four want an IN-PERSONA line. */
    readonly reason: 'bad_transcript' | 'not_configured' | 'timeout' | 'upstream',
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
 *  - `apps/api` must keep booting env-free. `GET /health`, `/sources` and `/version` have no business
 *    needing an Anthropic key, and auth.ts is already the one hard throw-at-load this app tolerates.
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
  const printable = [...anchors].sort((a, b) => {
    // Featured first (ordering only — never a printed field, which would be a place FACT).
    if (a.featured !== b.featured) return a.featured ? -1 : 1
    // ⚠ Codepoint comparison, NOT localeCompare: locale/ICU differences between processes would make
    // the cached prefix differ between Cloud Run instances for the same region.
    if (a.name !== b.name) return a.name < b.name ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  if (printable.length > MAX_PLAN_ANCHORS) {
    // The cap is a ceiling far above any curated region today, so this firing is a product signal, not
    // a paging event — log the count (never the names) and let the operator decide.
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
    'This is the whole list. Name first, then the id you copy when you draw a route up.',
    '',
    rows,
  ].join('\n')
}

const flatten = (s: string): string => s.replace(/\s+/g, ' ').trim()

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
  if (args.wrapUpNotice) system.push({ type: 'text', text: args.wrapUpNotice })

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
      output_config: { effort: PLANNER_EFFORT },
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
    // The client `timeout` above is per ATTEMPT and is itself retried; this is the hard wall clock.
    { signal: AbortSignal.timeout(PLANNER_TIMEOUT_MS) },
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
    throw plannerFailure(err, stream.request_id)
  }

  // Both, on purpose. `usageUsd` is the number for THIS call (a long-lived API process cannot
  // meaningfully attribute a running total to anyone); `recordModelUsage` is the process tally INV-11
  // names as one of the four guards on rider-triggered spend. The tally is keyed by model, so it is
  // bounded in entries — only the counters grow.
  // ⚠ Keyed on the model we ASKED for, never on `message.model`. The API is not contractually bound to
  // echo the alias back — it may resolve to a longer id — and MODEL_PRICING is keyed on the alias, so
  // pricing the echo would silently tally $0 under a second, unpriced key. That is exactly the failure
  // @skipper/shared's spend.ts warns about, and the drift guard CANNOT catch it: the guard validates
  // the requested ids, so it stays green while the runtime key drifts. Every other call site in the
  // repo records against the requested constant; this one now matches. `message.model` is still worth
  // having as the served-by signal — it goes in the log line below, not into the tally.
  recordModelUsage(CLAUDE_MODELS.planner, message.usage)
  const details = message.usage.output_tokens_details
  console.info(
    `[planner] stop=${message.stop_reason} anchors=${args.anchors.length}` +
      ` in=${message.usage.input_tokens} cr=${message.usage.cache_read_input_tokens ?? 0}` +
      ` cw=${message.usage.cache_creation_input_tokens ?? 0} out=${message.usage.output_tokens}` +
      ` think=${details?.thinking_tokens ?? 0} $${usageUsd(CLAUDE_MODELS.planner, message.usage).toFixed(5)}` +
      ` served=${message.model} req=${stream.request_id ?? '-'}`,
  )
  // ⚠ Counts, ids and an anchor COUNT only. Never the body, the prompt, the roster, `say`, or a tool
  // input. `cr=0` across turns is the tell that the cached prefix broke — that is what it is here for.

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
      return { ...base, outcome: 'route', rawRoute: call.input }
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

/**
 * Classify a vendor failure into something safe to carry, and log the safe half of it.
 *
 * ⚠ The raw error never leaves this function. Status, error type and request id are ours to log; the
 * body is not (`APIError.error` is the response JSON, which can quote the offending field).
 */
function plannerFailure(err: unknown, requestId: string | null | undefined): PlannerTurnError {
  if (err instanceof PlannerTurnError) return err

  const timedOut =
    err instanceof Anthropic.APIUserAbortError || err instanceof Anthropic.APIConnectionTimeoutError
  const status = err instanceof Anthropic.APIError ? err.status : undefined
  const type = err instanceof Anthropic.APIError ? err.type : null
  // ⚠ `requestID` on an APIError, `request_id` on a MessageStream — two spellings of one id, and a typo
  // silently logs `undefined`.
  const id = (err instanceof Anthropic.APIError ? err.requestID : null) ?? requestId ?? '-'

  console.error(
    `[planner] model call failed: ${timedOut ? 'timeout' : (type ?? 'unknown')}` +
      ` status=${status ?? '-'} req=${id}`,
  )
  return new PlannerTurnError(timedOut ? 'timeout' : 'upstream')
}
