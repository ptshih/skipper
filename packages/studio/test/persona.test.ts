import { describe, expect, test } from 'bun:test'
import { personaFromKey, SKIPPER } from '../src/persona'
import { bannedTicsIn } from '../src/pipeline/lint'

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

  // ⚠ THE PROMPT MUST NOT MODEL THE TICS IT BANS. This is not hypothetical tidiness: measured over
  // the 457 released clips, 155 shipped a hard-banned wind-up and 148 of those were the "here's the …"
  // family — and the prompt itself used that construction twice in its own voice ("Here is the heart
  // of you…", "So here is how it works.") while banning only three of its completions. A prompt that
  // demonstrates a construction teaches it, and `bun run check` was green the whole time.
  //
  // Checked against `bannedTicsIn` — the LINT's own table, not a copy — so adding a pattern there
  // immediately holds the prompt to it too.
  describe('the prompt does not model the tics it forbids', () => {
    // The prompt quotes forbidden phrases in order to ban them (no "fun fact", no "here is the
    // narration"), so quoted spans in PROSE are exempt. Example narrations are the opposite case:
    // they are the Skipper speaking, and few-shot text conditions harder than prose does, so they
    // are linted directly rather than skipped for happening to be quoted.
    const prompt = SKIPPER.systemPrompt
    const exampleBlocks = [...prompt.matchAll(/<example\b[^>]*>([\s\S]*?)<\/example>/g)].map((m) => m[1]!)
    const prose = prompt.replace(/<example\b[^>]*>[\s\S]*?<\/example>/g, ' ')

    test('its own PROSE voice is clean (quoted bans exempt)', () => {
      const unquoted = prose.replace(/"[^"]*"/g, ' ')
      expect(bannedTicsIn(unquoted)).toEqual([])
    })

    test('every EXAMPLE narration is clean — few-shot text is the strongest conditioning here', () => {
      expect(exampleBlocks.length).toBeGreaterThan(0) // the regex must actually be finding them
      for (const block of exampleBlocks) {
        // The narration is the quoted body; the `Card:` line is input, not the Skipper talking.
        for (const [, said] of block.matchAll(/"([^"]*)"/g)) {
          expect(bannedTicsIn(said!)).toEqual([])
        }
      }
    })
  })
})
