// The planner eval panel's PURE half — every gate dimension, exercised with no network and no spend.
//
// ⚠ THIS FILE IS THE REASON THE GATES ARE HONEST. `apps/api/eval/run.ts` spends real money and must
// never run unattended, so the logic that decides PASS/FAIL is deliberately pure and lives in
// ./checks — and it is only trustworthy if something exercises it for free. That is here.
//
// ⚠ WHAT THIS FILE DOES NOT DO: call a model. Nothing in it touches Anthropic, needs a key, or reads
// the database. If a future edit makes this test need either, that edit moved logic out of the pure
// half and IS the bug.

import { describe, expect, test } from 'bun:test'
import { checkScenario, disciplineCheck, parrotedSentences, routeKey, routingCheck, voiceCheck } from '../eval/checks'
import { personaToEvals, rollUp } from '../eval/judge'
import { SCENARIOS } from '../eval/scenarios'
import { PLANNER_SYSTEM_PROMPT } from '../src/planner-prompt'
import type { ScenarioTurn, TurnOutcome } from '../eval/types'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

const outcome = (over: Partial<TurnOutcome> = {}): TurnOutcome => ({
  scenarioId: 's',
  index: 0,
  rider: 'yes',
  expect: 'hold',
  say: 'Sounds good, friend.',
  rawRoute: null,
  routeKey: null,
  outcome: 'say',
  usd: 0.01,
  ...over,
})

describe('routeKey — drive identity', () => {
  test('start, end and via decide it', () => {
    expect(routeKey({ start_anchor_id: A, end_anchor_id: B })).toBe(routeKey({ start_anchor_id: A, end_anchor_id: B }))
    expect(routeKey({ start_anchor_id: A, end_anchor_id: B })).not.toBe(routeKey({ start_anchor_id: A, end_anchor_id: C }))
  })

  // ⚠ THE ASSERTION THIS WHOLE PANEL EXISTS FOR. `toProposeRequest` drops targetMinutes, so a
  // duration-only change is the SAME billed call and the SAME card — the founder's 2026-08-03
  // "refusing to redraw" report. If this ever splits, the eval would score that bug as a PASS.
  test('target_minutes does NOT make a different drive', () => {
    expect(routeKey({ start_anchor_id: A, end_anchor_id: B, target_minutes: 120 })).toBe(
      routeKey({ start_anchor_id: A, end_anchor_id: B, target_minutes: 30 }),
    )
  })

  test('via ORDER is load-bearing, and a missing endpoint is not a route', () => {
    expect(routeKey({ start_anchor_id: A, end_anchor_id: B, via_anchor_ids: [C, A] })).not.toBe(
      routeKey({ start_anchor_id: A, end_anchor_id: B, via_anchor_ids: [A, C] }),
    )
    expect(routeKey({ start_anchor_id: A })).toBeNull()
    expect(routeKey(null)).toBeNull()
    expect(routeKey('nope')).toBeNull()
  })
})

describe('routing gate', () => {
  test('a missing draw and an unwanted draw both fail', () => {
    expect(routingCheck(outcome({ expect: 'draw' }), new Set()).pass).toBe(false)
    expect(routingCheck(outcome({ expect: 'hold', routeKey: 'k' }), new Set()).pass).toBe(false)
  })

  test('a legitimate first draw passes', () => {
    expect(routingCheck(outcome({ expect: 'draw', routeKey: 'k' }), new Set()).pass).toBe(true)
  })

  // The post-3401b8f form of the founder's bug: the client re-flows the card, so a repeat is no
  // longer a frozen screen — it is the skipper claiming a change he did not make.
  test('re-emitting a drive already drawn fails EVEN on a draw turn', () => {
    const r = routingCheck(outcome({ expect: 'draw', routeKey: 'k' }), new Set(['k']))
    expect(r.pass).toBe(false)
    expect(r.findings.join(' ')).toContain('already drawn')
  })

  test('a paid turn that produced nothing usable fails', () => {
    for (const bad of ['truncated', 'refused', 'empty', 'aborted']) {
      expect(routingCheck(outcome({ outcome: bad }), new Set()).pass).toBe(false)
    }
  })
})

describe('voice gate', () => {
  // `route_wordless` is a live, instrumented defect: nothing structurally guarantees a text block
  // rides with a tool call, so the prompt clause is the only mechanism and this is its only test.
  test('an empty say fails', () => {
    expect(voiceCheck(outcome({ say: '   ' })).pass).toBe(false)
  })

  test('markup and emoji fail — they render as literal characters', () => {
    expect(voiceCheck(outcome({ say: 'Here is **the** plan.' })).pass).toBe(false)
    expect(voiceCheck(outcome({ say: '- one\n- two' })).pass).toBe(false)
    expect(voiceCheck(outcome({ say: 'Off we go 🚗' })).pass).toBe(false)
  })

  test('an ordinary short line passes', () => {
    expect(voiceCheck(outcome({ say: "Kings Beach out to Incline, and back around. Want me to draw that up?" })).pass).toBe(true)
  })
})

