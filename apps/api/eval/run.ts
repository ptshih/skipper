// The planner eval CLI — replay the scripted suite against the REAL prompt and score what comes back.
//
//   bun apps/api/eval/run.ts                      # PREVIEW — spends nothing, prints the plan
//   bun apps/api/eval/run.ts --apply              # SPENDS — replays every scenario, then judges
//   bun apps/api/eval/run.ts --apply --only change-it-up-shorter
//   bun apps/api/eval/run.ts --apply --no-judge   # gates only; skips the advisory persona call
//
// ⚠ SAFE-BY-DEFAULT, matching docs/guides/ops-scripts-sop.md: no `--apply`, no model call, no dollars.
// ⚠ IT SPENDS REAL MONEY AND THEREFORE NEEDS AN EXPLICIT FOUNDER GO PER RUN (CLAUDE.md STOP). Being
//   cheap is not permission — the go is for the run, not for the script existing.
// ⚠ IT REPORTS WHAT IT BILLED, NOT WHAT IT PLANNED. Every turn's real `usage` is summed, the judge's
//   own call included; a panel that reported only the replay's half would under-report, and an
//   under-reporting guard is worse than none because it reads as reassurance.
// ⚠ NEVER wire this into `bun test` or `bun run check`. Those run unattended on every change, and an
//   inferred paid run is the one thing the STOP list forbids outright.

import { CLAUDE_MODELS, usageUsd } from '@skipper/shared'
import { runPlannerTurn, type PlannerTurnInput } from '../src/planner'
import { PLANNER_WRAP_UP_NOTICE } from '../src/planner-prompt'
import { PLAN_WRAP_UP_AFTER_MESSAGES } from '../src/limits'
import { assertedDurations, checkScenario, repeatedPhrases, routeKey, turnsWithEcho } from './checks'
import { judgePersona, judgeSpendUsd, personaToEvals, rollUp, type PersonaVerdict } from './judge'
import { FIXTURE_ANCHORS, FIXTURE_REGION, FIXTURE_SPATIAL_BLOCK, SCENARIOS } from './scenarios'
import type { Scenario, TurnEval, TurnOutcome } from './types'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const NO_JUDGE = args.includes('--no-judge')
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
/** ⚠ A MEASUREMENT LEVER, not a config. Sweeps reasoning depth so the empty-say-on-draw defect can be
 *  attributed rather than guessed at; production keeps `PLANNER_EFFORT` until a founder moves it. */
const EFFORT = args.includes('--effort')
  ? (args[args.indexOf('--effort') + 1] as 'low' | 'medium' | 'high')
  : undefined
/** ⚠ THE EXPERIMENT ARM. Injects a HAND-WRITTEN drive-time table as a volatile block after the cache
 *  breakpoint — no matrix, no migration, no Routes call, no Google terms exposure. Run the suite with
 *  and without and compare THREE numbers: the routing gate (does it plan better?), `durations`
 *  (does it leak?), and `repeats` (does it get more templated?). */
const SPATIAL = args.includes('--spatial')
/** ⚠ A/B for the drawn-memory fix (`drivePlanRequest.drawn`). Production ALWAYS sends it; this exists
 *  so the arm without it can be measured, because a fix committed on n=2 is a hypothesis. */
const NO_MEMORY = args.includes('--no-memory')

/** Rough per-turn cost, for the preview only. ⚠ Never used in the report — that reads real usage. */
const EST_USD_PER_TURN = 0.02

/** Named so the report says what a "repeated phrase" actually is, rather than printing a bare count. */
const PHRASE_LABEL = '6+ words verbatim'

const suite = ONLY ? SCENARIOS.filter((s) => s.id === ONLY) : SCENARIOS

/** Replay ONE scenario, turn by turn, exactly as the client would.
 *
 * ⚠ THE TRANSCRIPT CARRIES ROLE + TEXT ONLY, because that is all `toWire` sends (mobile
 * src/lib/planner-transcript.ts): the route object is client state and is deliberately dropped. So on
 * the turn after a draw the model's ONLY evidence that it drew is its own sentence — the structural
 * fact behind every defect this suite exists to catch. Replaying any other way would evaluate a
 * planner that does not exist.
 */
