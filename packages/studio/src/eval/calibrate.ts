// Judge↔human CALIBRATION runner for the LLM evaluators (grounding today; charm is analogous).
//
// An LLM judge is only worth anything if it predicts the human it replaces. This runs the
// labeled golden cases through the REAL grounding judge and measures agreement on three axes:
// the known-answer pass/fail VERDICT, RECALL (did it catch each expected violation), and
// PRECISION (did it flag anything on a case labeled clean).
// Run it after a model or prompt change to confirm the judge still tracks the founder's ear.
//
// ⚠ RECALL AND PRECISION FAIL IN OPPOSITE DIRECTIONS, which is why they are reported separately
// rather than rolled into one agreement number. A recall miss SHIPS A HALLUCINATION — the failure the
// whole fail-closed design exists to prevent. A precision miss costs money and prose: each false
// positive buys an excision round and trims a line the sheet actually supported. The production judge
// UNION-VOTES k samples (grounding.ts), so it is biased toward flagging BY CONSTRUCTION — meaning
// precision is the axis expected to drift, slowly and in one direction, after a prompt or model change.
//
// ⚠ Costs GROUNDING_VOTE_SAMPLES Opus calls per case, not one: this runs the REAL production judge
// (`evaluateGrounding` with no decomposer override → the union-VOTING decomposer), which is the point —
// calibrating a k=1 judge would measure something the gate never uses. The resolved fan-out is printed
// before the first call so the operator sees the real bill; it is ON DEMAND, not CI, and has no
// --apply gate (running it IS the request). The deterministic evaluators (tts/diversity) have their own
// always-on unit tests (test/eval-tts.test.ts, test/eval-advisory.test.ts); this is the periodic
// calibration check. Exits non-zero if the judge disagrees with any verdict label.
//
// Usage (ANTHROPIC_API_KEY via dotenvx):
//   dotenvx run -f .env.development -- bun packages/studio/src/eval/calibrate.ts

import { GROUNDING_VOTE_SAMPLES } from '../config'
import { llmSpendLines, llmSpentUsd } from '@skipper/shared'
import { GROUNDING_CASES, type GroundingCase } from './golden'
import { evaluateGrounding } from './grounding'
import type { ClaimVerdict, StopEval } from './types'

interface CaseResult {
  id: string
  expectedPass: boolean
  actualPass: boolean
  passMatch: boolean
  caught: string[] // expected violations the judge flagged (recall hits)
  missed: string[] // expected violations the judge did NOT flag (recall gaps — the dangerous miss)
  /**
   * Claims flagged beyond the labeled set.
   *
   * ⚠ THIS IS NOT A PRECISION METRIC, and reading it as one is why it sat here labeled "possible
   * over-flagging" while measuring two different things at once. On a case labeled FAIL, an extra flag
   * is very often a LEGITIMATE second violation the label simply did not enumerate — `expect.ungrounded`
   * lists the substring that case exists to lock in, not every violation in the script.
   * `grounding-scenic-names-landmark` is the proof: its script names Mount Tallac AND Cascade Lake, and
   * the label lists only `tallac`, so correctly flagging Cascade Lake scores as "extra".
   */
  extra: number
  /**
   * The subset of `extra` that IS unambiguously a false positive: a claim flagged on a case labeled
   * CLEAN, where by construction there is nothing legitimate to flag.
   *
   * ⚠ WHY THE CLEAN CASES ARE THE PRECISION SUBSTRATE, and why this is worth separating: the production
   * judge UNION-VOTES k samples (grounding.ts `makeVotingDecomposer`) — a claim flagged by ANY sample is
   * ungrounded — so precision degrades as k rises, by construction. The 10 clean cases are the only
   * place that shows up unambiguously, and each false positive there costs a real excision round and
   * erodes writing the sheet actually supported.
   */
  falsePositives: number
}

function scoreCase(c: GroundingCase, ev: StopEval): CaseResult {
  const flagged = ((ev.detail ?? []) as ClaimVerdict[])
    .filter((v) => v.status === 'ungrounded')
    .map((v) => v.claim.toLowerCase())
  const caught: string[] = []
  const missed: string[] = []
  for (const sub of c.expect.ungrounded) {
    if (flagged.some((f) => f.includes(sub.toLowerCase()))) caught.push(sub)
    else missed.push(sub)
  }
  const extra = flagged.filter(
    (f) => !c.expect.ungrounded.some((sub) => f.includes(sub.toLowerCase())),
  ).length
  return {
    id: c.id,
    expectedPass: c.expect.pass,
    actualPass: ev.pass,
    passMatch: ev.pass === c.expect.pass,
    caught,
    missed,
    extra,
    // On a CLEAN case there is nothing legitimate to flag, so every flagged claim is a false
    // positive — not just the ones beyond a labeled set (which is empty here anyway).
    falsePositives: c.expect.pass ? flagged.length : 0,
  }
}