describe('discipline gate', () => {
  const turn: ScenarioTurn = { rider: 'how far?', expect: 'hold' }

  test('a distance is a defect; a DURATION the rider named is not', () => {
    expect(disciplineCheck(outcome({ say: "It's about 12 miles." }), turn).pass).toBe(false)
    // He legitimately asks for and repeats back a duration — a bare number check would fire here.
    expect(disciplineCheck(outcome({ say: 'You said a couple of hours, so about two.' }), turn).pass).toBe(true)
  })

  test('a distance dressed as a duration is the same gap', () => {
    expect(disciplineCheck(outcome({ say: "That's twenty minutes away." }), turn).pass).toBe(false)
  })

  test('a per-turn banned phrase fails, case-insensitively', () => {
    const t: ScenarioTurn = { rider: 'x', expect: 'hold', banned: ['Emerald Bay'] }
    expect(disciplineCheck(outcome({ say: 'emerald bay is lovely' }), t).pass).toBe(false)
  })
})

describe('parrot detector', () => {
  // The cheapest real quality signal available: a few-shot beats an instruction, so the failure mode
  // is the model reciting its own sample lines at every rider. No substring assertion can see that.
  test('it catches a sentence lifted verbatim out of the prompt', () => {
    const sentence = PLANNER_SYSTEM_PROMPT.split(/(?<=[.!?])\s+/).find((s) => s.trim().length > 60)!.trim()
    expect(parrotedSentences(sentence).length).toBeGreaterThan(0)
  })

  test('ordinary in-character prose is not flagged', () => {
    expect(parrotedSentences('Kings Beach it is, and back around by teatime.')).toEqual([])
  })

  // ⚠ REGRESSION, and the reason PARROT_MIN_CHARS is 45 rather than 25. This generic planning
  // question sits inside one of the prompt's longer sample lines, so a lower floor flagged the
  // Skipper for asking the very thing his job requires — which would push the prompt toward teaching
  // worse questions. Short catchphrases are the judge's `canned` flag to catch, not this detector's.
  test('a generic question the job REQUIRES is not parroting', () => {
    expect(parrotedSentences('How long do you want to be out?')).toEqual([])
    expect(parrotedSentences('Kings Beach it is. How long do you want to be out?')).toEqual([])
  })

  test('short fragments are ignored — they collide on ordinary English', () => {
    expect(parrotedSentences('That is the deal.')).toEqual([])
  })
})

describe('checkScenario threading', () => {
  // ⚠ The drawn-set is added to AFTER each check, never before — otherwise a turn's own route counts
  // as a prior draw and every legitimate first draw scores as a repeat.
  test('a first draw passes and an identical later draw fails', () => {
    const turns: ScenarioTurn[] = [
      { rider: 'do it', expect: 'draw' },
      { rider: 'cool', expect: 'hold_no_repeat' },
    ]
    const evals = checkScenario(
      [
        outcome({ index: 0, expect: 'draw', routeKey: 'k', say: 'There she is.' }),
        outcome({ index: 1, expect: 'hold_no_repeat', routeKey: 'k', say: 'Glad you like it.' }),
      ],
      turns,
    )
    const routing = evals.filter((e) => e.dimension === 'routing')
    expect(routing[0]!.pass).toBe(true)
    expect(routing[1]!.pass).toBe(false)
  })
})

describe('rollUp', () => {
  test('a gate failure fails the run; an advisory one does not', () => {
    const o = [outcome()]
    const gateFail = rollUp('r', 1, o, [{ scenarioId: 's', index: 0, dimension: 'routing', pass: false, score: 0, findings: ['x'] }], 1)
    expect(gateFail.pass).toBe(false)

    const advisoryFail = rollUp('r', 1, o, [{ scenarioId: 's', index: 0, dimension: 'persona', pass: false, score: 0.3, findings: ['x'] }], 1)
    expect(advisoryFail.pass).toBe(true)
  })

  test('it carries BILLED spend through untouched', () => {
    expect(rollUp('r', 1, [outcome()], [], 1.2345).usd).toBe(1.2345)
  })
})

describe('persona verdict mapping', () => {
  test('a canned turn is flagged even when the score is high', () => {
    const evals = personaToEvals({
      turns: [{ scenarioId: 's', index: 0, persona: 9, best: 'warm', sag: 'same line as turn 1', canned: true }],
      overall: 8,
      verdict: 'fine',
      recommendation: 'tune',
      biggestRisk: 'repetition',
    })
    expect(evals[0]!.pass).toBe(false)
    expect(evals[0]!.findings.join(' ')).toContain('canned')
  })
})

describe('the suite itself', () => {
  test('every scenario id is unique and every scenario says what it guards', () => {
    const ids = SCENARIOS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of SCENARIOS) expect(s.about.length).toBeGreaterThan(40)
  })

  test('the founder-reported cases are present and expect a HOLD on the duration change', () => {
    const s = SCENARIOS.find((x) => x.id === 'change-it-up-shorter')
    expect(s).toBeDefined()
    const shorter = s!.turns.find((t) => t.rider.includes('shorter'))
    expect(shorter?.expect).toBe('hold_no_repeat')
    // ...and the scenario must still contain a turn that legitimately DOES draw, or it would only
    // ever prove the planner can refuse.
    expect(s!.turns.some((t) => t.expect === 'draw')).toBe(true)
  })

  test('the wrap-up scenario is long enough to actually trip the notice', () => {
    const s = SCENARIOS.find((x) => x.id === 'wrap-up-long-conversation')!
    // Each turn contributes a rider AND a skipper message, so the notice fires partway through.
    expect(s.turns.length * 2).toBeGreaterThan(16)
  })
})
