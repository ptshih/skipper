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
// proof of the framed payload's shape — do not grow a second response builder inside the callback.
//   • The TERMINAL frame is AUTHORITATIVE and its `say` may DIFFER from the concatenated deltas: a
//     refusal REPLACES the streamed text, a truncation APPENDS the retry line to it. The client
//     overwrites its buffer with the terminal `say` — it never appends.
//   • EOF with NO terminal frame means the turn failed (or the rider hung up). That is the client's
//     signal, and it is why nothing here writes an apology to a rider who has already left.
//   • Every REJECTION — the 413, both 400s, the cap wrap-up, the unknown region — stays JSON on BOTH
//     Accepts, so whether a client streams can never change whether its request is accepted.

import { Hono } from 'hono'
import { streamSSE, type SSEMessage } from 'hono/streaming'
import { eq } from 'drizzle-orm'
import { db } from '@skipper/db'
import { regions } from '@skipper/db/schema'
import { drivePlanRequest, type DrivePlanResponse, type PlannedRoute } from '@skipper/shared'
import { loadRegionAnchors } from './drives'
import type { ApiEnv } from './entitlements'
import {
  checkTranscript,
  MAX_PLAN_BODY_BYTES,
  readBoundedText,
} from './limits'
import { PlannerTurnError, runPlannerTurn, type PlannerModelArgs, type PlannerTurn } from './planner'
import { withRetry } from './retry'

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

/** The model's tool vocabulary → the wire shape. ⚠ THREE TRANSLATIONS, all load-bearing — see the
 *  `rawRoute` doc in ./planner. The one that bites: `round_trip` is NOT the wire's loop shape. Here it
 *  means "come back around"; on the wire a loop is `end === start` with the turnaround as the LAST
 *  `via` midpoint, because `start === end` alone materializes as a degenerate zero-distance route.
 *  Returns null on anything malformed — model output is untrusted, and a half-parsed route must read
 *  as "no route" rather than as a route to somewhere nobody asked for. */
function toPlannedRoute(raw: unknown): PlannedRoute | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const start = typeof r.start_anchor_id === 'string' ? r.start_anchor_id : null
  const end = typeof r.end_anchor_id === 'string' ? r.end_anchor_id : null
  if (!start || !end) return null
  const via = Array.isArray(r.via_anchor_ids) ? r.via_anchor_ids.filter((v): v is string => typeof v === 'string') : []
  const minutes = typeof r.target_minutes === 'number' && Number.isFinite(r.target_minutes) ? Math.round(r.target_minutes) : null

  // The round-trip mapping. A loop ends where it started and needs a real far end to turn around at,
  // so the model's `end` becomes the midpoint and `start` becomes both ends.
  const roundTrip = r.round_trip === true
  const wire: PlannedRoute = roundTrip
    ? { start, end: start, via: [...via, end], ...(minutes != null ? { targetMinutes: minutes } : {}) }
    : { start, end, ...(via.length ? { via } : {}), ...(minutes != null ? { targetMinutes: minutes } : {}) }

  // ⚠ The wire caps `via` at 8 to bound the single billed Routes call. A round trip appends one, so a
  // model that filled `via` to the brim would push it over — drop the route rather than ship a request
  // the next endpoint will reject anyway.
  if ((wire.via?.length ?? 0) > 8) return null
  return wire
}

/** Map a planner outcome to what the rider hears. ⚠ Derived from the OUTCOME, never from "is there a
 *  route" — a truncated turn and a normal chat beat are byte-identical from the caller's side, and
 *  treating them the same is how a rider says yes and watches nothing happen. */
function toResponse(turn: PlannerTurn): DrivePlanResponse {
  switch (turn.outcome) {
    case 'route': {
      const route = toPlannedRoute(turn.rawRoute)
      // A route we cannot translate is not a route. The rider still hears what the skipper said; they
      // simply are not handed a drive to confirm.
      return route ? { say: turn.say, route, done: false } : { say: turn.say || VOICE.retry, done: false }
    }
    case 'say':
      return { say: turn.say, done: false }
    case 'refused':
      return { say: VOICE.refused, done: false }
    case 'truncated':
    case 'aborted':
    case 'empty':
      // ⚠ `say` may be non-empty even here — the model got a sentence out before it was cut off. Show
      // it, then add the retry line, rather than throwing away words the rider already saw streaming.
      return { say: turn.say ? `${turn.say} ${VOICE.retry}` : VOICE.retry, done: false }
  }
}

