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
// INV-8's failure mode: a tool call serialized into rider-visible prose instead of a tool_use block.
// ../src/plan-route SUPPRESSES it in production; here it must be COUNTED, because a suppressed defect
// an eval cannot see is a defect that silently grows.
//
// ⚠ SHARED WITH THE SUPPRESSOR, and it has to be. This was a LOCAL COPY until 2026-08-04, frozen at
// the pattern's first cut — bare names only — while production widened it to catch closing and
// NAMESPACED tags after one got through to a rider. So the eval scored exactly the shape production
// had just been fixed for as CLEAN, on a run that spends real money to produce that score. A counter
// blind to what its guard catches is worse than no counter.
// ⚠ ../src/tool-call-leak imports NOTHING, which is what keeps this half runnable with no network, no
// key and no spend — importing ../src/plan-route for the same constant would drag in the Anthropic SDK
// and @skipper/db and break exactly the property ../test/planner-eval.test.ts exists to protect.
import { LEAKED_TOOL_CALL } from '../src/tool-call-leak'
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
 * the turnaround as the second-to-last midpoint, so a round trip and a one-way over the same two
 * anchors are genuinely different `/propose` bodies. It is left out because the model's `round_trip`
 * flag is not what the client keys on, and including it here would let a model "change" a drive by
 * flipping a boolean while `proposeKey` — the thing that actually decides whether a card is drawn —
 * collides. Scoring the strictest reading is correct for a gate.
 *
 * ⚠ `return_anchor_id` IS INCLUDED, and it is the one place the strictest reading would be WRONG.
 * Since the no-same-road rule (docs/decisions/no-same-road-loops.md) the server appends the rider's way
 * home into `via`, so two loops that differ only in it are different `/propose` bodies AND different
 * `proposeKey`s — the client draws a second card and a second Routes call is genuinely billed. The
 * prompt also now tells the model to redraw when the way home changes. Excluding it would score the
 * model FAILING for doing exactly what it was told, on a drive the rider really did change. The test
 * for "is this a repeat?" has to match what the client believes, not what is strictest.
 */
export function routeKey(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const start = typeof r.start_anchor_id === 'string' ? r.start_anchor_id : null
  const end = typeof r.end_anchor_id === 'string' ? r.end_anchor_id : null
  if (!start || !end) return null
  const via = Array.isArray(r.via_anchor_ids) ? r.via_anchor_ids.filter((v): v is string => typeof v === 'string') : []
  const back = typeof r.return_anchor_id === 'string' ? r.return_anchor_id : null
  return JSON.stringify([start, end, via, back])
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

  if (LEAKED_TOOL_CALL.test(o.say)) {
    findings.push('a TOOL CALL leaked into the spoken line (INV-8) — the route never fired and the rider reads raw markup')
  }
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
 * A DISTANCE claim. Durations are matched separately below, because the two need different rules.
 */
const DISTANCE = /\b\d+(\.\d+)?\s*(miles?|mi\b|kilometers?|kilometres?|km)\b/i
/** "twenty minutes away" / "an hour out" — a distance dressed as a duration, which he also lacks. */
const DISTANCE_AS_TIME = /\b(minutes?|hours?)\s+(away|out from|from here)\b/i

/* -------------------------------------------------------------------------- */
/* The DURATION detector — the one the panel was blind to.                      */
/* -------------------------------------------------------------------------- */

/** Any spoken duration: "two hours", "a couple of hours", "40 minutes", "half an hour". */
// ⚠ The spelled-out numbers matter as much as the digits — "about fifty minutes" is the natural
// register for this character, and an earlier cut of this list stopped at six and missed it entirely.
const DURATION =
  /\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|sixty|ninety|half|couple|few)\s*(?:-|\s)?\s*(hours?|hrs?|minutes?|mins?)\b/i

/**
 * Marks the duration as the RIDER'S, which is legitimate and which the prompt explicitly teaches
 * ("How long they want is THEIRS, never yours: say it back as the thing they asked for").
 */
const RIDER_ATTRIBUTED = /\byou(?:'ve|'re| have| are)?\s+(said|asked|wanted|named|mentioned|told|got|after)\b|\basked for\b|\byour\b/i

/**
 * A duration asserted as a fact about the ROAD rather than echoed back as the rider's own ask.
 *
 * ⚠ WHY THIS EXISTS, AND WHY IT DID NOT BEFORE. The panel shipped with durations deliberately
 * EXCLUDED, on the reasoning that the skipper legitimately repeats the rider's stated target and a
 * bare number check would fire on correct output. That reasoning is right about the false positive and
 * wrong about the consequence: it left "Incline's about fifty minutes from Emerald Bay" — the exact
 * leak that giving the model spatial data would invite — passing all three gates clean. The panel
 * could not see the thing it would most need to see.
 *
 * ⚠ IT IS COARSE ON PURPOSE, AND ITS VALUE IS THE DELTA, NOT THE COUNT. Telling "the two hours you
 * asked for" (fine) from "a couple of hours' worth of road" (an assertion) is a judgement call that a
 * regex cannot make reliably, and tuning it until it could would be fitting it to one run's wording.
 * What it CAN do honestly is be applied identically to two arms of an experiment: if the arm holding a
 * drive-time table asserts durations at a materially higher rate than the arm without one, that is the
 * leak, measured. Read it as an instrument, not as a verdict on any single line.
 */
