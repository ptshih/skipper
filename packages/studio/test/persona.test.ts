import { describe, expect, test } from 'bun:test'
import { personaFromKey, SKIPPER } from '../src/persona'
import { BANNED_LABELS, bannedTicsIn, PROMPT_PROSE_EXEMPT } from '../src/pipeline/lint'

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
      // PROMPT_PROSE_EXEMPT is for words the prompt must NAME to forbid them — it has to say "the
      // card" to explain what the card is. Everything else is held to the full table.
      const found = bannedTicsIn(unquoted).filter((l) => !PROMPT_PROSE_EXEMPT.has(l))
      expect(found).toEqual([])
    })

    test('every EXAMPLE narration is clean — few-shot text is the strongest conditioning here', () => {
      expect(exampleBlocks.length).toBeGreaterThan(0) // the regex must actually be finding them
      // ⚠ NO exemption here, deliberately. A scenic example once read "That is all the card gives
      // me" and taught the leak to every clip generated after it; few-shot text is the strongest
      // conditioning in this prompt, so it is held to the whole table.
      let checked = 0
      for (const block of exampleBlocks) {
        // The narration is the quoted body; the `Card:` line is input, not the Skipper talking.
        for (const [, said] of block.matchAll(/"([^"]*)"/g)) {
          checked++
          expect(bannedTicsIn(said!)).toEqual([])
        }
      }
      // ⚠ The inner loop asserts NOTHING when the regex finds nothing — reformat the examples to curly
      // quotes or an unquoted block and this test goes silently vacuous while staying green, on the one
      // prompt the repo iterates on hardest. Every example must yield at least one narration to lint.
      expect(checked).toBeGreaterThanOrEqual(exampleBlocks.length)
    })

    // ⚠ THE OTHER HALF OF THE 148-CLIP GAP, and until 2026-08-04 nothing checked it. The two tests
    // above stop the prompt from USING a banned tic. This one stops the prompt from staying SILENT
    // about one. That silence is the documented cause of the corpus's worst quality failure: the lint
    // banned nine completions of the "here's the …" family, the prose named three, and "the model
    // avoided the three it was told about and wrote the rest" — 148 of 457 released clips. Measured
    // again on 2026-08-04 before this landed: 15 labels in the table, 8 named, SEVEN linted-but-never-
    // mentioned ("wait for it", "wrap your head around", "and get this", "pretty cool, right", "the
    // story doesn't end there", "to this day", "over the years").
    //
    // The failure it prevents is not a bad clip — the lint catches those — it is a WITHHELD one:
    // retakes are bounded, so a clip can burn its budget and be dropped for a tic the model was never
    // told to avoid, which reads as the generator failing rather than the prompt under-specifying.
    //
    // ⚠ It asks `BANNED_LABELS` rather than listing phrases, so ADDING a pattern to the lint fails
    // this test until the prompt mentions it. That direction is the point: the table and the prose are
    // two hand-maintained lists and only ONE of them the model ever reads.
    test('the prompt NAMES every tic the lint bans (add to the table → say it in the prose)', () => {
      const quoted = [...prose.matchAll(/"([^"]*)"/g)].map((m) => m[1]!)
      expect(quoted.length).toBeGreaterThan(0) // the quotes must actually be found, or this is vacuous
      const named = new Set(quoted.flatMap((q) => bannedTicsIn(q)))
      const missing = BANNED_LABELS.filter((l) => !named.has(l))
      expect(missing).toEqual([])
    })
  })
})
