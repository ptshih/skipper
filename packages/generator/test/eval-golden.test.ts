// Deterministic regression gate over the golden set. The free evaluators (tts, diversity)
// run as real assertions here — a rule change that breaks a locked-in failure mode trips in
// CI. (The LLM evaluators — grounding, charm — aren't asserted here; they're probabilistic +
// cost money, so they're measured by the on-demand calibration runner, eval/calibrate.ts.)

import { describe, expect, test } from 'bun:test'
import { TTS_CASES, DIVERSITY_CASES } from '../src/eval/golden'
import { evaluateTts } from '../src/eval/tts'
import { evaluateDiversity } from '../src/eval/diversity'
import { personaFromKey } from '../src/persona'

const KIT = personaFromKey('skipper').kit

describe('golden / tts — deterministic regression', () => {
  for (const c of TTS_CASES) {
    test(`${c.id}: ${c.why}`, () => {
      expect(evaluateTts(c.input).pass).toBe(c.expect.pass)
    })
  }
})

describe('golden / diversity — deterministic regression', () => {
  for (const c of DIVERSITY_CASES) {
    test(`${c.id}: ${c.why}`, () => {
      const failing = evaluateDiversity(c.inputs, KIT)
        .filter((e) => !e.pass)
        .map((e) => e.seq)
        .sort((a, b) => a - b)
      expect(failing).toEqual(c.expect.failingSeqs)
    })
  }
})