export function assertedDurations(say: string): string[] {
  return say
    .split(/(?<=[.!?])\s+|\s+--\s+|\s+—\s+/)
    .map((s) => s.trim())
    .filter((s) => DURATION.test(s) && !RIDER_ATTRIBUTED.test(s))
}

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
  // ⚠ `assertedDurations` is deliberately NOT a finding here. It fires on legitimate readbacks that
  // carry the rider's own target without the word "you" ("Kings Beach out to Emerald Bay, a couple of
  // hours"), so gating on it would fail every run and mean nothing. It is reported as a MEASURED COUNT
  // instead — an instrument for comparing two arms of an experiment, not a rule. See its doc.
  if (DISTANCE.test(o.say)) findings.push('asserted a DISTANCE — he has no map, no coordinates and no distances')
  if (DISTANCE_AS_TIME.test(o.say)) findings.push('asserted how far away something is — same gap, dressed as a duration')

  for (const p of parrotedSentences(o.say)) {
    findings.push(`recited its own prompt verbatim: ${JSON.stringify(p.slice(0, 70))}`)
  }

  return evalOf(o, 'discipline', findings)
}

/* -------------------------------------------------------------------------- */
/* The JUKEBOX metric — deterministic, because the judge's is not.              */
/* -------------------------------------------------------------------------- */

/** Phrases shorter than this collide on ordinary English ("out to", "and back around"). */
const PHRASE_WORDS = 6

/**
 * Count near-verbatim phrase reuse ACROSS turns — the jukebox, measured rather than judged.
 *
 * ⚠ WHY THIS EXISTS: THE JUDGE'S `canned` COUNT IS TOO NOISY TO STEER BY. Measured 2026-08-03 across
 * seven replays: the SAME prompt scored 5 canned turns on one run and 15 on the next, and three
 * genuinely different prompts scored 12, 13 and 5-15 — mutually indistinguishable. A decision was
 * actually made on one of those samples and had to be retracted. An advisory dimension that cannot
 * separate a real change from chance at n=1 is not a signal, it is a coin.
 *
 * This is the same trade the panel already makes elsewhere: the objective half gates, the subjective
 * half informs. Repetition happens to be objectively countable, so it moves to the objective half. The
 * judge keeps what only taste can see — whether a line is warm, whether a joke lands — and loses the
 * one job it was measurably bad at.
 *
 * ⚠ Compares across DIFFERENT turns only. A phrase repeated inside one turn is a writing tic; the same
 * sentence in the same slot of every conversation is the failure mode that kills the character.
 * ⚠ Normalized on words, so punctuation and capitalisation cannot hide a repeat, and place NAMES are
 * left in deliberately — "Kings Beach out to Emerald Bay and back" recurring IS the template firing.
 */
export function repeatedPhrases(says: readonly string[]): { phrase: string; count: number }[] {
  const seen = new Map<string, number>()
  for (const say of says) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
    const words = norm(say)
    // A turn contributes each distinct phrase ONCE, so an intra-turn repeat cannot inflate the count.
    const here = new Set<string>()
    for (let i = 0; i + PHRASE_WORDS <= words.length; i++) here.add(words.slice(i, i + PHRASE_WORDS).join(' '))

    // ⚠ WHOLE SENTENCES TOO, AND WITHOUT THE WORD FLOOR — because the floor made this metric blind to
    // the exact thing it was built for. Every catchphrase this prompt has actually produced is SHORT:
    // "Consider it drawn." (3 words), "there she is" (3), "Shall I draw it?" (4). At a 6-word window
    // all three score ZERO, and only the long readback template registered. A repeated fragment needs a
    // floor because short fragments collide on ordinary English — but a repeated COMPLETE SENTENCE does
    // not: nobody says the same whole sentence twice by accident, at any length.
    for (const raw of say.split(/(?<=[.!?])\s+/)) {
      const s = norm(raw).join(' ')
      if (s.split(' ').filter(Boolean).length >= 2) here.add(s)
    }

    for (const p of here) seen.set(p, (seen.get(p) ?? 0) + 1)
  }
  const repeated = [...seen.entries()]
    .filter(([, count]) => count >= 2)
    .map(([phrase, count]) => ({ phrase, count }))
    // Longest first, so the maximal span is always the one kept below.
    .sort((a, b) => b.phrase.length - a.phrase.length)

  // ⚠ COLLAPSE OVERLAPPING WINDOWS, or one repeat is counted many times and every figure this
  // produces is inflated by a factor nobody can see. A repeated 9-word sentence yields four
  // overlapping 6-word windows plus the sentence itself — measured on a real run, the three entries
  // "emerald bay state park out to" / "bay state park out to incline" / "state park out to incline
  // village" were ONE phrase reported three times, and the headline number was ~3x the truth.
  // A phrase is dropped when a LONGER repeated phrase contains it and was seen at least as often.
  const maximal: { phrase: string; count: number }[] = []
  for (const r of repeated) {
    if (maximal.some((m) => m.count >= r.count && m.phrase.includes(r.phrase))) continue
    maximal.push(r)
  }
  return maximal.sort((a, b) => b.count - a.count)
}

/**
 * How many of these turns repeat something an EARLIER turn already said.
 *
 * ⚠ THE INTERPRETABLE COMPANION to `repeatedPhrases`, and the one to quote. A phrase count has no
 * natural ceiling and moves with sentence length, so "42" means nothing without the corpus in front of
 * you. This is bounded by the turn count and reads directly: "9 of 50 turns echoed an earlier one."
 */
export function turnsWithEcho(says: readonly string[]): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  const seen = new Set<string>()
  let echoed = 0
  for (const say of says) {
    const words = norm(say)
    const here = new Set<string>()
    for (let i = 0; i + PHRASE_WORDS <= words.length; i++) here.add(words.slice(i, i + PHRASE_WORDS).join(' '))
    for (const raw of say.split(/(?<=[.!?])\s+/)) {
      const s = norm(raw).join(' ')
      if (s.split(' ').filter(Boolean).length >= 2) here.add(s)
    }
    if ([...here].some((p) => seen.has(p))) echoed++
    for (const p of here) seen.add(p)
  }
  return echoed
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
