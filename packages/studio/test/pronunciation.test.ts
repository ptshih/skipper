import { describe, expect, test } from 'bun:test'
import { pronunciationClause, PRONUNCIATIONS } from '../src/pipeline/pronunciation'
import { buildSynthesisRequest } from '../src/pipeline/tts'
import { SKIPPER_TTS_STYLE_PROMPT } from '../src/models'

const LEX = { Genoa: 'juh-NOH-uh', Verdi: 'VER-dye' }

describe('pronunciationClause — only the names this clip actually says', () => {
  test('no lexicon name → empty (the common case; prompt stays byte-identical)', () => {
    expect(pronunciationClause('Just a little spring up the way, folks.', LEX)).toBe('')
  })

  test('a present name → a guide clause naming it and its spoken form', () => {
    const c = pronunciationClause('Coming up is Genoa, oldest town in the state.', LEX)
    expect(c).toContain('"Genoa" as "juh-NOH-uh"')
    expect(c.startsWith(' ')).toBe(true) // appends cleanly onto the style prompt
  })

  test('case-insensitive', () => {
    expect(pronunciationClause('down in genoa', LEX)).toContain('"Genoa" as "juh-NOH-uh"')
  })

  test('whole-word only — does not fire inside a longer word', () => {
    expect(pronunciationClause('the Genoan valley', LEX)).toBe('')
  })

  test('multiple present names are joined', () => {
    const c = pronunciationClause('from Genoa out toward Verdi', LEX)
    expect(c).toContain('"Genoa" as "juh-NOH-uh"')
    expect(c).toContain('"Verdi" as "VER-dye"')
    expect(c).toContain(';') // joined
  })

  test('the live lexicon carries the two local-pronunciation traps', () => {
    expect(PRONUNCIATIONS.Genoa).toBe('juh-NOH-uh')
    expect(PRONUNCIATIONS.Verdi).toBe('VER-dye')
  })
})

describe('buildSynthesisRequest — the clause rides input.prompt at synth', () => {
  test('a clip that says a trap name gets the guide appended to the style prompt', () => {
    const body = buildSynthesisRequest('Welcome to Genoa, folks.', 'Charon')
    expect(body.input.prompt.startsWith(SKIPPER_TTS_STYLE_PROMPT)).toBe(true)
    expect(body.input.prompt).toContain('"Genoa" as "juh-NOH-uh"')
  })

  test('a clip with no lexicon name leaves the prompt untouched', () => {
    const body = buildSynthesisRequest('Just look at that water.', 'Charon')
    expect(body.input.prompt).toBe(SKIPPER_TTS_STYLE_PROMPT)
  })
})