async function replay(scenario: Scenario): Promise<TurnOutcome[]> {
  const transcript: PlannerTurnInput[] = []
  const outcomes: TurnOutcome[] = []
  // ⚠ MIRRORS THE CLIENT'S `drawnRef` EXACTLY, and it has to: the model's memory of what it drew is
  // sent from the client (the server is stateless), so a replay that omitted it would measure a
  // planner nobody runs. Keyed like the client's, so a re-emitted identical route does not enter twice.
  const drawn = new Map<string, { start: string; end: string; via?: string[] | null }>()

  for (const [index, t] of scenario.turns.entries()) {
    transcript.push({ role: 'rider', text: t.rider })

    // ⚠ Reproduce the route handler's own condition rather than approximating it, or the wrap-up
    // scenario silently tests nothing — the D12 bug this repo already shipped once was a field that
    // was typed and consumed with nothing on earth setting it.
    const wrapUp = transcript.length > PLAN_WRAP_UP_AFTER_MESSAGES ? { wrapUpNotice: PLANNER_WRAP_UP_NOTICE } : {}

    const turn = await runPlannerTurn({
      turns: [...transcript],
      regionName: FIXTURE_REGION,
      anchors: FIXTURE_ANCHORS,
      ...wrapUp,
      ...(drawn.size && !NO_MEMORY ? { drawn: [...drawn.values()] } : {}),
      ...(EFFORT ? { effort: EFFORT } : {}),
      ...(SPATIAL ? { extraSystem: FIXTURE_SPATIAL_BLOCK } : {}),
    })

    outcomes.push({
      scenarioId: scenario.id,
      index,
      rider: t.rider,
      say: turn.say,
      rawRoute: turn.rawRoute,
      routeKey: routeKey(turn.rawRoute),
      outcome: turn.outcome,
      expect: t.expect,
      usd: usageUsd(CLAUDE_MODELS.planner, turn.usage),
    })

    // Faithful to production: the client appends whatever came back, and `toModelMessages` filters an
    // empty one out at the vendor seam. Pushing it here keeps the two paths identical.
    transcript.push({ role: 'skipper', text: turn.say })

    // ...and so does remembering the draw. `drawUp` on the client records the route the moment one
    // arrives, so the NEXT turn's request carries it.
    const key = routeKey(turn.rawRoute)
    if (key && !drawn.has(key)) {
      const r = turn.rawRoute as { start_anchor_id: string; end_anchor_id: string; via_anchor_ids?: string[] }
      drawn.set(key, { start: r.start_anchor_id, end: r.end_anchor_id, via: r.via_anchor_ids ?? null })
    }
  }
  return outcomes
}

function line(n: number): string {
  return '─'.repeat(n)
}

