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
import { checkScenario, routeKey } from './checks'
import { judgePersona, judgeSpendUsd, personaToEvals, rollUp, type PersonaVerdict } from './judge'
import { FIXTURE_ANCHORS, FIXTURE_REGION, SCENARIOS } from './scenarios'
import type { Scenario, TurnEval, TurnOutcome } from './types'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const NO_JUDGE = args.includes('--no-judge')
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null

/** Rough per-turn cost, for the preview only. ⚠ Never used in the report — that reads real usage. */
const EST_USD_PER_TURN = 0.02

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
    console.log(`  biggest risk   : ${verdict.biggestRisk}`)
    const canned = verdict.turns.filter((t) => t.canned)
    if (canned.length) console.log(`  ⚠ ${canned.length} turn(s) read as CANNED — the jukebox failure mode`)
  }

  // ⚠ BILLED, from real usage on every call this process made. Not an estimate, and not the preview's.
  console.log(`\n  BILLED THIS RUN: $${billed.toFixed(4)}  (${outcomes.length} planner turns + judge)`)
  console.log(`  GATE: ${card.pass ? 'PASS' : 'FAIL'}\n`)

  // Non-zero exit on a gate failure, so this is usable from a script without parsing stdout.
  if (!card.pass) process.exitCode = 1
}

await main()
