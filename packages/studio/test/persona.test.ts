import { describe, expect, test } from 'bun:test'
import { personaFromKey, SKIPPER } from '../src/persona'

describe('personaFromKey', () => {
  test('the skipper key resolves to the Skipper', () => {
    expect(personaFromKey('skipper')).toBe(SKIPPER)
  })

  test('an unknown/empty key falls back to the Skipper (never persona-less)', () => {
    expect(personaFromKey('atlantis')).toBe(SKIPPER)
    expect(personaFromKey('')).toBe(SKIPPER)
  })
})

describe('Skipper persona def', () => {
  test('kit beats stay in lockstep with the kit prose in the prompts (no prose↔regex desync)', () => {
    // Each kit detector must actually fire on the prompt text that describes that beat —
    // the load-bearing sync the registry exists to keep (lint + studio share these beats).
    for (const beat of SKIPPER.kit.beats) {
      const described = beat.match.test(SKIPPER.systemPrompt) || beat.match.test(SKIPPER.framePrompt)
      expect(described).toBe(true)
    }
  })
})