async function main(): Promise<void> {
  const turnCount = suite.reduce((n, s) => n + s.turns.length, 0)

  if (!APPLY) {
    console.log(`\nPLANNER EVAL — preview. Nothing was called and nothing was billed.\n${line(78)}`)
    for (const s of suite) {
      console.log(`  ${s.id.padEnd(28)} ${s.turns.length} turns`)
      console.log(`    ${s.about.replace(/\s+/g, ' ').slice(0, 150)}…`)
    }
    console.log(line(78))
    console.log(`  ${suite.length} scenarios, ${turnCount} planner turns`)
    console.log(`  estimated ~$${(turnCount * EST_USD_PER_TURN).toFixed(2)} for the replay, plus ONE judge call`)
    console.log(`  re-run with --apply to spend. That needs an explicit founder go.\n`)
    return
  }

  console.log(`\nPLANNER EVAL — replaying ${suite.length} scenarios (${turnCount} turns). This spends.\n`)

  const outcomes: TurnOutcome[] = []
  const evals: TurnEval[] = []
  for (const s of suite) {
    process.stdout.write(`  ${s.id.padEnd(28)} `)
    const got = await replay(s)
    outcomes.push(...got)
    const scored = checkScenario(got, s.turns)
    evals.push(...scored)
    const failed = scored.filter((e) => !e.pass).length
    console.log(failed === 0 ? 'ok' : `${failed} finding(s)`)
  }

  let verdict: PersonaVerdict | null = null
  if (!NO_JUDGE) {
    process.stdout.write(`  ${'persona judge'.padEnd(28)} `)
    try {
      verdict = await judgePersona(outcomes)
      evals.push(...personaToEvals(verdict))
      console.log(`overall ${verdict.overall}/10 — ${verdict.recommendation}`)
    } catch (err) {
      // ⚠ A judge that never ran must NOT read as a clean advisory dimension. Say so loudly; the
      // rollup treats an unevaluated dimension as passing, which is only honest alongside this line.
      console.log(`FAILED — ${err instanceof Error ? err.message : 'unknown'} (persona is UNJUDGED)`)
    }
  }

  const billed = outcomes.reduce((n, o) => n + o.usd, 0) + judgeSpendUsd
  const card = rollUp('planner-eval', suite.length, outcomes, evals, billed)

  console.log(`\n${line(78)}\nFINDINGS\n${line(78)}`)
  const bad = evals.filter((e) => !e.pass)
  if (bad.length === 0) console.log('  none — every dimension clean.')
  for (const e of bad) {
    const o = outcomes.find((x) => x.scenarioId === e.scenarioId && x.index === e.index)
    const note = suite.find((s) => s.id === e.scenarioId)?.turns[e.index]?.note
    console.log(`\n  [${e.dimension}] ${e.scenarioId} #${e.index}  (expect: ${o?.expect})`)
    console.log(`    rider: ${JSON.stringify(o?.rider ?? '')}`)
    console.log(`    said : ${JSON.stringify((o?.say ?? '').slice(0, 160))}`)
    if (note) console.log(`    why  : ${note}`)
    for (const f of e.findings) console.log(`    ⚠ ${f}`)
  }

  console.log(`\n${line(78)}\nSCORECARD\n${line(78)}`)
  for (const d of card.dimensions) {
    const mark = d.kind === 'gate' ? (d.pass ? 'PASS' : 'FAIL') : d.pass ? 'ok' : 'flagged'
    console.log(
      `  ${d.dimension.padEnd(12)} ${d.kind.padEnd(9)} ${mark.padEnd(8)} ` +
        `score ${d.score.toFixed(2)}  ${d.turnsFailed}/${d.turnsEvaluated} turns flagged`,
    )
  }
  if (verdict) {
    console.log(`\n  persona verdict: ${verdict.verdict}`)
    if (verdict.biggestRisk) console.log(`  biggest risk   : ${verdict.biggestRisk}`)
    const canned = verdict.turns.filter((t) => t.canned)
    if (canned.length) console.log(`  ⚠ ${canned.length} turn(s) read as CANNED — the jukebox failure mode`)
  }

  // ⚠ THE TWO DETERMINISTIC METRICS, and they exist because the judge's equivalents are too noisy to
  // steer by: measured 2026-08-03, the SAME prompt scored 5 canned turns on one run and 15 on the
  // next. These are computed from the transcript with no model in the loop, so a difference between
  // two arms is a difference in the prompt, not in the weather.
  const says = outcomes.map((o) => o.say)
  // ⚠ WITHIN one conversation is the ONLY number that describes a rider's experience, and pooling the
  // two was this panel's biggest measurement error. A rider sees exactly one conversation — the
  // transcript "dies with the screen, on purpose" (mobile planner-transcript.ts) — and plans one to
  // three drives ever. A phrase used once in scenario A and once in scenario B is something NOBODY can
  // observe, yet the pooled count weighted it identically to the same line twice in one chat. Every
  // jukebox figure reported before 2026-08-04 was the pooled one.
  const within = suite.flatMap((s) =>
    repeatedPhrases(outcomes.filter((o) => o.scenarioId === s.id).map((o) => o.say)),
  )
  const pooled = repeatedPhrases(says)
  const durations = outcomes.flatMap((o) => assertedDurations(o.say))

  const echoTurns = suite.reduce(
    (n, s) => n + turnsWithEcho(outcomes.filter((o) => o.scenarioId === s.id).map((o) => o.say)),
    0,
  )

  console.log(`\n${line(78)}\nMEASURED (no judge — compare these across arms)\n${line(78)}`)
  // ⚠ QUOTE THIS ONE. A phrase count has no natural ceiling and moves with sentence length, so it
  // cannot be compared across runs by eye; this is bounded by the turn count and reads directly.
  console.log(`  turns echoing an earlier turn of the SAME chat:  ${echoTurns}/${outcomes.length}`)
  console.log(`  distinct repeated phrases within one chat:      ${within.length}`)
  for (const r of within.slice(0, 6)) console.log(`    x${r.count}  ${JSON.stringify(r.phrase)}`)
  console.log(`  repeated across the whole run (no rider sees):  ${pooled.length}`)
  console.log(`  durations asserted as road fact:                 ${durations.length}`)
  for (const d of durations.slice(0, 6)) console.log(`    ${JSON.stringify(d.slice(0, 72))}`)
  if (SPATIAL) console.log(`  ⚠ --spatial ARM: a hand-written drive-time table was in context this run.`)

  // ⚠ PERSIST THE RAW TURNS. Every arm before 2026-08-04 cost $0.35-0.70 to produce numbers that were
  // printed and thrown away — and when three separate defects were later found in the metrics, none of
  // those runs could be re-scored and the money was simply gone. With the transcripts on disk any NEW
  // metric can be back-applied to runs already paid for, at zero further spend. Gitignored: these are
  // model outputs, not source, and they grow without bound.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const tag = `${NO_MEMORY ? 'nomem' : 'mem'}${SPATIAL ? '-spatial' : ''}${EFFORT ? `-${EFFORT}` : ''}`
  const path = `${import.meta.dir}/.runs/${stamp}-${tag}.json`
  await Bun.write(path, JSON.stringify({ tag, billed, outcomes, evals, verdict }, null, 1))
  console.log(`\n  raw turns saved: ${path.replace(import.meta.dir, 'apps/api/eval')}`)

  // ⚠ BILLED, from real usage on every call this process made. Not an estimate, and not the preview's.
  console.log(`  BILLED THIS RUN: $${billed.toFixed(4)}  (${outcomes.length} planner turns + judge)`)
  console.log(`  GATE: ${card.pass ? 'PASS' : 'FAIL'}\n`)

  // Non-zero exit on a gate failure, so this is usable from a script without parsing stdout.
  if (!card.pass) process.exitCode = 1
}

await main()
