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
  test('no personal-kit backstory creeps back into the stop prompt (V2 cut the intro + the kit)', () => {
    // V2 deleted the intro/outro frame that once housed a "cousin Ray" personal kit, so the host
    // invents no backstory. Guard the specific bits the founder flagged from creeping back into the
    // SPOKEN prompt (file comments may still mention them as history — this checks the prompt string).
    // The def no longer TYPES a framePrompt/kit (the compiler enforces that); this guards the prose.
    expect(SKIPPER.systemPrompt).not.toMatch(/cousin ray|getting to it tuesday/i)
  })
})
