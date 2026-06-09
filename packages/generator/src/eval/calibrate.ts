// Judge↔human CALIBRATION runner for the LLM evaluators (grounding today; charm is analogous).
//
// An LLM judge is only worth anything if it predicts the human it replaces. This runs the
// labeled golden cases through the REAL grounding judge and measures agreement: did it get
// each known-answer pass/fail verdict right, and did it catch each expected violation (recall)?
// Run it after a model or prompt change to confirm the judge still tracks the founder's ear.
//
// Costs one grounding (Sonnet) call per case — ON DEMAND, not CI. The deterministic golden
// cases (tts/diversity) are the always-on gate (test/eval-golden.test.ts); this is the
// periodic calibration check. Exits non-zero if the judge disagrees with any verdict label.
//
// Usage (ANTHROPIC_API_KEY via dotenvx):
//   dotenvx run -f .env.development -- bun packages/generator/src/eval/calibrate.ts

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
  extra: number // claims flagged beyond the expected set (possible over-flagging; not penalized)
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
  }
}

async function main() {
  console.log(`Calibrating the grounding judge against ${GROUNDING_CASES.length} golden cases (Sonnet)...\n`)
  const evals = await Promise.all(GROUNDING_CASES.map((c) => evaluateGrounding(c.input)))
  const results = GROUNDING_CASES.map((c, i) => scoreCase(c, evals[i]!))

  for (const r of results) {
    const verdict = r.passMatch ? '✓' : '✗ DISAGREES'
    const want = r.expectedPass ? 'pass' : 'fail'
    const got = r.actualPass ? 'pass' : 'fail'
    let line = `${verdict}  ${r.id}  (want ${want}, got ${got})`
    if (r.missed.length) line += `  · MISSED: ${r.missed.join(', ')}`
    if (r.extra) line += `  · +${r.extra} extra flag(s)`
    console.log(line)
  }

  const verdictAgree = results.filter((r) => r.passMatch).length
  const expectedViolations = results.reduce((n, r) => n + r.caught.length + r.missed.length, 0)
  const caughtViolations = results.reduce((n, r) => n + r.caught.length, 0)
  console.log('\n' + '-'.repeat(60))
  console.log(`verdict agreement: ${verdictAgree}/${results.length}`)
  console.log(`violation recall:  ${caughtViolations}/${expectedViolations}`)

  // A known-answer verdict miss is a real calibration regression — surface it via exit code.
  if (verdictAgree < results.length) process.exitCode = 1
}

main().catch((e) => {
  console.error('\ncalibration failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