async function main() {
  // Print the resolved fan-out, not just the case count: the judge is union-voted, so the Opus bill is
  // cases × samples. Reading the case count alone is how this run gets budgeted at a third of its cost.
  const samples = GROUNDING_VOTE_SAMPLES()
  console.log(
    `Calibrating the grounding judge against ${GROUNDING_CASES.length} golden cases ` +
      `(Opus, ${samples} vote sample(s) each → ${GROUNDING_CASES.length * samples} judge calls)...\n`,
  )
  const evals = await Promise.all(GROUNDING_CASES.map((c) => evaluateGrounding(c.input)))
  const results = GROUNDING_CASES.map((c, i) => scoreCase(c, evals[i]!))

  for (const r of results) {
    const verdict = r.passMatch ? '✓' : '✗ DISAGREES'
    const want = r.expectedPass ? 'pass' : 'fail'
    const got = r.actualPass ? 'pass' : 'fail'
    let line = `${verdict}  ${r.id}  (want ${want}, got ${got})`
    if (r.missed.length) line += `  · MISSED: ${r.missed.join(', ')}`
    // Label the two kinds of surplus flag differently — they mean opposite things. On a clean case a
    // flag is a false positive; on a failing one it is usually a real violation the label did not list.
    if (r.falsePositives) line += `  · ${r.falsePositives} FALSE POSITIVE(S)`
    else if (r.extra) line += `  · +${r.extra} additional flag(s) (may be legitimate)`
    console.log(line)
  }

  const verdictAgree = results.filter((r) => r.passMatch).length
  const expectedViolations = results.reduce((n, r) => n + r.caught.length + r.missed.length, 0)
  const caughtViolations = results.reduce((n, r) => n + r.caught.length, 0)
  const cleanCases = results.filter((r) => r.expectedPass)
  const falsePositives = cleanCases.reduce((n, r) => n + r.falsePositives, 0)
  const cleanCasesDirtied = cleanCases.filter((r) => r.falsePositives > 0).length
  console.log('\n' + '-'.repeat(60))
  console.log(`verdict agreement: ${verdictAgree}/${results.length}`)
  console.log(`violation recall:  ${caughtViolations}/${expectedViolations}   (the FAIL-CLOSED direction — a miss ships a hallucination)`)
  console.log(
    `false positives:   ${falsePositives} claim(s) across ${cleanCasesDirtied}/${cleanCases.length} clean case(s)` +
      `   (the COST direction — each one buys an excision round and trims supported writing)`,
  )

  // A known-answer verdict miss is a real calibration regression — surface it via exit code. That
  // already covers the WORST precision failure for free: a false positive on a clean case flips its
  // verdict, so it fails here rather than merely printing.
  //
  // ⚠ NOT ALSO GATED ON A false-positive COUNT, deliberately. There is no baseline run to set a
  // threshold from, and a number invented at authoring time is exactly the kind nobody can defend
  // later — it would either never fire or block a legitimate prompt improvement on its first run.
  // Print it, watch it across a few runs, THEN pick a ceiling from data if it moves. The reason it is
  // worth watching at all: `GROUNDING_VOTE_SAMPLES` biases the judge toward flagging by construction,
  // so drift here is expected to be one-directional and slow — the shape that hides in a passing gate.
  if (verdictAgree < results.length) process.exitCode = 1

  // ⚠ REPORT WHAT IT BILLED. This is a PAID run — GROUNDING_VOTE_SAMPLES Opus calls per case, 54 on the
  // 2026-08-04 run — and until then it printed no spend at all, so the operator learned the agreement
  // numbers and nothing about the cost. Doctrine is explicit: "a paid one reports what it BILLED, not
  // what it planned." Same defect fixed in classify-treatments.ts the same day; the tally already
  // existed in-process (grounding.ts records every attempt, retries included) and simply was not read.
  // ⚠ Printed AFTER the exit code is set so a disagreeing run still reports its bill — a calibration
  // that fails is exactly the one whose cost you want to know before re-running it.
  for (const line of llmSpendLines()) console.log(line)
  console.log(`\nBILLED THIS RUN: ~$${llmSpentUsd().toFixed(4)}  (${GROUNDING_VOTE_SAMPLES()} vote sample(s) × ${results.length} cases)`)
}

main().catch((e) => {
  console.error('\ncalibration failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
