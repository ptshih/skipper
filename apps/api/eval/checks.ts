// The DETERMINISTIC half of the planner eval panel — every gate dimension, as pure functions.
//
// ⚠ PURE AND IMPORT-LIGHT ON PURPOSE. These decide the three GATE dimensions, so they must be
// exercisable by `bun test` with no network, no key and no spend — which is also what makes it
// honest to gate on them. The judge (./judge) is the advisory half and needs a model.
//
// ⚠ NOTHING HERE READS THE PROMPT'S INTENT — it reads what came back. A check that consulted the
// prompt to decide whether output was compliant would pass whenever the prompt and the output shared
// a mistake, which is the one failure mode an eval exists to catch.

import { PLANNER_SYSTEM_PROMPT } from '../src/planner-prompt'
import type { PlannerDimension, ScenarioTurn, TurnEval, TurnOutcome } from './types'

/* -------------------------------------------------------------------------- */
/* Drive identity.                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The identity of the DRIVE a tool call describes: start, end, and the midpoints in order.
 *
 * ⚠ THIS IS DELIBERATELY THE SAME DEFINITION THE TOOL DESCRIPTION NOW STATES ("Two calls sharing the
 * same start_anchor_id, end_anchor_id and via_anchor_ids are the SAME drive however else they differ,
 * target_minutes included") AND THE SAME ONE `proposeKey` USES ON THE CLIENT. That three-way
 * agreement is the whole point: the founder's bug was those three definitions disagreeing. This is a
 * third copy by necessity — `apps/api` cannot import from `apps/mobile` — so the tests below assert
 * the property rather than trusting the coincidence.
 *
 * ⚠ `target_minutes` is EXCLUDED. `toProposeRequest` drops it, so two routes differing only in the
 * duration the rider asked for materialize the identical drive from the identical billed call. An
 * eval that treated them as different would score the founder's exact bug as a PASS.
 *
 * ⚠ `round_trip` is excluded too, and that one is subtler: on the wire a loop is `end === start` with
 * the turnaround as the last midpoint, so a round trip and a one-way over the same two anchors are
 * genuinely different `/propose` bodies. It is left out because the model's `round_trip` flag is not
 * what the client keys on, and including it here would let a model "change" a drive by flipping a
 * boolean while `proposeKey` — the thing that actually decides whether a card is drawn — collides.
 * Scoring the strictest reading is correct for a gate.
 */
export function routeKey(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const start = typeof r.start_anchor_id === 'string' ? r.start_anchor_id : null
  const end = typeof r.end_anchor_id === 'string' ? r.end_anchor_id : null
  if (!start || !end) return null
  const via = Array.isArray(r.via_anchor_ids) ? r.via_anchor_ids.filter((v): v is string => typeof v === 'string') : []
  return JSON.stringify([start, end, via])
}

/* -------------------------------------------------------------------------- */
/* routing — did it draw exactly when it should have?                           */
/* -------------------------------------------------------------------------- */

/**
 * Score the ROUTING dimension for one turn, given every drive already drawn in this conversation.
 *
 * `drawnBefore` is the set of `routeKey`s emitted on EARLIER turns of the same scenario — a set, not
 * a "last route", because the founder's report was about returning to an earlier plan several turns
 * later, which a last-route-only check cannot see.
 */
export function routingCheck(o: TurnOutcome, drawnBefore: ReadonlySet<string>): TurnEval {
  const findings: string[] = []
  const drew = o.routeKey !== null

  if (o.expect === 'draw' && !drew) {
    findings.push('expected a route on this turn and none came back — the rider said yes and would watch nothing happen')
  }
  if (o.expect !== 'draw' && drew) {
    findings.push(`a route was drawn on a turn that should have held (expect=${o.expect})`)
  }
  // ⚠ Checked on EVERY turn, not only `hold_no_repeat` ones. A repeat is wrong even on a turn where
  // drawing was expected: if the rider agrees to a "new" plan and the model re-emits an identical
  // drive, the client dedupes and the rider sees a card slide down while the skipper claims a change.
  // That is the founder's bug in its post-3401b8f form, and it is the one this suite exists for.
  if (drew && o.routeKey && drawnBefore.has(o.routeKey)) {
    findings.push('this drive was already drawn earlier in the conversation — identical start, end and via')
  }
  // A paid turn that produced nothing usable. The rider hears VOICE.retry.
  if (o.outcome === 'truncated' || o.outcome === 'refused' || o.outcome === 'empty' || o.outcome === 'aborted') {
    findings.push(`the turn ended '${o.outcome}' — a paid call the rider got nothing usable from`)
  }

  return evalOf(o, 'routing', findings)
}

/* -------------------------------------------------------------------------- */
/* voice — did the rider get a line at all, and does it read as speech?         */
/* -------------------------------------------------------------------------- */