planRoutes.post('/', async (c) => {
  const read = await readBoundedText(c.req.raw, MAX_PLAN_BODY_BYTES)
  if (!read.ok) {
    return c.json({ error: 'payload_too_large', message: 'That is a lot of talking. Start a fresh one?' }, 413)
  }
  let body: unknown
  try {
    body = JSON.parse(read.text)
  } catch {
    return c.json({ error: 'bad_request', message: 'Invalid JSON body.' }, 400)
  }
  const parsed = drivePlanRequest.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'bad_request', message: 'turns[] and regionId are required.' }, 400)
  }

  // ⚠ The caps are enforced HERE, not in the Zod schema: they price MODEL TOKENS, so their home is
  // ./limits, and @skipper/shared cannot import apps/api. Failing in persona rather than with a bare
  // 400 — a rider who has been chatting with a character should not suddenly meet a validator.
  const capFailure = checkTranscript(parsed.data.turns)
  if (capFailure) {
    return c.json({ say: "We have been at this a while — let's start fresh and I'll get you rolling.", done: true }, 200)
  }

  const [region] = await withRetry(
    () => db.select({ bbox: regions.bbox, name: regions.displayName }).from(regions).where(eq(regions.id, parsed.data.regionId)).limit(1),
    { label: 'plan.region' },
  )
  if (!region) return c.json({ say: VOICE.noRegion, done: true } satisfies DrivePlanResponse, 200)

  const anchors = await loadRegionAnchors(region.bbox)

  const args: PlannerModelArgs = {
    turns: parsed.data.turns,
    regionName: region.name,
    anchors,
    // ⚠ The rider's connection, threaded all the way to the model call. This ONE line is the whole
    // cancellation feature: without it, a rider who backgrounds the app bills Opus to completion on a
    // turn nobody will read (INV-11). It is also exactly the kind of line a refactor drops silently,
    // which is why there is a test asserting the planner received a live signal.
    signal: c.req.raw.signal,
  }

  // ⚠ THE ONLY BRANCH IN THIS HANDLER, AND IT IS DELIBERATELY THE LAST THING IN IT. Every rejection
  // above — the 413, both 400s, the cap wrap-up, the unknown region — answers with the SAME JSON on
  // both Accepts, so "does this client stream?" can never change whether a request is accepted or what
  // it costs. The client already needs a not-SSE branch for 413/400/429; reusing it for the two
  // in-persona 200s costs it nothing and costs us one fewer response shape to keep in sync. It is also
  // what lets an older Cloud Run revision answer a streaming request during a rollout without breaking
  // the rider — the JSON path never went away.
  if (!wantsStream(c.req.header('accept'))) {
    try {
      return c.json(toResponse(await runPlannerTurn(args)) satisfies DrivePlanResponse)
    } catch {
      // ⚠ Swallowed deliberately: the caught value may carry a prompt, a transcript fragment, or a
      // vendor message, none of which may reach the rider OR the log (INV-13). The planner module has
      // already logged what is safe to log.
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
      await terminate(toResponse(turn) satisfies DrivePlanResponse)
    } catch (err) {
      // The rider hung up. There is no socket to write to and nothing to apologise for; leaving WITHOUT
      // a terminal frame is CORRECT, and the client's own EOF-without-`turn` rule covers it.
      if (err instanceof PlannerTurnError && err.reason === 'client_gone') return
      await terminate({ say: VOICE.down, done: false } satisfies DrivePlanResponse)
    } finally {
      clearInterval(beat)
      // Flush before hono's detached runner closes the stream — otherwise the terminal frame can lose
      // the race with close() and the rider gets a clean EOF that reads as a failed turn.
      await chain
    }
  })
})
