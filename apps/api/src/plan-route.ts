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

import { Hono } from 'hono'
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
import { runPlannerTurn, type PlannerModelArgs, type PlannerTurn } from './planner'
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
  }
  try {
    return c.json(toResponse(await runPlannerTurn(args)))
  } catch {
    // ⚠ Swallowed deliberately: the caught value may carry a prompt, a transcript fragment, or a
    // vendor message, none of which may reach the rider OR the log (INV-13). The planner module has
    // already logged what is safe to log.
    return c.json({ say: VOICE.down, done: false } satisfies DrivePlanResponse, 200)
  }
})