/** Markup the prompt bans outright. Each would render as literal characters in the bubble. */
const MARKUP = [/\*\*/, /^#{1,6}\s/m, /^\s*[-*]\s/m, /\[.+\]\(.+\)/, /`/]
/** Emoji and pictographs — banned, and the app's own icons are vector for the same reason. */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u

export function voiceCheck(o: TurnOutcome): TurnEval {
  const findings: string[] = []

  // ⚠ THE HIGHEST-VALUE CHECK IN THIS FILE. Nothing structurally guarantees a text block rides with a
  // tool call (`say` is deliberately not a tool field), so the prompt's "Say a line every single turn"
  // is the ONLY mechanism — and it has already failed in production (`route_wordless`).
  if (o.say.trim() === '') findings.push('empty say — the rider types and the screen does not move')

  if (MARKUP.some((re) => re.test(o.say))) findings.push('markup in a spoken line — it renders as literal characters')
  if (EMOJI.test(o.say)) findings.push('emoji in a spoken line')

  // Not a hard length cap — the prompt says "one to three sentences on most turns", so this flags the
  // monologue, not the occasional long one.
  if (o.say.length > 600) findings.push(`${o.say.length} chars — this is a paragraph, not a chat at a car window`)

  return evalOf(o, 'voice', findings)
}

/* -------------------------------------------------------------------------- */
/* discipline — did it stay off facts, distances and its own script?            */
/* -------------------------------------------------------------------------- */

/**
 * A DISTANCE claim. Durations are deliberately NOT matched: the skipper legitimately asks for and
 * repeats back the duration the rider named ("and you said a couple of hours"), so a bare number
 * detector would fire on correct output. He has no distances at all, under any phrasing.
 */
const DISTANCE = /\b\d+(\.\d+)?\s*(miles?|mi\b|kilometers?|kilometres?|km)\b/i
/** "twenty minutes away" / "an hour out" — a distance dressed as a duration, which he also lacks. */
const DISTANCE_AS_TIME = /\b(minutes?|hours?)\s+(away|out from|from here)\b/i

/**
 * Sentences the model lifted VERBATIM out of its own system prompt.
 *
 * ⚠ WHY THIS IS THE CHEAPEST REAL QUALITY SIGNAL AVAILABLE. The prompt teaches by example, and a
 * few-shot beats an instruction — so the failure mode is the model reciting the sample deflections and
 * the worked exchange at riders, every conversation, word for word. That reads as canned the second
 * time a rider sees it, and no substring assertion on a static string can detect it.
 *
 * ⚠ THE 45-CHAR FLOOR IS NOT ARBITRARY, AND A LOWER ONE IS ACTIVELY WRONG. At 25 this fired on
 * "How long do you want to be out?" — a generic planning question the Skipper MUST ask, which happens
 * to sit inside one of the prompt's longer sample lines. Penalising it would push the prompt toward
 * teaching worse questions. The floor buys precision at the cost of missing short catchphrases
 * ("Now that'd be telling."), and that gap is covered deliberately by a different instrument: the
 * persona judge's `canned` flag, which is asked to hunt exactly that. Deterministic checks take the
 * unambiguous half; taste takes the rest.
 */
const PARROT_MIN_CHARS = 45

export function parrotedSentences(say: string): string[] {
  return say
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= PARROT_MIN_CHARS && PLANNER_SYSTEM_PROMPT.includes(s))
}

export function disciplineCheck(o: TurnOutcome, turn: ScenarioTurn): TurnEval {
  const findings: string[] = []
  const lower = o.say.toLowerCase()

  for (const b of turn.banned ?? []) {
    if (lower.includes(b.toLowerCase())) findings.push(`said a banned phrase for this turn: ${JSON.stringify(b)}`)
  }
  if (DISTANCE.test(o.say)) findings.push('asserted a DISTANCE — he has no map, no coordinates and no distances')
  if (DISTANCE_AS_TIME.test(o.say)) findings.push('asserted how far away something is — same gap, dressed as a duration')

  for (const p of parrotedSentences(o.say)) {
    findings.push(`recited its own prompt verbatim: ${JSON.stringify(p.slice(0, 70))}`)
  }

  return evalOf(o, 'discipline', findings)
}

/* -------------------------------------------------------------------------- */
/* Rollup.                                                                      */
/* -------------------------------------------------------------------------- */

function evalOf(o: TurnOutcome, dimension: PlannerDimension, findings: string[]): TurnEval {
  return {
    scenarioId: o.scenarioId,
    index: o.index,
    dimension,
    pass: findings.length === 0,
    // Binary rather than graded: every finding in this file is a discrete defect, and inventing a
    // partial credit would only make a failing run look survivable.
    score: findings.length === 0 ? 1 : 0,
    findings,
  }
}

/**
 * Run every deterministic dimension over a whole replayed scenario, threading the drawn-set forward.
 * Returns the evals in turn order.
 */
export function checkScenario(outcomes: readonly TurnOutcome[], turns: readonly ScenarioTurn[]): TurnEval[] {
  const drawn = new Set<string>()
  const out: TurnEval[] = []
  for (const o of outcomes) {
    const turn = turns[o.index]
    if (!turn) continue
    out.push(routingCheck(o, drawn), voiceCheck(o), disciplineCheck(o, turn))
    // ⚠ Added AFTER the check, never before — otherwise a turn's own route counts as a prior draw and
    // every legitimate first draw scores as a repeat.
    if (o.routeKey) drawn.add(o.routeKey)
  }
  return out
}
