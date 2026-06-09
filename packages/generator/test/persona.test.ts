import { describe, expect, test } from 'bun:test'
import { personaForRegion, SKIPPER } from '../src/persona'

describe('personaForRegion', () => {
  test('lake-tahoe resolves to the Skipper', () => {
    expect(personaForRegion('lake-tahoe')).toBe(SKIPPER)
  })

  test('an unknown/empty region falls back to the Skipper (never persona-less)', () => {
    expect(personaForRegion('atlantis')).toBe(SKIPPER)
    expect(personaForRegion('')).toBe(SKIPPER)
  })
})

describe('Skipper persona def', () => {
  test('host is always "Skipper" (founder rule: regions differ by voice/flavor, not name)', () => {
    expect(SKIPPER.hostName).toBe('Skipper')
  })

  test('kit beats stay in lockstep with the kit prose in the prompts (no prose↔regex desync)', () => {
    // Each kit detector must actually fire on the prompt text that describes that beat —
    // the load-bearing sync the registry exists to keep (lint + generator share these beats).
    for (const beat of SKIPPER.kit.beats) {
      const described = beat.match.test(SKIPPER.systemPrompt) || beat.match.test(SKIPPER.bracketPrompt)
      expect(described).toBe(true)
    }
  })

  test('the dropNote names the kit terms', () => {
    expect(SKIPPER.kit.dropNote.toLowerCase()).toMatch(/ray|mechanic|truck|coffee/)
  })
})
